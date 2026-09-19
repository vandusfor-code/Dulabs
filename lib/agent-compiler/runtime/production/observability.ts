// DuLabs Business — Agent Compiler, Step 8 — observabilidad de producción.
//
// Traza reconstruible de una ejecución del Business Agent Runtime SIN secretos.
// Nunca registra tokens, api keys, Authorization headers ni credenciales.

export interface BusinessAgentTrace {
  tenantId: string;
  wamid: string;
  phoneNumberId: string;
  /** Identidad del agente/versión ejecutado. */
  flowId?: string;
  flowVersionId?: string;
  checksum?: string;
  /** Decisión del Gate. */
  gateDecision?: "pass" | "block" | "fixed_response" | "transfer_human" | "fail_closed" | "duplicate";
  matchedRuleId?: string;
  matchedBy?: "deterministic" | "semantic";
  /** Resultado del orquestador (cuando el Gate pasa). */
  orchestratorOutcome?: string;
  /** Outcome del boundary. */
  outcome: "no_business_agent" | "guardrail_blocked" | "flow" | "fail_closed" | "duplicate" | "blocked_number";
  reason?: string;
  llmInvoked: boolean;
  latencyMs?: number;
  error?: string;
}

export interface BusinessAgentObserver {
  onTrace(trace: BusinessAgentTrace): void;
}

/** Claves que NUNCA deben aparecer en una traza/log (defensa en profundidad). */
const SECRET_KEYS = /token|api[_-]?key|authorization|secret|password|bearer|credential|refresh/i;

/** Redacta recursivamente cualquier valor bajo una clave sensible. */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? "[REDACTED]" : redactSecrets(v, depth + 1);
  }
  return out;
}

/** Observer por defecto: log estructurado a consola, con redacción. */
export function createConsoleObserver(): BusinessAgentObserver {
  return {
    onTrace(trace) {
      console.log("[business-agent]", JSON.stringify(redactSecrets(trace)));
    },
  };
}
