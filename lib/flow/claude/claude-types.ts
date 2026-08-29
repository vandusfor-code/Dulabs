/**
 * Contratos Claude Executor (Fase 4.2).
 * Separación: TRUSTED vs UNTRUSTED data.
 */

import type { AiNodeConfig } from "@/lib/flow/types";
import type { ConversationKey } from "@/lib/flow/orchestrator-types";

/** Modos soportados por Claude Executor (incluye propose_action; Flow schema puede usar hybrid como alias). */
export type ClaudeAiMode = "respond" | "classify" | "extract" | "propose_action";

export const PROHIBITED_EVIDENCE_FIELDS = [
  "available",
  "appointmentConfirmed",
  "leadCreated",
  "transferred",
  "appointmentId",
  "leadId",
  "pausadoHasta",
  "reservationId",
  "verified",
  "leadPersisted",
  "transferred",
] as const;

export type ProhibitedEvidenceField = (typeof PROHIBITED_EVIDENCE_FIELDS)[number];

/** Provenance de texto generado por IA — nunca evidencia externa. */
export const AI_TEXT_PROVENANCE = "AI_GENERATED_TEXT" as const;

/** Resultado verificado de un Action Executor — única fuente de evidencia externa. */
export interface VerifiedActionResult {
  source: string;
  verified: true;
  data: Record<string, unknown>;
}

/** Datos de confianza para el prompt de Claude. */
export interface AIExecutionContextTrusted {
  nodeInstructions: string;
  mode: ClaudeAiMode;
  flowVersionId?: string;
  agentId?: string;
  /** Gap documentado: agentVersionId no existe aún en Store. */
  agentVersionId?: string;
  classifications?: string[];
  outputVariables?: string[];
  verifiedResults: VerifiedActionResult[];
  allowedActionTypes: string[];
  variables: Record<string, unknown>;
  budget: AiBudgetState;
}

/** Datos no confiables — nunca mezclados con system instructions. */
export interface AIExecutionContextUntrusted {
  userMessage?: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  externalText?: string[];
}

export interface AIExecutionContext {
  executionId: string;
  effectId: string;
  tenantId: string;
  flowId?: string;
  nodeId: string;
  model: string;
  trusted: AIExecutionContextTrusted;
  untrusted: AIExecutionContextUntrusted;
}

export interface AiBudgetState {
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  startedAtMs: number;
}

export interface AiBudgetLimits {
  maxAiCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxExecutionDurationMs: number;
}

export const DEFAULT_AI_BUDGET_LIMITS: AiBudgetLimits = {
  maxAiCalls: 10,
  maxInputTokens: 32_000,
  maxOutputTokens: 8_192,
  maxExecutionDurationMs: 120_000,
};

/** Request explícito — sin objetos Store/Supabase ni credentials. */
export interface AIRequest {
  executionId: string;
  effectId: string;
  flowId?: string;
  flowVersionId?: string;
  agentId?: string;
  agentVersionId?: string;
  tenantId: string;
  nodeId: string;
  model: string;
  mode: ClaudeAiMode;
  nodeInstructions: string;
  conversation?: ConversationKey;
  variables: Record<string, unknown>;
  verifiedResults: VerifiedActionResult[];
  allowedActionTypes: string[];
  budget: AiBudgetState;
  budgetLimits: AiBudgetLimits;
  userMessage?: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  classifications?: string[];
  outputVariables?: string[];
}

export interface AIActionProposal {
  actionType: string;
  arguments?: Record<string, unknown>;
}

/** Output validado — PROPOSED ≠ EXECUTED. */
export interface AIOutput {
  mode: ClaudeAiMode;
  responseText?: string;
  classification?: string;
  extracted?: Record<string, unknown>;
  actionProposal?: AIActionProposal;
}

/** Metadata de observabilidad segura. */
export interface ClaudeObservabilityMetadata {
  executionId: string;
  effectId: string;
  flowVersionId?: string;
  agentId?: string;
  agentVersionId?: string;
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  classification?: string;
  mode: ClaudeAiMode;
  textProvenance: typeof AI_TEXT_PROVENANCE;
  budgetAfter: AiBudgetState;
}

export interface ClaudeExecutorDeps {
  defaultModel?: string;
  budgetLimits?: AiBudgetLimits;
  resolveApiKey?: (tenantId: string) => Promise<string | null>;
  assertAgentOwnedByTenant?: (tenantId: string, agentId: string) => Promise<boolean>;
  loadConversationHistory?: (
    conversation: ConversationKey,
  ) => Promise<Array<{ role: "user" | "assistant"; content: string }>>;
  anthropicClient?: AnthropicMessagesClient;
}

/** Boundary inyectable — tests mockan esto. */
export interface AnthropicCreateMessageParams {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
}

export interface AnthropicCreateMessageResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  >;
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
}

export interface AnthropicMessagesClient {
  createMessage(
    params: AnthropicCreateMessageParams,
    signal?: AbortSignal,
  ): Promise<AnthropicCreateMessageResult>;
}

/** Contexto de dispatch extendido (EffectDispatchRequest.aiContext). */
export interface AiDispatchContext {
  flowId?: string;
  flowVersionId?: string;
  aiBudget?: AiBudgetState;
  userMessage?: string;
}

/** Resuelve mode del nodo Flow → mode Claude. */
export function resolveClaudeMode(config: AiNodeConfig): ClaudeAiMode {
  if (config.mode === "propose_action") return "propose_action";
  if (config.mode === "hybrid") return "propose_action";
  return config.mode;
}

/** Acciones permitidas para un nodo AI — sin fallback "all". */
export function resolveAllowedActionTypes(config: AiNodeConfig): string[] {
  if (config.allowedTools?.length) return [...config.allowedTools];
  return [];
}
