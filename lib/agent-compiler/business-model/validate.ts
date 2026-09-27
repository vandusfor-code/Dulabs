// DuLabs Business — Business Agent 2.0, FASE 5 — validador de publicación del Universal Business Model.
//
// FAIL-CLOSED: un modelo con cualquier error NO se compila ni se publica (PUBLICATION_REJECTED con errores
// estructurados {code, path, message}). No hay "warnings que se publican igual" para lo que el runtime no puede cumplir:
// zona horaria no soportada, acción sin runtime, dependencia faltante, horario inválido, campos protegidos…

import { businessModelSchema, METADATA_KEY_RE, MAX_METADATA_ENTRIES, WEEKDAYS, type BusinessModel } from "@/lib/agent-compiler/business-model/schema";
import {
  CAPABILITY_CATALOG,
  dependenciesOf,
  isUbmCapabilityId,
  type BookingCapabilityConfig,
  type CatalogCapabilityConfig,
  type HandoffCapabilityConfig,
  type KnowledgeCapabilityConfig,
  type UbmCapabilityId,
} from "@/lib/agent-compiler/business-model/capabilities";
import { RESERVED_FIELD_KEYS, validateCustomerFieldsConfig, WELL_KNOWN_FIELDS } from "@/lib/customer-data";
import { isSystemInternalVariableKey } from "@/lib/flow/ai-runtime/protected-variables";
import { hhmmToMinutes } from "@/lib/business-hours";

/** Única zona que los handlers de agenda existentes soportan (offset fijo -05:00). */
export const SUPPORTED_BOOKING_TIMEZONE = "America/Bogota";

export const MODEL_ERROR_CODES = [
  "SCHEMA_INVALID",
  "TIMEZONE_INVALID",
  "TIMEZONE_NOT_SUPPORTED",
  "LANGUAGE_NOT_SUPPORTED",
  "CURRENCY_INVALID",
  "UNKNOWN_CAPABILITY",
  "DUPLICATE_CAPABILITY",
  "UNSUPPORTED_CAPABILITY_VERSION",
  "CAPABILITY_CONFIG_INVALID",
  "CAPABILITY_NOT_AVAILABLE",
  "CAPABILITY_DEPENDENCY_MISSING",
  "CATALOG_AUTHORITY_CONFLICT",
  "BUSINESS_HOURS_REQUIRED",
  "BUSINESS_HOURS_INVALID",
  "BUSINESS_HOURS_OVERLAP",
  "BOOKING_BUFFER_NOT_SUPPORTED",
  "RESOURCE_SELECTION_NOT_SUPPORTED",
  "BOOKING_POLICY_NOT_SUPPORTED",
  "BOOKING_WITHOUT_BOOKABLE_SERVICE",
  "DUPLICATE_ID",
  "DUPLICATE_NAME",
  "UNKNOWN_REFERENCE",
  "PRICE_CURRENCY_MISMATCH",
  "CUSTOMER_FIELD_INVALID",
  "PROTECTED_FIELD",
  "METADATA_INVALID",
  "POLICY_REQUIRES_CAPABILITY",
] as const;
export type ModelErrorCode = (typeof MODEL_ERROR_CODES)[number];

export interface ModelError {
  code: ModelErrorCode;
  path: string;
  message: string;
}

/** Capacidades resueltas (config ya validada con el schema de su capacidad). Solo las ACTIVAS. */
export interface ResolvedCapabilities {
  knowledge?: { version: string; config: KnowledgeCapabilityConfig };
  catalog?: { version: string; config: CatalogCapabilityConfig };
  quotes?: { version: string; config: Record<string, never> };
  booking?: { version: string; config: BookingCapabilityConfig };
  handoff?: { version: string; config: HandoffCapabilityConfig };
}

export type BusinessModelValidation = { ok: true; model: BusinessModel; capabilities: ResolvedCapabilities } | { ok: false; code: "PUBLICATION_REJECTED"; errors: ModelError[] };

/**
 * Nombres que un campo personalizado nunca puede usar: identidad del tenant/agente, permisos, capacidades,
 * autorización, acciones. Se comparan normalizados (sin mayúsculas, guiones ni guion bajo).
 */
export const PROTECTED_FIELD_NAMES: ReadonlySet<string> = new Set([
  "tenant", "tenantid", "tenants", "organization", "organizationid", "orgid",
  "permission", "permissions", "role", "roles", "owner", "admin", "scope", "scopes",
  "capability", "capabilities", "authorization", "authorized", "auth", "token", "accesstoken", "apikey", "secret", "password",
  "action", "actions", "actiontype", "tool", "tools",
  "agent", "agentid", "agentversion", "agentname", "flowid", "flowversionid", "artifact", "artifactid", "checksum", "publishedversion",
  "systemprompt", "prompt", "instructions",
]);

export function isProtectedFieldName(key: string): boolean {
  const norm = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return PROTECTED_FIELD_NAMES.has(norm) || RESERVED_FIELD_KEYS.has(key) || isSystemInternalVariableKey(key);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz.includes("/") || tz === "UTC";
  } catch {
    return false;
  }
}

function isValidCurrency(code: string): boolean {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("currency");
  return supported ? supported.includes(code) : /^[A-Z]{3}$/.test(code);
}

function isCalendarDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

function checkIntervals(intervals: ReadonlyArray<{ start: string; end: string }>, path: string, errors: ModelError[]): void {
  const spans: Array<[number, number]> = [];
  intervals.forEach((iv, i) => {
    const s = hhmmToMinutes(iv.start);
    const e = hhmmToMinutes(iv.end);
    if (s === null || e === null || s >= e) {
      errors.push({ code: "BUSINESS_HOURS_INVALID", path: `${path}.intervals[${i}]`, message: "El inicio debe ser anterior al fin." });
      return;
    }
    spans.push([s, e]);
  });
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i]![0] < spans[i - 1]![1]) errors.push({ code: "BUSINESS_HOURS_OVERLAP", path: `${path}.intervals`, message: "Los intervalos del día se superponen." });
  }
}

function checkMetadata(meta: Record<string, unknown> | undefined, path: string, errors: ModelError[]): void {
  if (!meta) return;
  const keys = Object.keys(meta);
  if (keys.length > MAX_METADATA_ENTRIES) errors.push({ code: "METADATA_INVALID", path, message: `Máximo ${MAX_METADATA_ENTRIES} campos personalizados.` });
  for (const k of keys) {
    if (!METADATA_KEY_RE.test(k)) errors.push({ code: "METADATA_INVALID", path: `${path}.${k}`, message: "Clave inválida: minúsculas, números y guion bajo, empezando por letra." });
    else if (isProtectedFieldName(k)) errors.push({ code: "PROTECTED_FIELD", path: `${path}.${k}`, message: `"${k}" es un campo protegido del sistema.` });
  }
}

function duplicates<T>(items: readonly T[], keyOf: (t: T) => string): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const it of items) {
    const k = keyOf(it);
    if (seen.has(k)) dup.add(k);
    seen.add(k);
  }
  return dup;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Valida un modelo para PUBLICAR. Puro: sin I/O. */
export function validateBusinessModel(raw: unknown): BusinessModelValidation {
  const parsed = businessModelSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: "PUBLICATION_REJECTED",
      errors: parsed.error.issues.slice(0, 50).map((i) => ({ code: "SCHEMA_INVALID" as const, path: i.path.join(".") || "(root)", message: i.message })),
    };
  }
  const model = parsed.data;
  const errors: ModelError[] = [];

  // --- Identidad ---
  if (!isValidTimeZone(model.identity.timezone)) errors.push({ code: "TIMEZONE_INVALID", path: "identity.timezone", message: "Zona horaria IANA inválida." });
  if (!model.identity.language.startsWith("es")) errors.push({ code: "LANGUAGE_NOT_SUPPORTED", path: "identity.language", message: "Las respuestas del runtime están en español; otro idioma no está soportado." });
  if (!isValidCurrency(model.identity.currency)) errors.push({ code: "CURRENCY_INVALID", path: "identity.currency", message: "Moneda ISO-4217 inválida." });
  checkMetadata(model.metadata, "metadata", errors);

  // --- Capacidades ---
  const resolved: ResolvedCapabilities = {};
  const enabled = new Set<UbmCapabilityId>();
  const seen = new Set<string>();
  const configs = new Map<UbmCapabilityId, unknown>();
  model.capabilities.forEach((c, i) => {
    const path = `capabilities[${i}]`;
    if (!isUbmCapabilityId(c.id)) return void errors.push({ code: "UNKNOWN_CAPABILITY", path, message: `Capacidad desconocida: ${c.id}.` });
    if (seen.has(c.id)) return void errors.push({ code: "DUPLICATE_CAPABILITY", path, message: `Capacidad repetida: ${c.id}.` });
    seen.add(c.id);
    const def = CAPABILITY_CATALOG[c.id];
    if (!def.versions.includes(c.version)) return void errors.push({ code: "UNSUPPORTED_CAPABILITY_VERSION", path: `${path}.version`, message: `Versión no soportada de ${c.id}: ${c.version}.` });
    if (!c.enabled) return;
    if (!def.executable) return void errors.push({ code: "CAPABILITY_NOT_AVAILABLE", path, message: `${c.id} no tiene acción de runtime: no se puede activar.` });
    const cfg = def.configSchema.safeParse(c.config);
    if (!cfg.success) {
      for (const issue of cfg.error.issues.slice(0, 10)) errors.push({ code: "CAPABILITY_CONFIG_INVALID", path: `${path}.config.${issue.path.join(".")}`, message: issue.message });
      return;
    }
    enabled.add(c.id);
    configs.set(c.id, cfg.data);
    (resolved as Record<string, unknown>)[c.id] = { version: c.version, config: cfg.data };
  });
  for (const id of enabled) {
    for (const dep of dependenciesOf(id, configs.get(id))) {
      if (!enabled.has(dep)) errors.push({ code: "CAPABILITY_DEPENDENCY_MISSING", path: `capabilities.${id}`, message: `${id} requiere la capacidad ${dep}.` });
    }
  }

  // --- Autoridad del catálogo (sin doble verdad) ---
  if (model.catalogAuthority === "business_tables" && (model.services.length > 0 || model.products.length > 0)) {
    errors.push({ code: "CATALOG_AUTHORITY_CONFLICT", path: "services", message: "Con catálogo en las tablas del negocio, el modelo no repite servicios ni productos." });
  }
  if (model.catalogAuthority === "model") {
    for (const id of ["catalog", "quotes"] as const) {
      if (enabled.has(id)) errors.push({ code: "CATALOG_AUTHORITY_CONFLICT", path: `capabilities.${id}`, message: `${id} lee el catálogo de las tablas del negocio; con catálogo en el modelo no se puede activar.` });
    }
  }
  if (resolved.catalog && !resolved.catalog.config.includeServices && !resolved.catalog.config.includeProducts) {
    errors.push({ code: "CAPABILITY_CONFIG_INVALID", path: "capabilities.catalog.config", message: "El catálogo debe incluir servicios, productos o ambos." });
  }

  // --- Horario (estructura) ---
  const hours = model.businessHours;
  if (hours) {
    for (const d of WEEKDAYS) {
      const day = hours.week[d];
      if (!day.open) continue;
      if (day.intervals.length === 0) errors.push({ code: "BUSINESS_HOURS_INVALID", path: `businessHours.week.${d}`, message: "Un día abierto necesita al menos un intervalo." });
      checkIntervals(day.intervals, `businessHours.week.${d}`, errors);
    }
    const dupDates = duplicates(hours.exceptions, (e) => e.date);
    hours.exceptions.forEach((e, i) => {
      const path = `businessHours.exceptions[${i}]`;
      if (!isCalendarDate(e.date)) errors.push({ code: "BUSINESS_HOURS_INVALID", path, message: "Fecha inválida." });
      if (dupDates.has(e.date)) errors.push({ code: "BUSINESS_HOURS_INVALID", path, message: "Fecha de excepción repetida." });
      if (e.open) {
        if (e.intervals.length === 0) errors.push({ code: "BUSINESS_HOURS_INVALID", path, message: "Una excepción abierta necesita intervalos." });
        checkIntervals(e.intervals, path, errors);
      }
    });
  }

  // --- Agenda ---
  const booking = resolved.booking?.config;
  if (booking) {
    if (model.identity.timezone !== SUPPORTED_BOOKING_TIMEZONE) {
      errors.push({ code: "TIMEZONE_NOT_SUPPORTED", path: "identity.timezone", message: `La agenda solo opera en ${SUPPORTED_BOOKING_TIMEZONE} (los handlers de agenda usan offset fijo).` });
    }
    if (booking.provider === "nylas" && (!hours || !WEEKDAYS.some((d) => hours.week[d].open && hours.week[d].intervals.length > 0))) {
      errors.push({ code: "BUSINESS_HOURS_REQUIRED", path: "businessHours", message: "La agenda con calendario exige un horario con al menos un día abierto." });
    }
    if (booking.bufferMinutes !== 0) errors.push({ code: "BOOKING_BUFFER_NOT_SUPPORTED", path: "capabilities.booking.config.bufferMinutes", message: "Los handlers de agenda no aplican margen entre reservas: solo se admite 0." });
    if (booking.resourceSelection !== "none") errors.push({ code: "RESOURCE_SELECTION_NOT_SUPPORTED", path: "capabilities.booking.config.resourceSelection", message: "Elegir persona/mesa/sala no tiene runtime todavía." });
    if (booking.provider !== "nylas" && (booking.cancellation.allowed || booking.rescheduling.allowed)) {
      errors.push({ code: "BOOKING_POLICY_NOT_SUPPORTED", path: "capabilities.booking.config", message: "Cancelar o reprogramar por aquí solo existe con el calendario (Nylas)." });
    }
    if (booking.requiresService && model.catalogAuthority === "model" && !model.services.some((s) => s.active && s.bookingEnabled)) {
      errors.push({ code: "BOOKING_WITHOUT_BOOKABLE_SERVICE", path: "services", message: "La agenda exige servicio, pero no hay servicios activos reservables." });
    }
  }

  // --- Servicios, productos, recursos ---
  const currency = model.identity.currency;
  const serviceIds = new Set(model.services.map((s) => s.id));
  const resourceIds = new Set(model.resources.map((r) => r.id));
  for (const [list, name] of [
    [model.services, "services"],
    [model.products, "products"],
    [model.resources, "resources"],
  ] as const) {
    const dupIds = duplicates(list as ReadonlyArray<{ id: string }>, (x) => x.id);
    const dupNames = duplicates(list as ReadonlyArray<{ name: string }>, (x) => fold(x.name));
    (list as ReadonlyArray<{ id: string; name: string; metadata?: Record<string, unknown>; price?: { currency: string } }>).forEach((item, i) => {
      const path = `${name}[${i}]`;
      if (dupIds.has(item.id)) errors.push({ code: "DUPLICATE_ID", path: `${path}.id`, message: `Id repetido: ${item.id}.` });
      if (dupNames.has(fold(item.name))) errors.push({ code: "DUPLICATE_NAME", path: `${path}.name`, message: "Nombre repetido (el cliente los nombra por nombre)." });
      if (item.price && item.price.currency !== currency) errors.push({ code: "PRICE_CURRENCY_MISMATCH", path: `${path}.price.currency`, message: `La moneda debe ser ${currency}.` });
      checkMetadata(item.metadata, `${path}.metadata`, errors);
    });
  }
  model.services.forEach((s, i) => {
    for (const r of s.resourceIds ?? []) if (!resourceIds.has(r)) errors.push({ code: "UNKNOWN_REFERENCE", path: `services[${i}].resourceIds`, message: `Recurso inexistente: ${r}.` });
  });
  model.resources.forEach((r, i) => {
    for (const s of r.serviceIds) if (!serviceIds.has(s)) errors.push({ code: "UNKNOWN_REFERENCE", path: `resources[${i}].serviceIds`, message: `Servicio inexistente: ${s}.` });
  });

  // --- Datos del cliente (campos personalizados controlados) ---
  for (const issue of validateCustomerFieldsConfig(model.customerFields)) {
    errors.push({ code: "CUSTOMER_FIELD_INVALID", path: issue.index >= 0 ? `customerFields[${issue.index}]` : "customerFields", message: issue.message });
  }
  model.customerFields.forEach((f, i) => {
    if (!WELL_KNOWN_FIELDS[f.key] && isProtectedFieldName(f.key)) errors.push({ code: "PROTECTED_FIELD", path: `customerFields[${i}].key`, message: `"${f.key}" es un campo protegido del sistema.` });
    if (f.enabled && f.scope === "booking" && !enabled.has("booking")) {
      errors.push({ code: "CAPABILITY_DEPENDENCY_MISSING", path: `customerFields[${i}].scope`, message: "Un dato de la reserva requiere la capacidad booking." });
    }
  });

  // --- Políticas ---
  if (model.policies.unsupportedRequest === "offer_handoff" && !enabled.has("handoff")) {
    errors.push({ code: "POLICY_REQUIRES_CAPABILITY", path: "policies.unsupportedRequest", message: "Ofrecer una persona requiere la capacidad handoff." });
  }

  return errors.length > 0 ? { ok: false, code: "PUBLICATION_REJECTED", errors } : { ok: true, model, capabilities: resolved };
}
