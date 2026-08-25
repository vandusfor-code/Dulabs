import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { descifrarSecreto } from "@/lib/crypto";
import { clasificarFalloIA, registrarFalloIA } from "@/lib/alertas";
import { construirMensajesConHistorial, type MensajeHistorialIA } from "@/lib/historial-conversacion";
import {
  especialistaPorServicio,
  crearCitaEspecialista,
  propuestaPendientePara,
  aceptarPropuesta,
  rechazarPropuesta,
} from "@/lib/especialistas";
import { notificarNuevaSolicitud, formatearFechaHora } from "@/lib/especialistas-notificar";
import type { ClienteConfig } from "@/lib/supabase";
import type { Especialista } from "@/lib/especialistas";

const MODELO = "claude-sonnet-5";

// Igual que generarRespuestaIA (lib/ia.ts), pero con UNA herramienta real:
// crear una solicitud de cita para un servicio que tiene especialista propia
// con agenda (ej. pestañas -> Nicol). El resto de servicios del negocio
// (uñas, cejas...) el modelo los sigue tratando en texto libre, como
// siempre -- esta herramienta solo existe para los servicios que de verdad
// tienen un calendario real detrás.
//
// El modelo NUNCA confirma la cita por su cuenta: la herramienta hace el
// intento de reserva atómico (ver lib/especialistas.ts, constraint EXCLUDE)
// y le devuelve el resultado real. Si el horario ya está ocupado, el modelo
// se entera por la propia herramienta -- no puede inventarse disponibilidad.
export async function generarRespuestaConEspecialistaIA(params: {
  supabase: SupabaseClient;
  cliente: ClienteConfig;
  systemPromptBase: string;
  textoUsuario: string;
  telefonoRemitente: string;
  historial?: MensajeHistorialIA[];
}): Promise<string | null> {
  const apiKey = params.cliente.api_key_ia ? descifrarSecreto(params.cliente.api_key_ia) : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await registrarFalloIA({
      tipo: "sin_key",
      mensaje: "No hay api_key_ia del tenant ni ANTHROPIC_API_KEY en el servidor",
      idTenant: params.cliente.id_tenant,
      phoneNumberId: params.cliente.phone_number_id,
      nombreNegocio: params.cliente.nombre_negocio,
    });
    return null;
  }

  const anthropic = new Anthropic({ apiKey });
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }); // YYYY-MM-DD

  // Si esta clienta tiene un horario propuesto esperando respuesta, su
  // próximo mensaje probablemente es un sí/no a eso -- no una solicitud
  // nueva. Se lo decimos al modelo explícitamente en vez de esperar que lo
  // adivine del historial.
  const propuesta = await propuestaPendientePara(params.supabase, params.cliente.phone_number_id, params.telefonoRemitente);

  const tools: Anthropic.Tool[] = [
    {
      name: "crear_solicitud_cita",
      description:
        "Crea la solicitud de cita para un servicio con agenda real y avisa a la especialista. Solo llamar cuando ya tengas servicio, fecha, hora y nombre confirmados por la clienta.",
      input_schema: {
        type: "object",
        properties: {
          servicio: { type: "string", description: "Nombre del servicio, ej. 'pestañas'" },
          fecha: { type: "string", description: "Fecha en formato YYYY-MM-DD" },
          hora: { type: "string", description: "Hora en formato HH:MM (24h)" },
          nombre_cliente: { type: "string", description: "Nombre de la clienta" },
        },
        required: ["servicio", "fecha", "hora", "nombre_cliente"],
      },
    },
  ];

  let systemFinal =
    `${params.systemPromptBase}\n\n` +
    `--- Agenda real ---\n` +
    `Hoy es ${hoy} (hora de Colombia). Para el servicio con agenda propia (ver la herramienta disponible) SÍ tienes una forma real de crear la solicitud en el sistema: usa crear_solicitud_cita solo cuando ya tengas confirmados por la clienta el servicio, la fecha, la hora y el nombre. No la llames antes de tener los cuatro datos completos.\n` +
    `Si la herramienta te dice que el horario está ocupado, díselo a la clienta tal cual y pídele que proponga otro horario -- nunca inventes ni asumas disponibilidad.\n` +
    `Para cualquier OTRO servicio que no tenga esa herramienta, sigues funcionando igual que siempre: solo tomas nota de la solicitud en texto, sin agenda real todavía.`;

  if (propuesta) {
    tools.push(
      {
        name: "aceptar_propuesta_horario",
        description: "La clienta acepta el nuevo horario que la especialista le propuso. Llamar sin argumentos.",
        input_schema: { type: "object", properties: {} },
      },
      {
        name: "rechazar_propuesta_horario",
        description:
          "La clienta NO acepta el horario propuesto y quiere otro. Llamar sin argumentos -- después ayúdala a buscar un nuevo horario con crear_solicitud_cita.",
        input_schema: { type: "object", properties: {} },
      }
    );
    systemFinal +=
      `\n\n--- Propuesta de horario pendiente ---\n` +
      `Le propusiste a esta clienta ${propuesta.servicio} el ${formatearFechaHora(propuesta.inicio)}, y está esperando que responda si le sirve. ` +
      `Interpreta su próximo mensaje como esa respuesta: si acepta (sí, dale, listo, me sirve, etc.) usa aceptar_propuesta_horario. Si no acepta o pide otro horario, usa rechazar_propuesta_horario, y luego ayúdala a encontrar uno nuevo con crear_solicitud_cita como de costumbre.`;
  }

  async function ejecutarHerramientaConNombre(nombre: string, input: Record<string, unknown>): Promise<string> {
    if (nombre === "aceptar_propuesta_horario") {
      if (!propuesta) return JSON.stringify({ success: false, error: "No hay ninguna propuesta pendiente." });
      const cita = await aceptarPropuesta(params.supabase, propuesta.id);
      return JSON.stringify(cita ? { success: true } : { success: false, error: "Esa propuesta ya no está disponible." });
    }
    if (nombre === "rechazar_propuesta_horario") {
      if (!propuesta) return JSON.stringify({ success: false, error: "No hay ninguna propuesta pendiente." });
      const cita = await rechazarPropuesta(params.supabase, propuesta.id);
      return JSON.stringify(cita ? { success: true } : { success: false, error: "Esa propuesta ya no está disponible." });
    }
    return ejecutarHerramienta(input);
  }

  async function ejecutarHerramienta(input: Record<string, unknown>): Promise<string> {
    const servicio = String(input.servicio ?? "");
    const especialista = await especialistaPorServicio(params.supabase, params.cliente.phone_number_id, servicio);
    if (!especialista) {
      return JSON.stringify({ success: false, error: `No manejamos "${servicio}" con agenda propia todavía.` });
    }

    const fecha = String(input.fecha ?? "");
    const hora = String(input.hora ?? "");
    const inicio = new Date(`${fecha}T${hora}:00-05:00`);
    if (Number.isNaN(inicio.getTime())) {
      return JSON.stringify({ success: false, error: "Fecha u hora inválida." });
    }

    const resultado = await crearCitaEspecialista(params.supabase, {
      especialistaId: especialista.id,
      idTenant: especialista.id_tenant,
      phoneNumberId: especialista.phone_number_id,
      telefonoCliente: params.telefonoRemitente,
      nombreCliente: String(input.nombre_cliente ?? "Clienta"),
      servicio,
      inicio,
      duracionMin: especialista.duracion_min,
      origen: "whatsapp_ia",
    });

    if (!resultado.ok) {
      if (resultado.motivo === "ocupado") {
        return JSON.stringify({ success: false, ocupado: true });
      }
      return JSON.stringify({ success: false, error: "No se pudo crear la solicitud, intenta de nuevo." });
    }

    // Best-effort: si la notificación a la especialista falla, la solicitud
    // ya quedó guardada igual -- no se pierde nada, solo no le llega el aviso.
    await notificarNuevaSolicitud(params.cliente, especialista as Especialista, resultado.cita);

    return JSON.stringify({ success: true });
  }

  const messages = construirMensajesConHistorial(params.historial ?? [], params.textoUsuario);
  const MAX_TURNOS_HERRAMIENTA = 4;

  for (let turno = 0; turno < MAX_TURNOS_HERRAMIENTA; turno++) {
    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.create({
        model: MODELO,
        max_tokens: 1024,
        system: [{ type: "text", text: systemFinal, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
      });
    } catch (err) {
      const { tipo, mensaje, status } = clasificarFalloIA(err);
      await registrarFalloIA({
        tipo,
        mensaje,
        status,
        idTenant: params.cliente.id_tenant,
        phoneNumberId: params.cliente.phone_number_id,
        nombreNegocio: params.cliente.nombre_negocio,
      });
      return null;
    }

    const bloquesHerramienta = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (bloquesHerramienta.length === 0 || response.stop_reason !== "tool_use") {
      const texto = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return texto || null;
    }

    messages.push({ role: "assistant", content: response.content });
    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const bloque of bloquesHerramienta) {
      const resultado = await ejecutarHerramientaConNombre(bloque.name, bloque.input as Record<string, unknown>);
      resultados.push({ type: "tool_result", tool_use_id: bloque.id, content: resultado });
    }
    messages.push({ role: "user", content: resultados });
  }

  return null;
}
