// DuLabs Business — Business Agent 2.0, FASE 9 — política de reintentos ÚNICA.
//
// Una sola regla para todo el Business Agent (entendimiento, lecturas del Action Engine, envío de recordatorios):
//
//   - backoff exponencial base·2^(n−1) con techo y jitter en [50 %, 100 %] (evita que N workers reintenten a la vez);
//   - máximo de intentos por dependencia (incluye el primero);
//   - timeout por intento (lo aplica quien llama; aquí queda declarado);
//   - SOLO se reintenta lo RETRYABLE. Nunca lo AMBIGUO (pudo haber ocurrido: se verifica, no se repite) ni lo
//     NO RETRYABLE (config, validación, seguridad, 4xx). Una escritura solo se reintenta si es idempotente en el store.
//
// Clases (ver error-taxonomy.ts):
//   RETRYABLE      timeout ANTES del efecto, 429, 5xx, red caída antes de enviar, store no disponible
//   NON_RETRYABLE  validación, regla de negocio, configuración, seguridad, 4xx definitivo, circuito abierto
//   AMBIGUOUS      timeout / conexión cortada DURANTE una escritura no idempotente → verificar (nunca reintentar)

export type RetryClass = "RETRYABLE" | "NON_RETRYABLE" | "AMBIGUOUS";

export interface RetryPolicy {
  /** Intentos totales (incluye el primero). */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Límite de cada intento (declarativo; lo aplica quien ejecuta). */
  attemptTimeoutMs: number;
}

/** Políticas por dependencia. Cambiar un número aquí cambia el comportamiento de todo el Business Agent. */
export const RETRY_POLICIES = {
  /** Gemini (entendimiento): 1 reintento dentro del presupuesto del turno (ver understanding/resilience.ts). */
  understanding: { maxAttempts: 2, baseDelayMs: 300, maxDelayMs: 1_200, attemptTimeoutMs: 8_000 },
  /** Lecturas del Action Engine (disponibilidad, catálogo, conocimiento, productos). */
  action_read: { maxAttempts: 2, baseDelayMs: 300, maxDelayMs: 1_200, attemptTimeoutMs: 8_000 },
  /** Escrituras idempotentes en el store propio (lead = merge, recordatorio = upsert por clave). */
  action_idempotent_write: { maxAttempts: 2, baseDelayMs: 300, maxDelayMs: 1_200, attemptTimeoutMs: 8_000 },
  /** Escrituras externas no idempotentes (agenda): NUNCA se reintentan; ante duda se verifican. */
  action_write: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, attemptTimeoutMs: 20_000 },
  /** Envío de recordatorios (lo reprograma el despachador; nunca después de la cita). */
  reminder_send: { maxAttempts: 3, baseDelayMs: 120_000, maxDelayMs: 600_000, attemptTimeoutMs: 10_000 },
} as const satisfies Record<string, RetryPolicy>;

export type RetryDependency = keyof typeof RETRY_POLICIES;

/** Espera antes del intento `attempt + 1` (attempt = intentos ya hechos, ≥ 1). */
export function retryDelay(policy: Pick<RetryPolicy, "baseDelayMs" | "maxDelayMs">, attempt: number, random: () => number = Math.random): number {
  if (policy.baseDelayMs <= 0) return 0;
  const raw = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(raw * (0.5 + Math.min(1, Math.max(0, random())) / 2));
}

/**
 * ¿Se hace otro intento? `attempt` = intentos ya hechos. Lo ambiguo y lo no retryable nunca; lo retryable hasta el
 * máximo de la política.
 */
export function retryDecision(policy: RetryPolicy, attempt: number, cls: RetryClass, random: () => number = Math.random): { retry: true; delayMs: number } | { retry: false; reason: "NON_RETRYABLE" | "AMBIGUOUS" | "ATTEMPTS_EXHAUSTED" } {
  if (cls === "AMBIGUOUS") return { retry: false, reason: "AMBIGUOUS" };
  if (cls === "NON_RETRYABLE") return { retry: false, reason: "NON_RETRYABLE" };
  if (attempt >= policy.maxAttempts) return { retry: false, reason: "ATTEMPTS_EXHAUSTED" };
  return { retry: true, delayMs: retryDelay(policy, attempt, random) };
}

/** Clase de un fallo con la forma del Action Engine ({retryable, ambiguous}). */
export function retryClassOf(failure: { retryable: boolean; ambiguous: boolean }): RetryClass {
  if (failure.ambiguous) return "AMBIGUOUS";
  return failure.retryable ? "RETRYABLE" : "NON_RETRYABLE";
}
