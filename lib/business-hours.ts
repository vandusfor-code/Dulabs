/**
 * Horario de atención del negocio — evaluación DETERMINISTA (backend authority).
 *
 * La IA nunca decide si una hora está disponible: solo interpreta la intención y
 * pasa fecha/hora estructuradas. Esta función pura valida que un turno
 * [inicio, inicio+duración) caiga ENTERO dentro de un intervalo abierto del día
 * correcto (respetando cierres al mediodía, días cerrados y excepciones por
 * fecha). Trabaja en hora local de pared del negocio (la misma en que el cliente
 * dice "a las 3"), así que no depende de la zona horaria del runtime.
 */
import type { BusinessHours, BusinessHoursInterval } from "@/lib/agent-compiler/spec/types";

export type BusinessHoursResult =
  | { ok: true }
  | { ok: false; reason: "cerrado" | "fuera_de_horario" | "config_invalida" };

/** "HH:MM" (24h) -> minutos desde medianoche, o null si el formato es inválido. */
export function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Día de la semana (0 = domingo ... 6 = sábado) de una fecha YYYY-MM-DD, estable ante la tz del runtime. */
export function weekdayDeFecha(fecha: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const d = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCDay();
}

function cabeEnAlgunIntervalo(intervals: BusinessHoursInterval[], startMin: number, endMin: number): boolean {
  for (const iv of intervals) {
    const open = hhmmToMinutes(iv.open);
    const close = hhmmToMinutes(iv.close);
    if (open === null || close === null || close <= open) continue;
    // El turno COMPLETO debe caber: no basta con empezar dentro (una cita de 120
    // min a las 17:00 con cierre 18:00 NO cabe -> se rechaza).
    if (startMin >= open && endMin <= close) return true;
  }
  return false;
}

/**
 * ¿El turno solicitado respeta el horario de atención? Sin horario configurado
 * (null/undefined) devuelve ok:true -> no bloquea (compatibilidad con Specs
 * previos; el bloqueo por horario es opt-in por configuración).
 */
export function evaluateBusinessHours(
  hours: BusinessHours | null | undefined,
  input: { fecha: string; hora: string; durationMin: number },
): BusinessHoursResult {
  if (!hours) return { ok: true };

  const startMin = hhmmToMinutes(input.hora);
  if (startMin === null || !Number.isFinite(input.durationMin) || input.durationMin <= 0) {
    return { ok: false, reason: "config_invalida" };
  }
  const endMin = startMin + input.durationMin;

  // 1) Excepción por fecha concreta (festivo, vacaciones, horario especial) manda.
  const exc = hours.exceptions?.find((e) => e.date === input.fecha);
  if (exc) {
    if (exc.closed) return { ok: false, reason: "cerrado" };
    return cabeEnAlgunIntervalo(exc.intervals ?? [], startMin, endMin) ? { ok: true } : { ok: false, reason: "fuera_de_horario" };
  }

  // 2) Día de la semana normal.
  const wd = weekdayDeFecha(input.fecha);
  if (wd === null) return { ok: false, reason: "config_invalida" };
  const day = hours.week?.[wd];
  if (!day || day.closed) return { ok: false, reason: "cerrado" };
  return cabeEnAlgunIntervalo(day.intervals ?? [], startMin, endMin) ? { ok: true } : { ok: false, reason: "fuera_de_horario" };
}

/** true si el negocio tiene al menos un intervalo abierto válido en la semana (para validar publicación). */
export function tieneAlgunHorarioAbierto(hours: BusinessHours | null | undefined): boolean {
  if (!hours || !Array.isArray(hours.week)) return false;
  return hours.week.some(
    (d) => d && !d.closed && (d.intervals ?? []).some((iv) => {
      const o = hhmmToMinutes(iv.open);
      const c = hhmmToMinutes(iv.close);
      return o !== null && c !== null && c > o;
    }),
  );
}
