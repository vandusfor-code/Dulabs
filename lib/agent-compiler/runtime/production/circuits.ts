// DuLabs Business — Business Agent 2.0, FASE 9 — circuitos POR DEPENDENCIA (no uno global).
//
//   gemini          entendimiento (clave única de la plataforma) → un circuito por proceso (understanding/resilience.ts)
//   nylas_calendar  agenda vía Nylas (grant POR TENANT)           → un circuito por (dependencia, tenant)
//   whatsapp        envío de recordatorios por Meta (token/número POR TENANT) → uno por (dependencia, tenant)
//
// Un tenant con el calendario desconectado o un token vencido abre SU circuito; los demás siguen operando. Abierto =
// falla rápida con BA-INTEGRATION-CIRCUIT_OPEN ANTES de llamar al proveedor (nunca es ambiguo: no se llamó). Solo las
// fallas de INTEGRACIÓN cuentan (timeout, 5xx, 429, red, credencial rechazada); un "horario ocupado" es una respuesta
// sana del proveedor.
//
// Estado en memoria del proceso, a propósito (ver FASE-9 doc, "estado distribuido"): el costo de que cada instancia
// descubra la caída por su cuenta es ≤ umbral × instancias llamadas con timeout acotado; un circuito en Redis/Postgres
// agregaría una dependencia en el camino de CADA mensaje. Memoria acotada: como máximo `maxKeys` circuitos (LRU).

import { createCircuitBreaker, sharedUnderstandingCircuit, type CircuitBreaker, type CircuitOptions, type CircuitState } from "@/lib/agent-compiler/understanding/resilience";

export const DEPENDENCIES = ["gemini", "nylas_calendar", "whatsapp"] as const;
export type Dependency = (typeof DEPENDENCIES)[number];

export const CIRCUIT_OPTIONS: Readonly<Record<Dependency, CircuitOptions>> = {
  gemini: { failureThreshold: 5, cooldownMs: 30_000 },
  nylas_calendar: { failureThreshold: 3, cooldownMs: 60_000 },
  whatsapp: { failureThreshold: 3, cooldownMs: 120_000 },
};

export interface CircuitRegistry {
  /** Circuito de la dependencia para ese alcance (tenant). gemini ignora el alcance (uno por proceso). */
  get(dependency: Dependency, scope: string): CircuitBreaker;
  /** Circuitos no cerrados (para /health y diagnóstico). Nunca incluye datos de clientes. */
  snapshot(nowMs: number): Array<{ dependency: Dependency; scope: string; state: CircuitState }>;
}

export function createCircuitRegistry(options: Partial<Record<Dependency, CircuitOptions>> = {}, maxKeys = 2_000, gemini: CircuitBreaker = createCircuitBreaker({ ...CIRCUIT_OPTIONS.gemini, ...options.gemini })): CircuitRegistry {
  const circuits = new Map<string, { dependency: Dependency; scope: string; breaker: CircuitBreaker }>();
  return {
    get(dependency, scope) {
      if (dependency === "gemini") return gemini;
      const key = `${dependency}:${scope}`;
      const hit = circuits.get(key);
      if (hit) {
        circuits.delete(key);
        circuits.set(key, hit); // LRU: el más reciente al final
        return hit.breaker;
      }
      const breaker = createCircuitBreaker({ ...CIRCUIT_OPTIONS[dependency], ...options[dependency] });
      circuits.set(key, { dependency, scope, breaker });
      if (circuits.size > maxKeys) circuits.delete(circuits.keys().next().value!);
      return breaker;
    },
    snapshot(nowMs) {
      const out: Array<{ dependency: Dependency; scope: string; state: CircuitState }> = [];
      const g = gemini.state(nowMs);
      if (g !== "closed") out.push({ dependency: "gemini", scope: "platform", state: g });
      for (const c of circuits.values()) {
        const s = c.breaker.state(nowMs);
        if (s !== "closed") out.push({ dependency: c.dependency, scope: c.scope, state: s });
      }
      return out;
    },
  };
}

/** Registro del proceso en producción (gemini = el mismo circuito que ya usa el entendimiento). */
export const sharedCircuits: CircuitRegistry = createCircuitRegistry({}, 2_000, sharedUnderstandingCircuit);

/**
 * Ejecuta `call` bajo el circuito: abierto → `onOpen()` sin llamar. `countsAsFailure(result)` decide si el resultado
 * habla mal del proveedor. Siempre registra éxito o falla (un half-open nunca queda colgado).
 */
export async function underCircuit<T>(breaker: CircuitBreaker | null, nowMs: () => number, call: () => Promise<T>, countsAsFailure: (r: T) => boolean, onOpen: () => T): Promise<T> {
  if (!breaker) return call();
  if (!breaker.allow(nowMs())) return onOpen();
  let r: T;
  try {
    r = await call();
  } catch (e) {
    breaker.failure(nowMs());
    throw e;
  }
  if (countsAsFailure(r)) breaker.failure(nowMs());
  else breaker.success();
  return r;
}
