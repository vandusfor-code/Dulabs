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
import { formatearFechaHoraCita } from "@/lib/agent-compiler/calendar/nylas-appointments";
import { zonedToUtc } from "@/lib/agent-compiler/actions/native/reminders";

/** Única zona que los handlers de agenda existentes soportan (fechas con offset fijo -05:00). */
const SUPPORTED_SCHEDULING_TIMEZONE = "America/Bogota";

export interface FailureMapping {
  code: ActionErrorCode;
  reason: string;
  retryable: boolean;
  ambiguous: boolean;
  invalidSlots: string[];
  /** FASE 8 — datos del backend que acompañan un fallo (p. ej. las citas entre las que el cliente debe elegir). */
  data?: Record<string, unknown>;
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
  /** FASE 8 — agente del servidor (lo necesitan las acciones nativas que persisten por agente). */
  agentId?: string;
}

/**
 * FASE 8 — verificación de una escritura de desenlace DESCONOCIDO: una LECTURA contra el proveedor que dice si el
 * efecto ocurrió. Nunca escribe. "unknown" = no se puede saber (se deja para una persona).
 */
export interface OutcomeVerifier {
  step: ActionStep;
  match(request: ActionRequest, data: Record<string, unknown>): { outcome: "found"; booking?: { appointmentRef: string | null; start: string; service: string | null } } | { outcome: "not_found" } | { outcome: "unknown" };
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
  /** FASE 8 — acción NATIVA del Business Agent (handler propio, no el executor interno del grafo). */
  native?: true;
  /** FASE 8 — cómo verificar si una escritura de desenlace desconocido ocurrió. */
  verifyOutcome?: OutcomeVerifier;
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
/** FASE 8 — la cita elegida de la lista del backend (id). */
const APPOINTMENT_CONSTRAINTS: readonly string[] = [...SLOT_CONSTRAINTS, "cita"];

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

type ListedAppointment = { id: string; servicio?: string | null; inicioIso?: string };
const listed = (previous: Record<string, unknown>): ListedAppointment[] =>
  (Array.isArray(previous.citasCliente) ? previous.citasCliente : []).filter((c): c is ListedAppointment => typeof (c as { id?: unknown })?.id === "string");

/**
 * La cita sobre la que se opera: la que el cliente ELIGIÓ de la lista que mostró el backend (constraint `cita` = id) o,
 * si tiene exactamente UNA, esa. El índice se recalcula contra la lista ACTUAL (si la cita ya no está, no se opera).
 */
function chosenAppointment(req: ActionRequest, previous: Record<string, unknown>): { citasCliente: unknown[]; cita_pick: string } | null {
  const citas = listed(previous);
  if (req.constraints.cita) {
    const i = citas.findIndex((c) => c.id === req.constraints.cita);
    return i >= 0 ? { citasCliente: citas, cita_pick: String(i + 1) } : null;
  }
  return citas.length === 1 ? { citasCliente: citas, cita_pick: "1" } : null;
}

/** Etiqueta de una cita listada (HECHO del backend): "Corte — sábado 14 de marzo, 3:00 p. m.". */
function appointmentLabel(c: ListedAppointment): string {
  return `${c.servicio ?? "Cita"} — ${c.inicioIso ? formatearFechaHoraCita(c.inicioIso) : ""}`.slice(0, 200);
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
    verifyOutcome: {
      step: listAppointmentsStep(),
      match: (req, data) => {
        const fecha = req.arguments.fecha ?? req.constraints.fecha;
        const hora = req.arguments.hora ?? req.constraints.hora;
        if (!Array.isArray(data.citasCliente)) return data.sinCitas === true ? { outcome: "not_found" } : { outcome: "unknown" };
        const at = fecha && hora ? zonedToUtc(fecha, hora, SUPPORTED_SCHEDULING_TIMEZONE) : null;
        if (!at) return { outcome: "unknown" };
        const hit = listed(data).find((c) => c.inicioIso && new Date(c.inicioIso).getTime() === at.getTime());
        return hit ? { outcome: "found", booking: { appointmentRef: hit.id, start: new Date(hit.inicioIso!).toISOString(), service: hit.servicio ?? req.arguments.servicio ?? null } } : { outcome: "not_found" };
      },
    },
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
    allowedConstraints: APPOINTMENT_CONSTRAINTS,
    allowsCustomerData: true,
    steps: [
      listAppointmentsStep(),
      { action: "cancelar_cita_cliente", buildPayload: (req, ctx) => chosenAppointment(req, ctx.previous) ?? {} },
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
    allowedConstraints: APPOINTMENT_CONSTRAINTS,
    allowsCustomerData: true,
    steps: [
      listAppointmentsStep(),
      { action: "reprogramar_cita_cliente", buildPayload: (req, ctx) => ({ ...schedulingPayload(req), ...(chosenAppointment(req, ctx.previous) ?? {}) }) },
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
  // -------------------------------------------------------------------------
  // FASE 8 — acciones NATIVAS del Business Agent (actions/native/handler.ts)
  // -------------------------------------------------------------------------
  ba_consultar_producto: {
    action: "ba_consultar_producto",
    capability: "catalog",
    native: true,
    purposes: ["lookup", "fulfill"],
    mutation: false,
    requiresConfirmation: false,
    timeoutMs: 8_000,
    retry: { maxAttempts: 2, baseDelayMs: 300 },
    temporal: false,
    allowedConstraints: [...SLOT_CONSTRAINTS, "contexto"],
    allowsCustomerData: true,
    steps: [{ action: "ba_consultar_producto", buildPayload: (req) => ({ producto: req.arguments.producto ?? "", ...(req.constraints.contexto ? { contexto: req.constraints.contexto } : {}) }) }],
    resultData: ["resultado", "coincidencia", "productoNombre", "precio", "moneda", "stock", "controlaStock", "opciones", "consulta"],
    mapFailure: (r) => nativeFailure(r, false),
  },
  ba_guardar_lead: {
    action: "ba_guardar_lead",
    capability: "leadCapture",
    native: true,
    purposes: ["fulfill"],
    // Escribe en el contacto: una sola vez por operación (claim), nunca se reintenta a ciegas.
    mutation: true,
    requiresConfirmation: false,
    timeoutMs: 8_000,
    retry: { maxAttempts: 1, baseDelayMs: 0 },
    temporal: false,
    allowedConstraints: [...SLOT_CONSTRAINTS, "interes"],
    allowsCustomerData: true,
    steps: [{ action: "ba_guardar_lead", buildPayload: (req) => ({ ...req.customerData, ...(req.constraints.interes ? { interes: req.constraints.interes } : {}) }) }],
    resultData: ["leadGuardado", "camposGuardados"],
    mapFailure: (r) => nativeFailure(r, true),
  },
  ba_programar_recordatorio: {
    action: "ba_programar_recordatorio",
    capability: "scheduling",
    native: true,
    purposes: ["fulfill"],
    mutation: true,
    requiresConfirmation: false,
    timeoutMs: 8_000,
    retry: { maxAttempts: 1, baseDelayMs: 0 },
    // Calcula el momento en la zona del NEGOCIO (no depende del offset fijo de los handlers de agenda).
    temporal: false,
    allowedConstraints: [...SLOT_CONSTRAINTS, "citaInicio", "citaRef", "citaServicio"],
    allowsCustomerData: true,
    steps: [
      {
        action: "ba_programar_recordatorio",
        buildPayload: (req, ctx) => ({
          citaInicio: req.constraints.citaInicio ?? "",
          citaRef: req.constraints.citaRef ?? "",
          ...(req.constraints.citaServicio ? { citaServicio: req.constraints.citaServicio } : {}),
          ...(req.constraints.fecha ? { fecha: req.constraints.fecha } : {}),
          ...(req.constraints.hora ? { hora: req.constraints.hora } : {}),
          ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
        }),
      },
    ],
    resultData: ["programado", "recordatorioEn", "citaInicio", "actualizado"],
    mapFailure: (r) => nativeFailure(r, true),
  },
};

/**
 * Validaciones de éxito LÓGICO de pasos auxiliares (listar citas antes de cancelar/reprogramar). FASE 8: con varias
 * citas, el fallo lleva las opciones REALES (id + etiqueta) para que el cliente elija ("la segunda").
 */
export function appointmentSelection(previous: Record<string, unknown>, request?: ActionRequest): FailureMapping | null {
  const citas = listed(previous);
  if (citas.length === 0) return f("NOT_FOUND", "NO_APPOINTMENTS");
  if (request?.constraints.cita) return citas.some((c) => c.id === request.constraints.cita) ? null : f("NOT_FOUND", "APPOINTMENT_NOT_FOUND", ["appointment"]);
  if (citas.length > 1) {
    return { ...f("BUSINESS_RULE_VIOLATION", "APPOINTMENT_SELECTION_REQUIRED"), data: { opciones: citas.slice(0, 10).map((c) => ({ value: c.id, label: appointmentLabel(c) })) } };
  }
  return null;
}

/** Fallos de las acciones nativas (códigos de actions/native/handler.ts). */
function nativeFailure(r: EffectDispatchResult, mutation: boolean): FailureMapping {
  const byClass = r.classification === "SECURITY_REJECTED" ? f("TENANT_ERROR", "HANDLER_SECURITY_REJECTED") : null;
  if (byClass) return byClass;
  const raw = r.error ?? "";
  if (raw.startsWith("momento_invalido")) return f("INVALID_ARGUMENTS", "REMINDER_TIME_INVALID", ["date", "time"]);
  switch (raw) {
    case "sin_cita":
      return f("NOT_FOUND", "NO_APPOINTMENT_TO_REMIND");
    case "recordatorio_cerrado":
      return f("BUSINESS_RULE_VIOLATION", "REMINDER_CLOSED");
    case "sin_datos":
      return f("INVALID_ARGUMENTS", "CUSTOMER_DATA_INCOMPLETE");
    case "sin_producto":
      return f("INVALID_ARGUMENTS", "NOTHING_TO_LOOK_UP", ["product"]);
    case "inventario_no_configurado":
    case "contacto_no_configurado":
    case "recordatorios_no_configurados":
      return f("INTERNAL_ERROR", "NATIVE_PORT_NOT_CONFIGURED");
    default:
      return r.classification === "RETRYABLE" ? f("EXTERNAL_ERROR", "SOURCE_UNAVAILABLE", [], !mutation) : f("INTERNAL_ERROR", "UNMAPPED_HANDLER_ERROR");
  }
}

export function getActionDefinition(action: string): ActionDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(ACTION_REGISTRY, action) ? ACTION_REGISTRY[action] : undefined;
}
