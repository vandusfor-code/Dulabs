/**
 * Simulated AI Executor — Fase 1 (Flow Simulator, autorizado).
 *
 * Implementa `EffectExecutor` (kind: "ai") sin llamar NUNCA a Claude o
 * Gemini reales -- este archivo no importa `@/lib/flow/executors/claude-executor`,
 * `@/lib/flow/executors/gemini-executor`, `@anthropic-ai/sdk` ni ningún
 * cliente HTTP. Aislamiento estructural (mismo criterio que
 * SimulatedSendMessageExecutor): el simulador nunca puede alcanzar el código
 * real de IA porque nunca lo importa.
 *
 * Fase 1 (autorizado por la especificación) -- respuesta simulada simple:
 * por defecto, un texto fijo ("Respuesta simulada de IA") y, en modo
 * classify, la primera clasificación declarada en el nodo. Admite overrides
 * por nodeId (inyectados por el caller, ej. desde el body del request HTTP)
 * para que el usuario del simulador pueda fijar una respuesta/clasificación
 * específica sin tocar este archivo -- deja la puerta abierta a un modo de
 * prueba más avanzado en una fase posterior, sin construirlo ahora.
 */

import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutionContext,
  type EffectExecutor,
  type InternalActionOperationClass,
} from "@/lib/flow/executor-types";

export interface SimulatedAiOverride {
  /** Fuerza éxito/fallo del efecto -- default true. */
  success?: boolean;
  error?: string;
  /** Texto de respuesta simulado (modos respond/hybrid/propose_action, y opcionalmente classify). */
  responseText?: string;
  /** Clasificación simulada (modo classify). Default: la primera de `classifications` del nodo. */
  classification?: string;
  /** Valores simulados para cada variable en `outputVariables`. Claves ausentes usan un placeholder. */
  outputValues?: Record<string, unknown>;
}

export interface SimulatedAiExecutorDeps {
  /** Resuelve el override configurado para un nodo -- inyectado por el caller (ver simulate-flow.ts). */
  resolveOverride?: (nodeId: string) => SimulatedAiOverride | undefined;
}

const DEFAULT_RESPONSE_TEXT = "Respuesta simulada de IA";

export class SimulatedAiExecutor implements EffectExecutor {
  readonly kind = "ai" as const;
  readonly version = "sim-1.0.0";
  readonly capabilities = {
    supportsIntegration: false,
    supportsAsync: false,
    operationClasses: [] as InternalActionOperationClass[],
  };

  constructor(private readonly deps: SimulatedAiExecutorDeps = {}) {}

  async dispatch(
    request: EffectDispatchRequest,
    _context: EffectExecutionContext,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    if (signal?.aborted) {
      return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT, error: "executor_aborted" };
    }
    const ai = request.ai;
    if (!ai) {
      return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR, error: "ai_config_required" };
    }

    const override = this.deps.resolveOverride?.(request.nodeId);

    if (override?.success === false) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
        error: override.error ?? "ai_simulated_failure",
      };
    }

    const data: Record<string, unknown> = { simulated: true };

    if (ai.mode === "classify") {
      const classification = override?.classification ?? ai.classifications?.[0] ?? "default";
      data.classification = classification;
      if (override?.responseText) data.responseText = override.responseText;
    } else {
      data.responseText = override?.responseText ?? DEFAULT_RESPONSE_TEXT;
    }

    for (const key of ai.outputVariables ?? []) {
      data[key] = override?.outputValues?.[key] ?? `[simulado] ${key}`;
    }

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data: { type: "ai_response", simulated: true, response: data.responseText ?? DEFAULT_RESPONSE_TEXT, ...data },
      appliedResult: data,
      metadata: { channel: "simulated", mode: ai.mode },
    };
  }
}
