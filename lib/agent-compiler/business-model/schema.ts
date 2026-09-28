// DuLabs Business — Business Agent 2.0, FASE 5 — Universal Business Model (UBM).
//
// Describe el NEGOCIO, no el agente: identidad, capacidades explícitas (con su configuración), servicios, productos,
// recursos genéricos, datos del cliente, horario y políticas. No contiene prompts, ni flujos, ni tenant, ni permisos:
//
//   Business Model (este archivo) → Validación (validate.ts) → Compilación (compile.ts) → Artefacto publicado
//   inmutable (artifact.ts) → Runtime (state machine + Action Engine)
//
// No hay lógica por industria: `identity.category` es METADATO (no cambia el comportamiento; lo prueba un test).
// Todo es estricto (.strict()): un campo desconocido es rechazo, no "se ignora".

import { z } from "zod";
import { AGENT_TONES, CUSTOMER_FIELD_SCOPES, CUSTOMER_FIELD_TYPES } from "@/lib/agent-compiler/spec/types";
import { MAX_CUSTOMER_FIELDS, MAX_FIELD_DESCRIPTION_LENGTH, MAX_FIELD_KEY_LENGTH, MAX_FIELD_LABEL_LENGTH, MAX_FIELD_QUESTION_LENGTH, MAX_OPTION_LENGTH, MAX_SELECT_OPTIONS } from "@/lib/customer-data";

export const BUSINESS_MODEL_SCHEMA_VERSION = "business-agent.business-model/1.0.0" as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();

/** Identificador estable de un elemento del modelo (servicio, producto, recurso). */
export const MODEL_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const modelId = z.string().regex(MODEL_ID_RE);

/** Clave de un campo personalizado (metadatos): snake_case. Las claves protegidas las rechaza el validador. */
export const METADATA_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const MAX_METADATA_ENTRIES = 30;

/** Campos personalizados CONTROLADOS: claves allowlisted por forma, valores escalares acotados (nada anidado). */
export const customMetadataSchema = z.record(z.string(), z.union([z.string().max(200), z.number().finite(), z.boolean()]));

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Identidad
// ---------------------------------------------------------------------------

export const identitySchema = z
  .object({
    name: text(120),
    description: optionalText(1000),
    /** METADATO: no selecciona prompts, flujos ni reglas. */
    category: optionalText(80),
    /** BCP-47 (p. ej. "es-CO"). */
    language: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
    /** ISO-4217 (p. ej. "COP"). */
    currency: z.string().regex(/^[A-Z]{3}$/),
    /** IANA. ÚNICA fuente de verdad de la zona horaria del negocio (la agenda no tiene otra). */
    timezone: text(64),
    contact: z
      .object({ phone: optionalText(40), email: z.string().trim().email().max(200).optional(), website: z.string().trim().url().max(300).optional() })
      .strict()
      .optional(),
    location: z
      .object({ address: optionalText(300), city: optionalText(120), country: z.string().regex(/^[A-Z]{2}$/).optional() })
      .strict()
      .optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Catálogo del negocio (datos) y recursos genéricos
// ---------------------------------------------------------------------------

export const priceSchema = z.object({ amount: z.number().finite().min(0).max(1e12), currency: z.string().regex(/^[A-Z]{3}$/) }).strict();

export const serviceSchema = z
  .object({
    id: modelId,
    name: text(120),
    description: optionalText(500),
    durationMinutes: z.number().int().min(5).max(480),
    price: priceSchema.optional(),
    active: z.boolean(),
    bookingEnabled: z.boolean(),
    /** Recursos genéricos (persona, mesa, sala, cancha…) que pueden prestar el servicio. */
    resourceIds: z.array(modelId).max(50).optional(),
    metadata: customMetadataSchema.optional(),
  })
  .strict();

export const productSchema = z
  .object({
    id: modelId,
    name: text(120),
    description: optionalText(500),
    price: priceSchema.optional(),
    active: z.boolean(),
    metadata: customMetadataSchema.optional(),
  })
  .strict();

/** Recurso GENÉRICO: `kind` es un texto libre del negocio ("staff", "table", "room"); el código no conoce tipos por industria. */
export const resourceSchema = z
  .object({
    id: modelId,
    name: text(120),
    kind: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    active: z.boolean(),
    serviceIds: z.array(modelId).max(200),
    metadata: customMetadataSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Datos del cliente (mismo contrato que el Spec: los handlers de reserva ya lo validan)
// ---------------------------------------------------------------------------

export const customerFieldSchema = z
  .object({
    key: z.string().trim().min(1).max(MAX_FIELD_KEY_LENGTH),
    label: z.string().trim().min(1).max(MAX_FIELD_LABEL_LENGTH),
    type: z.enum(CUSTOMER_FIELD_TYPES),
    required: z.boolean(),
    enabled: z.boolean(),
    scope: z.enum(CUSTOMER_FIELD_SCOPES),
    question: z.string().trim().max(MAX_FIELD_QUESTION_LENGTH).optional(),
    description: z.string().trim().max(MAX_FIELD_DESCRIPTION_LENGTH).optional(),
    options: z.array(z.string().trim().min(1).max(MAX_OPTION_LENGTH)).max(MAX_SELECT_OPTIONS).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Horario (estructurado; en la zona de identity.timezone)
// ---------------------------------------------------------------------------

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const intervalSchema = z.object({ start: z.string().regex(HHMM), end: z.string().regex(HHMM) }).strict();
export const dayScheduleSchema = z.object({ open: z.boolean(), intervals: z.array(intervalSchema).max(6) }).strict();

export const businessHoursSchema = z
  .object({
    week: z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, dayScheduleSchema])) as Record<Weekday, typeof dayScheduleSchema>).strict(),
    exceptions: z.array(z.object({ date: z.string().regex(ISO_DATE), open: z.boolean(), intervals: z.array(intervalSchema).max(6) }).strict()).max(366),
  })
  .strict();

// ---------------------------------------------------------------------------
// Capacidades explícitas: {id, version, enabled, config}. Las acciones, requisitos y dependencias NO los declara el
// modelo: salen del catálogo en código (capabilities.ts). Un modelo no puede otorgarse acciones.
// ---------------------------------------------------------------------------

export const capabilityEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    enabled: z.boolean(),
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

// ---------------------------------------------------------------------------
// Políticas estructuradas (las de agenda viven en la config de `booking`)
// ---------------------------------------------------------------------------

export const policiesSchema = z
  .object({
    /** Qué hacer ante algo que el negocio no gestiona por aquí: ofrecer una persona (si hay handoff) o solo informar. */
    unsupportedRequest: z.enum(["offer_handoff", "inform_only"]),
  })
  .strict();

/**
 * FASE 8 — presentación: SOLO estilo de las respuestas. Nunca entra en la huella de ejecución ni cambia un hecho
 * (precio, fecha, disponibilidad, resultado): esos los pone el backend. Ausente = tono "cercano".
 */
export const presentationSchema = z.object({ tone: z.enum(AGENT_TONES), assistantName: optionalText(60) }).strict();

// ---------------------------------------------------------------------------
// Modelo completo
// ---------------------------------------------------------------------------

export const businessModelSchema = z
  .object({
    schemaVersion: z.literal(BUSINESS_MODEL_SCHEMA_VERSION),
    identity: identitySchema,
    capabilities: z.array(capabilityEntrySchema).max(20),
    /**
     * Autoridad del catálogo:
     *   "business_tables"  servicios/productos viven en las tablas del negocio (dulabs_servicios / inventario), que es
     *                      lo que leen hoy los handlers de catálogo y cotización. El modelo NO los repite (sin doble verdad).
     *   "model"            el modelo declara sus servicios; el runtime los usa para validar qué se puede reservar y con
     *                      qué duración. Listar/cotizar siguen leyendo tablas, así que con esta autoridad `catalog` y
     *                      `quotes` no se pueden activar (lo rechaza el validador; no se simula).
     */
    catalogAuthority: z.enum(["business_tables", "model"]),
    services: z.array(serviceSchema).max(200),
    products: z.array(productSchema).max(500),
    resources: z.array(resourceSchema).max(100),
    customerFields: z.array(customerFieldSchema).max(MAX_CUSTOMER_FIELDS),
    businessHours: businessHoursSchema.nullable(),
    policies: policiesSchema,
    presentation: presentationSchema.optional(),
    metadata: customMetadataSchema.optional(),
  })
  .strict();

export type BusinessModel = z.infer<typeof businessModelSchema>;
export type BusinessModelInput = z.input<typeof businessModelSchema>;
export type CapabilityEntry = z.infer<typeof capabilityEntrySchema>;
export type BusinessHoursModel = z.infer<typeof businessHoursSchema>;
export type ServiceModel = z.infer<typeof serviceSchema>;
export type ProductModel = z.infer<typeof productSchema>;
export type ResourceModel = z.infer<typeof resourceSchema>;
export type CustomerFieldModel = z.infer<typeof customerFieldSchema>;
