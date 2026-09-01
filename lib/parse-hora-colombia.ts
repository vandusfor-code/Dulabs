/**
 * Parser determinístico de expresiones horarias colombianas → HH:MM (24h).
 * Usado por q-hora (y preguntas equivalentes) sin llamadas a Claude.
 */

export type ParseHoraColombiaOk = { ok: true; hhmm: string };
export type ParseHoraColombiaFail = {
  ok: false;
  kind: "ambiguous" | "invalid";
  message: string;
};
export type ParseHoraColombiaResult = ParseHoraColombiaOk | ParseHoraColombiaFail;

const NUMEROS: Record<string, number> = {
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintidos: 22,
  veintitres: 23,
};

type Periodo = "am" | "pm" | "manana" | "tarde" | "noche" | "madrugada";

function fmt(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function isValidTime(h: number, m: number): boolean {
  return Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function normalizeInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[¿?¡!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripFiller(s: string): string {
  return s
    .replace(/\b(?:por favor|porfa|gracias|ok|vale|listo|please)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectPeriodo(s: string): Periodo | null {
  if (/\b(?:a\.?\s*m\.?)\b/.test(s) || /\bde la manana\b/.test(s) || /\ben la manana\b/.test(s)) return "manana";
  if (/\b(?:p\.?\s*m\.?)\b/.test(s) || /\bde la tarde\b/.test(s) || /\ben la tarde\b/.test(s)) return "tarde";
  if (/\bde la noche\b/.test(s) || /\ben la noche\b/.test(s) || /\bpor la noche\b/.test(s)) return "noche";
  if (/\bde la madrugada\b/.test(s) || /\ben la madrugada\b/.test(s)) return "madrugada";
  return null;
}

function parseHourToken(token: string): number | null {
  if (/^\d{1,2}$/.test(token)) {
    const n = Number(token);
    return n >= 0 && n <= 23 ? n : null;
  }
  return NUMEROS[token] ?? null;
}

function applyPeriodo(hour: number, minute: number, periodo: Periodo): string | null {
  if (!isValidTime(hour, minute)) return null;

  switch (periodo) {
    case "am":
    case "manana":
      if (hour === 12) return fmt(0, minute);
      if (hour >= 1 && hour <= 11) return fmt(hour, minute);
      return fmt(hour, minute);
    case "pm":
    case "tarde":
      if (hour === 12) return fmt(12, minute);
      if (hour >= 1 && hour <= 11) return fmt(hour + 12, minute);
      return fmt(hour, minute);
    case "noche":
    case "madrugada":
      if (hour >= 1 && hour <= 11) return fmt(hour + 12, minute);
      return fmt(hour, minute);
    default:
      return null;
  }
}

function ambiguousMessage(hour: number, label?: string): string {
  const h = label ?? String(hour);
  return `¿Te refieres a las ${h} de la tarde o a las ${h} de la mañana?`;
}

function invalidMessage(): string {
  return "Ingresa la hora en formato HH:MM (ej. 16:00) o dime por ejemplo «4 de la tarde».";
}

/** Extrae hora (0–23), minutos y etiqueta legible si vino en palabras. */
function extractHourMinute(
  s: string,
): { hour: number; minute: number; label?: string; explicit24: boolean } | null {
  // HH:MM [horas?]
  const hhmm = s.match(/^(?:a las |las )?(\d{1,2}):(\d{2})(?:\s*(?:h|hrs?|horas?))?$/);
  if (hhmm) {
    const hour = Number(hhmm[1]);
    const minute = Number(hhmm[2]);
    if (!isValidTime(hour, minute)) return null;
    return { hour, minute, explicit24: hour >= 13 || hour === 0 };
  }

  // N horas (24h)
  const horas = s.match(/^(?:a las |las )?(\d{1,2})\s+horas?$/);
  if (horas) {
    const hour = Number(horas[1]);
    if (!isValidTime(hour, 0)) return null;
    return { hour, minute: 0, explicit24: true };
  }

  const wordAlt = Object.keys(NUMEROS).join("|");
  const patterns = [
    new RegExp(
      `^(?:a las |las )?(\\d{1,2})(?::(\\d{2}))?(?:\\s*(?:de la|en la|por la)\\s+(?:manana|tarde|noche|madrugada))?`,
    ),
    new RegExp(`^(?:a las |las )?(${wordAlt})(?:\\s*(?:de la|en la|por la)\\s+(?:manana|tarde|noche|madrugada))?`),
    new RegExp(`^(\\d{1,2})(?::(\\d{2}))?\\s*(?:de la|en la|por la)\\s+(?:manana|tarde|noche|madrugada)`),
    new RegExp(`^(${wordAlt})\\s*(?:de la|en la|por la)\\s+(?:manana|tarde|noche|madrugada)`),
    new RegExp(`^(?:a las |las )?(\\d{1,2})(?::(\\d{2}))?\\s*(?:a\\.?\\s*m\\.?|p\\.?\\s*m\\.?)`),
    new RegExp(`^(?:a las |las )?(${wordAlt})\\s*(?:a\\.?\\s*m\\.?|p\\.?\\s*m\\.?)`),
    new RegExp(`^(\\d{1,2})(?::(\\d{2}))?\\s*(?:a\\.?\\s*m\\.?|p\\.?\\s*m\\.?)`),
    new RegExp(`^(${wordAlt})\\s*(?:a\\.?\\s*m\\.?|p\\.?\\s*m\\.?)`),
    new RegExp(`^(?:a las |las )?(\\d{1,2})(?::(\\d{2}))?$`),
    new RegExp(`^(?:a las |las )?(${wordAlt})$`),
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;
    const hour = parseHourToken(m[1]!);
    if (hour === null) continue;
    const minute = m[2] !== undefined ? Number(m[2]) : 0;
    if (!isValidTime(hour, minute)) continue;
    const label = /^\d+$/.test(m[1]!) ? undefined : m[1];
    return { hour, minute, label, explicit24: hour >= 13 };
  }

  return null;
}

/**
 * Convierte texto natural colombiano a HH:MM (24h).
 * No inventa mañana/tarde si la expresión es ambigua (ej. "a las 4").
 */
export function parseHoraColombia(raw: string): ParseHoraColombiaResult {
  const normalized = stripFiller(normalizeInput(raw));
  if (!normalized) {
    return { ok: false, kind: "invalid", message: invalidMessage() };
  }

  const periodo = detectPeriodo(normalized);
  const extracted = extractHourMinute(normalized);
  if (!extracted) {
    return { ok: false, kind: "invalid", message: invalidMessage() };
  }

  const { hour, minute, label, explicit24 } = extracted;

  if (periodo) {
    const hhmm = applyPeriodo(hour, minute, periodo);
    if (!hhmm) return { ok: false, kind: "invalid", message: invalidMessage() };
    return { ok: true, hhmm };
  }

  // HH:MM / N horas en 24h explícito
  if (explicit24 || hour >= 13) {
    return { ok: true, hhmm: fmt(hour, minute) };
  }

  // HH:MM con hora 0–12 sin periodo → ya es 24h válido (ej. "09:30", "16:00" cubierto arriba)
  if (/^\d{1,2}:\d{2}$/.test(normalized.replace(/^(?:a las |las )/, ""))) {
    return { ok: true, hhmm: fmt(hour, minute) };
  }

  // Sin periodo y hora 1–12 → ambiguo
  if (hour >= 1 && hour <= 12) {
    return {
      ok: false,
      kind: "ambiguous",
      message: ambiguousMessage(hour, label),
    };
  }

  return { ok: true, hhmm: fmt(hour, minute) };
}
