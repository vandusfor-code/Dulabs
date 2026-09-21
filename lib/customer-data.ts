/**
 * Datos del cliente (R3) — reglas DETERMINISTAS compartidas por el wizard, el
 * validador del Spec, el compiler y el backend de reserva.
 *
 * ARQUITECTURA: la configuración vive en el Spec (customerData.fields). El
 * compiler la convierte en nodos question/buttons con validación real del Flow
 * Engine, y EMBEBE la misma definición (estática) en la acción de reserva, que
 * la revalida aquí antes de tocar el calendario. La IA nunca decide qué datos
 * son obligatorios ni si un valor es válido: solo el backend.
 *
 * Módulo PURO (sin I/O, sin server-only): se importa desde componentes cliente.
 */
import { z } from "zod";
import type { CustomerField, CustomerFieldScope, CustomerFieldType } from "@/lib/agent-compiler/spec/types";
import { CUSTOMER_FIELD_SCOPES, CUSTOMER_FIELD_TYPES } from "@/lib/agent-compiler/spec/types";
import type { QuestionValidation } from "@/lib/flow/types";
import { hhmmToMinutes } from "@/lib/business-hours";

// --- Topes (hardening: mismo criterio que spec/schema.ts) -------------------
export const MAX_CUSTOMER_FIELDS = 20;
export const MAX_SELECT_OPTIONS = 25;
export const MAX_FIELD_KEY_LENGTH = 40;
export const MAX_FIELD_LABEL_LENGTH = 80;
export const MAX_FIELD_QUESTION_LENGTH = 300;
export const MAX_FIELD_DESCRIPTION_LENGTH = 300;
export const MAX_OPTION_LENGTH = 60;
const MAX_VALUE_LENGTH = 200;
const MAX_LONG_VALUE_LENGTH = 500;

/** Clave de un campo personalizado: snake_case, empieza por letra. */
export const CUSTOM_FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

// --- Claves conocidas (semántica que el Runtime ya entiende) -----------------
export interface WellKnownField {
  type: CustomerFieldType;
  /** true = el valor lo aporta el CANAL (WhatsApp), nunca se le pregunta al cliente. */
  channelSourced?: boolean;
  label: string;
  question: string;
}

/**
 * Claves con semántica propia. Coinciden con los parámetros que las acciones de
 * reserva ya consumen (`nombreCliente`, `notas`...), así que un dato capturado
 * con esa clave llega a la reserva sin mapeos intermedios. Es DATA: agregar una
 * clave conocida no toca el compiler ni el runtime.
 */
export const WELL_KNOWN_FIELDS: Readonly<Record<string, WellKnownField>> = {
  nombreCliente: { type: "text", label: "Nombre", question: "¿Cuál es tu nombre?" },
  telefonoCliente: { type: "phone", channelSourced: true, label: "Teléfono", question: "¿Cuál es tu número de teléfono?" },
  correoCliente: { type: "email", label: "Correo electrónico", question: "¿Cuál es tu correo electrónico?" },
  notas: { type: "text", label: "Notas", question: "¿Hay algo que debamos tener en cuenta?" },
};

/**
 * Claves que colisionarían con variables/parámetros del Runtime (o con campos
 * que la IA tiene prohibido fabricar). Un campo personalizado NUNCA puede
 * llamarse así. Test: todo PROHIBITED_EVIDENCE_FIELDS debe estar aquí.
 */
export const RESERVED_FIELD_KEYS: ReadonlySet<string> = new Set([
  // variables del flow compilado y del orquestador
  "hoy", "baseConocimiento", "user_request", "customer_name", "qualification", "service_choice", "appointment_request",
  // parámetros de las acciones de reserva/catálogo
  "fecha", "hora", "servicio", "duracionMin", "numeroCliente", "businessHoursJson", "customerFieldsJson",
  // resultados verificados del runtime
  "citaId", "status", "inicio", "fin", "effectId", "source", "executionId", "timestamp",
  // evidencia que la IA no puede fabricar (PROHIBITED_EVIDENCE_FIELDS)
  "available", "appointmentConfirmed", "leadCreated", "transferred", "appointmentId", "leadId", "pausadoHasta", "reservationId", "verified", "leadPersisted",
]);

export function isChannelSourced(key: string): boolean {
  return WELL_KNOWN_FIELDS[key]?.channelSourced === true;
}

// --- Schema Zod (forma) ------------------------------------------------------
export const customerFieldSchema = z.object({
  key: z.string().trim().min(1).max(MAX_FIELD_KEY_LENGTH),
  label: z.string().trim().min(1).max(MAX_FIELD_LABEL_LENGTH),
  type: z.enum(CUSTOMER_FIELD_TYPES),
  required: z.boolean(),
  enabled: z.boolean(),
  scope: z.enum(CUSTOMER_FIELD_SCOPES),
  question: z.string().trim().max(MAX_FIELD_QUESTION_LENGTH).optional(),
  description: z.string().trim().max(MAX_FIELD_DESCRIPTION_LENGTH).optional(),
  options: z.array(z.string().trim().min(1).max(MAX_OPTION_LENGTH)).max(MAX_SELECT_OPTIONS).optional(),
});

export const customerDataSchema = z.object({
  fields: z.array(customerFieldSchema).max(MAX_CUSTOMER_FIELDS),
});

// --- Utilidades de texto -----------------------------------------------------
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Comparación tolerante: minúsculas, sin acentos, espacios colapsados. */
export function normalizeToken(s: string): string {
  return stripAccents(s).toLowerCase().replace(/\s+/g, " ").trim();
}

/** Texto de UNA línea, sin control chars ni `<`/`>` (el evento del calendario es texto plano). */
export function sanitizeText(raw: string, max: number): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Quita `{{...}}` para que una etiqueta/pregunta nunca dispare interpolación de variables. */
function sinPlantillas(s: string): string {
  return s.replace(/[{}]/g, "").trim();
}

// --- Validación de la CONFIGURACIÓN -----------------------------------------
export interface CustomerFieldIssue {
  /** Índice del campo en customerData.fields (o -1 si es global). */
  index: number;
  key?: string;
  message: string;
}

/** Valida la configuración (keys, duplicados, reservadas, opciones, tipos conocidos). No mira capabilities. */
export function validateCustomerFieldsConfig(fields: readonly CustomerField[]): CustomerFieldIssue[] {
  const issues: CustomerFieldIssue[] = [];
  if (fields.length > MAX_CUSTOMER_FIELDS) {
    issues.push({ index: -1, message: `Máximo ${MAX_CUSTOMER_FIELDS} campos de datos del cliente.` });
  }
  const seen = new Set<string>();
  fields.forEach((f, index) => {
    const key = f.key;
    const known = WELL_KNOWN_FIELDS[key];
    if (!known) {
      if (RESERVED_FIELD_KEYS.has(key)) {
        issues.push({ index, key, message: `La clave "${key}" está reservada por el sistema; elige otra.` });
      } else if (!CUSTOM_FIELD_KEY_RE.test(key)) {
        issues.push({ index, key, message: `La clave "${key}" no es válida: usa minúsculas, números y guion bajo, empezando por una letra (máx. ${MAX_FIELD_KEY_LENGTH}).` });
      }
    } else if (known.type !== f.type) {
      issues.push({ index, key, message: `El campo "${key}" tiene un significado fijo en el sistema y debe ser de tipo "${known.type}".` });
    }
    if (seen.has(key)) issues.push({ index, key, message: `La clave "${key}" está repetida.` });
    seen.add(key);
    if (!f.label.trim()) issues.push({ index, key, message: `El campo "${key}" necesita una etiqueta.` });
    if (f.type === "select") {
      const options = (f.options ?? []).map((o) => o.trim()).filter(Boolean);
      const unicas = new Set(options.map(normalizeToken));
      if (options.length < 2) {
        issues.push({ index, key, message: `El campo "${key}" (lista de opciones) necesita al menos 2 opciones.` });
      } else if (unicas.size !== options.length) {
        issues.push({ index, key, message: `El campo "${key}" tiene opciones repetidas.` });
      }
    }
  });
  return issues;
}

/** Campos activos (enabled). */
export function activeFields(fields: readonly CustomerField[] | undefined): CustomerField[] {
  return (fields ?? []).filter((f) => f.enabled);
}

/** Campos que el agente le PREGUNTA al cliente: activos y no aportados por el canal. */
export function askableFields(fields: readonly CustomerField[] | undefined): CustomerField[] {
  return activeFields(fields).filter((f) => !isChannelSourced(f.key));
}

/** Forma COMPACTA para IR/acción: solo campos activos, sin notas internas (`description`). */
export function toCompiledFields(fields: readonly CustomerField[] | undefined): CustomerField[] {
  return activeFields(fields).map((f) => ({
    key: f.key,
    label: sinPlantillas(f.label),
    type: f.type,
    required: f.required,
    enabled: true,
    scope: f.scope,
    ...(f.question?.trim() ? { question: sinPlantillas(f.question) } : {}),
    ...(f.type === "select" ? { options: (f.options ?? []).map((o) => o.trim()).filter(Boolean) } : {}),
  }));
}

// --- Pregunta y validación para el Flow Engine -------------------------------
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Nombre de persona plausible: letras (con tildes), espacios, puntuación corriente ("Ana!", "Pérez, Ana") y emojis; sin
 * dígitos, signos de pregunta ni símbolos. Evita que "¿Quién ganó el mundial?" o "no sé" queden como el NOMBRE del cliente (calendario y contacto).
 */
const NOMBRE_PATTERN = "^[\\p{L}][\\p{L}\\p{M} .,'’!\\p{Extended_Pictographic}-]{1,79}$";
const NOMBRE_RE = new RegExp(NOMBRE_PATTERN, "u");

const DATE_PATTERN = "^(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{4})$";
const BOOLEAN_PATTERN = "^(?:s[ií]|no|yes|true|false)$";

/** Validación que el Flow Engine aplica a la respuesta del cliente (determinista, sin LLM). */
export function buildQuestionValidation(field: CustomerField): QuestionValidation {
  switch (field.type) {
    case "phone":
      return { kind: "phone" };
    case "email":
      return { kind: "email" };
    case "number":
      return { kind: "number" };
    case "time":
      return { kind: "hora_colombia" };
    case "date":
      return { kind: "regex", pattern: DATE_PATTERN };
    case "boolean":
      return { kind: "regex", pattern: BOOLEAN_PATTERN, flags: "i" };
    case "select": {
      const alternativas = new Set<string>();
      for (const o of field.options ?? []) {
        const limpio = o.trim();
        if (!limpio) continue;
        alternativas.add(escapeRegex(limpio));
        alternativas.add(escapeRegex(stripAccents(limpio)));
      }
      return { kind: "regex", pattern: `^(?:${[...alternativas].join("|")})$`, flags: "i" };
    }
    case "text":
    default:
      // El nombre del cliente es un dato con forma conocida: la respuesta debe parecer un nombre.
      if (field.key === "nombreCliente") return { kind: "regex", pattern: NOMBRE_PATTERN, flags: "u", message: "No entendí tu nombre. ¿Me lo escribes, por favor?" };
      return { kind: "text" };
  }
}

/** Texto de la pregunta (con pista de formato cuando el tipo la necesita). */
export function buildQuestionText(field: CustomerField): string {
  const label = sinPlantillas(field.label);
  const base =
    field.question?.trim() ? sinPlantillas(field.question) : (WELL_KNOWN_FIELDS[field.key]?.question ?? `Por favor, indícame: ${label}.`);
  switch (field.type) {
    case "select":
      return `${base} (${(field.options ?? []).join(" / ")})`;
    case "boolean":
      return `${base} (Sí / No)`;
    case "date":
      return `${base} (formato DD/MM/AAAA)`;
    default:
      return base;
  }
}

// --- Validación de VALORES (autoridad del backend) ---------------------------
export type FieldValueFailure = "vacio" | "formato" | "opcion";
export type FieldValueResult = { ok: true; value: string } | { ok: false; reason: FieldValueFailure };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s\-()]{7,20}$/;

function parseDate(raw: string): string | null {
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else return null;
  // Fecha REAL del calendario (rechaza 31/02, año bisiesto inválido, etc.).
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Valida y NORMALIZA un valor contra la definición del campo. Nunca lanza. */
export function validateFieldValue(field: CustomerField, raw: unknown): FieldValueResult {
  if (raw === undefined || raw === null) return { ok: false, reason: "vacio" };
  const long = field.key === "notas";
  const text = sanitizeText(String(raw), long ? MAX_LONG_VALUE_LENGTH : MAX_VALUE_LENGTH);
  if (!text) return { ok: false, reason: "vacio" };

  switch (field.type) {
    case "text":
      // Defensa en profundidad (la misma regla que aplica el motor al preguntar): el backend no acepta como nombre algo que no lo es.
      if (field.key === "nombreCliente" && !NOMBRE_RE.test(text)) return { ok: false, reason: "formato" };
      return { ok: true, value: text };
    case "phone": {
      if (!PHONE_RE.test(text)) return { ok: false, reason: "formato" };
      return { ok: true, value: text.replace(/[\s\-()]/g, "") };
    }
    case "email": {
      if (text.length > 254 || !EMAIL_RE.test(text)) return { ok: false, reason: "formato" };
      return { ok: true, value: text.toLowerCase() };
    }
    case "number": {
      const n = Number(text.replace(",", "."));
      if (!Number.isFinite(n)) return { ok: false, reason: "formato" };
      return { ok: true, value: String(n) };
    }
    case "date": {
      const iso = parseDate(text);
      return iso ? { ok: true, value: iso } : { ok: false, reason: "formato" };
    }
    case "time": {
      const minutos = hhmmToMinutes(text);
      if (minutos === null) return { ok: false, reason: "formato" };
      return { ok: true, value: `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}` };
    }
    case "select": {
      const objetivo = normalizeToken(text);
      const opcion = (field.options ?? []).find((o) => normalizeToken(o) === objetivo);
      return opcion ? { ok: true, value: opcion.trim() } : { ok: false, reason: "opcion" };
    }
    case "boolean": {
      const t = normalizeToken(text);
      if (["si", "yes", "true"].includes(t)) return { ok: true, value: "Sí" };
      if (["no", "false"].includes(t)) return { ok: true, value: "No" };
      return { ok: false, reason: "formato" };
    }
    default:
      return { ok: false, reason: "formato" };
  }
}

function channelValue(raw: string | undefined): FieldValueResult {
  const text = raw ? sanitizeText(raw, 40) : "";
  return text ? { ok: true, value: text } : { ok: false, reason: "vacio" };
}

export interface ResolvedCustomerEntry {
  key: string;
  label: string;
  scope: CustomerFieldScope;
  value: string;
}

export interface CustomerDataProblem {
  key: string;
  label: string;
  reason: FieldValueFailure;
}

export type ResolveCustomerDataResult =
  | {
      ok: true;
      entries: ResolvedCustomerEntry[];
      /** Valores ya normalizados de las claves conocidas (si están configuradas). */
      nombre?: string;
      telefono?: string;
      correo?: string;
      notas?: string;
    }
  | { ok: false; problems: CustomerDataProblem[] };

/**
 * Resuelve los datos del cliente contra la configuración. AUTORIDAD del
 * backend: un campo requerido ausente o inválido => ok:false (la reserva no
 * procede). Un campo OPCIONAL inválido se descarta (nunca bloquea ni se guarda).
 * El teléfono de una clave `channelSourced` viene SIEMPRE del canal (saneado, sin
 * re-validar formato), nunca del payload (que la IA podría haber alterado).
 */
export function resolveCustomerData(input: {
  fields: readonly CustomerField[];
  values: Record<string, string | undefined>;
  channelPhone?: string;
}): ResolveCustomerDataResult {
  const entries: ResolvedCustomerEntry[] = [];
  const problems: CustomerDataProblem[] = [];

  for (const field of activeFields(input.fields)) {
    // Un valor aportado por el CANAL (teléfono de WhatsApp) es de confianza por
    // definición: se sanea pero NO se re-valida por formato -- el identificador
    // real del canal (p. ej. de una cuenta conectada por QR) no siempre calza con
    // la regex de un teléfono tecleado, y rechazarlo bloquearía reservas legítimas.
    const result: FieldValueResult = isChannelSourced(field.key)
      ? channelValue(input.channelPhone)
      : validateFieldValue(field, input.values[field.key]);
    if (result.ok) {
      entries.push({ key: field.key, label: field.label, scope: field.scope, value: result.value });
    } else if (field.required) {
      problems.push({ key: field.key, label: field.label, reason: result.reason });
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  const byKey = (k: string) => entries.find((e) => e.key === k)?.value;
  return {
    ok: true,
    entries,
    nombre: byKey("nombreCliente"),
    telefono: byKey("telefonoCliente"),
    correo: byKey("correoCliente"),
    notas: byKey("notas"),
  };
}

/** Texto plano para la descripción del evento del calendario (sin `<`/`>`, tope de longitud). */
export function formatCustomerDataForEvent(entries: readonly ResolvedCustomerEntry[], extraNotes?: string): string {
  const lineas = entries.map((e) => `${sanitizeText(e.label, MAX_FIELD_LABEL_LENGTH)}: ${e.value}`);
  const extra = extraNotes ? sanitizeText(extraNotes, MAX_LONG_VALUE_LENGTH) : "";
  if (extra && !entries.some((e) => e.key === "notas")) lineas.push(`Notas: ${extra}`);
  return lineas.join("\n").slice(0, 2000);
}

/** Huella estable de los datos resueltos (idempotencia: mismo effectId con datos distintos => conflicto). */
export function customerDataFingerprint(entries: readonly ResolvedCustomerEntry[]): string {
  return entries.map((e) => `${e.key}=${e.value}`).join("|");
}

// --- Lectura defensiva de la configuración embebida en la acción -------------
export type ParsedCustomerFields = { ok: true; fields: CustomerField[] } | { ok: false };

/**
 * Parsea `customerFieldsJson` (definición ESTÁTICA que el compiler embebe en la
 * acción). Fail-closed: si existe pero está corrupta => ok:false (el backend no
 * reserva a ciegas). Ausente/vacía => campos [] (agente sin datos configurados).
 */
export function parseCustomerFieldsJson(json: string | undefined): ParsedCustomerFields {
  if (json === undefined || json.trim() === "") return { ok: true, fields: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false };
  }
  const shape = customerDataSchema.safeParse({ fields: parsed });
  if (!shape.success) return { ok: false };
  const fields = shape.data.fields as CustomerField[];
  if (validateCustomerFieldsConfig(fields).length > 0) return { ok: false };
  return { ok: true, fields };
}
