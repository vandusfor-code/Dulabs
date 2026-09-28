// DuLabs Business — Business Agent 2.0, FASE 7 — resiliencia de la llamada al modelo de entendimiento.
//
// Política explícita y ACOTADA (nunca un bucle):
//   - timeout por intento (AbortSignal al proveedor + carrera: un proveedor que ignora la señal tampoco bloquea el turno);
//   - presupuesto total del entendimiento por mensaje;
//   - máximo de intentos (por defecto 2 = 1 reintento), solo ante fallas TRANSITORIAS o salida inválida;
//   - backoff exponencial con jitter y techo;
//   - circuito por proceso: tras N fallas seguidas se abre y falla rápido durante un enfriamiento; luego deja pasar UNA
//     prueba (half-open) y se cierra si sale bien.
// Si todo falla, el turno recibe UNDERSTANDING_FAILED: la state machine conserva el estado y el runtime no ejecuta
// ninguna acción (ver conversation-runtime.ts).

import { RETRY_POLICIES, retryDelay } from "@/lib/agent-compiler/runtime/production/retry-policy";
import { createExecutorUnderstandingProvider, type ProviderFailureReason, type UnderstandingProvider, type UnderstandingProviderResult } from "@/lib/agent-compiler/understanding/provider";

export interface UnderstandingRetryPolicy {
  /** Intentos totales (incluye el primero). */
  maxAttempts: number;
  /** Límite de cada intento. */
  attemptTimeoutMs: number;
  /** Límite de todo el entendimiento del mensaje (intentos + esperas). */
  totalBudgetMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

// FASE 9 — los números salen de la política única (runtime/production/retry-policy.ts).
export const DEFAULT_UNDERSTANDING_RETRY: UnderstandingRetryPolicy = {
  maxAttempts: RETRY_POLICIES.understanding.maxAttempts,
  attemptTimeoutMs: RETRY_POLICIES.understanding.attemptTimeoutMs,
  totalBudgetMs: 15_000,
  baseDelayMs: RETRY_POLICIES.understanding.baseDelayMs,
  maxDelayMs: RETRY_POLICIES.understanding.maxDelayMs,
};

/** Espera antes del intento `attempt + 1`: base·2^(attempt−1) con techo, y jitter en [50 %, 100 %]. */
export function backoffDelay(policy: UnderstandingRetryPolicy, attempt: number, random: () => number = Math.random): number {
  return retryDelay(policy, attempt, random);
}

export const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Ejecuta un intento con timeout: la señal le llega al proveedor y, además, una carrera garantiza el límite. */
export async function callWithTimeout(
  provider: UnderstandingProvider,
  request: Omit<Parameters<UnderstandingProvider["understand"]>[0], "signal">,
  timeoutMs: number,
): Promise<UnderstandingProviderResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<UnderstandingProviderResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, category: "EXTERNAL_SERVICE_ERROR", code: "understanding_provider_timeout", retryable: true, reason: "timeout" });
    }, Math.max(1, timeoutMs));
  });
  try {
    const call = provider.understand({ ...request, signal: controller.signal }).catch(
      (): UnderstandingProviderResult => ({ ok: false, category: "EXTERNAL_SERVICE_ERROR", code: "understanding_provider_unavailable", retryable: true, reason: "unavailable" }),
    );
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Circuito
// ---------------------------------------------------------------------------

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreaker {
  /** ¿Puede salir una llamada ahora? En half-open deja pasar UNA sola prueba. */
  allow(nowMs: number): boolean;
  success(): void;
  failure(nowMs: number): void;
  state(nowMs: number): CircuitState;
}

export interface CircuitOptions {
  failureThreshold: number;
  cooldownMs: number;
}

export const DEFAULT_CIRCUIT: CircuitOptions = { failureThreshold: 5, cooldownMs: 30_000 };

export function createCircuitBreaker(options: CircuitOptions = DEFAULT_CIRCUIT): CircuitBreaker {
  let failures = 0;
  let openedAt: number | null = null;
  let probing = false;
  const state = (now: number): CircuitState => (openedAt === null ? "closed" : now - openedAt >= options.cooldownMs ? "half_open" : "open");
  return {
    allow(now) {
      const s = state(now);
      if (s === "closed") return true;
      if (s === "open" || probing) return false;
      probing = true;
      return true;
    },
    success() {
      failures = 0;
      openedAt = null;
      probing = false;
    },
    failure(now) {
      failures += 1;
      if (probing || failures >= options.failureThreshold) openedAt = now;
      probing = false;
    },
    state,
  };
}

/** Circuito compartido del proceso para el entendimiento en producción (por instancia; no se comparte entre instancias). */
export const sharedUnderstandingCircuit = createCircuitBreaker();

/** Las fallas propias de UNA solicitud (tenant, seguridad) no dicen nada de la salud del proveedor. */
const COUNTS_AGAINST_PROVIDER: ReadonlySet<ProviderFailureReason | undefined> = new Set<ProviderFailureReason | undefined>([
  "timeout",
  "rate_limited",
  "server",
  "network",
  "unavailable",
  "auth",
  "output_invalid",
]);

/** Envuelve un proveedor con el circuito: abierto = falla inmediata, sin llamar al modelo. */
export function withCircuitBreaker(provider: UnderstandingProvider, breaker: CircuitBreaker, clock: () => number = Date.now): UnderstandingProvider {
  return {
    name: provider.name,
    async understand(request) {
      if (!breaker.allow(clock())) {
        return { ok: false, category: "EXTERNAL_SERVICE_ERROR", code: "understanding_provider_circuit_open", retryable: false, reason: "circuit_open" };
      }
      const r = await provider.understand(request);
      if (r.ok) breaker.success();
      else if (COUNTS_AGAINST_PROVIDER.has(r.reason)) breaker.failure(clock());
      else breaker.success();
      return r;
    },
  };
}

/** Proveedor de entendimiento de PRODUCCIÓN: Gemini (temperatura 0) detrás del circuito compartido del proceso. */
export function productionUnderstandingProvider(): UnderstandingProvider {
  return withCircuitBreaker(createExecutorUnderstandingProvider(), sharedUnderstandingCircuit);
}
