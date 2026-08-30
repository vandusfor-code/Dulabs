/**
 * Tests del Execution Orchestrator (Fase 4.0).
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { FLOW_ENGINE_ERROR_CODES } from "@/lib/flow/engine-types";
import type { FlowDefinition } from "@/lib/flow/types";
import { FlowExecutionConcurrencyConflictError } from "@/lib/flow/flow-store-errors";
import { engineStateToExecutionUpdate } from "@/lib/flow/flow-store-types";
import type {
  FlowEffectRow,
  FlowExecutionRow,
  FlowRow,
  FlowVersionRow,
} from "@/lib/flow/flow-store-types";
import type {
  CreateExecutionResult,
  InsertEffectResult,
  InsertEventResult,
  SaveExecutionStateResult,
} from "@/lib/flow/flow-store";
import {
  createExecutionOrchestrator,
  ORCHESTRATOR_OUTCOMES,
  type ConversationKey,
  type FlowOrchestratorStore,
  type NormalizedFlowEvent,
} from "@/lib/flow/flow-orchestrator";
import { createTestEffectExecutorFramework } from "@/lib/flow/executor-factory";
import { IntegrationResolver } from "@/lib/flow/integration-resolver";
import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutionContext,
  type EffectExecutor,
  type EffectExecutorKind,
} from "@/lib/flow/executor-types";
import { sanitizePayloadForObservability } from "@/lib/flow/sanitize-observability-payload";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function linearFlow(): FlowDefinition {
  return {
    name: "Linear",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg", type: "message", config: { text: "Hola" } },
      {
        id: "q",
        type: "question",
        config: {
          text: "Nombre?",
          variableKey: "nombre",
          required: true,
          validation: { kind: "text" },
        },
      },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "msg" },
      { id: "e2", source: "msg", target: "q" },
      { id: "e3", source: "q", target: "end" },
    ],
    variables: [{ key: "nombre", label: "Nombre", type: "string" }],
  };
}

function actionFlow(): FlowDefinition {
  return {
    name: "Action",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "manual" } },
      {
        id: "act",
        type: "action",
        config: { actionType: "crear_lead_enterprise", params: { fuente: "flow" } },
      },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "act" },
      { id: "e2", source: "act", target: "end" },
    ],
    variables: [],
  };
}

function baseExecutionRow(overrides: Partial<FlowExecutionRow> = {}): FlowExecutionRow {
  return {
    tenant_id: "tenant-1",
    id: "exec-row-1",
    flow_id: "flow-1",
    flow_version_id: "version-pinned",
    execution_id: "exec-logical-1",
    phone_number_id: "123",
    telefono_cliente: "573001112233",
    status: "waiting_input",
    current_node_id: "q",
    variables: {},
    expected_input: "text",
    pending_effect: null,
    exports: { lead: {}, custom_fields: {}, webhook_body: {} },
    metadata: {},
    state_version: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    ...overrides,
  };
}

function versionRow(
  definition: FlowDefinition,
  overrides: Partial<FlowVersionRow> = {},
): FlowVersionRow {
  return {
    tenant_id: "tenant-1",
    id: "version-pinned",
    flow_id: "flow-1",
    version_number: 1,
    definition_json: definition as unknown as Record<string, unknown>,
    published_at: new Date().toISOString(),
    retired_at: null,
    created_by: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function flowRow(overrides: Partial<FlowRow> = {}): FlowRow {
  return {
    tenant_id: "tenant-1",
    id: "flow-1",
    slug: "test-flow",
    name: "Test",
    description: null,
    status: "published",
    published_version_id: "version-published",
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const conversation: ConversationKey = {
  phoneNumberId: "123",
  telefonoCliente: "573001112233",
};

function normalizedEvent(overrides: Partial<NormalizedFlowEvent> = {}): NormalizedFlowEvent {
  return {
    tenantId: "tenant-1",
    conversation,
    flowId: "flow-1",
    eventId: "evt-1",
    eventType: "text",
    payload: { text: "Ana" },
    engineEvent: { type: "text", text: "Ana" },
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock store
// ---------------------------------------------------------------------------

interface MockStoreOptions {
  activeExecution?: FlowExecutionRow | null;
  executionRow?: FlowExecutionRow;
  flow?: FlowRow | null;
  versions?: Record<string, FlowVersionRow>;
  insertEventResult?: InsertEventResult | ((eventId: string) => Promise<InsertEventResult>);
  saveBehavior?: "ok" | "conflict_once" | "conflict_always" | "error";
  effects?: Record<string, FlowEffectRow>;
  insertEffectResult?: InsertEffectResult | ((effectId: string) => Promise<InsertEffectResult>);
  onCall?: (name: string, detail?: unknown) => void;
}

function createMockStore(opts: MockStoreOptions = {}): {
  store: FlowOrchestratorStore;
  state: {
    callOrder: string[];
    createCalls: Array<Record<string, unknown>>;
    getFlowVersionCalls: string[];
    insertEventCalls: number;
    saveCalls: number;
    eventsInserted: Set<string>;
    executionRow: FlowExecutionRow;
  };
} {
  const callOrder: string[] = [];
  const eventsInserted = new Set<string>();
  let saveAttempts = 0;
  const effects = new Map<string, FlowEffectRow>(Object.entries(opts.effects ?? {}));
  let executionRow =
    opts.executionRow ??
    opts.activeExecution ??
    baseExecutionRow({ status: "waiting_input", current_node_id: "q" });

  const metrics = {
    callOrder,
    createCalls: [] as Array<Record<string, unknown>>,
    getFlowVersionCalls: [] as string[],
    insertEventCalls: 0,
    saveCalls: 0,
    eventsInserted,
  };

  const store: FlowOrchestratorStore = {
    async getActiveExecution(_tenantId, _conv) {
      metrics.callOrder.push("getActiveExecution");
      return opts.activeExecution ?? null;
    },

    async getExecutionById(_tenantId, _id) {
      metrics.callOrder.push("getExecutionById");
      return executionRow;
    },

    async getFlow(_tenantId, _flowId) {
      metrics.callOrder.push("getFlow");
      return opts.flow ?? flowRow();
    },

    async getFlowVersion(_tenantId, versionId) {
      metrics.callOrder.push(`getFlowVersion:${versionId}`);
      metrics.getFlowVersionCalls.push(versionId);
      const versions = opts.versions ?? {
        "version-published": versionRow(linearFlow(), { id: "version-published" }),
        "version-pinned": versionRow(linearFlow(), { id: "version-pinned" }),
      };
      return versions[versionId] ?? null;
    },

    async createExecution(input) {
      metrics.callOrder.push("createExecution");
      metrics.createCalls.push(input as unknown as Record<string, unknown>);
      executionRow = {
        tenant_id: input.tenantId,
        id: randomUUID(),
        flow_id: input.flowId,
        flow_version_id: input.flowVersionId,
        execution_id: input.executionId,
        phone_number_id: input.phoneNumberId,
        telefono_cliente: input.telefonoCliente,
        state_version: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...engineStateToExecutionUpdate(input.initialState),
        last_activity_at: new Date().toISOString(),
      };
      const result: CreateExecutionResult = { created: true, row: executionRow };
      return result;
    },

    async saveExecutionState(_tenantId, _executionRowId, engineState, expectedVersion) {
      metrics.callOrder.push("saveExecutionState");
      metrics.saveCalls += 1;
      opts.onCall?.("saveExecutionState", { expectedVersion });

      if (opts.saveBehavior === "error") {
        throw new Error("store_error");
      }
      if (opts.saveBehavior === "conflict_always") {
        throw new FlowExecutionConcurrencyConflictError({
          tenantId: "tenant-1",
          executionRowId: executionRow.id,
          expectedStateVersion: expectedVersion,
        });
      }
      if (opts.saveBehavior === "conflict_once" && saveAttempts === 0) {
        saveAttempts += 1;
        executionRow = { ...executionRow, state_version: expectedVersion + 1 };
        throw new FlowExecutionConcurrencyConflictError({
          tenantId: "tenant-1",
          executionRowId: executionRow.id,
          expectedStateVersion: expectedVersion,
        });
      }

      executionRow = {
        ...executionRow,
        ...engineStateToExecutionUpdate(engineState),
        state_version: expectedVersion + 1,
      };
      const result: SaveExecutionStateResult = { stateVersion: executionRow.state_version };
      return result;
    },

    async insertEventIdempotent(input) {
      metrics.callOrder.push("insertEventIdempotent");
      metrics.insertEventCalls += 1;
      if (typeof opts.insertEventResult === "function") {
        return opts.insertEventResult(input.eventId);
      }
      if (eventsInserted.has(input.eventId)) {
        return { inserted: false, row: null };
      }
      eventsInserted.add(input.eventId);
      if (opts.insertEventResult) return opts.insertEventResult;
      return { inserted: true, row: null };
    },

    async insertEffectIdempotent(input) {
      metrics.callOrder.push("insertEffectIdempotent");
      if (typeof opts.insertEffectResult === "function") {
        return opts.insertEffectResult(input.effectId);
      }
      if (effects.has(input.effectId)) {
        return { inserted: false, row: effects.get(input.effectId)! };
      }
      if (opts.insertEffectResult) return opts.insertEffectResult;
      const row: FlowEffectRow = {
        id: effects.size + 1,
        tenant_id: input.tenantId,
        flow_execution_id: input.flowExecutionId,
        effect_id: input.effectId,
        node_id: input.nodeId,
        kind: input.kind,
        integration_id: input.integrationId ?? null,
        status: "pending",
        requested_at: new Date().toISOString(),
        resolved_at: null,
        result_payload_raw: null,
        result_payload_applied: null,
        provider: null,
        provider_model: null,
        created_at: new Date().toISOString(),
      };
      effects.set(input.effectId, row);
      return { inserted: true, row };
    },

    async getEffectByEffectId(_tenantId, _execId, effectId) {
      metrics.callOrder.push("getEffectByEffectId");
      return effects.get(effectId) ?? null;
    },

    async resolveEffectResult(input) {
      metrics.callOrder.push("resolveEffectResult");
      const existing = effects.get(input.effectId);
      if (!existing) return { ok: false as const, reason: "not_found" as const };
      if (existing.tenant_id !== input.tenantId) {
        return { ok: false as const, reason: "tenant_mismatch" as const };
      }
      if (existing.flow_execution_id !== input.flowExecutionId) {
        return { ok: false as const, reason: "effect_mismatch" as const };
      }
      if (existing.status === "succeeded" || existing.status === "failed") {
        if (existing.status === input.status) {
          return { ok: true as const, row: existing, alreadyResolved: true };
        }
        return { ok: false as const, reason: "invalid_transition" as const };
      }
      if (existing.status !== "pending") {
        return { ok: false as const, reason: "invalid_transition" as const };
      }
      const updated: FlowEffectRow = {
        ...existing,
        status: input.status,
        result_payload_raw: input.resultPayloadRaw ?? null,
        result_payload_applied: input.resultPayloadApplied ?? null,
        resolved_at: input.resolvedAt ?? new Date().toISOString(),
      };
      effects.set(input.effectId, updated);
      return { ok: true as const, row: updated, alreadyResolved: false };
    },

    async recordNodeTransition() {
      metrics.callOrder.push("recordNodeTransition");
    },
  };

  const state = {
    get callOrder() {
      return metrics.callOrder;
    },
    get createCalls() {
      return metrics.createCalls;
    },
    get getFlowVersionCalls() {
      return metrics.getFlowVersionCalls;
    },
    get insertEventCalls() {
      return metrics.insertEventCalls;
    },
    get saveCalls() {
      return metrics.saveCalls;
    },
    eventsInserted,
    get executionRow() {
      return executionRow;
    },
    set executionRow(row: FlowExecutionRow) {
      executionRow = row;
    },
  };

  return { store, state };
}

type LegacyDispatchFn = (
  req: EffectDispatchRequest,
  ctx?: EffectExecutionContext,
) => Promise<
  | Partial<EffectDispatchResult>
  | {
      result?: {
        success: boolean;
        resultPayloadRaw?: Record<string, unknown>;
        resultPayloadApplied?: Record<string, unknown>;
      };
    }
  | {
      immediateEngineEvent?: {
        type: "effect_result";
        success: boolean;
        effectId: string;
        data?: Record<string, unknown>;
      };
    }
  | Record<string, never>
>;

function wrapLegacyExecutor(
  kind: EffectExecutorKind,
  legacy: { dispatch: LegacyDispatchFn },
): EffectExecutor {
  return {
    kind,
    version: "test",
    capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
    dispatch: async (req, ctx) => {
      const raw = await legacy.dispatch(req, ctx);
      if (!raw || Object.keys(raw).length === 0) {
        return {
          success: true,
          classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
          data: {},
          appliedResult: {},
        };
      }
      if ("immediateEngineEvent" in raw && raw.immediateEngineEvent) {
        const ev = raw.immediateEngineEvent;
        return {
          success: ev.success,
          classification: ev.success
            ? EFFECT_RESULT_CLASSIFICATIONS.SUCCESS
            : EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
          data: ev.data ?? {},
          appliedResult: ev.data ?? {},
        };
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
      return raw as EffectDispatchResult;
    },
  };
}

function buildEffectFramework(
  executors: Partial<Record<EffectExecutorKind, { dispatch: LegacyDispatchFn }>> = {},
) {
  const list = Object.entries(executors).map(([kind, ex]) =>
    wrapLegacyExecutor(kind as EffectExecutorKind, ex!),
  );
  return createTestEffectExecutorFramework({
    executors: list,
    integrationResolver: new IntegrationResolver({
      getIntegrationById: async () => null,
      getIntegrationCredentials: async () => [],
    }),
  });
}

function buildOrchestrator(
  store: FlowOrchestratorStore,
  executors: Partial<Record<EffectExecutorKind, { dispatch: LegacyDispatchFn }>> = {},
  extra: { maxInternalEvents?: number; maxCasAttempts?: number } = {},
) {
  let effectCounter = 0;
  const merged: Partial<Record<EffectExecutorKind, { dispatch: LegacyDispatchFn }>> = {
    send_message: { dispatch: async () => ({}) },
    ...executors,
  };
  return createExecutionOrchestrator({
    store,
    engine: { createFlowEngineState, runFlowEngine },
    effectFramework: buildEffectFramework(merged),
    maxInternalEvents: extra.maxInternalEvents,
    maxCasAttempts: extra.maxCasAttempts,
    ids: {
      executionId: () => "exec-new-1",
      effectId: () => `fx-${++effectCounter}`,
    },
    clock: { nowIso: () => "2026-01-01T00:00:00.000Z", sleepMs: async () => {} },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Execution Orchestrator — Fase 4.0", () => {
  it("1. CREATE — inicia ejecución con versión publicada", async () => {
    const { store, state } = createMockStore({ activeExecution: null });
    const orch = buildOrchestrator(store);
    const result = await orch.process(
      normalizedEvent({
        eventId: "evt-create",
        eventType: "start",
        engineEvent: { type: "start" },
        payload: {},
      }),
    );

    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(state.createCalls.length, 1);
    assert.equal(state.createCalls[0]?.flowVersionId, "version-published");
    assert.ok(state.callOrder.includes("createExecution"));
  });

  it("2. RESUME — continúa ejecución activa existente", async () => {
    const row = baseExecutionRow();
    const { store, state } = createMockStore({ activeExecution: row });
    const orch = buildOrchestrator(store);
    const result = await orch.process(normalizedEvent());

    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(state.createCalls.length, 0);
    assert.ok(result.effects.length > 0);
  });

  it("3. CREATE race — active_execution_exists usa existing", async () => {
    const existing = baseExecutionRow({ id: "existing-row" });
    const { store, state } = createMockStore({ activeExecution: null });
    state.executionRow = existing;
    store.createExecution = async () => ({
      created: false,
      reason: "active_execution_exists",
      existing,
    });
    store.getExecutionById = async () => existing;
    const orch = buildOrchestrator(store);
    const result = await orch.process(
      normalizedEvent({ eventId: "evt-race", engineEvent: { type: "start" }, eventType: "start" }),
    );

    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(result.executionRowId, "existing-row");
  });

  it("4. duplicate event — no Engine ni effects", async () => {
    const row = baseExecutionRow();
    const { store, state } = createMockStore({
      activeExecution: row,
      insertEventResult: { inserted: false, row: null },
    });
    let engineCalls = 0;
    const orch = createExecutionOrchestrator({
      store,
      engine: {
        createFlowEngineState,
        runFlowEngine: (...args) => {
          engineCalls += 1;
          return runFlowEngine(...args);
        },
      },
      effectFramework: buildEffectFramework(),
      ids: { executionId: () => "x", effectId: () => "fx-1" },
      clock: { nowIso: () => "", sleepMs: async () => {} },
    });

    const result = await orch.process(normalizedEvent({ eventId: "dup-evt" }));
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.DUPLICATE_EVENT);
    assert.equal(engineCalls, 0);
    assert.equal(result.dispatchedEffectIds.length, 0);
    assert.equal(state.saveCalls, 0);
  });

  it("5. terminal completed — terminal_no_op", async () => {
    const row = baseExecutionRow({ status: "completed", current_node_id: "end" });
    const { store } = createMockStore({ activeExecution: row });
    const orch = buildOrchestrator(store);
    const result = await orch.process(normalizedEvent({ eventId: "evt-term" }));
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.TERMINAL_NO_OP);
  });

  it("6. terminal transferred — terminal_no_op", async () => {
    const row = baseExecutionRow({ status: "transferred" });
    const { store } = createMockStore({ activeExecution: row });
    const orch = buildOrchestrator(store);
    const result = await orch.process(normalizedEvent());
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.TERMINAL_NO_OP);
  });

  it("7. terminal failed — terminal_no_op", async () => {
    const row = baseExecutionRow({ status: "failed", current_node_id: null });
    const { store } = createMockStore({ activeExecution: row });
    const orch = buildOrchestrator(store);
    const result = await orch.process(normalizedEvent());
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.TERMINAL_NO_OP);
  });

  it("8. Engine error — no saveExecutionState", async () => {
    const brokenFlow = linearFlow();
    brokenFlow.nodes = brokenFlow.nodes.filter((n) => n.id !== "start");
    const row = baseExecutionRow({
      status: "running",
      current_node_id: null,
      expected_input: undefined,
    });
    const { store, state } = createMockStore({
      activeExecution: row,
      versions: { "version-pinned": versionRow(brokenFlow) },
    });
    const orch = buildOrchestrator(store);
    const result = await orch.process(
      normalizedEvent({ engineEvent: { type: "start" }, eventType: "start" }),
    );

    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.ok(result.engineError);
    assert.equal(state.saveCalls, 0);
  });

  it("9. CAS success — save y effects posteriores", async () => {
    const actionDef = actionFlow();
    const row = baseExecutionRow({
      status: "running",
      current_node_id: "start",
      expected_input: undefined,
    });
    const { store, state } = createMockStore({
      activeExecution: row,
      versions: { "version-pinned": versionRow(actionDef) },
    });
    let dispatched = 0;
    const orch = buildOrchestrator(store, {
      action: {
        dispatch: async () => {
          dispatched += 1;
          return {};
        },
      },
    });
    const result = await orch.process(
      normalizedEvent({ engineEvent: { type: "start" }, eventType: "start", eventId: "evt-cas-ok" }),
    );

    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(state.saveCalls, 2);
    assert.equal(dispatched, 1);
    assert.ok(result.dispatchedEffectIds.length >= 1);
  });

  it("10. CAS conflict + retry — Engine re-ejecutado, evento no re-insertado", async () => {
    const row = baseExecutionRow();
    const { store, state } = createMockStore({
      activeExecution: row,
      saveBehavior: "conflict_once",
    });
    let engineCalls = 0;
    const orch = createExecutionOrchestrator({
      store,
      engine: {
        createFlowEngineState,
        runFlowEngine: (...args) => {
          engineCalls += 1;
          return runFlowEngine(...args);
        },
      },
      effectFramework: buildEffectFramework(),
      ids: { executionId: () => "x", effectId: () => "fx-1" },
      clock: { nowIso: () => "", sleepMs: async () => {} },
    });

    const result = await orch.process(normalizedEvent({ eventId: "evt-cas-retry" }));
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(state.insertEventCalls, 1);
    assert.equal(engineCalls, 2);
    assert.equal(state.saveCalls, 2);
  });

  it("11. CAS conflict max attempts — concurrency_exhausted", async () => {
    const row = baseExecutionRow();
    const { store, state } = createMockStore({
      activeExecution: row,
      saveBehavior: "conflict_always",
    });
    let dispatched = 0;
    const orch = buildOrchestrator(
      store,
      {
        action: {
          dispatch: async () => {
            dispatched += 1;
            return {};
          },
        },
      },
      { maxCasAttempts: 3 },
    );

    const result = await orch.process(normalizedEvent({ eventId: "evt-cas-max" }));
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.CONCURRENCY_EXHAUSTED);
    assert.equal(state.saveCalls, 3);
    assert.equal(dispatched, 0);
  });

  it("12. no effect before save — dispatch solo tras save", async () => {
    const actionDef = actionFlow();
    const row = baseExecutionRow({
      status: "running",
      current_node_id: "start",
      expected_input: undefined,
    });
    const order: string[] = [];
    const { store } = createMockStore({
      activeExecution: row,
      versions: { "version-pinned": versionRow(actionDef) },
      onCall: (name) => order.push(name),
    });
    const orch = buildOrchestrator(store, {
      action: {
        dispatch: async () => {
          order.push("dispatch");
          return {};
        },
      },
    });
    await orch.process(
      normalizedEvent({ engineEvent: { type: "start" }, eventType: "start", eventId: "evt-order" }),
    );

    const saveIdx = order.indexOf("saveExecutionState");
    const dispatchIdx = order.indexOf("dispatch");
    assert.ok(saveIdx >= 0);
    assert.ok(dispatchIdx >= 0);
    assert.ok(saveIdx < dispatchIdx);
  });

  it("13. effect registration before dispatch", async () => {
    const actionDef = actionFlow();
    const row = baseExecutionRow({
      status: "running",
      current_node_id: "start",
      expected_input: undefined,
    });
    const order: string[] = [];
    const { store } = createMockStore({
      activeExecution: row,
      versions: { "version-pinned": versionRow(actionDef) },
    });
    const originalInsert = store.insertEffectIdempotent.bind(store);
    store.insertEffectIdempotent = async (input) => {
      order.push("insertEffect");
      return originalInsert(input);
    };
    const orch = buildOrchestrator(store, {
      action: {
        dispatch: async () => {
          order.push("dispatch");
          return {};
        },
      },
    });
    await orch.process(
      normalizedEvent({ engineEvent: { type: "start" }, eventType: "start", eventId: "evt-reg" }),
    );

    assert.ok(order.indexOf("insertEffect") < order.indexOf("dispatch"));
  });

  it("14. duplicate effect — insertEffectIdempotent inserted:false", async () => {
    const actionDef = actionFlow();
    const row = baseExecutionRow({
      status: "running",
      current_node_id: "start",
      expected_input: undefined,
    });
    const { store } = createMockStore({
      activeExecution: row,
      versions: { "version-pinned": versionRow(actionDef) },
      insertEffectResult: { inserted: false, row: null },
    });
    let dispatched = 0;
    const orch = buildOrchestrator(store, {
      action: {
        dispatch: async () => {
          dispatched += 1;
          return {};
        },
      },
    });
    const result = await orch.process(
      normalizedEvent({ engineEvent: { type: "start" }, eventType: "start", eventId: "evt-dup-fx" }),
    );
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(dispatched, 0);
  });

  it("15. existing succeeded effect — no dispatch, encola effect_result", async () => {
    const actionDef = actionFlow();
    const row = baseExecutionRow({
      status: "running",
      current_node_id: "start",
      expected_input: undefined,
    });

    const { store } = createMockStore({
      activeExecution: row,
      versions: { "version-pinned": versionRow(actionDef) },
      effects: {
        "fx-known": {
          id: 1,
          tenant_id: "tenant-1",
          flow_execution_id: row.id,
          effect_id: "fx-known",
          node_id: "act",
          kind: "action",
          integration_id: null,
          status: "succeeded",
          requested_at: new Date().toISOString(),
          resolved_at: new Date().toISOString(),
          result_payload_raw: { ok: true },
          result_payload_applied: { ok: true },
          provider: null,
          provider_model: null,
          created_at: new Date().toISOString(),
        },
      },
    });

    let dispatched = 0;
    const orch = createExecutionOrchestrator({
      store,
      engine: { createFlowEngineState, runFlowEngine },
      effectFramework: buildEffectFramework({
        action: {
          dispatch: async () => {
            dispatched += 1;
            return {};
          },
        },
      }),
      ids: { executionId: () => "x", effectId: () => "fx-known" },
      clock: { nowIso: () => "", sleepMs: async () => {} },
    });

    const result = await orch.process(
      normalizedEvent({
        eventId: "evt-succeeded-fx",
        engineEvent: { type: "start" },
        eventType: "start",
      }),
    );

    assert.equal(dispatched, 0);
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.ok(result.effects.some((e) => e.type === "effect_required"));
  });

  it("16. existing pending effect — no dispatch", async () => {
    const actionDef = actionFlow();
    const row = baseExecutionRow({
      status: "running",
      current_node_id: "start",
      expected_input: undefined,
    });
    const { store } = createMockStore({
      activeExecution: row,
      versions: { "version-pinned": versionRow(actionDef) },
      effects: {
        "fx-pending": {
          id: 1,
          tenant_id: "tenant-1",
          flow_execution_id: row.id,
          effect_id: "fx-pending",
          node_id: "act",
          kind: "action",
          integration_id: null,
          status: "pending",
          requested_at: new Date().toISOString(),
          resolved_at: null,
          result_payload_raw: null,
          result_payload_applied: null,
          provider: null,
          provider_model: null,
          created_at: new Date().toISOString(),
        },
      },
    });
    let dispatched = 0;
    const orch = createExecutionOrchestrator({
      store,
      engine: { createFlowEngineState, runFlowEngine },
      effectFramework: buildEffectFramework({
        action: {
          dispatch: async () => {
            dispatched += 1;
            return {};
          },
        },
      }),
      ids: { executionId: () => "x", effectId: () => "fx-pending" },
      clock: { nowIso: () => "", sleepMs: async () => {} },
    });

    const result = await orch.process(
      normalizedEvent({
        eventId: "evt-pending-fx",
        engineEvent: { type: "start" },
        eventType: "start",
      }),
    );

    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(dispatched, 0);
  });

  it("17. tenant mismatch — rejected", async () => {
    const row = baseExecutionRow({ tenant_id: "other-tenant" });
    const { store } = createMockStore({ activeExecution: row });
    const orch = buildOrchestrator(store);
    const result = await orch.process(normalizedEvent({ tenantId: "tenant-1" }));
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.REJECTED);
    assert.equal(result.rejectReason, "tenant_mismatch");
  });

  it("18. pinned flow version — usa flow_version_id de la ejecución", async () => {
    const row = baseExecutionRow({ flow_version_id: "version-pinned-old" });
    const { store, state } = createMockStore({
      activeExecution: row,
      versions: {
        "version-pinned-old": versionRow(linearFlow(), { id: "version-pinned-old" }),
        "version-published": versionRow(linearFlow(), { id: "version-published" }),
      },
    });
    const orch = buildOrchestrator(store);
    await orch.process(normalizedEvent({ eventId: "evt-pinned" }));
    assert.ok(state.getFlowVersionCalls.includes("version-pinned-old"));
    assert.ok(!state.getFlowVersionCalls.includes("version-published"));
  });

  it("19. orphan effect_result — rejected", async () => {
    const { store } = createMockStore({ activeExecution: null });
    const orch = buildOrchestrator(store);
    const result = await orch.process(
      normalizedEvent({
        engineEvent: {
          type: "effect_result",
          success: true,
          effectId: "fx-orphan",
        },
        eventType: "effect_result",
      }),
    );
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.REJECTED);
    assert.equal(result.rejectReason, "orphan_effect_result");
  });

  it("20. internal effect_result processing — executor síncrono continúa", async () => {
    const actionDef = actionFlow();
    const row = baseExecutionRow({
      status: "running",
      current_node_id: "start",
      expected_input: undefined,
    });
    const { store, state } = createMockStore({
      activeExecution: row,
      versions: { "version-pinned": versionRow(actionDef) },
    });
    let engineCalls = 0;
    const orch = createExecutionOrchestrator({
      store,
      engine: {
        createFlowEngineState,
        runFlowEngine: (...args) => {
          engineCalls += 1;
          return runFlowEngine(...args);
        },
      },
      effectFramework: buildEffectFramework({
        action: {
          dispatch: async (req) => ({
            immediateEngineEvent: {
              type: "effect_result",
              success: true,
              effectId: req.effectId,
              data: {},
            },
          }),
        },
      }),
      ids: { executionId: () => "x", effectId: () => "fx-sync-1" },
      clock: { nowIso: () => "", sleepMs: async () => {} },
    });

    const result = await orch.process(
      normalizedEvent({ engineEvent: { type: "start" }, eventType: "start", eventId: "evt-internal" }),
    );

    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.ok(engineCalls >= 2);
    assert.equal(state.saveCalls, 2);
  });

  it("21. runaway internal event protection — límite por invocación", async () => {
    const actionDef = actionFlow();
    const row = baseExecutionRow({
      status: "running",
      current_node_id: "start",
      expected_input: undefined,
    });
    const { store } = createMockStore({
      activeExecution: row,
      versions: { "version-pinned": versionRow(actionDef) },
    });
    const orch = buildOrchestrator(
      store,
      {
        action: {
          dispatch: async (req) => ({
            immediateEngineEvent: {
              type: "effect_result",
              success: true,
              effectId: req.effectId,
              data: {},
            },
          }),
        },
      },
      { maxInternalEvents: 0 },
    );

    const result = await orch.process(
      normalizedEvent({ engineEvent: { type: "start" }, eventType: "start", eventId: "evt-runaway" }),
    );

    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(result.detail, "internal_event_limit_reached");
  });

  it("22. OrchestratorResult explícito en cada path", async () => {
    const { store } = createMockStore({ activeExecution: null });
    const orch = buildOrchestrator(store);
    const paths = [
      await orch.process(
        normalizedEvent({
          engineEvent: { type: "effect_result", success: true },
          eventType: "effect_result",
        }),
      ),
      await orch.process(
        normalizedEvent({
          engineEvent: { type: "start" },
          eventType: "start",
          eventId: "explicit-create",
        }),
      ),
    ];
    for (const r of paths) {
      assert.ok(r.outcome);
      assert.ok(Array.isArray(r.effects));
      assert.ok(Array.isArray(r.dispatchedEffectIds));
    }
  });

  it("23. adversarial — dos workers mismo evento: un duplicate, Engine una vez", async () => {
    const row = baseExecutionRow();
    const inserted = new Set<string>();
    let engineCalls = 0;
    let dispatchCalls = 0;

    const store = createMockStore({ activeExecution: row }).store;
    store.insertEventIdempotent = async ({ eventId }) => {
      await new Promise((r) => setTimeout(r, 2));
      if (inserted.has(eventId)) return { inserted: false, row: null };
      inserted.add(eventId);
      return { inserted: true, row: null };
    };

    const orch = createExecutionOrchestrator({
      store,
      engine: {
        createFlowEngineState,
        runFlowEngine: (...args) => {
          engineCalls += 1;
          return runFlowEngine(...args);
        },
      },
      effectFramework: buildEffectFramework({
        action: {
          dispatch: async () => {
            dispatchCalls += 1;
            return {};
          },
        },
      }),
      ids: { executionId: () => "x", effectId: () => "fx-adv-1" },
      clock: { nowIso: () => "", sleepMs: async () => {} },
    });

    const evt = normalizedEvent({ eventId: "evt-adversarial", engineEvent: { type: "text", text: "Ana" } });
    const [r1, r2] = await Promise.all([orch.process(evt), orch.process(evt)]);

    const outcomes = [r1.outcome, r2.outcome].sort();
    assert.deepEqual(outcomes, [
      ORCHESTRATOR_OUTCOMES.DUPLICATE_EVENT,
      ORCHESTRATOR_OUTCOMES.PROCESSED,
    ]);
    assert.equal(engineCalls, 1);
    assert.equal(dispatchCalls, 0);
  });

  it("24. sanitizePayloadForObservability redacta claves sensibles", () => {
    const original = {
      text: "hola",
      api_key: "sk-live-abc1234567890",
      nested: { token: "super-secret-token-value" },
    };
    const sanitized = sanitizePayloadForObservability(original) as Record<string, unknown>;
    assert.equal(sanitized.text, "hola");
    assert.equal(sanitized.api_key, "[REDACTED]");
    assert.deepEqual(sanitized.nested, { token: "[REDACTED]" });
    assert.equal(original.api_key, "sk-live-abc1234567890");
  });

  it("25. engine error code explícito en resultado", async () => {
    const broken: FlowDefinition = {
      name: "Broken",
      nodes: [{ id: "end", type: "end", config: {} }],
      edges: [],
      variables: [],
    };
    const row = baseExecutionRow({ status: "running", current_node_id: null });
    const { store } = createMockStore({
      activeExecution: row,
      versions: { "version-pinned": versionRow(broken) },
    });
    const orch = buildOrchestrator(store);
    const result = await orch.process(
      normalizedEvent({ engineEvent: { type: "start" }, eventType: "start" }),
    );
    assert.equal(result.engineError?.code, FLOW_ENGINE_ERROR_CODES.MISSING_START_NODE);
  });
});

describe("Execution Orchestrator — effect result persistence (Fase 4.0.1)", () => {
  it("9. persiste resultado ANTES de procesar effect_result en Engine", async () => {
    const actionDef = actionFlow();
    const row = baseExecutionRow({
      status: "running",
      current_node_id: "start",
      expected_input: undefined,
    });
    const order: string[] = [];
    const { store } = createMockStore({
      activeExecution: row,
      versions: { "version-pinned": versionRow(actionDef) },
    });
    const originalResolve = store.resolveEffectResult.bind(store);
    store.resolveEffectResult = async (input) => {
      order.push("resolveEffectResult");
      return originalResolve(input);
    };

    let engineCalls = 0;
    const orch = createExecutionOrchestrator({
      store,
      engine: {
        createFlowEngineState,
        runFlowEngine: (...args) => {
          engineCalls += 1;
          order.push(`engine:${engineCalls}`);
          return runFlowEngine(...args);
        },
      },
      effectFramework: buildEffectFramework({
        action: {
          dispatch: async (req) => ({
            result: { success: true, resultPayloadRaw: { ok: true, effectId: req.effectId } },
          }),
        },
      }),
      ids: { executionId: () => "x", effectId: () => "fx-sync-order" },
      clock: { nowIso: () => "2026-01-01T00:00:00.000Z", sleepMs: async () => {} },
    });

    await orch.process(
      normalizedEvent({ engineEvent: { type: "start" }, eventType: "start", eventId: "evt-order" }),
    );

    const resolveIdx = order.indexOf("resolveEffectResult");
    const secondEngineIdx = order.indexOf("engine:2");
    assert.ok(resolveIdx >= 0);
    assert.ok(secondEngineIdx >= 0);
    assert.ok(resolveIdx < secondEngineIdx);
  });

  it("10. si persistencia falla, NO ejecuta Engine con effect_result", async () => {
    const actionDef = actionFlow();
    const row = baseExecutionRow({
      status: "running",
      current_node_id: "start",
      expected_input: undefined,
    });
    const { store } = createMockStore({
      activeExecution: row,
      versions: { "version-pinned": versionRow(actionDef) },
    });
    store.resolveEffectResult = async () => ({ ok: false as const, reason: "invalid_transition" as const });

    let engineCalls = 0;
    const orch = createExecutionOrchestrator({
      store,
      engine: {
        createFlowEngineState,
        runFlowEngine: (...args) => {
          engineCalls += 1;
          return runFlowEngine(...args);
        },
      },
      effectFramework: buildEffectFramework({
        action: {
          dispatch: async () => ({
            result: { success: true, resultPayloadRaw: { ok: true } },
          }),
        },
      }),
      ids: { executionId: () => "x", effectId: () => "fx-fail-persist" },
      clock: { nowIso: () => "", sleepMs: async () => {} },
    });

    const result = await orch.process(
      normalizedEvent({ engineEvent: { type: "start" }, eventType: "start", eventId: "evt-no-engine" }),
    );

    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(engineCalls, 1);
    assert.equal(result.dispatchedEffectIds.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Blocker #8 — carrera start/start no debe reiniciar una ejecución avanzada.
//
// Causa raíz: cuando dos eventos "start" concurrentes chocan contra el
// índice único de una-ejecución-activa-por-conversación, el segundo recibía
// createResult.existing (la fila del ganador, posiblemente ya avanzada) pero
// seguía procesándose con SU PROPIO engineEvent original ("start"), que
// flow-engine.ts resetea incondicionalmente -- pisando el progreso real.
//
// Fix (lib/flow/flow-orchestrator.ts::resolveExecution): cuando
// createExecution devuelve active_execution_exists Y el evento original era
// "start", se reescribe a {type:"text", text: <texto original>} antes de
// pasarlo al engine -- nunca se toca flow-engine.ts.
// ---------------------------------------------------------------------------
describe("Execution Orchestrator — Blocker #8: race start/start", () => {
  it("A. start concurrente: el segundo NO reinicia el Flow -- continúa desde el nodo real, usa el texto como respuesta genuina", async () => {
    const flow = linearFlow(); // start -> msg("Hola") -> q("Nombre?", waiting_input/text) -> end
    const { store } = createMockStore({ activeExecution: null, versions: { "version-pinned": versionRow(flow), "version-published": versionRow(flow) } });
    const orch = buildOrchestrator(store);

    // Primer "start" real: crea la ejecución, avanza hasta la pregunta.
    const r1 = await orch.process(
      normalizedEvent({ eventId: "evt-A", eventType: "start", engineEvent: { type: "start" } }),
    );
    assert.equal(r1.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    const helloCount1 = r1.effects.filter((e) => e.type === "send_message").length;
    assert.equal(helloCount1, 2, "el primer 'start' debe producir 'Hola' + el prompt de la pregunta ('Nombre?'), una sola vez cada uno");

    const winningRow = await store.getExecutionById("tenant-1", r1.executionRowId!);
    assert.equal(winningRow?.status, "waiting_input");
    assert.equal(winningRow?.current_node_id, "q", "debe haber quedado esperando la pregunta, no en start");

    // Simula la carrera: un SEGUNDO "start" (mismo disparador que produciría
    // el bridge si, por la misma condición de carrera, también creyó que no
    // había ejecución activa) llega DESPUÉS de que el ganador ya avanzó.
    // createExecution ahora reporta el conflicto real contra esa fila.
    store.createExecution = async () => ({
      created: false,
      reason: "active_execution_exists",
      existing: winningRow!,
    });

    const r2 = await orch.process(
      normalizedEvent({ eventId: "evt-B", eventType: "start", engineEvent: { type: "start", text: "manos" } }),
    );

    assert.equal(r2.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED, "no debe fallar -- debe tratarse como continuación válida");
    assert.equal(r2.executionRowId, r1.executionRowId, "misma fila -- nunca crea ni resetea a una ejecución nueva");

    const helloCount2 = r2.effects.filter((e) => e.type === "send_message").length;
    assert.equal(helloCount2, 0, "NO debe volver a emitir 'Hola' ni el prompt de la pregunta -- eso probaría que sí reinició desde start");

    const finalRow = await store.getExecutionById("tenant-1", r1.executionRowId!);
    assert.equal(finalRow?.status, "completed", "debe haber avanzado de verdad usando 'manos' como respuesta real a la pregunta pendiente");
    assert.equal((finalRow?.variables as Record<string, unknown>)?.nombre, "manos", "el primer mensaje/turno no se pierde: el texto del evento se aplicó al nodo real que lo esperaba");
  });

  it("B. un evento 'text' que pierde la carrera de creación NO se reescribe -- ya es seguro tal cual (solo 'start' resetea)", async () => {
    const row = baseExecutionRow({ id: "existing-row-text", status: "waiting_input", current_node_id: "q", expected_input: "text" });
    const { store } = createMockStore({ activeExecution: null });
    store.createExecution = async () => ({ created: false, reason: "active_execution_exists", existing: row });
    store.getExecutionById = async () => row;
    const orch = buildOrchestrator(store);

    const result = await orch.process(
      normalizedEvent({ eventId: "evt-text-race", eventType: "text", engineEvent: { type: "text", text: "Ana" } }),
    );

    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(result.executionRowId, "existing-row-text");
  });

  it("C. cross-tenant: la fila existente de OTRO tenant sigue rechazándose tras el fix", async () => {
    const otroTenantRow = baseExecutionRow({ id: "otro-tenant-row", tenant_id: "tenant-ajeno" });
    const { store } = createMockStore({ activeExecution: null });
    store.createExecution = async () => ({ created: false, reason: "active_execution_exists", existing: otroTenantRow });
    const orch = buildOrchestrator(store);

    const result = await orch.process(
      normalizedEvent({ eventId: "evt-cross-tenant", eventType: "start", engineEvent: { type: "start" } }),
    );

    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.REJECTED);
    assert.equal(result.rejectReason, "tenant_mismatch");
  });

  it("D. no se duplican efectos/citas: un 'start' que llega mientras la fila real está 'waiting_effect' (acción en vuelo) NUNCA vuelve a despachar la acción", async () => {
    const flow = actionFlow(); // start -> act(crear_lead_enterprise) -> end
    let dispatchCalls = 0;
    const inFlightRow = baseExecutionRow({
      id: "row-waiting-effect",
      status: "waiting_effect",
      current_node_id: "act",
      expected_input: undefined,
      pending_effect: { effectId: "fx-inflight", nodeId: "act", kind: "action" },
    });
    const { store } = createMockStore({
      activeExecution: null,
      versions: { "version-pinned": versionRow(flow), "version-published": versionRow(flow) },
    });
    store.createExecution = async () => ({
      created: false,
      reason: "active_execution_exists",
      existing: inFlightRow,
    });
    store.getExecutionById = async () => inFlightRow;

    const orch = buildOrchestrator(store, {
      action: {
        dispatch: async () => {
          dispatchCalls += 1;
          return { result: { success: true, resultPayloadRaw: { ok: true } } };
        },
      },
    });

    const result = await orch.process(
      normalizedEvent({ eventId: "evt-race-inflight", eventType: "start", engineEvent: { type: "start" } }),
    );

    // La reescritura a "text" choca contra el guard real del engine
    // (status !== "waiting_input") -> INVALID_STATE, fail-closed. Nunca se
    // vuelve a intentar la acción -- ni una cita ni un lead se duplican.
    assert.equal(dispatchCalls, 0, "la acción en vuelo NUNCA debe volver a dispatcharse por culpa de un 'start' tardío");
    assert.equal(result.engineError?.code, FLOW_ENGINE_ERROR_CODES.INVALID_STATE);
  });

  it("E. flows existentes (RESUME normal, sin carrera) siguen funcionando exactamente igual", async () => {
    const row = baseExecutionRow();
    const { store } = createMockStore({ activeExecution: row });
    const orch = buildOrchestrator(store);
    const result = await orch.process(normalizedEvent());

    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.ok(result.effects.length > 0);
  });

  it("F. CREATE sin carrera (created:true) sigue usando el evento original tal cual -- 'start' real no se toca", async () => {
    const { store, state } = createMockStore({ activeExecution: null });
    const orch = buildOrchestrator(store);
    const result = await orch.process(
      normalizedEvent({ eventId: "evt-create-normal", eventType: "start", engineEvent: { type: "start" } }),
    );

    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(state.createCalls.length, 1);
  });
});
