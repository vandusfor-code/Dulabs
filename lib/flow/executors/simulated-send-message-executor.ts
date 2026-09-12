/**
 * Simulated Send Message Executor — Fase 1 (Flow Simulator, autorizado).
 *
 * Implementa el MISMO contrato `EffectExecutor` (kind: "send_message") que
 * usa producción (ver lib/flow/executors/send-message-executor.ts), pero sin
 * NINGUNA dependencia de Supabase, WhatsApp Cloud API ni ningún I/O externo
 * -- este archivo no importa `@/lib/whatsapp`, `@/lib/whatsapp-outbound` ni
 * ningún cliente de red. Aislamiento estructural, no un flag en runtime: el
 * simulador nunca referencia `SendMessageExecutor` (el real) en ningún
 * import, así que es imposible para el grafo de módulos del simulador
 * alcanzar una llamada real a Meta.
 *
 * Nunca envía nada -- solo "resuelve" el contenido tal cual lo dejó el
 * Engine (ya interpolado, ver flow-engine.ts) y lo devuelve marcado
 * `simulated: true`, para que el simulador lo muestre como burbuja de chat.
 */

import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutionContext,
  type EffectExecutor,
  type InternalActionOperationClass,
} from "@/lib/flow/executor-types";

export class SimulatedSendMessageExecutor implements EffectExecutor {
  readonly kind = "send_message" as const;
  readonly version = "sim-1.0.0";
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
      return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT, error: "executor_aborted" };
    }
    if (!request.message) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "message_content_required",
      };
    }

    const data = {
      type: "send_message" as const,
      simulated: true as const,
      content: request.message.content,
      buttons: request.message.buttons,
    };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      metadata: { channel: "simulated", contentType: request.message.buttons?.length ? "buttons" : "text" },
    };
  }
}
