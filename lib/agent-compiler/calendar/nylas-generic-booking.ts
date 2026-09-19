// DuLabs Business — Agent Compiler, Bloque 16 — agendamiento genérico Nylas.
//
// Acción PROPIA del Business Agent Compiler, DELIBERADAMENTE separada de
// crear_cita_nylas (AMORE, lib/flow/executors/internal-action-executor.ts::
// crearCitaNylasAction) -- esa acción exige request.payload.agendamiento, un
// objeto con especialista/servicio ya resueltos que SOLO produce el motor de
// escenarios propio de AMORE (lib/bot-escenarios/resolver.ts). El patrón
// genérico propose_action->action que emite el Business Agent Compiler
// entrega parámetros simples (fecha/hora en texto YA estructurado por la
// IA) -- el MISMO contrato que consume agendar_cita_especialista (provider
// "internal", confirmado funcional). Este módulo replica ESE contrato para
// el provider "nylas": ningún tenant necesita el motor de escenarios de
// AMORE para reservar contra SU PROPIO calendario conectado (Bloque 15).
//
// crearCitaNylasAction (AMORE) NO se modifica. Cero fallback cruzado.
//
// REGLA (spec Bloque 16): la IA NUNCA calcula disponibilidad ni decide si
// un horario está libre -- solo transforma la intención conversacional en
// fecha/hora estructuradas (igual que ya hace para agendar_cita_especialista).
// Este módulo (backend) es quien:
//   1. resuelve el calendario conectado del tenant (nunca del payload/LLM);
//   2. consulta eventos reales del calendario en la ventana solicitada;
//   3. rechaza si hay conflicto real (nunca inventa disponibilidad);
//   4. crea el evento SOLO si no hay conflicto;
//   5. es idempotente por (tenantId, executionRowId, effectId) -- un
//      reintento/replay del mismo efecto NUNCA duplica la reserva.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ejecutarConIdempotencia, huellaSolicitud } from "@/lib/idempotencia-reserva";
import type { NylasEvent, NylasEventsClient, NylasEventsWriteClient } from "@/lib/nylas/nylas-types";
import type { CalendarConnectionStore } from "@/lib/agent-compiler/calendar/types";
import type { BusinessHours } from "@/lib/agent-compiler/spec/types";
import { evaluateBusinessHours } from "@/lib/business-hours";
import { TIMEZONE_COLOMBIA } from "@/lib/timezone-colombia";

export interface CrearCitaNylasGenericoParams {
  tenantId: string;
  executionRowId: string;
  effectId: string;
  /** YYYY-MM-DD -- ya estructurado por la IA al proponer la acción (nunca texto libre). */
  fecha: string;
  /** HH:MM 24h -- ídem. */
  hora: string;
  nombreCliente: string;
  telefonoCliente?: string;
  servicio?: string;
  notas?: string;
  duracionMinInput?: number;
  /**
   * Horario de atención del negocio (regla de disponibilidad). Si viene, el
   * turno completo debe caber en él ANTES de tocar el calendario. null/undefined
   * = sin regla de horario (compatibilidad).
   */
  businessHours?: BusinessHours | null;
}

export type CrearCitaNylasGenericoRechazoMotivo =
  | "datos_incompletos"
  | "fecha_invalida"
  | "fuera_de_horario"
  | "calendario_no_conectado"
  | "proveedor_no_disponible"
  | "ocupado"
  | "error_tecnico"
  | "en_progreso"
  | "conflicto_reintento";

export type ResultadoCrearCitaNylasGenerico =
  | { ok: true; citaId: string; inicioIso: string; finIso: string }
  | { ok: false; motivo: CrearCitaNylasGenericoRechazoMotivo; detalle: string };

const DURACION_MIN_DEFAULT = 60;
/** Defensivo: nunca una "cita" de más de 8h por un dato corrupto/alucinado. */
const DURACION_MIN_MAX = 8 * 60;

/** Mismo criterio EXACTO que especialistas-flow-adaptador.ts::parseFechaHora (offset fijo Colombia, sin DST). */
function parseFechaHora(fecha: string, hora: string): Date | null {
  const inicio = new Date(`${fecha}T${hora}:00-05:00`);
  return Number.isNaN(inicio.getTime()) ? null : inicio;
}

function seSolapan(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function rangoUnixDeEvento(when: NylasEvent["when"]): { start: number; end: number } | null {
  if (when.object === "timespan") return { start: when.start_time, end: when.end_time };
  // Eventos de día completo (feriados, bloqueos manuales de agenda) -- se
  // tratan como ocupando el día entero: nunca se agenda "por encima" de un
  // bloqueo real solo porque no era un timespan preciso.
  if (when.object === "datespan") {
    return {
      start: Math.floor(new Date(`${when.start_date}T00:00:00-05:00`).getTime() / 1000),
      end: Math.floor(new Date(`${when.end_date}T23:59:59-05:00`).getTime() / 1000),
    };
  }
  return {
    start: Math.floor(new Date(`${when.date}T00:00:00-05:00`).getTime() / 1000),
    end: Math.floor(new Date(`${when.date}T23:59:59-05:00`).getTime() / 1000),
  };
}

/** true si algún evento REAL (no cancelado) del calendario se solapa con [startUnix, endUnix). Nunca "adivina": compara contra los eventos reales devueltos por Nylas. */
export function hayConflictoDeHorario(eventos: NylasEvent[], startUnix: number, endUnix: number): boolean {
  for (const ev of eventos) {
    if (ev.status === "cancelled") continue;
    const rango = rangoUnixDeEvento(ev.when);
    if (rango && seSolapan(startUnix, endUnix, rango.start, rango.end)) return true;
  }
  return false;
}

export interface CrearCitaNylasGenericoDeps {
  supabase: SupabaseClient;
  calendarStore: CalendarConnectionStore;
  /** null = credenciales de Nylas no configuradas -- NUNCA se simula una conexión. */
  nylasApiKey: string | null;
  createNylasEventsClient: (apiKey: string) => NylasEventsClient;
  createNylasEventsWriteClient: (apiKey: string) => NylasEventsWriteClient;
}

/**
 * Orquestación pura (sin acoplar al Flow Engine/EffectDispatchRequest --
 * eso lo hace el wrapper delgado en internal-action-executor.ts). Revalida
 * disponibilidad real INMEDIATAMENTE antes de crear el evento (defensa ante
 * concurrencia: dos solicitudes casi simultáneas nunca reservan el mismo
 * horario dos veces) y usa ejecutarConIdempotencia (lib/idempotencia-reserva.ts,
 * genérica, YA reutilizada por otros consumidores -- no se duplica el
 * mecanismo) para que un reintento/replay del MISMO effectId nunca duplique
 * el evento en el calendario real.
 */
export async function crearCitaNylasGenerico(
  deps: CrearCitaNylasGenericoDeps,
  params: CrearCitaNylasGenericoParams,
  signal?: AbortSignal,
): Promise<ResultadoCrearCitaNylasGenerico> {
  if (!params.fecha || !params.hora || !params.nombreCliente) {
    return { ok: false, motivo: "datos_incompletos", detalle: "Faltan datos reales de la cita (fecha, hora o nombre) para poder reservar." };
  }
  const inicio = parseFechaHora(params.fecha, params.hora);
  if (!inicio) {
    return { ok: false, motivo: "fecha_invalida", detalle: "Fecha u hora inválida." };
  }

  // Calendario SIEMPRE resuelto server-side por tenantId (nunca del
  // payload/LLM/frontend) -- ver lib/agent-compiler/calendar/types.ts.
  const conn = await deps.calendarStore.getConnection(params.tenantId);
  if (!conn || conn.status !== "connected" || !conn.grantId || !conn.selectedCalendarId) {
    return { ok: false, motivo: "calendario_no_conectado", detalle: "No hay un calendario conectado para este negocio todavía." };
  }
  if (!deps.nylasApiKey) {
    return { ok: false, motivo: "proveedor_no_disponible", detalle: "La integración de calendario no está disponible en este momento." };
  }

  const duracionMin =
    params.duracionMinInput && params.duracionMinInput > 0 && params.duracionMinInput <= DURACION_MIN_MAX
      ? params.duracionMinInput
      : DURACION_MIN_DEFAULT;

  // Horario de atención del negocio (regla determinista, ANTES del calendario):
  // el turno COMPLETO [inicio, inicio+duración) debe caber en el horario. La IA
  // no calcula esto. Sin horario configurado, no bloquea (compatibilidad).
  const horario = evaluateBusinessHours(params.businessHours, { fecha: params.fecha, hora: params.hora, durationMin: duracionMin });
  if (!horario.ok) {
    return {
      ok: false,
      motivo: "fuera_de_horario",
      detalle:
        horario.reason === "cerrado"
          ? "El negocio no atiende ese día."
          : "Ese horario está fuera del horario de atención del negocio.",
    };
  }

  const startUnix = Math.floor(inicio.getTime() / 1000);
  const endUnix = startUnix + duracionMin * 60;

  const grantId = conn.grantId;
  const calendarId = conn.selectedCalendarId;
  const readClient = deps.createNylasEventsClient(deps.nylasApiKey);
  const writeClient = deps.createNylasEventsWriteClient(deps.nylasApiKey);

  const idempotencyKey = `cita_nylas_generico:${params.executionRowId}:${params.effectId}`;
  const huella = huellaSolicitud([params.tenantId, calendarId, params.fecha, params.hora, duracionMin, params.nombreCliente]);

  type ResultadoInterno =
    | { ok: true; citaId: string; inicioIso: string; finIso: string }
    | { ok: false; motivo: "ocupado" | "error_tecnico"; detalle: string };

  let resultado;
  try {
    resultado = await ejecutarConIdempotencia<ResultadoInterno>(deps.supabase, {
      idTenant: params.tenantId,
      idempotencyKey,
      huella,
      operacion: async () => {
        let eventosExistentes: NylasEvent[];
        try {
          eventosExistentes = await readClient.listEvents({ grantId, calendarId, startUnix, endUnix }, signal);
        } catch {
          return { ok: false, motivo: "error_tecnico", detalle: "No se pudo verificar la disponibilidad real en este momento." };
        }
        // Revalidación real INMEDIATAMENTE antes de crear (aunque el flujo
        // conversacional ya haya "mostrado" disponibilidad antes) -- nunca
        // confía en un estado de disponibilidad consultado hace turnos.
        if (hayConflictoDeHorario(eventosExistentes, startUnix, endUnix)) {
          return { ok: false, motivo: "ocupado", detalle: "Ese horario ya está ocupado en el calendario." };
        }
        const titulo = params.servicio ? `${params.servicio} -- ${params.nombreCliente}` : params.nombreCliente;
        let creado;
        try {
          creado = await writeClient.createEvent(
            { grantId, calendarId, title: titulo, description: params.notas, startUnix, endUnix, timezone: TIMEZONE_COLOMBIA },
            signal,
          );
        } catch {
          return { ok: false, motivo: "error_tecnico", detalle: "Hubo un error técnico real al intentar reservar." };
        }
        return { ok: true, citaId: creado.id, inicioIso: new Date(startUnix * 1000).toISOString(), finIso: new Date(endUnix * 1000).toISOString() };
      },
    });
  } catch {
    return { ok: false, motivo: "error_tecnico", detalle: "Hubo un error técnico real al intentar reservar." };
  }

  if (resultado.estado === "conflicto") {
    return { ok: false, motivo: "conflicto_reintento", detalle: "Ya existe una solicitud distinta con esta misma referencia." };
  }
  if (resultado.estado === "en_progreso") {
    return { ok: false, motivo: "en_progreso", detalle: "Ya hay una reserva en curso para esta misma solicitud." };
  }
  // "ejecutado" o "repetido" devuelven el MISMO resultado real -- un
  // reintento/replay nunca produce un segundo evento en el calendario.
  return resultado.resultado;
}
