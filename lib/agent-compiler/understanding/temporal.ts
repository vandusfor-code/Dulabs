// DuLabs Business — Business Agent 2.0, FASE 2 — contexto temporal del servidor.
//
// ÚNICA fuente de tiempo del entendimiento: un reloj inyectado (`UnderstandingClock`) que se lee UNA vez por mensaje.
// El modelo recibe este contexto para INTERPRETAR ("mañana", "el sábado"), pero nunca es la autoridad de la fecha: el
// backend normaliza lo que el cliente escribió con los parsers deterministas existentes, anclado a `businessDate`.

export type UnderstandingClock = () => Date;

export const systemClock: UnderstandingClock = () => new Date();

/** Zona por defecto de DuLabs (misma que lib/timezone-colombia.ts) si el negocio no declara otra. */
export const DEFAULT_BUSINESS_TIMEZONE = "America/Bogota";

export interface TemporalContext {
  /** Instante del servidor en ISO-8601 UTC. */
  currentDatetime: string;
  /** Zona del reloj del servidor (siempre UTC: las fechas se almacenan en UTC). */
  timezone: "UTC";
  /** Zona IANA del negocio: "hoy" y "mañana" se calculan en esta zona. */
  businessTimezone: string;
  /** Fecha local del negocio (YYYY-MM-DD). Ancla de todas las fechas relativas. */
  businessDate: string;
  /** Hora local del negocio (HH:MM, 24h). */
  businessTime: string;
  /** Día de la semana local del negocio, en español sin tildes (lunes..domingo). */
  businessWeekday: string;
}

const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function buildTemporalContext(now: Date, businessTimezone: string | undefined): TemporalContext {
  if (Number.isNaN(now.getTime())) throw new Error("invalid_clock");
  const tz = businessTimezone && isValidTimeZone(businessTimezone) ? businessTimezone : DEFAULT_BUSINESS_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  const businessDate = `${get("year")}-${get("month")}-${get("day")}`;
  return {
    currentDatetime: now.toISOString(),
    timezone: "UTC",
    businessTimezone: tz,
    businessDate,
    businessTime: `${hour.padStart(2, "0")}:${get("minute")}`,
    businessWeekday: WEEKDAYS[new Date(`${businessDate}T12:00:00Z`).getUTCDay()]!,
  };
}
