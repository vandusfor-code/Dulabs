/**
 * DuLabs Flow Builder — API pública del contrato (Fase 0).
 */

export * from "@/lib/flow/types";
export * from "@/lib/flow/constants";
export * from "@/lib/flow/errors";
export {
  flowDefinitionSchema,
  flowNodeSchema,
  flowEdgeSchema,
  variableDefinitionSchema,
  parseFlowDefinition,
  safeParseFlowDefinition,
} from "@/lib/flow/schemas";
export { validateFlowGraph, validateFlowPublishRules, validateFlowDefinition } from "@/lib/flow/validate-graph";
export { validateSecurityRules, computeVerifiedCapabilities } from "@/lib/flow/validate-security";
export {
  resolveActionCapabilitySpec,
  WEBHOOK_SEMANTIC_ALLOWLIST,
} from "@/lib/flow/action-capabilities";
export {
  validateFlowForPublish,
  validateFlowDefinitionInput,
} from "@/lib/flow/validate-publish";
export {
  createFlowEngineState,
  runFlowEngine,
  resolveNextNodeId,
  validateQuestionValue,
  DEFAULT_MAX_AUTO_STEPS,
} from "@/lib/flow/flow-engine";
export {
  createFlow,
  createFlowVersion,
  publishFlowVersion,
  getFlowVersion,
  getFlowById,
  createIntegration,
  upsertCredential,
  getIntegrationById,
  getIntegrationCredentials,
  createExecution,
  getExecutionById,
  getActiveExecutionByConversation,
  getExecutionEngineState,
  saveExecutionState,
  insertEventIdempotent,
  insertEffectIdempotent,
  getEffectByEffectId,
  resolveEffectResult,
  recordNodeTransition,
  executionRowToEngineState,
  engineStateToExecutionUpdate,
  definitionContainsEmbeddedSecrets,
  FlowStoreError,
  FlowExecutionConcurrencyConflictError,
  FlowActiveExecutionExistsError,
  FlowEmbeddedSecretsError,
  FLOW_STORE_ERROR_CODES,
} from "@/lib/flow/flow-store";
export type {
  CreateExecutionResult,
  SaveExecutionStateResult,
  InsertEventResult,
  InsertEffectResult,
  ResolveEffectResultOutcome,
} from "@/lib/flow/flow-store";
export type {
  FlowRow,
  FlowVersionRow,
  FlowExecutionRow,
  FlowEventRow,
  FlowEffectRow,
  FlowIntegrationRow,
} from "@/lib/flow/flow-store-types";
export { isSensitiveKeyName, looksLikeEmbeddedSecret } from "@/lib/flow/detect-embedded-secrets";
export {
  sanitizePayloadForObservability,
  sanitizeEventPayloadForObservability,
} from "@/lib/flow/sanitize-observability-payload";
export {
  ExecutionOrchestrator,
  createExecutionOrchestrator,
  ORCHESTRATOR_OUTCOMES,
  DEFAULT_MAX_CAS_ATTEMPTS,
  DEFAULT_MAX_INTERNAL_EVENTS,
} from "@/lib/flow/flow-orchestrator";
export {
  ExecutorRegistry,
  UnknownExecutorKindError,
} from "@/lib/flow/executor-registry";
export {
  EffectExecutorFramework,
  sanitizeExecutorDispatchResult,
} from "@/lib/flow/executor-framework";
export { IntegrationResolver, createInternalOnlyIntegrationResolver } from "@/lib/flow/integration-resolver";
export {
  createDefaultExecutorRegistry,
  createDefaultEffectExecutorFramework,
  createTestEffectExecutorFramework,
} from "@/lib/flow/executor-factory";
export {
  EFFECT_RESULT_CLASSIFICATIONS,
  effectResultNeedsEngineContinuation,
  toLegacyEngineEvent,
} from "@/lib/flow/executor-types";
export {
  isDispatchableEffect,
  buildEffectDispatchRequest,
  storeKindForDispatchableEffect,
  executorKindForDispatchableEffect,
} from "@/lib/flow/effect-dispatchable";
export { InternalActionExecutor } from "@/lib/flow/executors/internal-action-executor";
export { SendMessageExecutor } from "@/lib/flow/executors/send-message-executor";
export type {
  NormalizedFlowEvent,
  OrchestratorResult,
  OrchestratorOutcome,
  OrchestratorRejectReason,
  ConversationKey,
  FlowOrchestratorStore,
  FlowOrchestratorEngine,
  EffectExecutor,
  EffectDispatchRequest,
  EffectDispatchResult,
  ExecutionOrchestratorDeps,
  EffectExecutorKind,
  EffectExecutionContext,
  EffectResultClassification,
} from "@/lib/flow/orchestrator-types";
export type {
  FlowEngineState,
  FlowEngineEvent,
  FlowEngineRunResult,
  FlowEngineOptions,
  EngineEffect,
  FlowEngineError,
  FlowEngineStatus,
  PendingEffect,
} from "@/lib/flow/engine-types";
