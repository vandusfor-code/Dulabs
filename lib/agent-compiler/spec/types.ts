// DuLabs Business — Agent Compiler (Fase 1), Step 4.
//
// BusinessAgentSpec: contrato MAESTRO, industry-agnostic, entre el formulario
// de UI y el Compiler. Declarativo, versionado y validable. El usuario final
// configura opciones estructuradas; DuLabs las compila (en Steps posteriores)
// a FlowDefinition + policies + tools sobre el Flow Engine EXISTENTE. Este
// archivo define SOLO el contrato; no genera flows, ni runtime, ni scheduling.
//
// SEGURIDAD: el Spec NO contiene tenantId. El tenant se deriva del contexto
// autenticado del servidor; jamás del contenido del LLM/PDF/frontend.

import type { ConditionMatchMode, ConditionRule } from "@/lib/flow/types";
import type { CapabilityKey } from "@/lib/agent-compiler/spec/capabilities";

/** Versión del CONTRATO (SemVer del schema del Spec, no del agente). */
export type SpecSchemaVersion = "1.0.0";
export const CURRENT_SPEC_SCHEMA_VERSION: SpecSchemaVersion = "1.0.0";

/**
 * Valor centinela del tipo de negocio que habilita el campo libre
 * `businessTypeCustom`. Fuente única de verdad para schema, formulario y
 * compiler -- así "Otro" nunca queda hardcodeado en tres sitios distintos.
 */
export const BUSINESS_TYPE_OTRO = "Otro";

// --- 1. IDENTITY -----------------------------------------------------------
export interface AgentIdentity {
  businessName: string;
  agentName: string;
  description?: string;
  /**
   * Categoría de negocio elegida en el wizard (un desplegable). Es CONTEXTO
   * para el compiler, NUNCA una lista rígida en lógica: cualquier string es
   * válido. Cuando vale BUSINESS_TYPE_OTRO ("Otro"), el tipo real está en
   * `businessTypeCustom`. Opcional para no romper Specs previos sin el campo.
   */
  businessType?: string;
  /** Tipo libre cuando businessType === "Otro" (negocio aún no contemplado). */
  businessTypeCustom?: string;
  /** IETF BCP-47 (ej. "es-CO"). */
  language: string;
  /** IANA tz (ej. "America/Bogota"). */
  timezone: string;
}

// --- 2. PERSONALITY (estructurada, no texto libre) -------------------------
export type PersonalityPrimary = "professional" | "friendly" | "direct" | "consultative";
export type PersonalityVerbosity = "concise" | "balanced" | "detailed";
export type PersonalityEmojiPolicy = "none" | "limited";
export type PersonalityFormality = "formal" | "neutral" | "casual";

export interface AgentPersonality {
  primary: PersonalityPrimary;
  verbosity: PersonalityVerbosity;
  emojiPolicy: PersonalityEmojiPolicy;
  formality: PersonalityFormality;
}

// --- 3. CAPABILITIES (tipadas + ancladas al Runtime) -----------------------
export type AgentCapabilities = Record<CapabilityKey, boolean>;

// --- 4. CATALOG (cómo usar el catálogo; los datos viven en tablas) ---------
export interface CatalogConfig {
  /** Siempre "structured": la autoridad son las tablas, nunca el prompt/PDF. */
  source: "structured";
  useServices: boolean;
  useProducts: boolean;
  /** Si el agente puede dar precio antes de calificar al cliente. */
  quoteBeforeQualification: boolean;
}

// --- 5. POLICIES: PROHIBITIONS + RULES -------------------------------------
/** Condición reutilizando el contrato del Runtime (mapea a un condition node). */
export interface PolicyCondition {
  rules: ConditionRule[];
  match: ConditionMatchMode;
}

export type ProhibitionScope = "business" | "state" | "contextual";
export type ProhibitionAction = "BLOCK" | "FIXED_RESPONSE" | "TRANSFER_HUMAN";

export interface Prohibition {
  id: string;
  description: string;
  scope: ProhibitionScope;
  /** Requerida cuando scope === "contextual" (ej. MASCOTA + ESTUDIO). */
  condition?: PolicyCondition;
  action: ProhibitionAction;
  /** Texto fijo cuando action === FIXED_RESPONSE/BLOCK. */
  response?: string;
  /** Mayor prioridad gana ante conflictos. */
  priority: number;
}

export type RuleKind = "informative" | "reminder" | "requirement" | "validation" | "precondition";

export interface BusinessRule {
  id: string;
  description: string;
  kind: RuleKind;
  /** Mensaje/recordatorio asociado, si aplica. */
  response?: string;
  priority: number;
}

export interface PoliciesConfig {
  prohibitions: Prohibition[];
  rules: BusinessRule[];
}

// --- 6. HUMAN HANDOFF ------------------------------------------------------
export type HandoffTriggerKind = "agent_request" | "complaint" | "discount_request" | "keyword" | "intent";
export type HandoffAction = "TRANSFER_HUMAN" | "FIXED_RESPONSE_THEN_PAUSE";

export interface HandoffTrigger {
  kind: HandoffTriggerKind;
  /** Requerido cuando kind === "keyword". */
  keywords?: string[];
  /** Etiqueta de intención cuando kind === "intent". */
  intent?: string;
}

export interface HandoffRule {
  id: string;
  description: string;
  trigger: HandoffTrigger;
  action: HandoffAction;
  response?: string;
  pauseHours?: number;
}

export interface HandoffConfig {
  rules: HandoffRule[];
  defaultPauseHours: number;
}

// --- 7. SCHEDULING (genérico; sin acoplar a una industria) -----------------
export type SchedulingProvider = "none" | "internal" | "nylas" | "google_calendar";

/** Recurso genérico requerido por una cita: "specialist", "table", "room", "court"... */
export interface ResourceRequirement {
  kind: string;
  label: string;
  required: boolean;
}

/** Un intervalo de atención dentro de un día, en hora local del negocio (HH:MM 24h). */
export interface BusinessHoursInterval {
  open: string;
  close: string;
}

/** Atención de un día de la semana (puede tener varios intervalos: p. ej. cierre al mediodía). */
export interface BusinessDaySchedule {
  closed: boolean;
  intervals: BusinessHoursInterval[];
}

/** Excepción por fecha concreta (festivo, vacaciones, horario especial). */
export interface BusinessHoursException {
  /** YYYY-MM-DD. */
  date: string;
  closed: boolean;
  intervals: BusinessHoursInterval[];
}

/**
 * Horario de atención del negocio (REGLA de disponibilidad, no reemplaza al
 * calendario real). Las horas están en la zona horaria del negocio
 * (scheduling.timezone). `week` tiene 7 posiciones, índice 0 = domingo ...
 * 6 = sábado (getUTCDay de la fecha), para casar con el cálculo determinista
 * del backend.
 */
export interface BusinessHours {
  week: BusinessDaySchedule[];
  exceptions: BusinessHoursException[];
}

export interface SchedulingConfig {
  enabled: boolean;
  provider: SchedulingProvider;
  timezone: string;
  minNoticeMinutes: number;
  cancellation: { allowed: boolean; minNoticeHours: number };
  confirmation: { required: boolean; hoursBefore: number };
  resources: ResourceRequirement[];
  /**
   * Horario de atención estructurado. Opcional a nivel de contrato (Specs
   * previos no lo traen -> no se bloquea por horario, compatibilidad). El
   * validador de publicación exige tenerlo cuando el agendamiento está activo.
   */
  businessHours?: BusinessHours;
}

// --- 8. KNOWLEDGE (secundario; nunca autoridad sobre lo estructurado) ------
export interface KnowledgeDocument {
  id: string;
  filename: string;
  /** Referencia al texto ya extraído (pdf-parse corre en subida). */
  textRef?: string;
  uploadedAt: string;
}

/** Qué hace el agente cuando NO encuentra información relevante (nunca inventa). */
export type KnowledgeNoAnswerPolicy = "message" | "handoff";

export interface KnowledgeConfig {
  /** Literal fijo: el conocimiento no estructurado SIEMPRE es secundario. */
  authority: "secondary";
  documents: KnowledgeDocument[];
  /**
   * R4 -- política sin respuesta. "message" (default): responde el mensaje fijo y
   * sigue; "handoff": transfiere a una persona (requiere la capability
   * humanHandoff). Opcional: los Specs previos no lo traen (= "message").
   * FAQ y documentos NO viven en el Spec: son datos por tenant (dulabs_ba_faqs /
   * dulabs_ba_knowledge_*) editables sin publicar una versión nueva.
   */
  onNoAnswer?: KnowledgeNoAnswerPolicy;
  /** Mensaje fijo cuando no hay información (≤300). Vacío = el estándar del sistema. */
  noAnswerMessage?: string;
}

// --- 9. CUSTOMER DATA (datos que el agente captura del cliente) -------------
/**
 * Tipos soportados = los que el Runtime YA sabe validar de forma determinista
 * (question.validation: text/number/email/phone/regex/hora_colombia). `date`,
 * `select` y `boolean` se expresan como `regex`; `time` como `hora_colombia`.
 * Ningún tipo requiere al LLM para validarse.
 */
export const CUSTOMER_FIELD_TYPES = ["text", "phone", "email", "number", "date", "time", "select", "boolean"] as const;
export type CustomerFieldType = (typeof CUSTOMER_FIELD_TYPES)[number];

/**
 * Dónde vive el dato una vez capturado:
 *  - "customer": pertenece a la PERSONA -- se guarda en su contacto
 *    (dulabs_clientes_conocidos.custom_fields), se reutiliza en próximas
 *    conversaciones (no se vuelve a preguntar) y viaja con la reserva.
 *  - "booking": pertenece a ESTA reserva (motivo, nº de personas...) -- viaja
 *    con el evento del calendario; nunca se guarda en el contacto ni se
 *    reutiliza.
 */
export const CUSTOMER_FIELD_SCOPES = ["customer", "booking"] as const;
export type CustomerFieldScope = (typeof CUSTOMER_FIELD_SCOPES)[number];

export interface CustomerField {
  /**
   * Identificador técnico estable: nombre de la variable del flow, del
   * custom_field del contacto y del parámetro de la acción de reserva.
   * Claves "conocidas" (nombreCliente/telefonoCliente/correoCliente/notas)
   * tienen semántica propia (ver lib/customer-data.ts::WELL_KNOWN_FIELDS).
   */
  key: string;
  /** Etiqueta visible (evento del calendario, resumen del wizard). */
  label: string;
  type: CustomerFieldType;
  /** El backend NO reserva si falta un dato requerido (la IA no decide esto). */
  required: boolean;
  /** Apagado = no se pregunta ni se exige (se conserva en el Spec). */
  enabled: boolean;
  scope: CustomerFieldScope;
  /** Pregunta que se le hace al cliente. Opcional: hay una por defecto. */
  question?: string;
  /** Nota interna para quien configura (no se le muestra al cliente). */
  description?: string;
  /** Solo type === "select": opciones válidas. */
  options?: string[];
}

export interface CustomerDataConfig {
  fields: CustomerField[];
}

// --- 10. METADATA / VERSIONADO ---------------------------------------------
export type SpecStatus = "draft" | "compiled" | "published" | "archived";

export interface SpecMetadata {
  /** Versión del AGENTE (incrementa en cada cambio de config). */
  specVersion: number;
  status: SpecStatus;
  createdAt: string;
  updatedAt: string;
  authorId?: string;
}

// --- Contrato completo -----------------------------------------------------
export interface BusinessAgentSpec {
  schemaVersion: SpecSchemaVersion;
  identity: AgentIdentity;
  personality: AgentPersonality;
  capabilities: AgentCapabilities;
  catalog: CatalogConfig;
  policies: PoliciesConfig;
  handoff: HandoffConfig;
  scheduling: SchedulingConfig;
  knowledge: KnowledgeConfig;
  /**
   * Datos que el agente captura del cliente. OPCIONAL: los Specs previos no lo
   * traen y siguen compilando exactamente igual (compatibilidad hacia atrás).
   */
  customerData?: CustomerDataConfig;
  metadata: SpecMetadata;
}
