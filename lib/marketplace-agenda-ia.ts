import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { descifrarSecreto } from "@/lib/crypto";
import {
  verificarDisponibilidad,
  sugerirHorariosLibres,
  crearCita,
  citasProximasDelCliente,
  citasDeFecha,
  cancelarCita,
  reagendarCita,
  obtenerCitaPorId,
  horaCorta,
  type Cita,
} from "@/lib/marketplace-citas";

const MODELO = "claude-opus-4-8";
const MAX_TURNOS_HERRAMIENTA = 4;

export interface ResultadoAgendaIA {
  texto: string | null;
}

// Genera la respuesta de un agente del Marketplace con capacidad de agenda
// real: a diferencia de generarRespuestaIA (lib/ia.ts, solo texto), aquí el
// modelo puede llamar herramientas que consultan/crean/cancelan/reagendan
// citas de verdad contra dulabs_marketplace_citas. El modelo NUNCA escribe
// directamente en la base — solo pide la acción, y este código la ejecuta y
// le devuelve el resultado real antes de que redacte su respuesta final.
export async function generarRespuestaAgendaIA(params: {
  supabase: SupabaseClient;
  systemPrompt: string;
  apiKeyCifrada: string | null;
  textoUsuario: string;
  activacionId: number;
  phoneNumberId: string;
  telefonoRemitente: string;
  nombreRemitente: string | null;
  esAdmin: boolean;
  recursosDisponibles: number;
  duracionEstandarMin: number;
}): Promise<ResultadoAgendaIA> {
  const apiKey = params.apiKeyCifrada ? descifrarSecreto(params.apiKeyCifrada) : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[marketplace-agenda-ia] sin API key de IA configurada");
    return { texto: null };
  }

  const anthropic = new Anthropic({ apiKey });

  const tools: Anthropic.Tool[] = [
    {
      name: "consultar_disponibilidad",
      description:
        "Consulta si hay cupo para una fecha y hora específicas, antes de agendar. Si no hay cupo, devuelve hasta 3 horarios alternativos cercanos ese mismo día.",
      input_schema: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha en formato YYYY-MM-DD" },
          hora: { type: "string", description: "Hora en formato HH:MM (24h)" },
        },
        required: ["fecha", "hora"],
      },
    },
    {
      name: "agendar_cita",
      description:
        "Crea una cita nueva para el remitente de este mensaje, en la fecha/hora dadas. Úsala SOLO después de confirmar disponibilidad y que el cliente confirmó que quiere ese horario.",
      input_schema: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha en formato YYYY-MM-DD" },
          hora: { type: "string", description: "Hora en formato HH:MM (24h)" },
          servicio: { type: "string", description: "Servicio o motivo de la cita, si el cliente lo mencionó" },
        },
        required: ["fecha", "hora"],
      },
    },
    {
      name: "consultar_mis_citas",
      description:
        "Devuelve las próximas citas agendadas del remitente de este mensaje. Úsala antes de cancelar o reagendar si el cliente no especifica cuál cita.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "cancelar_cita",
      description:
        "Cancela una cita. Si el remitente solo tiene una cita próxima, puedes omitir cita_id y se cancela esa. Si tiene varias, primero usa consultar_mis_citas y pide al cliente que confirme cuál.",
      input_schema: {
        type: "object",
        properties: { cita_id: { type: "integer", description: "ID de la cita a cancelar (opcional si el cliente solo tiene una)" } },
      },
    },
    {
      name: "reagendar_cita",
      description:
        "Cambia la fecha/hora de una cita existente (no crea una nueva). Si el remitente solo tiene una cita próxima, puedes omitir cita_id.",
      input_schema: {
        type: "object",
        properties: {
          cita_id: { type: "integer", description: "ID de la cita a reagendar (opcional si el cliente solo tiene una)" },
          nueva_fecha: { type: "string", description: "Nueva fecha en formato YYYY-MM-DD" },
          nueva_hora: { type: "string", description: "Nueva hora en formato HH:MM (24h)" },
        },
        required: ["nueva_fecha", "nueva_hora"],
      },
    },
  ];

  // Herramienta solo visible/utilizable cuando el remitente es el número
  // admin configurado (ver INSTRUCCION_ADMIN en lib/marketplace.ts) — un
  // cliente normal nunca ve esta herramienta en su lista disponible.
  if (params.esAdmin) {
    tools.push({
      name: "consultar_citas_del_negocio",
      description: "SOLO para el administrador del negocio: lista todas las citas agendadas de una fecha, de cualquier cliente.",
      input_schema: {
        type: "object",
        properties: { fecha: { type: "string", description: "Fecha en formato YYYY-MM-DD" } },
        required: ["fecha"],
      },
    });
  }

  // Resuelve a qué cita se refiere cancelar_cita/reagendar_cita. Un cliente
  // normal SOLO puede tocar sus propias citas — aunque el modelo alucine un
  // cita_id ajeno, aquí se filtra siempre contra citasProximasDelCliente.
  async function resolverCitaObjetivo(citaIdInput: unknown): Promise<Cita | null> {
    if (citaIdInput != null) {
      const id = Number(citaIdInput);
      if (!Number.isFinite(id)) return null;
      if (params.esAdmin) return obtenerCitaPorId(params.supabase, id, params.activacionId);
      const propias = await citasProximasDelCliente(params.supabase, params.activacionId, params.telefonoRemitente);
      return propias.find((c) => c.id === id) ?? null;
    }
    const propias = await citasProximasDelCliente(params.supabase, params.activacionId, params.telefonoRemitente);
    return propias.length === 1 ? propias[0] : null;
  }

  async function ejecutarHerramienta(nombre: string, input: Record<string, unknown>): Promise<string> {
    switch (nombre) {
      case "consultar_disponibilidad": {
        const fecha = String(input.fecha ?? "");
        const hora = String(input.hora ?? "");
        const libre = await verificarDisponibilidad(params.supabase, {
          activacionId: params.activacionId,
          fecha,
          hora,
          duracionMin: params.duracionEstandarMin,
          recursosDisponibles: params.recursosDisponibles,
        });
        if (libre) return JSON.stringify({ disponible: true });
        const alternativas = await sugerirHorariosLibres(params.supabase, {
          activacionId: params.activacionId,
          fecha,
          horaDeseada: hora,
          duracionMin: params.duracionEstandarMin,
          recursosDisponibles: params.recursosDisponibles,
        });
        return JSON.stringify({ disponible: false, alternativas });
      }
      case "agendar_cita": {
        const fecha = String(input.fecha ?? "");
        const hora = String(input.hora ?? "");
        // crearCita hace su propio chequeo de cupo de forma atómica (RPC
        // dulabs_reservar_cita) — un verificarDisponibilidad previo aquí
        // sería redundante Y volvería a abrir la misma ventana de carrera
        // que se está cerrando (hallazgo #5).
        const cita = await crearCita(params.supabase, {
          activacionId: params.activacionId,
          phoneNumberId: params.phoneNumberId,
          numeroCliente: params.telefonoRemitente,
          nombreCliente: params.nombreRemitente,
          fecha,
          hora,
          duracionMin: params.duracionEstandarMin,
          servicio: input.servicio ? String(input.servicio) : null,
          recursosDisponibles: params.recursosDisponibles,
        });
        if (!cita) {
          return JSON.stringify({ success: false, motivo: "Ese horario ya no tiene cupo. Vuelve a consultar disponibilidad." });
        }
        return JSON.stringify({ success: true, cita_id: cita.id });
      }
      case "consultar_mis_citas": {
        const citas = await citasProximasDelCliente(params.supabase, params.activacionId, params.telefonoRemitente);
        return JSON.stringify({
          citas: citas.map((c) => ({ id: c.id, fecha: c.fecha, hora: horaCorta(c.hora_inicio), servicio: c.servicio })),
        });
      }
      case "cancelar_cita": {
        const cita = await resolverCitaObjetivo(input.cita_id);
        if (!cita) return JSON.stringify({ success: false, motivo: "No encontré esa cita." });
        await cancelarCita(params.supabase, cita.id, params.activacionId);
        return JSON.stringify({ success: true });
      }
      case "reagendar_cita": {
        const cita = await resolverCitaObjetivo(input.cita_id);
        if (!cita) return JSON.stringify({ success: false, motivo: "No encontré esa cita." });
        const nuevaFecha = String(input.nueva_fecha ?? "");
        const nuevaHora = String(input.nueva_hora ?? "");
        // Mismo criterio que agendar_cita: reagendarCita hace su propio
        // chequeo de cupo atómico (RPC dulabs_reagendar_cita), excluyendo
        // esta misma cita del conteo — sin pre-check separado que reabra la
        // ventana de carrera.
        const actualizada = await reagendarCita(
          params.supabase,
          cita.id,
          params.activacionId,
          nuevaFecha,
          nuevaHora,
          params.duracionEstandarMin,
          params.recursosDisponibles
        );
        if (!actualizada) return JSON.stringify({ success: false, motivo: "Ese nuevo horario no tiene cupo." });
        return JSON.stringify({ success: true });
      }
      case "consultar_citas_del_negocio": {
        if (!params.esAdmin) return JSON.stringify({ error: "No autorizado" });
        const fecha = String(input.fecha ?? "");
        const citas = await citasDeFecha(params.supabase, params.activacionId, fecha);
        return JSON.stringify({
          citas: citas.map((c) => ({
            id: c.id,
            hora: horaCorta(c.hora_inicio),
            nombre_cliente: c.nombre_cliente,
            telefono: c.numero_cliente,
            servicio: c.servicio,
          })),
        });
      }
      default:
        return JSON.stringify({ error: "Herramienta desconocida" });
    }
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const contextoAgenda = `Hoy es ${hoy}. Cada cita dura ${params.duracionEstandarMin} minutos. Usa las herramientas disponibles para consultar disponibilidad, agendar, consultar, cancelar o reagendar citas — nunca inventes disponibilidad ni confirmes una cita sin llamar antes a agendar_cita. No inventes el ID de una cita: si no lo sabes, consulta primero con consultar_mis_citas.`;
  const systemFinal = `${params.systemPrompt}\n\n--- Agenda ---\n${contextoAgenda}`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: params.textoUsuario }];

  for (let turno = 0; turno < MAX_TURNOS_HERRAMIENTA; turno++) {
    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.create({
        model: MODELO,
        max_tokens: 1024,
        system: systemFinal,
        tools,
        messages,
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        console.error("[marketplace-agenda-ia] IA rate-limited");
      } else if (err instanceof Anthropic.APIError) {
        console.error(`[marketplace-agenda-ia] error de IA ${err.status}:`, err.message);
      } else {
        console.error("[marketplace-agenda-ia] error de IA:", err instanceof Error ? err.message : err);
      }
      return { texto: null };
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
      return { texto: texto || null };
    }

    messages.push({ role: "assistant", content: response.content });
    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const bloque of bloquesHerramienta) {
      const resultado = await ejecutarHerramienta(bloque.name, bloque.input as Record<string, unknown>);
      resultados.push({ type: "tool_result", tool_use_id: bloque.id, content: resultado });
    }
    messages.push({ role: "user", content: resultados });
  }

  return { texto: "Un momento, deja lo confirmo y te aviso. ¿Puedes repetir tu solicitud?" };
}
