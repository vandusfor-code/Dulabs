/**
 * Framework común: timeout, clasificación de errores, sanitización obligatoria (Fase 4.1).
 */

import { sanitizePayloadForObservability } from "@/lib/flow/sanitize-observability-payload";
import { UnknownExecutorKindError, type ExecutorRegistry } from "@/lib/flow/executor-registry";
import type { IntegrationResolver } from "@/lib/flow/integration-resolver";
import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutorKind,
  type EffectResultClassification,
} from "@/lib/flow/executor-types";

export interface EffectObservabilityRecord {
  effectId: string;
  executionRowId: string;
  tenantId: string;
  kind: EffectExecutorKind;
  attempt: number;
  durationMs: number;
  success: boolean;
  classification: EffectResultClassification;
  errorCategory?: EffectResultClassification;
  externalReference?: string;
}

export interface EffectExecutorFrameworkDeps {
  registry: ExecutorRegistry;
  integrationResolver: IntegrationResolver;
  overallTimeoutMs?: number;
  observability?: {
    record(entry: EffectObservabilityRecord): void;
  };
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Lanza AbortError si el signal ya fue cancelado (timeout del framework). */
export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw Object.assign(new Error("executor_aborted"), { name: "AbortError" });
  }
}

function isNetworkErrorMessage(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("fetch failed") ||
    msg.includes("socket hang up")
  );
}

function classifyThrownError(err: unknown): EffectResultClassification {
  if (err instanceof UnknownExecutorKindError) {
    return EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED;
  }
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.message.includes("timeout") || err.message.includes("aborted")) {
      return EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT;
    }
    if (err.message.includes("rate limit")) {
      return EFFECT_RESULT_CLASSIFICATIONS.RATE_LIMIT;
    }
    if (err.message.includes("validation")) {
      return EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR;
    }
    if (err.message.includes("auth") || err.message.includes("unauthorized")) {
      return EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR;
    }
    if (isNetworkErrorMessage(err.message)) {
      return EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS;
    }
  }
  return EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS;
}

function sanitizeRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  const sanitized = sanitizePayloadForObservability(value);
  if (typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }
  return { value: sanitized };
}

function sanitizeStringRef(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizePayloadForObservability(value);
  return typeof sanitized === "string" ? sanitized : String(sanitized);
}

/**
 * Sanitiza el resultado del executor antes de persistencia/observabilidad.
 * Preserva `data`/`appliedResult` para el Engine; redacta secretos embebidos.
 */
export function sanitizeExecutorDispatchResult(
  result: EffectDispatchResult,
): EffectDispatchResult {
  return {
    ...result,
    data: sanitizeRecord(result.data),
    metadata: sanitizeRecord(result.metadata),
    rawResult: sanitizeRecord(result.rawResult),
    appliedResult: sanitizeRecord(result.appliedResult ?? result.data),
    externalReference: sanitizeStringRef(result.externalReference),
    error:
      typeof result.error === "string"
        ? (sanitizePayloadForObservability(result.error) as string)
        : result.error,
  };
}

function dispatchWithAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(Object.assign(new Error("executor_aborted"), { name: "AbortError" }));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(Object.assign(new Error("executor_timeout"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

export class EffectExecutorFramework {
  private readonly timeoutMs: number;

  constructor(private readonly deps: EffectExecutorFrameworkDeps) {
    this.timeoutMs = deps.overallTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async execute(request: EffectDispatchRequest): Promise<EffectDispatchResult> {
    const started = Date.now();

    try {
      const integration = await this.deps.integrationResolver.resolve({
        tenantId: request.tenantId,
        integrationId: request.integrationId,
        action: request.action,
        kind: request.kind,
      });

      if (!integration.ok) {
        const failed: EffectDispatchResult = {
          success: false,
          classification: integration.classification,
          error: integration.reason,
          durationMs: Date.now() - started,
        };
        return this.finalize(request, failed, started);
      }

      const executor = this.deps.registry.resolve(request.kind);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let raw: EffectDispatchResult;
      try {
        raw = await dispatchWithAbortSignal(
          executor.dispatch(request, integration.context, controller.signal),
          controller.signal,
        );
      } finally {
        clearTimeout(timer);
      }

      const classification =
        raw.classification ??
        (raw.success ? EFFECT_RESULT_CLASSIFICATIONS.SUCCESS : EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);

      const normalized: EffectDispatchResult = {
        ...raw,
        classification,
        success: raw.success && classification === EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        durationMs: Date.now() - started,
      };

      return this.finalize(request, normalized, started);
    } catch (err) {
      const classification = classifyThrownError(err);
      const failed: EffectDispatchResult = {
        success: false,
        classification,
        error: err instanceof Error ? err.message : "executor_error",
        durationMs: Date.now() - started,
      };
      return this.finalize(request, failed, started);
    }
  }

  private finalize(
    request: EffectDispatchRequest,
    result: EffectDispatchResult,
    started: number,
  ): EffectDispatchResult {
    const sanitized = sanitizeExecutorDispatchResult(result);
    sanitized.durationMs = sanitized.durationMs ?? Date.now() - started;

    this.deps.observability?.record({
      effectId: request.effectId,
      executionRowId: request.executionRowId,
      tenantId: request.tenantId,
      kind: request.kind,
      attempt: request.attempt,
      durationMs: sanitized.durationMs,
      success: sanitized.success,
      classification: sanitized.classification,
      errorCategory: sanitized.success ? undefined : sanitized.classification,
      externalReference: sanitized.externalReference,
    });

    return sanitized;
  }
}
