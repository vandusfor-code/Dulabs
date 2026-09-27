// DuLabs Business — Business Agent 2.0, FASE 4 — Action Registry (fuente única de lo que el Business Agent ejecuta).
//
// Una definición por acción REAL del runtime (las mismas que ya ejecuta InternalActionExecutor y que tienen contrato en
// FASE 1). Nada de `if (action === ...)` repartidos: el motor solo consulta este registro. Una acción que no está aquí
// no se ejecuta (INVALID_ACTION). No se agregan acciones que no existen (p. ej. pedidos o pagos).
//
// El handler de cada acción es el executor interno existente: el motor le entrega EXACTAMENTE las variables que ese
// handler ya lee (fecha/hora/servicio/appointment_request...) y la configuración ESTÁTICA que el compilador embebió en el
// flow publicado (horario, datos del cliente, política), nunca valores del modelo.

import type { EffectDispatchResult } from "@/lib/flow/executor-types";
import type { CapabilityKey } from "@/lib/agent-compiler/spec/capabilities";
import type { ActionErrorCode } from "@/lib/agent-compiler/actions/result";
import type { ActionPurpose, ActionRequest } from "@/lib/agent-compiler/conversation/model";

export interface FailureMapping {
  code: ActionErrorCode;
  reason: string;
  retryable: boolean;
  ambiguous: boolean;
  invalidSlots: string[];
}

export interface ActionStep {
  /** Acción del executor interno que se invoca en este paso. */
  action: string;
  buildPayload(request: ActionRequest, ctx: StepContext): Record<string, unknown>;
}

export interface StepContext {
  /** Mensaje actual del cliente (runtime-injected; solo lo usa la búsqueda de conocimiento como consulta). */
  userMessage: string;
  /** Datos de pasos previos del mismo request (p. ej. las citas listadas antes de cancelar). */
  previous: Record<string, unknown>;
}

export interface ActionDefinition {
  action: string;
  /** Capacidad del Spec que debe estar activa para ejecutarla. */
  capability: CapabilityKey;
  /** Proveedor de agenda requerido (acciones de agenda): la acción solo existe para ese proveedor. */
  schedulingProvider?: "nylas" | "internal";
  purposes: readonly ActionPurpose[];
  /** Escritura externa / cambio de estado real: nunca se re-ejecuta tras un timeout o un worker caído. */
  mutation: boolean;
  requiresConfirmation: boolean;
  timeoutMs: number;
  retry: { maxAttempts: number; baseDelayMs: number };
  /** Opera sobre fecha/hora del negocio: exige la zona soportada por los handlers existentes. */
  temporal: boolean;
  /** Clave de exclusión (candado) para serializar verificación + escritura; null = sin candado. */
  lockKey?(request: ActionRequest): string | null;
  allowedConstraints: readonly string[];
  allowsCustomerData: boolean;
  /** Pasos: el último es la acción principal; los anteriores son lecturas auxiliares (p. ej. listar citas). */
  steps: readonly ActionStep[];
  /** Datos del resultado que se entregan (allowlist). */
  resultData: readonly string[];
  /** Resultado de éxito lógico (p. ej. listar citas con 0 citas no es éxito). */
  successCheck?(data: Record<string, unknown>): FailureMapping | null;
  mapFailure(result: EffectDispatchResult, request: ActionRequest): FailureMapping;
}

// ---------------------------------------------------------------------------
// Mapeo de errores de los handlers existentes (códigos reales de internal-action-executor.ts)
// ---------------------------------------------------------------------------

const f = (code: ActionErrorCode, reason: string, invalidSlots: string[] = [], retryable = false, ambiguous = false): FailureMapping => ({ code, reason, retryable, ambiguous, invalidSlots });

function byClassification(r: EffectDispatchResult, mutation: boolean): FailureMapping | null {
  switch (r.classification) {
    case "TIMEOUT":
      return f("TIMEOUT", "HANDLER_TIMEOUT", [], !mutation, mutation);
    case "RATE_LIMIT":
      return f("RATE_LIMITED", "RATE_LIMITED", [], !mutation);
    case "AUTH_ERROR":
      return f("EXTERNAL_ERROR", "PROVIDER_AUTH_ERROR");
    case "SECURITY_REJECTED":
      return f(r.error?.includes("tenant") ? "TENANT_ERROR" : "UNAUTHORIZED", "HANDLER_SECURITY_REJECTED");
    case "EXTERNAL_AMBIGUOUS":
      return f("EXTERNAL_ERROR", "OUTCOME_UNKNOWN", [], false, true);
    default:
      return null;
  }
}

/** Motivos de agenda (crear / reprogramar / agenda interna) → código + dato que el cliente puede cambiar. */
const SCHEDULING_REASONS: Readonly<Record<string, [ActionErrorCode, string, string[]]>> = {
  ocupado: ["BUSINESS_RULE_VIOLATION", "SLOT_TAKEN", ["time"]],
  fuera_de_horario: ["BUSINESS_RULE_VIOLATION", "OUTSIDE_BUSINESS_HOURS", ["time"]],
  cerrado: ["BUSINESS_RULE_VIOLATION", "BUSINESS_CLOSED", ["date"]],
  muy_pronto: ["BUSINESS_RULE_VIOLATION", "TOO_SOON", ["time"]],
  muy_cerca: ["BUSINESS_RULE_VIOLATION", "TOO_SOON", ["time"]],
  fecha_pasada: ["BUSINESS_RULE_VIOLATION", "DATE_IN_PAST", ["date"]],
  fecha_invalida: ["INVALID_ARGUMENTS", "DATE_INVALID", ["date"]],
  hora_invalida: ["INVALID_ARGUMENTS", "TIME_INVALID", ["time"]],
  sin_cupos: ["BUSINESS_RULE_VIOLATION", "NO_AVAILABILITY", ["date"]],
  sin_horario: ["BUSINESS_RULE_VIOLATION", "BUSINESS_HOURS_NOT_CONFIGURED", []],
  datos_incompletos: ["BUSINESS_RULE_VIOLATION", "CUSTOMER_DATA_INCOMPLETE", []],
  datos_invalidos: ["INVALID_ARGUMENTS", "CUSTOMER_DATA_INVALID", []],
  calendario_no_conectado: ["BUSINESS_RULE_VIOLATION", "CALENDAR_NOT_CONNECTED", []],
  calendario_distinto: ["BUSINESS_RULE_VIOLATION", "CALENDAR_CHANGED", []],
  proveedor_no_disponible: ["EXTERNAL_ERROR", "PROVIDER_NOT_CONFIGURED", []],
  configuracion_invalida: ["INTERNAL_ERROR", "AGENT_CONFIGURATION_INVALID", []],
  conflicto_reintento: ["IDEMPOTENCY_CONFLICT", "PROVIDER_IDEMPOTENCY_CONFLICT", []],
  missing_appointment_params: ["INVALID_ARGUMENTS", "MISSING_APPOINTMENT_PARAMS", []],
  no_permitido: ["BUSINESS_RULE_VIOLATION", "POLICY_NOT_ALLOWED", []],
  sin_citas: ["NOT_FOUND", "NO_APPOINTMENTS", []],
  cita_no_encontrada: ["NOT_FOUND", "APPOINTMENT_NOT_FOUND", []],
  mismo_horario: ["BUSINESS_RULE_VIOLATION", "SAME_SCHEDULE", ["time"]],
};

function schedulingFailure(r: EffectDispatchResult, mutation: boolean): FailureMapping {
  const byClass = byClassification(r, mutation);
  if (byClass) return byClass;
  const raw = (r.error ?? "").toLowerCase();
  // "disponibilidad_no_disponible:sin_cupos", "cancelacion_rechazada:no_permitido", "ocupado"...
  const motivo = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw;
  if (motivo === "error_tecnico") return f("EXTERNAL_ERROR", "PROVIDER_ERROR", [], !mutation, mutation);
  if (motivo === "en_progreso") return f("CONFLICT", "PROVIDER_OPERATION_IN_PROGRESS", [], true);
  const known = SCHEDULING_REASONS[motivo];
  if (known) return f(known[0], known[1], known[2]);
  return f(r.classification === "RETRYABLE" ? "EXTERNAL_ERROR" : "INTERNAL_ERROR", "UNMAPPED_HANDLER_ERROR", [], r.classification === "RETRYABLE" && !mutation);
}

function readFailure(r: EffectDispatchResult): FailureMapping {
  const byClass = byClassification(r, false);
  if (byClass) return byClass;
  const raw = r.error ?? "";
  if (raw === "cotizacion_sin_items") return f("INVALID_ARGUMENTS", "NOTHING_TO_QUOTE", ["product"]);
  if (r.classification === "RETRYABLE") return f("EXTERNAL_ERROR", "SOURCE_UNAVAILABLE", [], true);
  return f("INTERNAL_ERROR", "UNMAPPED_HANDLER_ERROR");
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

/** Restricciones que el backend deriva de slots validados (conversation/actions.ts). Cualquier otra clave se rechaza. */
const SLOT_CONSTRAINTS: readonly string[] = ["franjaHoraria", "fecha", "hora"];

/** Variables que los handlers de agenda existentes leen (fecha en YYYY-MM-DD y hora HH:MM: el parser las acepta tal cual). */
function schedulingPayload(req: ActionRequest): Record<string, unknown> {
  const fecha = req.arguments.fecha ?? req.constraints.fecha ?? "";
  const hora = req.arguments.hora ?? req.constraints.hora ?? "";
  return {
    ...req.customerData,
    ...req.arguments,
    ...(fecha ? { fecha, appointment_request: fecha } : {}),
    ...(hora ? { hora, appointment_pick: hora } : {}),
  };
}

/** Candado por fecha: serializa verificar → crear del mismo negocio para el mismo día (tabla dulabs_ba_booking_locks). */
function bookingLock(req: ActionRequest): string | null {
  const fecha = req.arguments.fecha ?? req.constraints.fecha;
  return fecha ? `booking:${fecha}` : null;
}

function listAppointmentsStep(): ActionStep {
  return { action: "listar_citas_cliente", buildPayload: () => ({}) };
}

/** Solo se opera sin preguntar "¿cuál?" si el cliente tiene exactamente UNA cita próxima (la selección es FASE 5+). */
function singleAppointment(previous: Record<string, unknown>): { citasCliente: unknown[]; cita_pick: string } | null {
  const citas = Array.isArray(previous.citasCliente) ? previous.citasCliente : [];
  return citas.length === 1 ? { citasCliente: citas, cita_pick: "1" } : null;
}

export const ACTION_REGISTRY: Readonly<Record<string, ActionDefinition>> = {
  buscar_disponibilidad_nylas_generico: {
    action: "buscar_disponibilidad_nylas_generico",
    capability: "scheduling",
    schedulingProvider: "nylas",
    purposes: ["lookup"],
    mutation: false,
    requiresConfirmation: false,
    timeoutMs: 10_000,
    retry: { maxAttempts: 2, baseDelayMs: 300 },
    temporal: true,
    allowedConstraints: SLOT_CONSTRAINTS,
    allowsCustomerData: true,
    steps: [{ action: "buscar_disponibilidad_nylas_generico", buildPayload: (req) => schedulingPayload(req) }],
    resultData: ["fecha", "duracionMin", "horariosDisponibles", "disponibilidadTexto", "hayCupos"],
    mapFailure: (r) => schedulingFailure(r, false),
  },
  crear_cita_nylas_generico: {
    action: "crear_cita_nylas_generico",
    capability: "scheduling",
    schedulingProvider: "nylas",
    purposes: ["fulfill"],
    mutation: true,
    requiresConfirmation: true,
    timeoutMs: 20_000,
    retry: { maxAttempts: 1, baseDelayMs: 0 },
    temporal: true,
    lockKey: bookingLock,
    allowedConstraints: SLOT_CONSTRAINTS,
    allowsCustomerData: true,
    steps: [{ action: "crear_cita_nylas_generico", buildPayload: (req) => schedulingPayload(req) }],
    resultData: ["citaId", "status", "inicio", "fin", "reservaTexto"],
    mapFailure: (r) => schedulingFailure(r, true),
  },
  agendar_cita_especialista: {
    action: "agendar_cita_especialista",
    capability: "scheduling",
    schedulingProvider: "internal",
    purposes: ["fulfill"],
    mutation: true,
    requiresConfirmation: true,
    timeoutMs: 20_000,
    retry: { maxAttempts: 1, baseDelayMs: 0 },
    temporal: true,
    lockKey: bookingLock,
    allowedConstraints: SLOT_CONSTRAINTS,
    allowsCustomerData: true,
    // El cliente confirmó la propuesta (el motor ya lo verificó): el adaptador de agenda interna recibe confirmado=true.
    steps: [{ action: "agendar_cita_especialista", buildPayload: (req) => ({ ...schedulingPayload(req), confirmado: req.confirmationId ? "true" : "false" }) }],
    resultData: ["citaId", "status", "inicio", "fin"],
    mapFailure: (r) => schedulingFailure(r, true),
  },
  cancelar_cita_cliente: {
    action: "cancelar_cita_cliente",
    capability: "scheduling",
    schedulingProvider: "nylas",
    purposes: ["fulfill"],
    mutation: true,
    requiresConfirmation: true,
    timeoutMs: 20_000,
    retry: { maxAttempts: 1, baseDelayMs: 0 },
    temporal: true,
    allowedConstraints: SLOT_CONSTRAINTS,
    allowsCustomerData: true,
    steps: [
      listAppointmentsStep(),
      { action: "cancelar_cita_cliente", buildPayload: (_req, ctx) => singleAppointment(ctx.previous) ?? {} },
    ],
    resultData: ["cancelada", "citaCanceladaTexto", "yaCancelada"],
    mapFailure: (r) => schedulingFailure(r, true),
  },
  reprogramar_cita_cliente: {
    action: "reprogramar_cita_cliente",
    capability: "scheduling",
    schedulingProvider: "nylas",
    purposes: ["fulfill"],
    mutation: true,
    requiresConfirmation: true,
    timeoutMs: 20_000,
    retry: { maxAttempts: 1, baseDelayMs: 0 },
    temporal: true,
    lockKey: bookingLock,
    allowedConstraints: SLOT_CONSTRAINTS,
    allowsCustomerData: true,
    steps: [
      listAppointmentsStep(),
      { action: "reprogramar_cita_cliente", buildPayload: (req, ctx) => ({ ...schedulingPayload(req), ...(singleAppointment(ctx.previous) ?? {}) }) },
    ],
    resultData: ["movida", "citaMovidaTexto", "inicio", "fin"],
    mapFailure: (r) => schedulingFailure(r, true),
  },
  calcular_cotizacion: {
    action: "calcular_cotizacion",
    capability: "sales",
    purposes: ["lookup", "fulfill"],
    mutation: false,
    requiresConfirmation: false,
    timeoutMs: 8_000,
    retry: { maxAttempts: 2, baseDelayMs: 300 },
    temporal: false,
    allowedConstraints: SLOT_CONSTRAINTS,
    allowsCustomerData: true,
    steps: [{ action: "calcular_cotizacion", buildPayload: (req) => ({ items: req.arguments.items ?? "" }) }],
    resultData: ["cotizacionTexto", "cotizacionTotal", "cotizacionTotalTexto", "cotizacionCompleta", "cantidadLineasCotizacion"],
    mapFailure: (r) => readFailure(r),
  },
  buscar_conocimiento: {
    action: "buscar_conocimiento",
    capability: "faq",
    purposes: ["lookup", "fulfill"],
    mutation: false,
    requiresConfirmation: false,
    timeoutMs: 8_000,
    retry: { maxAttempts: 2, baseDelayMs: 300 },
    temporal: false,
    allowedConstraints: SLOT_CONSTRAINTS,
    allowsCustomerData: true,
    steps: [{ action: "buscar_conocimiento", buildPayload: (_req, ctx) => ({ user_request: ctx.userMessage }) }],
    resultData: ["conocimientoEncontrado", "respuestaExacta", "respuestaDirecta", "cantidadConocimiento"],
    mapFailure: (r) => readFailure(r),
  },
  listar_catalogo_servicios: {
    action: "listar_catalogo_servicios",
    capability: "catalog",
    purposes: ["lookup", "fulfill"],
    mutation: false,
    requiresConfirmation: false,
    timeoutMs: 8_000,
    retry: { maxAttempts: 2, baseDelayMs: 300 },
    temporal: false,
    allowedConstraints: SLOT_CONSTRAINTS,
    allowsCustomerData: true,
    steps: [{ action: "listar_catalogo_servicios", buildPayload: () => ({}) }],
    resultData: ["catalogoTexto", "cantidadCatalogo"],
    mapFailure: (r) => readFailure(r),
  },
  transferir_soporte: {
    action: "transferir_soporte",
    capability: "humanHandoff",
    purposes: ["handoff"],
    // Activa la pausa humana: idempotente por estado (repetirla no duplica nada), pero es un cambio real.
    mutation: true,
    requiresConfirmation: false,
    timeoutMs: 10_000,
    retry: { maxAttempts: 1, baseDelayMs: 0 },
    temporal: false,
    allowedConstraints: SLOT_CONSTRAINTS,
    allowsCustomerData: true,
    steps: [{ action: "transferir_soporte", buildPayload: () => ({}) }],
    resultData: ["transferred", "pausadoHasta"],
    mapFailure: (r) => readFailure(r),
  },
};

/** Validaciones de éxito LÓGICO de pasos auxiliares (listar citas antes de cancelar/reprogramar). */
export function appointmentSelection(previous: Record<string, unknown>): FailureMapping | null {
  const citas = Array.isArray(previous.citasCliente) ? previous.citasCliente : [];
  if (citas.length === 0) return f("NOT_FOUND", "NO_APPOINTMENTS");
  if (citas.length > 1) return f("BUSINESS_RULE_VIOLATION", "APPOINTMENT_SELECTION_REQUIRED");
  return null;
}

export function getActionDefinition(action: string): ActionDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(ACTION_REGISTRY, action) ? ACTION_REGISTRY[action] : undefined;
}
