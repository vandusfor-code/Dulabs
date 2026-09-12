/**
 * Tipos del Execution Orchestrator (Fase 4.0).
 * Coordina lifecycle + Store + Engine + routing de efectos (sin I/O real).
 */

import type {
  EngineEffect,
  FlowEngineError,
  FlowEngineEvent,
  FlowEngineRunResult,
  FlowEngineState,
} from "@/lib/flow/engine-types";
import type { FlowDefinition } from "@/lib/flow/types";
import type {
  CreateExecutionResult,
  InsertEffectResult,
  InsertEventResult,
  ResolveEffectResultOutcome,
  SaveExecutionStateResult,
} from "@/lib/flow/flow-store";
import type {
  FlowEffectRow,
  FlowExecutionRow,
  FlowRow,
  FlowVersionRow,
} from "@/lib/flow/flow-store-types";
import type { EffectExecutorFramework } from "@/lib/flow/executor-framework";
export type {
  EffectDispatchRequest,
  EffectDispatchResult,
  EffectExecutor,
  EffectExecutorKind,
  EffectExecutionContext,
  EffectResultClassification,
} from "@/lib/flow/executor-types";
export { EFFECT_RESULT_CLASSIFICATIONS } from "@/lib/flow/executor-types";

// ---------------------------------------------------------------------------
// Evento normalizado (entrada del Orchestrator)
// ---------------------------------------------------------------------------

export interface ConversationKey {
  phoneNumberId: string;
  telefonoCliente: string;
}

/** Evento de dominio ya normalizado — tenantId NO proviene del payload. */
export interface NormalizedFlowEvent {
  tenantId: string;
  conversation: ConversationKey;
  /** Flow lógico a ejecutar (CREATE). RESUME usa flow_id de la fila existente. */
  flowId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  engineEvent: FlowEngineEvent;
  receivedAt: string;
  /**
   * dulabs_clientes_config.base_conocimiento del tenant (texto libre real:
   * precios, horarios, servicios) -- opcional, solo se siembra en
   * variables.baseConocimiento (mismo patrón que 'hoy') si CREATE la
   * ejecución nueva. Un flow que no la referencia no cambia de
   * comportamiento. Nunca reemplaza una consulta real de disponibilidad/citas.
   */
  baseConocimiento?: string;
}

// ---------------------------------------------------------------------------
// Outcomes / resultados
// ---------------------------------------------------------------------------

export const ORCHESTRATOR_OUTCOMES = {
  DUPLICATE_EVENT: "duplicate_event",
  CONCURRENCY_EXHAUSTED: "concurrency_exhausted",
  TERMINAL_NO_OP: "terminal_no_op",
  REJECTED: "rejected",
  PROCESSED: "processed",
} as const;

export type OrchestratorOutcome =
  (typeof ORCHESTRATOR_OUTCOMES)[keyof typeof ORCHESTRATOR_OUTCOMES];

export type OrchestratorRejectReason =
  | "tenant_mismatch"
  | "orphan_effect_result"
  | "not_a_start_trigger"
  | "flow_not_published"
  | "version_not_found"
  | "pinned_version_not_found"
  | "execution_not_found";

export interface OrchestratorResult {
  outcome: OrchestratorOutcome;
  executionRowId?: string;
  /** Efectos emitidos por el Engine en esta invocación. */
  effects: EngineEffect[];
  /** effectIds despachados a executors externos en esta invocación. */
  dispatchedEffectIds: string[];
  engineError?: FlowEngineError;
  rejectReason?: OrchestratorRejectReason;
  /** Detalle adicional (sin secretos). */
  detail?: string;
  /**
   * Bug raíz #3 (incidente "disponible→ocupado") — true si en ESTA invocación
   * el Flow ejecutó con éxito al menos una acción CRÍTICA (criticality
   * "critical" en action-capabilities.ts: agendar/cancelar/mover cita, etc.).
   * Señal estructurada, no textual: permite a lib/flow-runtime-bridge.ts
   * decidir que NO debe caer a LEGACY aunque una etapa POSTERIOR del Flow
   * (ej. la redacción del mensaje final) falle -- porque LEGACY re-procesaría
   * el mismo mensaje y contradiría/duplicaría una operación crítica que ya
   * ocurrió de verdad. Ver el incidente de la cita real #796.
   */
  criticalActionExecuted?: boolean;
}

// ---------------------------------------------------------------------------
// Store inyectable
// ---------------------------------------------------------------------------

export interface FlowOrchestratorStore {
  getActiveExecution(
    tenantId: string,
    conversation: ConversationKey,
  ): Promise<FlowExecutionRow | null>;

  getExecutionById(tenantId: string, executionRowId: string): Promise<FlowExecutionRow | null>;

  getFlow(tenantId: string, flowId: string): Promise<FlowRow | null>;

  getFlowVersion(tenantId: string, versionId: string): Promise<FlowVersionRow | null>;

  createExecution(input: {
    tenantId: string;
    flowId: string;
    flowVersionId: string;
    executionId: string;
    phoneNumberId: string;
    telefonoCliente: string;
    initialState: FlowEngineState;
  }): Promise<CreateExecutionResult>;

  saveExecutionState(
    tenantId: string,
    executionRowId: string,
    state: FlowEngineState,
    expectedStateVersion: number,
  ): Promise<SaveExecutionStateResult>;

  insertEventIdempotent(input: {
    tenantId: string;
    flowExecutionId: string;
    eventId: string;
    eventType: string;
    rawPayload?: Record<string, unknown>;
  }): Promise<InsertEventResult>;

  insertEffectIdempotent(input: {
    tenantId: string;
    flowExecutionId: string;
    effectId: string;
    nodeId: string;
    kind: string;
    integrationId?: string;
  }): Promise<InsertEffectResult>;

  getEffectByEffectId(
    tenantId: string,
    flowExecutionId: string,
    effectId: string,
  ): Promise<FlowEffectRow | null>;

  resolveEffectResult(input: {
    tenantId: string;
    flowExecutionId: string;
    effectId: string;
    status: "succeeded" | "failed";
    resultPayloadRaw?: Record<string, unknown>;
    resultPayloadApplied?: Record<string, unknown>;
    resolvedAt?: string;
  }): Promise<ResolveEffectResultOutcome>;

  recordNodeTransition(input: {
    tenantId: string;
    flowExecutionId: string;
    eventId?: string;
    fromNodeId?: string | null;
    toNodeId: string;
    sourceHandle?: string;
  }): Promise<void>;

  // ---------------------------------------------------------------------
  // FASE F7 (Contacts + Variables + Tags, autorizado) -- OPCIONALES a
  // propósito, mismo criterio ya usado en toda esta interfaz para
  // dependencias añadidas después de F1 (ver AiProviderRouterDeps/Fase 6):
  // cualquier fake/store de test ya existente que implemente
  // FlowOrchestratorStore sin estos 3 métodos sigue compilando y
  // comportándose EXACTAMENTE igual (undefined = sin contacto/tags, el
  // Orchestrator ya guarda con `?.()`). Solo
  // createSupabaseFlowOrchestratorStore (producción real) los implementa.
  // ---------------------------------------------------------------------

  /**
   * Resuelve (o crea, si es la primera vez) el contacto real de esta
   * conversación y devuelve sus custom_fields -- para sembrarlos en
   * state.variables al CREAR una ejecución nueva (mismo patrón que 'hoy').
   */
  resolveOrCreateContact?(
    tenantId: string,
    conversation: ConversationKey,
  ): Promise<{ customFields: Record<string, unknown> }>;

  /** Nombres de las etiquetas YA asignadas a esta conversación (para sembrar `tag:<nombre>`). */
  getConversationTagNames?(tenantId: string, conversation: ConversationKey): Promise<string[]>;

  /**
   * Persiste (merge, nunca replace) custom_fields en el contacto real --
   * usado tras save_data(target="custom_field") para que deje de ser un
   * balde muerto (ver FlowExportBucket.custom_fields).
   */
  persistContactCustomFields?(
    tenantId: string,
    conversation: ConversationKey,
    customFields: Record<string, unknown>,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Engine inyectable
// ---------------------------------------------------------------------------

export interface FlowOrchestratorEngine {
  createFlowEngineState(
    flow: FlowDefinition,
    opts?: { flowId?: string; flowVersionId?: string; executionId?: string },
  ): FlowEngineState;

  runFlowEngine(
    flow: FlowDefinition,
    state: FlowEngineState,
    event: FlowEngineEvent,
    options?: { eventId?: string; idGenerator?: () => string },
  ): FlowEngineRunResult;
}

// ---------------------------------------------------------------------------
// Dependencias del Orchestrator
// ---------------------------------------------------------------------------

export interface OrchestratorClock {
  nowIso(): string;
  sleepMs(ms: number): Promise<void>;
}

export interface OrchestratorIdGenerators {
  executionId(): string;
  effectId(): string;
}

export interface ExecutionOrchestratorDeps {
  store: FlowOrchestratorStore;
  engine: FlowOrchestratorEngine;
  effectFramework: EffectExecutorFramework;
  clock: OrchestratorClock;
  ids: OrchestratorIdGenerators;
  /** Límite de eventos internos (effect_result síncronos) por invocación. */
  maxInternalEvents?: number;
  maxCasAttempts?: number;
}

export const DEFAULT_MAX_CAS_ATTEMPTS = 5;
export const DEFAULT_MAX_INTERNAL_EVENTS = 10;
export const CAS_BACKOFF_BASE_MS = 10;
