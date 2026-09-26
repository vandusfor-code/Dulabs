// DuLabs Business — Business Agent 2.0, FASE 1 — estado de producto del agente (capa compatible).
//
// Hoy el estado de un Business Agent está repartido en cuatro lugares (versión del Registry, flow publicado,
// vínculo del número en dulabs_clientes_config e ia_pausada, más la precedencia de otros motores en el webhook).
// Esta capa NO cambia ninguno: DERIVA un estado único y explicable desde esos hechos, para que la UI y la
// futura máquina de estados (FASE 3) partan de la misma verdad que usa el runtime.
//
//   DRAFT       sin versión válida
//   CONFIGURED  la última versión compila y valida, pero no hay versión publicada
//   PUBLISHED   hay versión publicada servible, sin número vinculado
//   ACTIVE      publicada y atendiendo al menos un número
//   PAUSED      publicada y vinculada, pero ningún número atiende porque están pausados (ia_pausada)
//   ERROR       la versión publicada no es servible, o todos los números vinculados los atiende otro motor
//
// Nota: CONFIGURED significa "valida y compila"; la verificación con datos reales (readiness) se aplica al
// publicar y al activar. La experiencia completa de readiness es la FASE 9.

import type { ValidationStatus } from "@/lib/agent-compiler/registry/types";

export type AgentLifecycleState = "DRAFT" | "CONFIGURED" | "PUBLISHED" | "ACTIVE" | "PAUSED" | "ERROR";

export interface LifecycleNumberInput {
  phoneNumberId: string;
  iaPausada: boolean;
  /** Motor que atiende ANTES que Business Agent en el webhook (null = ninguno). */
  otherEngine: "agente_conversacional" | null;
}

export interface LifecycleInput {
  latestValidationStatus: ValidationStatus | null;
  /** null = no hay versión publicada. `servable` = mismo criterio que el resolver de producción. */
  published: { servable: boolean } | null;
  /** Números con este agente activo (flow_activo = true y flow_id = el del agente). */
  boundNumbers: LifecycleNumberInput[];
}

export type LifecycleNumberStatus = "serving" | "paused" | "blocked_by_other_engine";

export interface AgentLifecycle {
  state: AgentLifecycleState;
  reasons: string[];
  numbers: Array<{ phoneNumberId: string; status: LifecycleNumberStatus }>;
}

function estadoNumero(n: LifecycleNumberInput): LifecycleNumberStatus {
  if (n.otherEngine) return "blocked_by_other_engine";
  if (n.iaPausada) return "paused";
  return "serving";
}

export function deriveAgentLifecycle(input: LifecycleInput): AgentLifecycle {
  const numbers = input.boundNumbers.map((n) => ({ phoneNumberId: n.phoneNumberId, status: estadoNumero(n) }));

  if (input.published) {
    if (!input.published.servable) {
      return { state: "ERROR", reasons: ["PUBLISHED_VERSION_INVALID"], numbers };
    }
    if (numbers.some((n) => n.status === "serving")) return { state: "ACTIVE", reasons: [], numbers };
    if (numbers.length > 0) {
      if (numbers.every((n) => n.status === "blocked_by_other_engine")) return { state: "ERROR", reasons: ["ENGINE_CONFLICT"], numbers };
      return { state: "PAUSED", reasons: ["NUMBERS_PAUSED"], numbers };
    }
    return { state: "PUBLISHED", reasons: [], numbers };
  }

  if (input.latestValidationStatus === "validated") return { state: "CONFIGURED", reasons: [], numbers };
  return { state: "DRAFT", reasons: input.latestValidationStatus === "failed" ? ["LATEST_VERSION_INVALID"] : [], numbers };
}
