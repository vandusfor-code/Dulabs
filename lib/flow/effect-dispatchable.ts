/**
 * Efectos del Engine que pasan por el pipeline de idempotencia/dispatch.
 */

import type { EngineEffect } from "@/lib/flow/engine-types";
import type { EffectDispatchRequest, EffectExecutorKind } from "@/lib/flow/executor-types";
import type { AiDispatchContext } from "@/lib/flow/claude/claude-types";
import type { ConversationKey } from "@/lib/flow/orchestrator-types";

export type DispatchableEngineEffect = Extract<
  EngineEffect,
  { type: "send_message" | "effect_required" }
>;

export function isDispatchableEffect(effect: EngineEffect): effect is DispatchableEngineEffect {
  return effect.type === "send_message" || effect.type === "effect_required";
}

export function storeKindForDispatchableEffect(effect: DispatchableEngineEffect): string {
  if (effect.type === "send_message") return "send_message";
  return effect.kind;
}

export function executorKindForDispatchableEffect(
  effect: DispatchableEngineEffect,
): EffectExecutorKind {
  if (effect.type === "send_message") return "send_message";
  return effect.kind;
}

export function buildEffectDispatchRequest(input: {
  effect: DispatchableEngineEffect;
  tenantId: string;
  executionRowId: string;
  conversation?: ConversationKey;
  attempt?: number;
  flowId?: string;
  flowVersionId?: string;
  aiBudget?: AiDispatchContext["aiBudget"];
}): EffectDispatchRequest {
  const base = {
    effectId: input.effect.effectId,
    executionRowId: input.executionRowId,
    tenantId: input.tenantId,
    nodeId: input.effect.nodeId,
    attempt: input.attempt ?? 1,
    executionLogicalId: input.effect.executionId,
    conversation: input.conversation,
    payload: {},
  };

  if (input.effect.type === "send_message") {
    return {
      ...base,
      kind: "send_message",
      message: {
        content: input.effect.content,
        buttons: input.effect.buttons,
      },
    };
  }

  return {
    ...base,
    kind: input.effect.kind,
    payload: input.effect.context,
    action: input.effect.action,
    ai: input.effect.ai,
    aiContext: {
      flowId: input.flowId,
      flowVersionId: input.flowVersionId,
      aiBudget: input.aiBudget,
    },
  };
}
