// DuLabs Business — Business Agent 2.0, FASE 2 — slots (entidades) y su normalización determinista.
//
// Regla de autoridad: el modelo SEÑALA dónde está el dato (`raw`, texto literal del mensaje) y puede dar su lectura
// (`value`); el BACKEND normaliza desde `raw` con los parsers existentes (fecha, hora) y reglas puras. La lectura del
// modelo solo se usa cuando el parser no alcanza Y los números que escribió el cliente la respaldan (misma regla que
// resolverHoraSolicitada / resolverFechaSolicitada). Nunca se inventan IDs: "corte clásico" queda como texto; resolverlo
// contra el catálogo es un paso posterior y determinista (FASE 3).

import { parseHoraColombia } from "@/lib/parse-hora-colombia";
import { resolverFechaSolicitada } from "@/lib/agent-compiler/calendar/fecha-solicitada";
import { resolverHoraSolicitada } from "@/lib/agent-compiler/calendar/hora-solicitada";
import { CUSTOM_FIELD_KEY_RE, WELL_KNOWN_FIELDS } from "@/lib/customer-data";
import type { BusinessAgentSpec, CustomerFieldType } from "@/lib/agent-compiler/spec/types";
import type { TemporalContext } from "@/lib/agent-compiler/understanding/temporal";

export type SlotKind = "name" | "text" | "number" | "count" | "date" | "time" | "time_range" | "phone" | "email" | "select" | "boolean";

export interface SlotDefinition {
  name: string;
  kind: SlotKind;
  /** Una línea para el modelo. En slots del negocio es DATA configurada (normalizada, ≤120). */
  description: string;
  /** Solo kind "select". */
  options?: readonly string[];
  origin: "universal" | "business";
}

export const UNIVERSAL_SLOTS: readonly SlotDefinition[] = [
  { name: "customer_name", kind: "name", description: "Nombre con el que el cliente se presenta.", origin: "universal" },
  { name: "service", kind: "text", description: "Servicio que menciona o pide, tal como lo dice.", origin: "universal" },
  { name: "product", kind: "text", description: "Producto que menciona o pide, tal como lo dice.", origin: "universal" },
  { name: "quantity", kind: "count", description: "Cantidad de unidades que pide.", origin: "universal" },
  { name: "party_size", kind: "count", description: "Número de personas.", origin: "universal" },
  { name: "date", kind: "date", description: "Día que menciona (\"mañana\", \"el sábado\", \"4 de octubre\").", origin: "universal" },
  { name: "time", kind: "time", description: "Hora puntual (\"a las 4\", \"15:30\").", origin: "universal" },
  { name: "time_range", kind: "time_range", description: "Franja horaria (\"después de las 4\", \"en la tarde\", \"entre 2 y 4\").", origin: "universal" },
  { name: "location", kind: "text", description: "Lugar o dirección que menciona.", origin: "universal" },
  { name: "phone", kind: "phone", description: "Número de teléfono que escribe.", origin: "universal" },
  { name: "email", kind: "email", description: "Correo electrónico que escribe.", origin: "universal" },
  { name: "order_reference", kind: "text", description: "Número o referencia de un pedido o reserva existente.", origin: "universal" },
  { name: "payment_method", kind: "text", description: "Medio de pago que menciona.", origin: "universal" },
  { name: "notes", kind: "text", description: "Indicación adicional que pide tener en cuenta.", origin: "universal" },
];

/** Campos conocidos del Spec (lib/customer-data.ts) que ya son slots universales: no se duplican. */
export const CUSTOMER_FIELD_TO_UNIVERSAL_SLOT: Readonly<Record<string, string>> = {
  nombreCliente: "customer_name",
  telefonoCliente: "phone",
  correoCliente: "email",
  notas: "notes",
};

export const MAX_BUSINESS_SLOTS = 20;
export const MAX_SLOT_RAW_LENGTH = 160;
const MAX_TEXT_VALUE = 200;
const MAX_NAME_VALUE = 80;
const MAX_COUNT = 10_000;

const FIELD_TYPE_TO_KIND: Record<CustomerFieldType, SlotKind> = {
  text: "text",
  phone: "phone",
  email: "email",
  number: "number",
  date: "date",
  time: "time",
  select: "select",
  boolean: "boolean",
};

/** Texto configurado por el negocio que viaja al prompt: una línea, sin caracteres de control, acotado. */
export function normalizeConfiguredText(value: string | undefined, max = 120): string {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Slots definidos por el negocio = campos personalizados de `spec.customerData` (encendidos). Un campo conocido
 * (nombreCliente, correoCliente...) ya es un slot universal; una clave que choca con un slot universal se omite.
 */
export function businessSlotsFromSpec(spec: Pick<BusinessAgentSpec, "customerData">): SlotDefinition[] {
  const universal = new Set(UNIVERSAL_SLOTS.map((s) => s.name));
  const out: SlotDefinition[] = [];
  for (const f of spec.customerData?.fields ?? []) {
    if (!f.enabled || WELL_KNOWN_FIELDS[f.key] || CUSTOMER_FIELD_TO_UNIVERSAL_SLOT[f.key]) continue;
    if (!CUSTOM_FIELD_KEY_RE.test(f.key) || universal.has(f.key)) continue;
    out.push({
      name: f.key,
      kind: FIELD_TYPE_TO_KIND[f.type],
      description: normalizeConfiguredText(f.label + (f.description ? ` — ${f.description}` : "")),
      options: f.type === "select" ? (f.options ?? []).map((o) => normalizeConfiguredText(o, 60)).filter(Boolean) : undefined,
      origin: "business",
    });
    if (out.length >= MAX_BUSINESS_SLOTS) break;
  }
  return out;
}

/** Catálogo de slots de UN turno: universales + los del negocio (validados). */
export function buildSlotCatalog(businessSlots: readonly SlotDefinition[] = []): Map<string, SlotDefinition> {
  const map = new Map<string, SlotDefinition>(UNIVERSAL_SLOTS.map((s) => [s.name, s]));
  for (const s of businessSlots.slice(0, MAX_BUSINESS_SLOTS)) {
    if (map.has(s.name) || !CUSTOM_FIELD_KEY_RE.test(s.name)) continue;
    map.set(s.name, { ...s, origin: "business" });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

export type NormalizedSlotValue =
  | { kind: "text"; text: string }
  | { kind: "number"; number: number }
  | { kind: "date"; date: string }
  | { kind: "time"; time: string }
  | { kind: "time_range"; from?: string; to?: string; period?: "morning" | "afternoon" | "evening" }
  | { kind: "phone"; phone: string }
  | { kind: "email"; email: string }
  | { kind: "select"; option: string }
  | { kind: "boolean"; value: boolean };

export type SlotNormalization =
  | { status: "resolved"; value: NormalizedSlotValue; normalizedBy: "parser" | "validated_model_reading" }
  | { status: "ambiguous"; reason: string; candidates?: string[] }
  | { status: "unresolved"; reason: string }
  | { status: "invalid"; reason: string };

/** Minúsculas, sin tildes, sin puntuación de borde, espacios colapsados. Solo para COMPARAR, nunca se muestra. */
export function foldText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:"'«»()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(raw: string, max: number): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20, treinta: 30, cincuenta: 50, cien: 100,
};

function parseCount(raw: string): number | null {
  const t = foldText(raw);
  const digits = t.match(/\d+/g);
  if (digits) return digits.length === 1 ? Number(digits[0]) : null;
  const words = t.split(" ").filter((w) => w in NUMBER_WORDS);
  return words.length === 1 ? NUMBER_WORDS[words[0]!]! : null;
}

function normalizeDate(raw: string, modelValue: string | undefined, temporal: TemporalContext): SlotNormalization {
  // "para el próximo sábado" / "el día 15 de marzo": el parser espera la expresión de fecha al inicio.
  const texto = raw.trim().replace(/^para\s+/i, "").replace(/^(?:el|la)\s+d[ií]a\s+/i, "");
  const r = resolverFechaSolicitada({ solicitudTexto: texto, fechaPropuesta: modelValue, hoyISO: temporal.businessDate });
  if (r.ok) return { status: "resolved", value: { kind: "date", date: r.fecha }, normalizedBy: r.origen === "texto" ? "parser" : "validated_model_reading" };
  if (r.motivo === "fecha_pasada") return { status: "invalid", reason: "date_in_past" };
  return { status: "unresolved", reason: "date_unresolved" };
}

function normalizeTime(raw: string, modelValue: string | undefined): SlotNormalization {
  const r = resolverHoraSolicitada({ solicitudTexto: raw, horaPropuesta: modelValue });
  if (r.ok) return { status: "resolved", value: { kind: "time", time: r.hora }, normalizedBy: r.origen === "cliente" ? "parser" : "validated_model_reading" };
  const p = parseHoraColombia(raw);
  if (!p.ok && p.kind === "ambiguous" && p.horaAmbigua !== undefined) {
    const h = p.horaAmbigua % 12;
    const pad = (n: number) => `${String(n).padStart(2, "0")}:00`;
    return { status: "ambiguous", reason: "time_am_pm_unspecified", candidates: [pad(h), pad(h + 12)] };
  }
  return { status: "unresolved", reason: "time_unresolved" };
}

const PERIODS: Array<[RegExp, "morning" | "afternoon" | "evening"]> = [
  [/\b(?:en|por|de) la manana\b/, "morning"],
  [/\b(?:en|por|de) la tarde\b/, "afternoon"],
  [/\b(?:en|por|de) la noche\b/, "evening"],
];

function normalizeTimeRange(raw: string, modelValue: string | undefined): SlotNormalization {
  const t = foldText(raw);
  const [modelFrom, modelTo] = (modelValue ?? "").split("-").map((x) => x.trim() || undefined);
  const side = (texto: string, propuesta: string | undefined) => {
    const r = normalizeTime(texto, propuesta);
    return r.status === "resolved" && r.value.kind === "time" ? { time: r.value.time, by: r.normalizedBy } : null;
  };

  const entre = /\bentre (?:las )?(.+?) y (?:las )?(.+)$/.exec(t);
  const desde = /\b(?:despues de|desde|a partir de)\s+(.+)$/.exec(t);
  const hasta = /\b(?:antes de|hasta)\s+(.+)$/.exec(t);
  if (entre || desde || hasta) {
    let from: ReturnType<typeof side> = null;
    let to: ReturnType<typeof side> = null;
    if (entre) {
      from = side(`a las ${entre[1]}`, modelFrom);
      to = side(`a las ${entre[2]}`, modelTo);
      if (!from || !to) return { status: "ambiguous", reason: "time_range_am_pm_unspecified" };
    } else if (desde) {
      from = side(desde[1]!, modelFrom);
      if (!from) return { status: "ambiguous", reason: "time_range_am_pm_unspecified" };
    } else if (hasta) {
      to = side(hasta![1]!, modelTo);
      if (!to) return { status: "ambiguous", reason: "time_range_am_pm_unspecified" };
    }
    if (from && to && from.time >= to.time) return { status: "invalid", reason: "time_range_inverted" };
    const by = from?.by === "validated_model_reading" || to?.by === "validated_model_reading" ? "validated_model_reading" : "parser";
    return { status: "resolved", value: { kind: "time_range", ...(from ? { from: from.time } : {}), ...(to ? { to: to.time } : {}) }, normalizedBy: by };
  }
  for (const [re, period] of PERIODS) {
    if (re.test(t)) return { status: "resolved", value: { kind: "time_range", period }, normalizedBy: "parser" };
  }
  return { status: "unresolved", reason: "time_range_unresolved" };
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

export function normalizeSlotValue(
  def: SlotDefinition,
  raw: string,
  modelValue: string | undefined,
  temporal: TemporalContext,
): SlotNormalization {
  switch (def.kind) {
    case "name": {
      const v = cleanText(raw, MAX_NAME_VALUE + 1);
      if (v.length > MAX_NAME_VALUE || !/\p{L}/u.test(v) || /[\d@<>{}[\]\\/]/.test(v)) return { status: "invalid", reason: "name_invalid" };
      return { status: "resolved", value: { kind: "text", text: v }, normalizedBy: "parser" };
    }
    case "text": {
      const v = cleanText(raw, MAX_TEXT_VALUE);
      return v ? { status: "resolved", value: { kind: "text", text: v }, normalizedBy: "parser" } : { status: "unresolved", reason: "empty" };
    }
    case "count": {
      const n = parseCount(raw);
      if (n === null) return { status: "unresolved", reason: "count_unresolved" };
      if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) return { status: "invalid", reason: "count_out_of_range" };
      return { status: "resolved", value: { kind: "number", number: n }, normalizedBy: "parser" };
    }
    case "number": {
      const m = foldText(raw).replace(/(\d),(\d)/g, "$1.$2").match(/-?\d+(?:\.\d+)?/g);
      if (!m || m.length !== 1) return { status: "unresolved", reason: "number_unresolved" };
      const n = Number(m[0]);
      return Number.isFinite(n) ? { status: "resolved", value: { kind: "number", number: n }, normalizedBy: "parser" } : { status: "invalid", reason: "number_invalid" };
    }
    case "date":
      return normalizeDate(raw, modelValue, temporal);
    case "time":
      return normalizeTime(raw, modelValue);
    case "time_range":
      return normalizeTimeRange(raw, modelValue);
    case "phone": {
      const digits = raw.replace(/[\s().-]/g, "");
      if (!/^\+?\d{7,15}$/.test(digits)) return { status: "invalid", reason: "phone_invalid" };
      return { status: "resolved", value: { kind: "phone", phone: digits }, normalizedBy: "parser" };
    }
    case "email": {
      const v = raw.trim().toLowerCase();
      return EMAIL_RE.test(v) ? { status: "resolved", value: { kind: "email", email: v }, normalizedBy: "parser" } : { status: "invalid", reason: "email_invalid" };
    }
    case "select": {
      const t = foldText(raw);
      const matches = (def.options ?? []).filter((o) => {
        const f = foldText(o);
        return f && (t === f || new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t));
      });
      if (matches.length === 1) return { status: "resolved", value: { kind: "select", option: matches[0]! }, normalizedBy: "parser" };
      if (matches.length > 1) return { status: "ambiguous", reason: "select_multiple_options", candidates: matches };
      return { status: "invalid", reason: "option_not_allowed" };
    }
    case "boolean": {
      const t = foldText(raw);
      if (/^(?:si|claro|por supuesto|correcto|afirmativo|dale|ok)\b/.test(t)) return { status: "resolved", value: { kind: "boolean", value: true }, normalizedBy: "parser" };
      if (/^(?:no|negativo|para nada)\b/.test(t)) return { status: "resolved", value: { kind: "boolean", value: false }, normalizedBy: "parser" };
      return { status: "unresolved", reason: "boolean_unresolved" };
    }
  }
}
