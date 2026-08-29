/**
 * Presupuesto IA — límites duros (Fase 4.2).
 */

import {
  DEFAULT_AI_BUDGET_LIMITS,
  type AiBudgetLimits,
  type AiBudgetState,
} from "@/lib/flow/claude/claude-types";

export function createInitialAiBudget(startedAtMs = Date.now()): AiBudgetState {
  return { callCount: 0, inputTokens: 0, outputTokens: 0, startedAtMs };
}

export function checkAiBudget(
  budget: AiBudgetState,
  limits: AiBudgetLimits = DEFAULT_AI_BUDGET_LIMITS,
  nowMs = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  if (budget.callCount >= limits.maxAiCalls) return { ok: false, reason: "max_ai_calls_exceeded" };
  if (budget.inputTokens >= limits.maxInputTokens) return { ok: false, reason: "max_input_tokens_exceeded" };
  if (budget.outputTokens >= limits.maxOutputTokens) return { ok: false, reason: "max_output_tokens_exceeded" };
  if (nowMs - budget.startedAtMs >= limits.maxExecutionDurationMs) {
    return { ok: false, reason: "max_execution_duration_exceeded" };
  }
  return { ok: true };
}

export function applyAiUsage(
  budget: AiBudgetState,
  usage: { inputTokens?: number; outputTokens?: number },
): AiBudgetState {
  return {
    ...budget,
    callCount: budget.callCount + 1,
    inputTokens: budget.inputTokens + (usage.inputTokens ?? 0),
    outputTokens: budget.outputTokens + (usage.outputTokens ?? 0),
  };
}
