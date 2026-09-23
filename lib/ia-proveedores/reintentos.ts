/**
 * Reintento CONTROLADO de una llamada al modelo.
 *
 * - Solo errores transitorios (rate_limit, timeout, server, network).
 * - Como máximo `maxRetries` (por defecto 1), con espera exponencial + jitter.
 * - Nunca excede el plazo del turno: si no queda tiempo, se rinde con el error.
 * - NUNCA cambia de proveedor ni de modelo (no hay fallback silencioso).
 */
import { AIProviderError, type AIGenerateRequest, type AIGenerateResult, type AIProvider } from "@/lib/ia-proveedores/contrato";

export interface RetryOptions {
  /** Instante (epoch ms) en que vence el turno completo. */
  deadlineAt: number;
  maxRetries?: number;
  baseDelayMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Observabilidad: un aviso por intento fallido (sin datos sensibles). */
  onRetry?: (info: { attempt: number; kind: string; delayMs: number }) => void;
}

/** Tiempo mínimo que debe quedar para que valga la pena otro intento. */
const MIN_ATTEMPT_MS = 1_500;

export async function generateWithRetry(provider: AIProvider, request: AIGenerateRequest, opts: RetryOptions, signal?: AbortSignal): Promise<AIGenerateResult> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  const maxRetries = Math.max(0, Math.min(3, opts.maxRetries ?? 1));
  const base = opts.baseDelayMs ?? 400;

  for (let attempt = 0; ; attempt++) {
    const remaining = opts.deadlineAt - now();
    if (remaining < MIN_ATTEMPT_MS) throw new AIProviderError("timeout", provider.id);
    try {
      return await provider.generate({ ...request, timeoutMs: Math.min(request.timeoutMs, remaining) }, signal);
    } catch (err) {
      const error = err instanceof AIProviderError ? err : new AIProviderError("unknown", provider.id);
      if (!error.retryable || attempt >= maxRetries || signal?.aborted) throw error;
      const delayMs = Math.round(base * 2 ** attempt + random() * base);
      if (opts.deadlineAt - now() - delayMs < MIN_ATTEMPT_MS) throw error;
      opts.onRetry?.({ attempt: attempt + 1, kind: error.kind, delayMs });
      await sleep(delayMs);
    }
  }
}
