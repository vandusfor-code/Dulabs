// DuLabs Business — Agent Compiler, Step 7 — executors de efectos con registro
// (SOLO tests). Envuelven el framework REAL (createTestEffectExecutorFramework)
// para poder afirmar si el LLM (kind "ai") o una tool (kind "action") fueron
// invocados o no — evidencia directa de "guardrail MATCH => LLM NOT_CALLED".

import { IntegrationResolver } from "@/lib/flow/integration-resolver";
import { createTestEffectExecutorFramework } from "@/lib/flow/executor-factory";
import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutor,
  type EffectExecutorKind,
} from "@/lib/flow/executor-types";

export type LegacyReturn =
  | { result: { success: boolean; resultPayloadApplied?: Record<string, unknown>; resultPayloadRaw?: Record<string, unknown> } }
  | Record<string, never>;

export type LegacyHandler = (req: EffectDispatchRequest) => LegacyReturn | Promise<LegacyReturn>;

export interface RecordedCall {
  kind: EffectExecutorKind;
  nodeId: string;
  request: EffectDispatchRequest;
}

export interface RecordingFramework {
  framework: ReturnType<typeof createTestEffectExecutorFramework>;
  calls: RecordedCall[];
  aiCalls: () => RecordedCall[];
  actionCalls: () => RecordedCall[];
  sendMessageCalls: () => RecordedCall[];
}

function wrap(kind: EffectExecutorKind, calls: RecordedCall[], handler: LegacyHandler): EffectExecutor {
  return {
    kind,
    version: "test",
    capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
    dispatch: async (req: EffectDispatchRequest): Promise<EffectDispatchResult> => {
      calls.push({ kind, nodeId: req.nodeId, request: req });
      const raw = await handler(req);
      if (!raw || Object.keys(raw).length === 0) {
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data: {}, appliedResult: {} };
      }
      if ("result" in raw && raw.result) {
        return {
          success: raw.result.success,
          classification: raw.result.success
            ? EFFECT_RESULT_CLASSIFICATIONS.SUCCESS
            : EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
          data: raw.result.resultPayloadApplied ?? {},
          rawResult: raw.result.resultPayloadRaw,
          appliedResult: raw.result.resultPayloadApplied ?? raw.result.resultPayloadRaw ?? {},
        };
      }
      return raw as unknown as EffectDispatchResult;
    },
  };
}

export function createRecordingEffectFramework(handlers: {
  ai?: LegacyHandler;
  action?: LegacyHandler;
  send_message?: LegacyHandler;
} = {}): RecordingFramework {
  const calls: RecordedCall[] = [];
  const aiHandler: LegacyHandler = handlers.ai ?? (() => ({ result: { success: true, resultPayloadApplied: {} } }));
  const actionHandler: LegacyHandler = handlers.action ?? (() => ({ result: { success: true, resultPayloadApplied: {} } }));
  const sendHandler: LegacyHandler = handlers.send_message ?? (() => ({}));

  const framework = createTestEffectExecutorFramework({
    executors: [
      wrap("ai", calls, aiHandler),
      wrap("action", calls, actionHandler),
      wrap("send_message", calls, sendHandler),
    ],
    integrationResolver: new IntegrationResolver({
      getIntegrationById: async () => null,
      getIntegrationCredentials: async () => [],
    }),
  });

  return {
    framework,
    calls,
    aiCalls: () => calls.filter((c) => c.kind === "ai"),
    actionCalls: () => calls.filter((c) => c.kind === "action"),
    sendMessageCalls: () => calls.filter((c) => c.kind === "send_message"),
  };
}

/** Propuesta de tool desde un nodo AI propose_action (para tests de autorización). */
export function aiProposes(actionType: string, args: Record<string, unknown> = {}): LegacyReturn {
  return { result: { success: true, resultPayloadApplied: { actionProposal: { actionType, arguments: args } } } };
}

/** Respuesta de texto desde un nodo AI respond. */
export function aiResponds(text: string): LegacyReturn {
  return { result: { success: true, resultPayloadApplied: { responseText: text } } };
}

/** Clasificación desde un nodo AI classify. */
export function aiClassifies(classification: string): LegacyReturn {
  return { result: { success: true, resultPayloadApplied: { classification } } };
}
