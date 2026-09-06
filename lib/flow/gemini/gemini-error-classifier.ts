/**
 * Clasificación de errores Gemini (FASE B, autorizado) — mismo criterio que
 * classifyAnthropicError (lib/flow/claude/claude-error-classifier.ts), solo
 * cambian los mensajes/prefijos para que la observabilidad diga qué
 * proveedor falló.
 */
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectResultClassification } from "@/lib/flow/executor-types";

export function classifyGeminiError(err: unknown): {
  classification: EffectResultClassification;
  error: string;
} {
  if (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))) {
    return { classification: EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT, error: "gemini_timeout" };
  }

  const e = err as { status?: number; message?: string };
  const status = typeof e?.status === "number" ? e.status : null;
  const message = e?.message ?? String(err);
  const lower = message.toLowerCase();

  if (status === 429 || lower.includes("rate limit") || lower.includes("resource_exhausted")) {
    return { classification: EFFECT_RESULT_CLASSIFICATIONS.RATE_LIMIT, error: "gemini_rate_limit" };
  }

  if (status === 401 || status === 403 || lower.includes("api key not valid") || lower.includes("permission_denied")) {
    return { classification: EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR, error: "gemini_auth_error" };
  }

  if (status !== null && status >= 500) {
    return { classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, error: "gemini_server_error" };
  }

  if (
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("econnreset") ||
    lower.includes("socket")
  ) {
    return { classification: EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS, error: "gemini_network_error" };
  }

  if (lower.includes("validation") || lower.includes("malformed") || lower.includes("schema") || lower.includes("invalid_argument")) {
    return { classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR, error: "gemini_validation_error" };
  }

  return { classification: EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS, error: "gemini_unknown_error" };
}
