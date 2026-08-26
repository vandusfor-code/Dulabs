import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { descifrarSecreto } from "@/lib/crypto";
import { clasificarFalloIA, registrarFalloIA } from "@/lib/alertas";
import { construirMensajesConHistorial, type MensajeHistorialIA } from "@/lib/historial-conversacion";
import {
  especialistaPorServicio,
  crearCitaEnCategoria,
  categoriaDeServicio,
  especialistasPorCategoria,
  citasDelDiaEnCategoria,
  confirmarCita,
  type Especialista,
} from "@/lib/especialistas";
import { notificarCitaConfirmada } from "@/lib/especialistas-notificar";
import { recordarNombreCliente } from "@/lib/clientes-conocidos";
import type { ClienteConfig } from "@/lib/supabase";

const MODELO = "claude-sonnet-5";

// Cuando quien escribe es una de las especialistas del negocio (ver
// lib/especialistas.ts especialistaPorNumero), NO se le atiende como
// clienta: puede consultar la agenda del negocio y agendar citas ya
// confirmadas en nombre de otra persona, sin pasar por el flujo de
// solicitud/aprobación de lib/especialista-solicitud-ia.ts.
export async function generarRespuestaAdminEspecialistaIA(params: {
  supabase: SupabaseClient;
  cliente: ClienteConfig;
  especialista: Especialista;
  textoUsuario: string;
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

  const tools: Anthropic.Tool[] = [
    {
      name: "consultar_citas",
      description: "Consulta las citas agendadas del negocio (todas las especialidades juntas). Si no se da fecha, muestra las próximas activas.",
      input_schema: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha en formato YYYY-MM-DD para ver un día en particular. Si se omite, muestra las próximas." },
        },
      },
    },
    {
      name: "agendar_cita_admin",
      description:
        "Agenda una cita YA CONFIRMADA para una clienta (no necesita aprobación de nadie más). Solo llamar cuando ya tengas servicio, fecha, hora y a nombre de quién es -- si no dijo el servicio, pregúntaselo primero, nunca lo asumas. Si el horario está ocupado, te devuelve los horarios tomados ese día para proponer otro.",
      input_schema: {
        type: "object",
        properties: {
          servicio: { type: "string", description: "Nombre del servicio, ej. 'pestañas' o 'semipermanente en manos'" },
          fecha: { type: "string", description: "Fecha en formato YYYY-MM-DD" },
          hora: { type: "string", description: "Hora en formato HH:MM (24h)" },
          nombre_cliente: { type: "string", description: "Nombre de la persona para quien es la cita" },
          telefono_cliente: { type: "string", description: "Teléfono de la clienta si lo sabe -- opcional. Si lo da, se le avisa por WhatsApp." },
          con_quien: {
            type: "string",
            description:
              "Nombre de la persona del equipo que la va a atender, SOLO si se especificó explícitamente (ej. 'con Carla', 'con Kelly'). Si no se menciona a nadie en particular, omite este campo -- se agenda con quien esté libre.",
          },
        },
        required: ["servicio", "fecha", "hora", "nombre_cliente"],
      },
    },
  ];

  const systemFinal =
    `Eres el asistente de agenda de "${params.cliente.nombre_negocio}". Quien te escribe ahora es ${params.especialista.nombre}, quien ADMINISTRA el negocio -- no es una clienta. Háblale directo, breve y eficiente, como a una colega, sin el tono de atención a clientas.\n` +
    `Hoy es ${hoy} (hora de Colombia).\n` +
    `Puede pedirte dos cosas: consultar qué citas hay (usa consultar_citas), o agendar una cita para alguien (usa agendar_cita_admin). Si no te dice el servicio, pregúntaselo antes de agendar -- nunca lo asumas ni inventes uno.\n` +
    `Las citas que agendes así quedan CONFIRMADAS de inmediato -- ella administra, no hace falta la aprobación de nadie más.\n` +
    `Si menciona con quién debe ser (ej. "con Carla"), pásalo en con_quien. Si no dice nada, se agenda automático con quien esté libre.\n` +
    `Si la herramienta de agendar te dice que el horario está ocupado, te devuelve los horarios ya tomados ese día -- usa eso para ofrecerle un hueco libre en vez de solo decir "ocupado".`;

  async function ejecutarHerramienta(nombre: string, input: Record<string, unknown>): Promise<string> {
    if (nombre === "consultar_citas") {
      const fecha = typeof input.fecha === "string" && input.fecha.trim() ? input.fecha.trim() : null;
      let query = params.supabase
        .from("dulabs_citas_especialista")
        .select("nombre_cliente, servicio, inicio, estado")
        .eq("phone_number_id", params.especialista.phone_number_id)
        .in("estado", ["pendiente", "confirmada", "propuesta"])
        .order("inicio", { ascending: true });

      if (fecha) {
        const desde = new Date(`${fecha}T00:00:00-05:00`);
        const hasta = new Date(`${fecha}T23:59:59-05:00`);
        if (Number.isNaN(desde.getTime())) return JSON.stringify({ success: false, error: "Fecha inválida." });
        query = query.gte("inicio", desde.toISOString()).lte("inicio", hasta.toISOString());
      } else {
        query = query.gte("inicio", new Date().toISOString()).limit(15);
      }

      const { data } = await query;
      return JSON.stringify({ success: true, citas: data ?? [] });
    }

    if (nombre === "agendar_cita_admin") {
      const servicio = String(input.servicio ?? "");
      const fecha = String(input.fecha ?? "");
      const hora = String(input.hora ?? "");
      const inicio = new Date(`${fecha}T${hora}:00-05:00`);
      if (Number.isNaN(inicio.getTime())) {
        return JSON.stringify({ success: false, error: "Fecha u hora inválida." });
      }
      const telefonoTexto = typeof input.telefono_cliente === "string" ? input.telefono_cliente.replace(/\D/g, "") : "";
      const nombreCliente = String(input.nombre_cliente ?? "Clienta");
      const conQuien = typeof input.con_quien === "string" ? input.con_quien.trim().toLowerCase() : "";

      // Igual que en el flujo de la clienta: primero especialidad propia y
      // exclusiva (pestañas), si no calza cae a la categoría compartida
      // (manos/pies) -- filtrada a una sola persona si se pidió con nombre.
      const especialistaExclusiva = await especialistaPorServicio(params.supabase, params.especialista.phone_number_id, servicio);
      let candidatas: Especialista[];
      if (especialistaExclusiva) {
        candidatas = [especialistaExclusiva];
      } else {
        const porCategoria = await especialistasPorCategoria(params.supabase, params.especialista.phone_number_id, categoriaDeServicio(servicio));
        candidatas = conQuien ? porCategoria.filter((e) => e.nombre.toLowerCase().includes(conQuien)) : porCategoria;
      }
      if (candidatas.length === 0) {
        return JSON.stringify({ success: false, error: `No manejamos "${servicio}"${conQuien ? ` con "${conQuien}"` : ""} con agenda propia todavía.` });
      }

      const duracionMin =
        typeof input.duracion_min === "number" && input.duracion_min > 0 ? input.duracion_min : candidatas[0].duracion_min;

      const resultado = await crearCitaEnCategoria(params.supabase, candidatas, {
        telefonoCliente: telefonoTexto || null,
        nombreCliente,
        servicio,
        inicio,
        duracionMin,
        origen: "manual",
      });

      if (!resultado.ok) {
        if (resultado.motivo === "ocupado") {
          const ocupados = await citasDelDiaEnCategoria(params.supabase, candidatas, fecha);
          return JSON.stringify({ success: false, ocupado: true, horarios_tomados: ocupados });
        }
        return JSON.stringify({ success: false, error: "No se pudo agendar, intenta de nuevo." });
      }

      // Se auto-confirma: la creó la propia administradora, no necesita
      // aprobarse a sí misma -- mismo criterio que la creación manual desde
      // el panel (ver app/api/agenda/[token]/route.ts).
      const confirmada = (await confirmarCita(params.supabase, resultado.cita.id)) ?? resultado.cita;
      if (confirmada.telefono_cliente) {
        await notificarCitaConfirmada(params.cliente, confirmada);
        await recordarNombreCliente(params.supabase, {
          idTenant: resultado.especialista.id_tenant,
          phoneNumberId: resultado.especialista.phone_number_id,
          telefonoCliente: confirmada.telefono_cliente,
          nombre: confirmada.nombre_cliente,
        });
      }

      return JSON.stringify({ success: true, con: resultado.especialista.nombre });
    }

    return JSON.stringify({ success: false, error: "Herramienta desconocida." });
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

    const bloquesHerramienta = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
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
      const resultado = await ejecutarHerramienta(bloque.name, bloque.input as Record<string, unknown>);
      resultados.push({ type: "tool_result", tool_use_id: bloque.id, content: resultado });
    }
    messages.push({ role: "user", content: resultados });
  }

  return null;
}
