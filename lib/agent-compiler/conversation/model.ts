// DuLabs Business — Business Agent 2.0, FASE 3 — modelo del estado conversacional (versionado).
//
// El estado contiene SOLO lo necesario para decidir el siguiente paso: estado de la conversación, objetivo en curso,
// slots con su ciclo de vida y procedencia, confirmación/acción pendientes, handoff y la última transición. No guarda el
// historial de mensajes ni texto libre del cliente (solo valores normalizados). El LLM nunca escribe aquí: el estado lo
// produce el reducer (transitions.ts) a partir de eventos validados.
//
// El estado persistido se valida con Zod al cargarlo: un estado que no cumple el schema (manipulado, corrupto o de una
// versión de schema desconocida) NO se usa (fail-closed), en vez de "repararlo".

import { z } from "zod";

export const CONVERSATION_STATE_SCHEMA_VERSION = "business-agent.conversation-state/1.0.0";

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

/**
 *   NEW                     sin objetivo activo (conversación nueva, saludo, o tras vencer por inactividad)
 *   COLLECTING_INFORMATION  hay objetivo y falta, es ambiguo o es inválido algún dato obligatorio
 *   AWAITING_CONFIRMATION   datos completos; se propuso la operación y se espera un sí/no del cliente
 *   READY_FOR_ACTION        el backend emitió una solicitud de acción (la ejecuta el Action Engine, FASE 4)
 *   EXECUTING               el Action Engine confirmó que empezó a ejecutarla (bloquea cambios de datos)
 *   COMPLETED / CANCELLED   el objetivo terminó (la conversación puede iniciar otro)
 *   HANDOFF_PENDING         el cliente pidió una persona; la transferencia está solicitada
 *   HANDED_OFF              una persona tiene la conversación: el agente no responde
 *   PAUSED                  pausa humana activa sin handoff del agente (intervención manual): el agente no responde
 *   ERROR                   fallas repetidas de entendimiento o una acción con error no recuperable
 *
 * UNDERSTANDING no es un estado persistido: interpretar ocurre DENTRO de un turno atómico (versión esperada).
 */
export const CONVERSATION_STATUSES = [
  "NEW",
  "COLLECTING_INFORMATION",
  "AWAITING_CONFIRMATION",
  "READY_FOR_ACTION",
  "EXECUTING",
  "COMPLETED",
  "CANCELLED",
  "HANDOFF_PENDING",
  "HANDED_OFF",
  "PAUSED",
  "ERROR",
] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** Estados en los que el agente NO procesa mensajes del cliente (una persona tiene o va a tener la conversación). */
export const HUMAN_CONTROLLED_STATUSES: ReadonlySet<ConversationStatus> = new Set(["HANDOFF_PENDING", "HANDED_OFF", "PAUSED"]);
/** Estados en los que el objetivo terminó: un nuevo objetivo empieza limpio (salvo datos del cliente). */
export const GOAL_TERMINAL_STATUSES: ReadonlySet<ConversationStatus> = new Set(["COMPLETED", "CANCELLED"]);

// ---------------------------------------------------------------------------
// Objetivos
// ---------------------------------------------------------------------------

export const GOAL_KINDS = ["booking", "rescheduling", "cancellation", "quote", "order", "information"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/**
 * Ciclo de vida de un slot. MISSING no se guarda: es "obligatorio y ausente", se DERIVA con los requisitos del negocio.
 *   KNOWN      valor válido aportado
 *   CORRECTED  valor válido que reemplazó a otro por corrección explícita (el anterior queda en `previous`)
 *   CONFIRMED  valor que el cliente confirmó al aceptar la propuesta
 *   AMBIGUOUS  hay más de una lectura o dos valores en conflicto: no se usa hasta aclararlo
 *   INVALID    el valor no es aceptable (fecha pasada, opción inexistente, cupo ocupado...)
 */
export const SLOT_STATUSES = ["KNOWN", "CORRECTED", "CONFIRMED", "AMBIGUOUS", "INVALID"] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];
export const USABLE_SLOT_STATUSES: ReadonlySet<SlotStatus> = new Set(["KNOWN", "CORRECTED", "CONFIRMED"]);

/**
 * Procedencia del valor. CONVERSATION_STATE no se guarda: es cómo se VE en un turno un valor que el cliente dijo en un
 * turno anterior (ver describeSlots). Un valor de ACTION_RESULT nunca pisa lo que dijo el cliente y nunca cuenta como
 * confirmado sin que el cliente acepte la propuesta.
 */
export const SLOT_SOURCES = ["CURRENT_MESSAGE", "CONVERSATION_STATE", "BUSINESS_DATA", "SYSTEM", "ACTION_RESULT"] as const;
export type SlotSource = (typeof SLOT_SOURCES)[number];
export type PersistedSlotSource = Exclude<SlotSource, "CONVERSATION_STATE">;

export const normalizedSlotValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().max(200) }).strict(),
  z.object({ kind: z.literal("number"), number: z.number().finite() }).strict(),
  z.object({ kind: z.literal("date"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({ kind: z.literal("time"), time: z.string().regex(/^\d{2}:\d{2}$/) }).strict(),
  z
    .object({
      kind: z.literal("time_range"),
      from: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      to: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      period: z.enum(["morning", "afternoon", "evening"]).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("phone"), phone: z.string().max(20) }).strict(),
  z.object({ kind: z.literal("email"), email: z.string().max(260) }).strict(),
  z.object({ kind: z.literal("select"), option: z.string().max(60) }).strict(),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }).strict(),
]);

const iso = z.string().min(10).max(40);

export const slotRecordSchema = z
  .object({
    status: z.enum(SLOT_STATUSES),
    value: normalizedSlotValueSchema.nullable(),
    candidates: z.array(z.string().max(120)).max(10).optional(),
    reason: z.string().max(60).optional(),
    source: z.enum(["CURRENT_MESSAGE", "BUSINESS_DATA", "SYSTEM", "ACTION_RESULT"]),
    normalizedBy: z.enum(["parser", "validated_model_reading", "business_catalog", "business_hours"]).optional(),
    /** "customer" sobrevive entre objetivos (nombre, correo); "goal" se reinicia con cada objetivo nuevo. */
    scope: z.enum(["customer", "goal"]),
    /** Momento del MENSAJE que aportó el valor (no del procesamiento): ordena mensajes fuera de orden. */
    observedAt: iso,
    updatedAt: iso,
    turn: z.number().int().min(0),
    previous: z.object({ value: normalizedSlotValueSchema, source: z.enum(["CURRENT_MESSAGE", "BUSINESS_DATA", "SYSTEM", "ACTION_RESULT"]), observedAt: iso }).strict().optional(),
    /** Información adicional que NO reemplazó el valor ("también me interesa el moderno"). */
    additional: z.array(normalizedSlotValueSchema).max(5).optional(),
    confirmedAt: iso.optional(),
  })
  .strict();
export type SlotRecord = z.infer<typeof slotRecordSchema>;

// ---------------------------------------------------------------------------
// Acción (frontera con FASE 4)
// ---------------------------------------------------------------------------

/**
 *   lookup   lectura que alimenta la conversación (disponibilidad, precio, conocimiento) y vuelve a evaluar
 *   fulfill  la operación del objetivo (reservar, cancelar, reprogramar, responder una consulta): al terminar, COMPLETED
 *   handoff  transferir a una persona: al terminar, HANDED_OFF
 */
/** Categoría de ACTION_FAILED para una solicitud de otra versión / datos viejos (FASE 5): se re-evalúa, no es ERROR. */
export const STALE_REQUEST_CATEGORY = "STALE_REQUEST";

export const ACTION_PURPOSES = ["lookup", "fulfill", "handoff"] as const;
export type ActionPurpose = (typeof ACTION_PURPOSES)[number];

export const actionRequestSchema = z
  .object({
    /** Clave de idempotencia determinista (tenant + conversación + objetivo + acción + argumentos). */
    id: z.string().regex(/^[a-f0-9]{32}$/),
    action: z.string().min(1).max(80),
    contractVersion: z.string().max(20),
    purpose: z.enum(ACTION_PURPOSES),
    /** Validados contra `llmArguments` del contrato de FASE 1 (mismos límites que una propuesta de la IA). */
    arguments: z.record(z.string(), z.string().max(1000)),
    /** Restricciones derivadas de slots que el contrato no recibe como argumento (franja horaria, fecha a mover). */
    constraints: z.record(z.string(), z.string().max(200)),
    /** Datos del cliente capturados (claves de customerData): el Action Engine decide cómo los usa. */
    customerData: z.record(z.string(), z.string().max(200)),
    sideEffects: z.string().max(40),
    requiresConfirmation: z.boolean(),
    confirmationId: z.string().max(64).nullable(),
    goalId: z.string().max(64).nullable(),
    status: z.enum(["requested", "executing"]),
    requestedAt: iso,
    /**
     * FASE 5: huella de ejecución del artefacto publicado con que se construyó (versión del negocio). Opcional para
     * leer estados previos. El Action Engine no ejecuta una solicitud "requested" de otra versión.
     */
    artifactRef: z.string().regex(/^[a-f0-9]{32}$/).nullable().optional(),
    /** FASE 6 — solicitud de una SIMULACIÓN (vista previa / pruebas): el Action Engine nunca ejecuta su efecto. */
    simulation: z.literal(true).optional(),
  })
  .strict();
export type ActionRequest = z.infer<typeof actionRequestSchema>;

// ---------------------------------------------------------------------------
// Estado completo
// ---------------------------------------------------------------------------

export const conversationScopeSchema = z
  .object({
    tenantId: z.string().min(1).max(64),
    /** `${phoneNumberId}:${telefonoCliente}` — lo fija el servidor desde el canal. */
    conversationId: z.string().min(1).max(120),
    /** Identidad del canal (teléfono de WhatsApp). */
    contactId: z.string().min(1).max(40),
    /** flow_id del Business Agent (el agente lógico). */
    agentId: z.string().min(1).max(64),
    /** flow_version_id con que se procesó el último turno. */
    agentVersion: z.string().max(64).nullable(),
  })
  .strict();
export type ConversationScope = z.infer<typeof conversationScopeSchema>;

export const conversationStateSchema = z
  .object({
    schemaVersion: z.literal(CONVERSATION_STATE_SCHEMA_VERSION),
    scope: conversationScopeSchema,
    status: z.enum(CONVERSATION_STATUSES),
    /** Estado al que se vuelve tras una pausa humana (RESUMED). */
    resumeStatus: z.enum(CONVERSATION_STATUSES).nullable(),
    goal: z
      .object({ id: z.string().max(64), kind: z.enum(GOAL_KINDS), intent: z.string().max(40), startedAt: iso, startedTurn: z.number().int().min(0) })
      .strict()
      .nullable(),
    currentIntent: z.object({ intent: z.string().max(40), band: z.enum(["high", "medium", "low"]) }).strict().nullable(),
    secondaryIntents: z.array(z.string().max(40)).max(2),
    slots: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), slotRecordSchema),
    pendingConfirmation: z
      .object({ id: z.string().max(64), action: z.string().max(80), argsHash: z.string().max(64), requestedAt: iso })
      .strict()
      .nullable(),
    pendingAction: actionRequestSchema.nullable(),
    /** Hash de la última consulta (lookup) hecha para el objetivo: no se repite la misma consulta. */
    lastLookup: z.object({ action: z.string().max(80), argsHash: z.string().max(64), outcome: z.enum(["succeeded", "failed"]) }).strict().nullable(),
    lastQuestion: z.object({ slot: z.string().max(40), reason: z.enum(["missing", "ambiguous", "invalid"]), turn: z.number().int().min(0), count: z.number().int().min(1) }).strict().nullable(),
    handoff: z.object({ status: z.enum(["none", "requested", "active"]), requestedAt: iso.nullable(), supported: z.boolean() }).strict(),
    lastTransition: z
      .object({ from: z.enum(CONVERSATION_STATUSES), event: z.string().max(40), to: z.enum(CONVERSATION_STATUSES), at: iso, turn: z.number().int().min(0) })
      .strict()
      .nullable(),
    lastActionResult: z
      .object({ actionId: z.string().max(64), action: z.string().max(80), outcome: z.enum(["succeeded", "failed"]), category: z.string().max(40).nullable(), at: iso })
      .strict()
      .nullable(),
    /** Rechazo explícito de la última propuesta (el siguiente paso pregunta qué cambiar). */
    proposalRejected: z.boolean(),
    /** Eventos ya procesados (wamid / ids de eventos del sistema): replay = no-op. */
    recentEventIds: z.array(z.string().max(200)).max(50),
    turn: z.number().int().min(0),
    consecutiveFailures: z.number().int().min(0),
    /** Momento del mensaje más reciente aplicado (reloj del canal). */
    lastMessageAt: iso.nullable(),
    /** Zona IANA del negocio con que se normalizaron fechas y horas (FASE 2). */
    timezone: z.string().max(60),
    createdAt: iso,
    updatedAt: iso,
  })
  .strict();
export type ConversationState = z.infer<typeof conversationStateSchema>;

export const MAX_RECENT_EVENT_IDS = 50;

export function initialConversationState(scope: ConversationScope, now: string, timezone: string): ConversationState {
  return {
    schemaVersion: CONVERSATION_STATE_SCHEMA_VERSION,
    scope,
    status: "NEW",
    resumeStatus: null,
    goal: null,
    currentIntent: null,
    secondaryIntents: [],
    slots: {},
    pendingConfirmation: null,
    pendingAction: null,
    lastLookup: null,
    lastQuestion: null,
    handoff: { status: "none", requestedAt: null, supported: true },
    lastTransition: null,
    lastActionResult: null,
    proposalRejected: false,
    recentEventIds: [],
    turn: 0,
    consecutiveFailures: 0,
    lastMessageAt: null,
    timezone,
    createdAt: now,
    updatedAt: now,
  };
}

export function parseConversationState(value: unknown): { ok: true; state: ConversationState } | { ok: false; issue: string } {
  const r = conversationStateSchema.safeParse(value);
  if (r.success) return { ok: true, state: r.data };
  const i = r.error.issues[0];
  return { ok: false, issue: `${i?.code ?? "invalid"}:${i?.path.join(".") ?? ""}` };
}

export function isSlotUsable(slot: SlotRecord | undefined): slot is SlotRecord & { value: NonNullable<SlotRecord["value"]> } {
  return Boolean(slot && slot.value && USABLE_SLOT_STATUSES.has(slot.status));
}
