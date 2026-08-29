/**
 * Clasificación de errores Anthropic (Fase 4.2).
 */

import { EFFECT_RESULT_CLASSIFICATIONS, type EffectResultClassification } from "@/lib/flow/executor-types";

export function classifyAnthropicError(err: unknown): {
  classification: EffectResultClassification;
  error: string;
} {
  if (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))) {
    return { classification: EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT, error: "anthropic_timeout" };
  }

  const e = err as { status?: number; message?: string };
  const status = typeof e?.status === "number" ? e.status : null;
  const message = e?.message ?? String(err);
  const lower = message.toLowerCase();

  if (status === 429 || lower.includes("rate limit")) {
    return { classification: EFFECT_RESULT_CLASSIFICATIONS.RATE_LIMIT, error: "anthropic_rate_limit" };
  }

  if (status === 401 || status === 403 || lower.includes("authentication") || lower.includes("invalid x-api-key")) {
    return { classification: EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR, error: "anthropic_auth_error" };
  }

  if (status !== null && status >= 500) {
    return { classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, error: "anthropic_server_error" };
  }

  if (
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("econnreset") ||
    lower.includes("socket")
  ) {
    return { classification: EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS, error: "anthropic_network_error" };
  }

  if (lower.includes("validation") || lower.includes("malformed") || lower.includes("schema")) {
    return { classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR, error: "anthropic_validation_error" };
  }

  return { classification: EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS, error: "anthropic_unknown_error" };
}
