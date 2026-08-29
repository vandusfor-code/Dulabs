/**
 * Contratos del Effect Executor Framework (Fase 4.1).
 */

import type { FlowEngineEvent } from "@/lib/flow/engine-types";
import type { AiDispatchContext } from "@/lib/flow/claude/claude-types";
import type { ActionNodeConfig, AiNodeConfig, FlowButton, FlowMessageContent } from "@/lib/flow/types";
import type { ConversationKey } from "@/lib/flow/orchestrator-types";

// ---------------------------------------------------------------------------
// Clasificación de resultados / errores
// ---------------------------------------------------------------------------

export const EFFECT_RESULT_CLASSIFICATIONS = {
  SUCCESS: "SUCCESS",
  RETRYABLE: "RETRYABLE",
  NON_RETRYABLE: "NON_RETRYABLE",
  TIMEOUT: "TIMEOUT",
  RATE_LIMIT: "RATE_LIMIT",
  AUTH_ERROR: "AUTH_ERROR",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  EXTERNAL_AMBIGUOUS: "EXTERNAL_AMBIGUOUS",
  SECURITY_REJECTED: "SECURITY_REJECTED",
} as const;

export type EffectResultClassification =
  (typeof EFFECT_RESULT_CLASSIFICATIONS)[keyof typeof EFFECT_RESULT_CLASSIFICATIONS];

/** Clasificación de operación para acciones internas (mapping desde criticality). */
export type InternalActionOperationClass = "READ" | "WRITE" | "CRITICAL";

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

export type EffectExecutorKind = "action" | "ai" | "send_message";

export interface EffectExecutorCapabilities {
  supportsIntegration: boolean;
  supportsAsync: boolean;
  operationClasses: InternalActionOperationClass[];
}

// ---------------------------------------------------------------------------
// Request — sin secretos
// ---------------------------------------------------------------------------

export interface EffectDispatchRequest {
  effectId: string;
  executionRowId: string;
  tenantId: string;
  nodeId: string;
  kind: EffectExecutorKind;
  integrationId?: string;
  /** Snapshot de variables / contexto del nodo. */
  payload: Record<string, unknown>;
  attempt: number;
  /** Config de acción (solo kind action). */
  action?: ActionNodeConfig;
  /** Config de nodo AI (solo kind ai). */
  ai?: AiNodeConfig;
  /** Metadata de ejecución AI (flow version, budget, user message). */
  aiContext?: AiDispatchContext;
  /** Contenido de mensaje (solo kind send_message). */
  message?: {
    content: FlowMessageContent;
    buttons?: FlowButton[];
  };
  conversation?: ConversationKey;
  executionLogicalId?: string;
}

// ---------------------------------------------------------------------------
// Result — sanitizado por el Framework antes de persistir
// ---------------------------------------------------------------------------

export interface EffectDispatchResult {
  success: boolean;
  classification: EffectResultClassification;
  /** Output aplicable al Engine (effect_result.data). */
  data?: Record<string, unknown>;
  /** Metadata de observabilidad (sanitizada). */
  metadata?: Record<string, unknown>;
  externalReference?: string;
  /** Resultado crudo del executor — solo persistido tras sanitización. */
  rawResult?: Record<string, unknown>;
  /** Resultado aplicado persistido — tras sanitización. */
  appliedResult?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Contexto interno del executor (credenciales solo en memoria)
// ---------------------------------------------------------------------------

export interface EffectExecutionContext {
  tenantId: string;
  /** true cuando la acción es nativa DuLabs sin integration externa. */
  internal: boolean;
  integrationId?: string;
  capability?: string;
  /** Credenciales descifradas — NUNCA serializar fuera del boundary. */
  credentials?: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Executor contract
// ---------------------------------------------------------------------------

export interface EffectExecutor {
  readonly kind: EffectExecutorKind;
  readonly version: string;
  readonly capabilities: EffectExecutorCapabilities;
  dispatch(
    request: EffectDispatchRequest,
    context: EffectExecutionContext,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult>;
}

/** Compat Fase 4.0 — derivación para persistencia. */
export function effectResultNeedsEngineContinuation(
  kind: EffectExecutorKind,
  _result: EffectDispatchResult,
): boolean {
  return kind === "action" || kind === "ai";
}

export function toLegacyEngineEvent(result: EffectDispatchResult, effectId: string): FlowEngineEvent {
  return {
    type: "effect_result",
    success: result.success,
    effectId,
    data: result.data ?? result.appliedResult ?? {},
    error: result.error,
  };
}
