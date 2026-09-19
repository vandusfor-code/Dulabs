// DuLabs Business — Agent Compiler, R7 — consulta de disponibilidad genérica Nylas.
//
// REGLA CENTRAL (misma filosofía que nylas-generic-booking.ts): la IA NUNCA
// calcula disponibilidad ni decide qué horario está libre. Este módulo (BACKEND)
// es la única autoridad:
//   1. resuelve el calendario conectado del tenant (nunca del payload/LLM);
//   2. consulta los eventos REALES del calendario en el día pedido;
//   3. genera los horarios candidatos SOLO dentro del horario de atención
//      (regla determinista, evaluateBusinessHours) y con la duración REAL del
//      servicio (dulabs_servicios), nunca inventada;
//   4. descarta cualquier horario que se solape con un evento real;
//   5. es SOLO LECTURA -- jamás crea, mueve ni borra un evento.
//
// La IA solo PRESENTA los horarios que este backend devuelve. Separado a
// propósito de la creación (crear_cita_nylas_generico) y de la acción AMORE
// buscar_disponibilidad_nylas (que exige especialista/servicio resueltos por el
// motor de escenarios). Cero fallback cruzado.

import type { NylasEvent, NylasEventsClient } from "@/lib/nylas/nylas-types";
import type { CalendarConnectionStore } from "@/lib/agent-compiler/calendar/types";
import type { BusinessHours } from "@/lib/agent-compiler/spec/types";
import { evaluateBusinessHours } from "@/lib/business-hours";
import { hayConflictoDeHorario } from "@/lib/agent-compiler/calendar/nylas-generic-booking";

export const SLOT_GRANULARITY_MIN_DEFAULT = 30;
export const MAX_SLOTS_DEFAULT = 6;
export const DURACION_MIN_DEFAULT = 60;
/** Defensivo: nunca una "cita" de más de 8h por un dato corrupto/alucinado. */
const DURACION_MIN_MAX = 8 * 60;

/** Offset fijo Colombia (sin DST) -- MISMO criterio que nylas-generic-booking.ts::parseFechaHora. */
function fechaHoraUnix(fecha: string, hora: string): number | null {
  const d = new Date(`${fecha}T${hora}:00-05:00`);
  const t = d.getTime();
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

function minutosAHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export type SlotsRechazoMotivo = "sin_horario" | "config_invalida" | "cerrado" | "fecha_invalida";

export type ResultadoSlots =
  | { ok: true; slots: string[] }
  | { ok: false; motivo: SlotsRechazoMotivo };

export interface CalcularSlotsInput {
  /** Horario de atención (regla determinista). Obligatorio: sin él no se ofrece disponibilidad (fail-closed). */
  businessHours: BusinessHours | null | undefined;
  /** YYYY-MM-DD -- ya estructurado por la IA (nunca texto libre). */
  fecha: string;
  /** Duración REAL del servicio en minutos (dulabs_servicios), nunca inventada. */
  durationMin: number;
  /** Eventos reales del calendario en el día (los devueltos por Nylas). */
  eventos: NylasEvent[];
  /** Unix seconds "ahora" (inyectable para tests). Se descartan horarios pasados. */
  nowUnix: number;
  granularityMin?: number;
  maxSlots?: number;
  /** Antelación mínima en minutos desde `nowUnix` (default 0). */
  minNoticeMin?: number;
}

/**
 * PURA. Devuelve los horarios de inicio ("HH:MM") realmente disponibles para el
 * día, en orden ascendente y como máximo `maxSlots`. Un horario es válido solo
 * si el turno COMPLETO [inicio, inicio+duración) cabe en el horario de atención
 * (evaluateBusinessHours), no se solapa con ningún evento real y no está en el
 * pasado. Nunca "adivina" cupo.
 */
export function calcularSlotsDisponibles(input: CalcularSlotsInput): ResultadoSlots {
  const granularity = input.granularityMin && input.granularityMin > 0 ? input.granularityMin : SLOT_GRANULARITY_MIN_DEFAULT;
  const maxSlots = input.maxSlots && input.maxSlots > 0 ? input.maxSlots : MAX_SLOTS_DEFAULT;
  const minNotice = input.minNoticeMin && input.minNoticeMin > 0 ? input.minNoticeMin : 0;
  const dur =
    input.durationMin && input.durationMin > 0 && input.durationMin <= DURACION_MIN_MAX ? input.durationMin : DURACION_MIN_DEFAULT;

  if (!input.businessHours) return { ok: false, motivo: "sin_horario" };
  if (fechaHoraUnix(input.fecha, "00:00") === null) return { ok: false, motivo: "fecha_invalida" };

  // Sonda: ¿el negocio está cerrado ese día? evaluateBusinessHours distingue
  // "cerrado" (día sin intervalos) de "fuera_de_horario" (día abierto, pero ese
  // instante no cae dentro) y "config_invalida".
  const sonda = evaluateBusinessHours(input.businessHours, { fecha: input.fecha, hora: "00:00", durationMin: 1 });
  if (!sonda.ok && sonda.reason === "config_invalida") return { ok: false, motivo: "config_invalida" };
  if (!sonda.ok && sonda.reason === "cerrado") return { ok: false, motivo: "cerrado" };

  const umbral = input.nowUnix + minNotice * 60;
  const slots: string[] = [];
  for (let m = 0; m + dur <= 24 * 60 && slots.length < maxSlots; m += granularity) {
    const hora = minutosAHHMM(m);
    const startUnix = fechaHoraUnix(input.fecha, hora);
    if (startUnix === null) continue;
    if (startUnix < umbral) continue; // pasado / sin antelación mínima
    const cabeEnHorario = evaluateBusinessHours(input.businessHours, { fecha: input.fecha, hora, durationMin: dur });
    if (!cabeEnHorario.ok) continue;
    const endUnix = startUnix + dur * 60;
    if (hayConflictoDeHorario(input.eventos, startUnix, endUnix)) continue;
    slots.push(hora);
  }
  return { ok: true, slots };
}

export type BuscarDisponibilidadRechazoMotivo =
  | SlotsRechazoMotivo
  | "calendario_no_conectado"
  | "proveedor_no_disponible"
  | "error_tecnico";

export type ResultadoBuscarDisponibilidad =
  | { ok: true; fecha: string; durationMin: number; slots: string[] }
  | { ok: false; motivo: BuscarDisponibilidadRechazoMotivo; detalle: string };

export interface BuscarDisponibilidadNylasGenericoParams {
  tenantId: string;
  /** YYYY-MM-DD. */
  fecha: string;
  /** Duración REAL ya resuelta desde el servicio (el executor la calcula). */
  durationMin?: number;
  businessHours?: BusinessHours | null;
  /** Unix seconds "ahora" (inyectable para tests). */
  nowUnix?: number;
  maxSlots?: number;
}

export interface BuscarDisponibilidadNylasGenericoDeps {
  calendarStore: CalendarConnectionStore;
  /** null = credenciales de Nylas no configuradas -- NUNCA se simula una conexión. */
  nylasApiKey: string | null;
  createNylasEventsClient: (apiKey: string) => NylasEventsClient;
}

/**
 * Orquestación SOLO LECTURA: resuelve el calendario del tenant server-side,
 * consulta los eventos reales del día completo y calcula los horarios libres.
 * No crea, mueve ni borra nada -- por eso no necesita idempotencia.
 */
export async function buscarDisponibilidadNylasGenerico(
  deps: BuscarDisponibilidadNylasGenericoDeps,
  params: BuscarDisponibilidadNylasGenericoParams,
  signal?: AbortSignal,
): Promise<ResultadoBuscarDisponibilidad> {
  const dur =
    params.durationMin && params.durationMin > 0 && params.durationMin <= DURACION_MIN_MAX ? params.durationMin : DURACION_MIN_DEFAULT;

  const inicioDiaUnix = fechaHoraUnix(params.fecha, "00:00");
  if (inicioDiaUnix === null) return { ok: false, motivo: "fecha_invalida", detalle: "Fecha inválida." };

  // Calendario SIEMPRE resuelto server-side por tenantId (nunca del payload/LLM).
  const conn = await deps.calendarStore.getConnection(params.tenantId);
  if (!conn || conn.status !== "connected" || !conn.grantId || !conn.selectedCalendarId) {
    return { ok: false, motivo: "calendario_no_conectado", detalle: "No hay un calendario conectado para este negocio todavía." };
  }
  if (!deps.nylasApiKey) {
    return { ok: false, motivo: "proveedor_no_disponible", detalle: "La integración de calendario no está disponible en este momento." };
  }

  const finDiaUnix = inicioDiaUnix + 24 * 60 * 60 - 1;
  const readClient = deps.createNylasEventsClient(deps.nylasApiKey);
  let eventos: NylasEvent[];
  try {
    eventos = await readClient.listEvents(
      { grantId: conn.grantId, calendarId: conn.selectedCalendarId, startUnix: inicioDiaUnix, endUnix: finDiaUnix },
      signal,
    );
  } catch {
    return { ok: false, motivo: "error_tecnico", detalle: "No se pudo consultar la disponibilidad real en este momento." };
  }

  const calc = calcularSlotsDisponibles({
    businessHours: params.businessHours,
    fecha: params.fecha,
    durationMin: dur,
    eventos,
    nowUnix: params.nowUnix ?? Math.floor(Date.now() / 1000),
    maxSlots: params.maxSlots,
  });
  if (!calc.ok) {
    return {
      ok: false,
      motivo: calc.motivo,
      detalle:
        calc.motivo === "cerrado"
          ? "El negocio no atiende ese día."
          : calc.motivo === "fecha_invalida"
            ? "Fecha inválida."
            : "No hay un horario de atención configurado para calcular la disponibilidad.",
    };
  }
  return { ok: true, fecha: params.fecha, durationMin: dur, slots: calc.slots };
}
