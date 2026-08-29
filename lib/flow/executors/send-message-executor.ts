/**
 * Send Message Executor — stub sin Meta API (Fase 4.1).
 * Pipeline de effects/idempotencia; I/O real en fase posterior.
 */

import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutionContext,
  type EffectExecutor,
  type InternalActionOperationClass,
} from "@/lib/flow/executor-types";

export class SendMessageExecutor implements EffectExecutor {
  readonly kind = "send_message" as const;
  readonly version = "1.0.0";
  readonly capabilities = {
    supportsIntegration: false,
    supportsAsync: false,
    operationClasses: [] as InternalActionOperationClass[],
  };

  async dispatch(
    request: EffectDispatchRequest,
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
    if (!request.message) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "message_content_required",
      };
    }

    const externalReference = `send_message:${request.effectId}`;

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data: {
        delivered: false,
        stub: true,
        nodeId: request.nodeId,
      },
      appliedResult: {
        delivered: false,
        stub: true,
        nodeId: request.nodeId,
      },
      metadata: {
        channel: "whatsapp",
        stub: true,
        contentType: request.message.content.text ? "text" : "structured",
      },
      rawResult: {
        stub: true,
        nodeId: request.nodeId,
      },
      externalReference,
    };
  }
}
