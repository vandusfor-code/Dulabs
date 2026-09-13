/**
 * FASE F8.4 (WhatsApp Media, autorizado) — confirma que un effect
 * send_message con content.media fluye correctamente por
 * flow-orchestrator.ts real: se despacha, se persiste en
 * dulabs_flow_effects con mediaType, y el retry de F8.3 (clasificación por
 * tipo de error) se aplica exactamente igual a media que a texto -- sin
 * ningún camino especial en el orchestrator (la lógica de media vive
 * enteramente en SendMessageExecutor, el orchestrator es agnóstico al
 * contenido).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { createExecutionOrchestrator, ORCHESTRATOR_OUTCOMES, type ConversationKey, type FlowOrchestratorStore } from "@/lib/flow/flow-orchestrator";
import { createTestEffectExecutorFramework } from "@/lib/flow/executor-factory";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectExecutor } from "@/lib/flow/executor-types";
import type { FlowDefinition } from "@/lib/flow/types";
import type { FlowExecutionRow } from "@/lib/flow/flow-store-types";
import { engineStateToExecutionUpdate } from "@/lib/flow/flow-store-types";
import type { FlowEngineState } from "@/lib/flow/engine-types";

const TENANT = "tenant-f84-media";
const CONV: ConversationKey = { phoneNumberId: "1000000000199", telefonoCliente: "573000000002" };
const DETERMINISTIC_EFFECT_ID = "eff-msg-media-1";

// "end" sin config.message no emite un segundo send_message (ver
// flow-engine.ts "case end") -- deja EXACTAMENTE un solo effect send_message
// (el del nodo "msg"), necesario para que las aserciones de este archivo
// sean simples (a diferencia de F8.3, cuyo flow de prueba usaba "question",
// que SÍ emite su propio send_message aparte).
function flowConMedia(): FlowDefinition {
  return {
    name: "F8.4 -- mensaje con media",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg", type: "message", config: { media: { type: "image", url: "https://x/catalogo.jpg", caption: "Nuestro catálogo" } } },
      { id: "fin", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "msg" },
      { id: "e2", source: "msg", target: "fin" },
    ],
    variables: [],
  };
}

function buildInMemoryStore(flow: FlowDefinition) {
  let row: FlowExecutionRow | null = null;
  const effects = new Map<string, { status: string; applied?: Record<string, unknown>; raw?: Record<string, unknown> }>();
  const store = {
    getActiveExecution: async () => row,
    getExecutionById: async () => row,
    getFlow: async () => ({ tenant_id: TENANT, id: "flow-1", slug: "s", name: "n", status: "published", published_version_id: "fv-1" }) as never,
    getFlowVersion: async () => ({ tenant_id: TENANT, id: "fv-1", flow_id: "flow-1", version_number: 1, definition_json: flow }) as never,
    createExecution: async (input: { executionId: string; initialState: FlowEngineState }) => {
      row = {
        tenant_id: TENANT, id: "row-1", flow_id: "flow-1", flow_version_id: "fv-1", execution_id: input.executionId,
        phone_number_id: CONV.phoneNumberId, telefono_cliente: CONV.telefonoCliente, status: input.initialState.status,
        current_node_id: input.initialState.currentNodeId, variables: input.initialState.variables, expected_input: null,
        pending_effect: null, exports: input.initialState.exports, metadata: input.initialState.metadata, state_version: 1,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
      } as FlowExecutionRow;
      return { created: true, row };
    },
    saveExecutionState: async (_t: string, _id: string, state: FlowEngineState, expectedVersion: number) => {
      if (!row) throw new Error("no row");
      if (row.state_version !== expectedVersion) throw new Error("cas conflict");
      row = { ...row, ...engineStateToExecutionUpdate(state), state_version: expectedVersion + 1 };
      return { stateVersion: row.state_version };
    },
    insertEventIdempotent: async () => ({ inserted: true }),
    insertEffectIdempotent: async (input: { effectId: string; nodeId: string }) => {
      if (effects.has(input.effectId)) return { inserted: false };
      effects.set(input.effectId, { status: "pending" });
      return { inserted: true };
    },
    getEffectByEffectId: async (_t: string, _e: string, effectId: string) => {
      const fx = effects.get(effectId);
      if (!fx) return null;
      return { tenant_id: TENANT, id: 1, flow_execution_id: "row-1", effect_id: effectId, node_id: "?", kind: "send_message", status: fx.status === "succeeded" ? "succeeded" : "failed", result_payload_applied: fx.applied ?? null, result_payload_raw: fx.raw ?? null, integration_id: null, created_at: new Date().toISOString(), resolved_at: new Date().toISOString() } as never;
    },
    resolveEffectResult: async (input: { effectId: string; status: "succeeded" | "failed"; resultPayloadApplied?: Record<string, unknown>; resultPayloadRaw?: Record<string, unknown> }) => {
      const fx = effects.get(input.effectId)!;
      fx.status = input.status;
      fx.applied = input.resultPayloadApplied;
      fx.raw = input.resultPayloadRaw;
      return { ok: true, row: { tenant_id: TENANT, id: 1, flow_execution_id: "row-1", effect_id: input.effectId, node_id: "?", kind: "send_message", status: input.status === "succeeded" ? "succeeded" : "failed", result_payload_applied: input.resultPayloadApplied ?? null, result_payload_raw: input.resultPayloadRaw ?? null, integration_id: null, created_at: new Date().toISOString(), resolved_at: new Date().toISOString() } as never };
    },
    recordNodeTransition: async () => {},
  };
  return { store: store as unknown as FlowOrchestratorStore, getEffectRow: (id: string) => effects.get(id) };
}

async function runTurno(flow: FlowDefinition, store: FlowOrchestratorStore, sendMessageExecutor: EffectExecutor, clock?: { nowIso(): string; sleepMs(ms: number): Promise<void> }) {
  const orchestrator = createExecutionOrchestrator({
    store,
    engine: { createFlowEngineState, runFlowEngine },
    effectFramework: createTestEffectExecutorFramework({ executors: [sendMessageExecutor] }),
    ids: { effectId: () => DETERMINISTIC_EFFECT_ID },
    ...(clock ? { clock } : {}),
  });
  return orchestrator.process({
    tenantId: TENANT, conversation: CONV, flowId: "flow-1", eventId: "evt-media-1", eventType: "message",
    payload: { text: "hola" }, engineEvent: { type: "start", text: "hola" }, receivedAt: new Date().toISOString(),
  });
}

describe("F8.4 — media a través del flow-orchestrator.ts real", () => {
  it("1. content.media llega intacto al executor (type/url/caption)", async () => {
    let recibido: unknown;
    const executor: EffectExecutor = {
      kind: "send_message", version: "test", capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
      async dispatch(request) {
        recibido = request.message?.content.media;
        const data = { delivered: true, wamid: "w1", mediaType: request.message?.content.media?.type };
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
      },
    };
    const { store } = buildInMemoryStore(flowConMedia());
    await runTurno(flowConMedia(), store, executor);
    assert.deepEqual(recibido, { type: "image", url: "https://x/catalogo.jpg", caption: "Nuestro catálogo" });
  });

  it("2. success queda persistido en dulabs_flow_effects con mediaType", async () => {
    const executor: EffectExecutor = {
      kind: "send_message", version: "test", capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
      async dispatch() {
        const data = { delivered: true, wamid: "w-media-persist", mediaType: "image" };
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
      },
    };
    const { store, getEffectRow } = buildInMemoryStore(flowConMedia());
    const result = await runTurno(flowConMedia(), store, executor);
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    const fx = getEffectRow(DETERMINISTIC_EFFECT_ID);
    assert.equal(fx?.status, "succeeded");
    assert.equal(fx?.applied?.mediaType, "image");
  });

  it("3. F8.3 retry se aplica igual a media: 503 en el intento 1 -> reintenta y termina en éxito", async () => {
    let calls = 0;
    const executor: EffectExecutor = {
      kind: "send_message", version: "test", capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
      async dispatch() {
        calls += 1;
        if (calls === 1) {
          return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, error: "meta_send_failed", rawResult: { httpStatus: 503 } };
        }
        const data = { delivered: true, wamid: "w-media-retry", mediaType: "image" };
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
      },
    };
    const { store, getEffectRow } = buildInMemoryStore(flowConMedia());
    const clock = { nowIso: () => new Date().toISOString(), sleepMs: async () => {} };
    await runTurno(flowConMedia(), store, executor, clock);
    assert.equal(calls, 2, "el retry de F8.3 se aplica sin cambios a un effect con media");
    const fx = getEffectRow(DETERMINISTIC_EFFECT_ID);
    assert.equal(fx?.status, "succeeded");
  });

  it("4. HTTP 400 en media (link inválido) -> NON_RETRYABLE, un único intento, sin retry", async () => {
    let calls = 0;
    const executor: EffectExecutor = {
      kind: "send_message", version: "test", capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
      async dispatch() {
        calls += 1;
        return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, error: "meta_send_failed", rawResult: { httpStatus: 400, mediaType: "image" } };
      },
    };
    const { store, getEffectRow } = buildInMemoryStore(flowConMedia());
    const clock = { nowIso: () => new Date().toISOString(), sleepMs: async () => {} };
    await runTurno(flowConMedia(), store, executor, clock);
    assert.equal(calls, 1);
    const fx = getEffectRow(DETERMINISTIC_EFFECT_ID);
    assert.equal(fx?.status, "failed");
    assert.equal(fx?.raw?.httpStatus, 400);
  });
});
