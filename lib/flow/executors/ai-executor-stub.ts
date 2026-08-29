/**
 * AI Executor — placeholder (Fase 4.1).
 * Claude Executor se implementará en fase posterior.
 */

import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutionContext,
  type EffectExecutor,
  type InternalActionOperationClass,
} from "@/lib/flow/executor-types";

export class AiExecutorStub implements EffectExecutor {
  readonly kind = "ai" as const;
  readonly version = "0.0.0-stub";
  readonly capabilities = {
    supportsIntegration: true,
    supportsAsync: true,
    operationClasses: [] as InternalActionOperationClass[],
  };

  async dispatch(
    _request: EffectDispatchRequest,
    _context: EffectExecutionContext,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    if (signal?.aborted) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT,
        error: "executor_aborted",
      };
    }
    return {
      success: false,
      classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
      error: "ai_executor_not_implemented",
    };
  }
}
