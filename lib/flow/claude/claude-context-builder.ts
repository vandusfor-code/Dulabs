/**
 * Construye AIRequest y AIExecutionContext (Fase 4.2).
 */

import { sanitizePayloadForObservability } from "@/lib/flow/sanitize-observability-payload";
import { createInitialAiBudget } from "@/lib/flow/claude/claude-budget";
import {
  DEFAULT_AI_BUDGET_LIMITS,
  resolveAllowedActionTypes,
  resolveClaudeMode,
  type AIExecutionContext,
  type AIRequest,
  type AiBudgetLimits,
  type AiBudgetState,
  type AiDispatchContext,
  type VerifiedActionResult,
} from "@/lib/flow/claude/claude-types";
import type { AiNodeConfig } from "@/lib/flow/types";
import type { EffectDispatchRequest } from "@/lib/flow/executor-types";

const INTERNAL_KEYS = new Set(["__verifiedResults", "__dulabsAiBudget", "__userMessage", "__conversationHistory"]);

export function extractVerifiedResults(payload: Record<string, unknown>): VerifiedActionResult[] {
  const results: VerifiedActionResult[] = [];

  const explicit = payload.__verifiedResults;
  if (Array.isArray(explicit)) {
    for (const item of explicit) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>;
        if (obj.verified === true && typeof obj.source === "string") {
          results.push({
            verified: true,
            source: obj.source,
            data: sanitizePayloadForObservability(obj) as Record<string, unknown>,
          });
        }
      }
    }
  }

  for (const [key, value] of Object.entries(payload)) {
    if (INTERNAL_KEYS.has(key) || key.startsWith("__")) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if (obj.verified === true && typeof obj.source === "string") {
        results.push({
          verified: true,
          source: obj.source,
          data: sanitizePayloadForObservability({ [key]: value, ...obj }) as Record<string, unknown>,
        });
      }
    }
  }

  return results;
}

function stripInternalKeys(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (INTERNAL_KEYS.has(key) || key.startsWith("__")) continue;
    out[key] = sanitizePayloadForObservability(value);
  }
  return out;
}

export function buildAIRequest(input: {
  request: EffectDispatchRequest;
  ai: AiNodeConfig;
  aiContext?: AiDispatchContext;
  model: string;
  budgetLimits?: AiBudgetLimits;
}): AIRequest {
  const payload = input.request.payload ?? {};
  const aiContext = input.aiContext ?? {};

  const budget: AiBudgetState =
    aiContext.aiBudget ??
    (payload.__dulabsAiBudget as AiBudgetState | undefined) ??
    createInitialAiBudget();

  const userMessage =
    aiContext.userMessage ??
    (typeof payload.__userMessage === "string" ? payload.__userMessage : undefined) ??
    (typeof payload.userMessage === "string" ? payload.userMessage : undefined) ??
    (typeof payload.lastUserMessage === "string" ? payload.lastUserMessage : undefined) ??
    (typeof payload.text === "string" ? payload.text : undefined);

  const historyRaw = payload.__conversationHistory;
  const conversationHistory = Array.isArray(historyRaw)
    ? historyRaw.filter(
        (m): m is { role: "user" | "assistant"; content: string } =>
          Boolean(m) &&
          typeof m === "object" &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string",
      )
    : undefined;

  return {
    executionId: input.request.executionLogicalId ?? input.request.executionRowId,
    effectId: input.request.effectId,
    flowId: aiContext.flowId,
    flowVersionId: aiContext.flowVersionId,
    agentId: input.ai.agentId,
    tenantId: input.request.tenantId,
    nodeId: input.request.nodeId,
    model: input.model,
    mode: resolveClaudeMode(input.ai),
    nodeInstructions: input.ai.instruction,
    conversation: input.request.conversation,
    variables: stripInternalKeys(payload),
    verifiedResults: extractVerifiedResults(payload),
    allowedActionTypes: resolveAllowedActionTypes(input.ai),
    budget,
    budgetLimits: input.budgetLimits ?? DEFAULT_AI_BUDGET_LIMITS,
    userMessage,
    conversationHistory,
    classifications: input.ai.classifications,
    outputVariables: input.ai.outputVariables,
  };
}

export function buildAIExecutionContext(aiRequest: AIRequest): AIExecutionContext {
  return {
    executionId: aiRequest.executionId,
    effectId: aiRequest.effectId,
    tenantId: aiRequest.tenantId,
    flowId: aiRequest.flowId,
    nodeId: aiRequest.nodeId,
    model: aiRequest.model,
    trusted: {
      nodeInstructions: aiRequest.nodeInstructions,
      mode: aiRequest.mode,
      flowVersionId: aiRequest.flowVersionId,
      agentId: aiRequest.agentId,
      agentVersionId: aiRequest.agentVersionId,
      classifications: aiRequest.classifications,
      outputVariables: aiRequest.outputVariables,
      verifiedResults: aiRequest.verifiedResults,
      allowedActionTypes: aiRequest.allowedActionTypes,
      variables: aiRequest.variables,
      budget: aiRequest.budget,
    },
    untrusted: {
      userMessage: aiRequest.userMessage,
      conversationHistory: aiRequest.conversationHistory,
    },
  };
}
