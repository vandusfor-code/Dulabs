/**
 * Presentación de fecha/hora en America/Bogota.
 *
 * Misma zona que el adaptador de citas (parseFechaHora usa offset -05:00,
 * equivalente a America/Bogota: Colombia no tiene horario de verano).
 * NO convierte ni persiste timestamps: solo formatea ISO-UTC para mostrar
 * al cliente / a Claude. El almacenamiento sigue en UTC.
 */

export const TIMEZONE_COLOMBIA = "America/Bogota";

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

export function esIsoDateTime(value: unknown): value is string {
  return typeof value === "string" && ISO_DATETIME.test(value.trim());
}

function partesColombia(iso: string): Intl.DateTimeFormatPart[] | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE_COLOMBIA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
}

function valorParte(partes: Intl.DateTimeFormatPart[], tipo: Intl.DateTimeFormatPartTypes): string {
  return partes.find((p) => p.type === tipo)?.value ?? "";
}

/** YYYY-MM-DD en Colombia. */
export function fechaColombiaDesdeIso(iso: string): string {
  const partes = partesColombia(iso);
  if (!partes) return iso;
  const year = valorParte(partes, "year");
  const month = valorParte(partes, "month");
  const day = valorParte(partes, "day");
  return `${year}-${month}-${day}`;
}

/**
 * HH:mm 24h en Colombia.
 * 2026-10-09T15:00:00Z → "10:00" (no "15:00").
 */
export function horaColombiaDesdeIso(iso: string): string {
  const partes = partesColombia(iso);
  if (!partes) return iso;
  let hour = valorParte(partes, "hour");
  const minute = valorParte(partes, "minute").padStart(2, "0");
  if (hour === "24") hour = "00";
  return `${hour.padStart(2, "0")}:${minute}`;
}

const CLAVES_INSTANTE = new Set(["inicio", "fin"]);

/**
 * Copia de presentación: si hay `inicio` ISO-UTC, `fecha`/`hora` visibles
 * salen de ese instante en Colombia (la misma hora que la propuesta
 * interpolada) y `inicio`/`fin` dejan de mostrar UTC crudo.
 * No muta el objeto original.
 */
export function presentarFechaHoraColombia(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(presentarFechaHoraColombia);
  if (value === null || typeof value !== "object") return value;

  const rec = value as Record<string, unknown>;
  const inicioIso = esIsoDateTime(rec.inicio) ? rec.inicio.trim() : undefined;
  const out: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(rec)) {
    if (inicioIso && key === "hora") {
      out[key] = horaColombiaDesdeIso(inicioIso);
    } else if (inicioIso && key === "fecha") {
      out[key] = fechaColombiaDesdeIso(inicioIso);
    } else if (CLAVES_INSTANTE.has(key) && esIsoDateTime(child)) {
      out[key] = `${fechaColombiaDesdeIso(child)} ${horaColombiaDesdeIso(child)}`;
    } else {
      out[key] = presentarFechaHoraColombia(child);
    }
  }

  if (inicioIso && out.hora === undefined) {
    out.hora = horaColombiaDesdeIso(inicioIso);
  }
  if (inicioIso && out.fecha === undefined) {
    out.fecha = fechaColombiaDesdeIso(inicioIso);
  }

  return out;
}
