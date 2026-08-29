import Anthropic from "@anthropic-ai/sdk";
import { descifrarSecreto } from "@/lib/crypto";
import { clasificarFalloIA, registrarFalloIA } from "@/lib/alertas";
import { construirMensajesConHistorial, type MensajeHistorialIA } from "@/lib/historial-conversacion";
import { guardarLeadEnterprise, notificarLeadEnterprise } from "@/lib/enterprise-leads";
import { activarPausaChat } from "@/lib/pausas-chat";
import type { ClienteConfig } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

const MODELO = "claude-sonnet-5";

// Traspaso a soporte humano: 24h es suficiente para que una persona del
// equipo tome la conversación de verdad, sin dejarla en silencio para
// siempre como sí tiene sentido en el onboarding ya completado (ver
// PAUSA_ONBOARDING_MS en app/webhook-dulabs/route.ts) -- acá, si la persona
// vuelve días después por otro tema, la IA debe poder atenderla de nuevo.
const PAUSA_SOPORTE_MS = 24 * 60 * 60 * 1000;

// Igual que generarRespuestaConEspecialistaIA (lib/especialista-solicitud-ia.ts),
// pero para el propio número de DuLabs: en vez de agendar una cita, la
// herramienta real que tiene disponible es dejar registrado un lead
// comercial (misma tabla que usa el formulario "Enterprise" de la landing,
// dulabs_enterprise_leads) para que el equipo comercial le dé seguimiento.
export async function generarRespuestaConLeadIA(params: {
  supabase: SupabaseClient;
  cliente: ClienteConfig;
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

  const tools: Anthropic.Tool[] = [
    {
      name: "guardar_lead_interesado",
      description:
        "Registra a esta persona como un lead comercial real para que el equipo de DuLabs le dé seguimiento directo. Solo llamar cuando la persona haya mostrado interés genuino en contratar o cotizar algo (no solo curiosidad) Y ya te haya dado, en la conversación, su nombre, empresa, correo y qué necesita. Nunca inventes ni asumas ninguno de estos datos -- si falta alguno, pregúntalo primero en texto normal.",
      input_schema: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre de la persona" },
          empresa: { type: "string", description: "Empresa a la que pertenece" },
          correo: { type: "string", description: "Correo de contacto" },
          necesidad: { type: "string", description: "Qué necesita en 1-2 líneas (ej. 'automatizar atención por WhatsApp', 'CRM a medida')" },
          detalle: { type: "string", description: "Contexto adicional relevante que haya dado, si aplica" },
        },
        required: ["nombre", "empresa", "correo", "necesidad"],
      },
    },
    {
      name: "transferir_a_soporte",
      description:
        "Transfiere la conversación a una persona del equipo de DuLabs y hace que la IA deje de responderle a este número por un buen rato. Úsala cuando la persona pida explícitamente hablar con alguien, pida soporte técnico, diga que ya es cliente y tiene un problema con su servicio, o cuando el caso sea sensible y no debas seguir resolviéndolo tú sola. Tu respuesta de texto en ese mismo turno debe ser el mensaje de despedida/traspaso -- nunca prometas un tiempo de respuesta concreto.",
      input_schema: {
        type: "object",
        properties: {
          motivo: { type: "string", description: "Por qué se transfiere, en pocas palabras (ej. 'ya es cliente, bot no le funciona')" },
        },
        required: ["motivo"],
      },
    },
  ];

  const systemFinal =
    `${params.cliente.prompt_sistema ?? ""}\n\n` +
    (params.cliente.base_conocimiento ? `--- Información de referencia de DuLabs ---\n${params.cliente.base_conocimiento}\n\n` : "") +
    `--- Registro de leads ---\n` +
    `Tienes disponible guardar_lead_interesado para dejar registrado a alguien realmente interesado, con seguimiento real de un humano del equipo -- no es una promesa vacía. Nunca digas "ya quedó registrado" o "te contactamos pronto" a menos que de verdad hayas llamado esa herramienta y haya funcionado. Si todavía no tienes los 4 datos (nombre, empresa, correo, necesidad), sigue conversando para conseguirlos de a uno, no los pidas todos de golpe en un solo mensaje.\n\n` +
    `--- Traspaso a soporte ---\n` +
    `Tienes disponible transferir_a_soporte para pasarle la conversación a una persona del equipo. Úsala cuando corresponda (pide soporte, ya es cliente con un problema, pide hablar con alguien, caso sensible) y no antes -- no la uses solo porque la conversación se puso difícil. Nunca digas "te transferí" o "ya te está atendiendo alguien" a menos que de verdad hayas llamado esa herramienta.`;

  async function ejecutarHerramienta(nombreHerramienta: string, input: Record<string, unknown>): Promise<string> {
    if (nombreHerramienta === "transferir_a_soporte") {
      await activarPausaChat(params.supabase, params.cliente.phone_number_id, params.telefonoRemitente, PAUSA_SOPORTE_MS);
      return JSON.stringify({ success: true });
    }

    const nombre = String(input.nombre ?? "").trim();
    const empresa = String(input.empresa ?? "").trim();
    const correo = String(input.correo ?? "").trim();
    const necesidad = String(input.necesidad ?? "").trim();
    if (!nombre || !empresa || !correo || !necesidad) {
      return JSON.stringify({ success: false, error: "Faltan datos (nombre, empresa, correo o necesidad)." });
    }
    const lead = {
      nombre,
      empresa,
      correo,
      telefono: params.telefonoRemitente,
      necesidad,
      detalle: typeof input.detalle === "string" ? input.detalle : undefined,
    };
    const saved = await guardarLeadEnterprise(params.supabase, lead);
    if (!saved.success) return JSON.stringify({ success: false, error: "No se pudo guardar, intenta de nuevo." });
    await notificarLeadEnterprise(lead);
    return JSON.stringify({ success: true });
  }

  const MENSAJE_RESPALDO =
    "¡Uy, disculpa! Tuve un problema técnico respondiéndote 😅 ¿me escribes de nuevo en un momento? Ya reviso qué pasó.";

  async function respaldoPorFalloSilencioso(mensaje: string): Promise<string> {
    await registrarFalloIA({
      tipo: "otro",
      mensaje,
      idTenant: params.cliente.id_tenant,
      phoneNumberId: params.cliente.phone_number_id,
      nombreNegocio: params.cliente.nombre_negocio,
    });
    return MENSAJE_RESPALDO;
  }

  const messages = construirMensajesConHistorial(params.historial ?? [], params.textoUsuario);
  const MAX_TURNOS_HERRAMIENTA = 3;

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
      return MENSAJE_RESPALDO;
    }

    const bloquesHerramienta = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (bloquesHerramienta.length === 0 || response.stop_reason !== "tool_use") {
      const texto = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (texto) return texto;
      return respaldoPorFalloSilencioso(
        `La IA devolvió texto vacío (stop_reason=${response.stop_reason}). Mensaje del usuario: "${params.textoUsuario.slice(0, 200)}"`
      );
    }

    messages.push({ role: "assistant", content: response.content });
    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const bloque of bloquesHerramienta) {
      const resultado = await ejecutarHerramienta(bloque.name, bloque.input as Record<string, unknown>);
      resultados.push({ type: "tool_result", tool_use_id: bloque.id, content: resultado });
    }
    messages.push({ role: "user", content: resultados });
  }

  return respaldoPorFalloSilencioso(`Se agotaron los ${MAX_TURNOS_HERRAMIENTA} turnos de herramienta sin devolver texto final.`);
}
