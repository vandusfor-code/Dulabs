/**
 * Presupuesto IA — límites duros (Fase 4.2).
 */

import {
  DEFAULT_AI_BUDGET_LIMITS,
  type AiBudgetLimits,
  type AiBudgetState,
} from "@/lib/flow/claude/claude-types";

export function createInitialAiBudget(startedAtMs = Date.now()): AiBudgetState {
  return { callCount: 0, inputTokens: 0, outputTokens: 0, startedAtMs, totalProcessingMs: 0 };
}

export function checkAiBudget(
  budget: AiBudgetState,
  limits: AiBudgetLimits = DEFAULT_AI_BUDGET_LIMITS,
): { ok: true } | { ok: false; reason: string } {
  if (budget.callCount >= limits.maxAiCalls) return { ok: false, reason: "max_ai_calls_exceeded" };
  if (budget.inputTokens >= limits.maxInputTokens) return { ok: false, reason: "max_input_tokens_exceeded" };
  if (budget.outputTokens >= limits.maxOutputTokens) return { ok: false, reason: "max_output_tokens_exceeded" };
  // Fase 1 (bug crítico real, prueba 314) — se mide tiempo de PROCESAMIENTO
  // real acumulado dentro de llamadas a Claude, nunca reloj de pared desde
  // el inicio de la ejecución (ver comentario de totalProcessingMs en
  // claude-types.ts). Una clienta real tardando minutos entre preguntas ya
  // NO agota este presupuesto.
  if ((budget.totalProcessingMs ?? 0) >= limits.maxExecutionDurationMs) {
    return { ok: false, reason: "max_execution_duration_exceeded" };
  }
  return { ok: true };
}

export function applyAiUsage(
  budget: AiBudgetState,
  usage: { inputTokens?: number; outputTokens?: number; durationMs?: number },
): AiBudgetState {
  return {
    ...budget,
    callCount: budget.callCount + 1,
    inputTokens: budget.inputTokens + (usage.inputTokens ?? 0),
    outputTokens: budget.outputTokens + (usage.outputTokens ?? 0),
    totalProcessingMs: (budget.totalProcessingMs ?? 0) + (usage.durationMs ?? 0),
  };
}
