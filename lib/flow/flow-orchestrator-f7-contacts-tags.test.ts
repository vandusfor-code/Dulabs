/**
 * FASE F7 (Contacts + Variables + Tags, autorizado) — tests de wiring del
 * ExecutionOrchestrator para los 3 métodos OPCIONALES nuevos de
 * FlowOrchestratorStore (resolveOrCreateContact / getConversationTagNames /
 * persistContactCustomFields, ver orchestrator-types.ts). Usa un store FAKE
 * en memoria (no Supabase real) -- prueba específicamente que
 * flow-orchestrator.ts:
 *  - siembra contact.custom_fields + tag:<nombre> en state.variables al
 *    CREAR una ejecución (test 6),
 *  - persiste state.exports.custom_fields en el contacto tras
 *    save_data(target="custom_field") (test 8),
 *  - sigue funcionando EXACTAMENTE igual (sin llamar nada nuevo) cuando el
 *    store NO implementa estos métodos -- regresión explícita para
 *    garantizar que ningún fake/store de F1-F6 se ve afectado.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { engineStateToExecutionUpdate } from "@/lib/flow/flow-store-types";
import type { FlowEffectRow, FlowExecutionRow, FlowRow, FlowVersionRow } from "@/lib/flow/flow-store-types";
import type { CreateExecutionResult, InsertEffectResult, InsertEventResult, SaveExecutionStateResult } from "@/lib/flow/flow-store";
import {
  createExecutionOrchestrator,
  ORCHESTRATOR_OUTCOMES,
  type ConversationKey,
  type FlowOrchestratorStore,
  type NormalizedFlowEvent,
} from "@/lib/flow/flow-orchestrator";
import { createTestEffectExecutorFramework } from "@/lib/flow/executor-factory";
import type { FlowDefinition } from "@/lib/flow/types";

const TENANT_ID = "tenant-f7";
const conversation: ConversationKey = { phoneNumberId: "555", telefonoCliente: "573001112244" };

function saveDataFlow(): FlowDefinition {
  return {
    name: "F7 — save_data custom_field",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "manual" } },
      {
        id: "save",
        type: "save_data",
        config: { mappings: [{ variable: "correoCliente", target: "custom_field", targetKey: "correo" }] },
      },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "save" },
      { id: "e2", source: "save", target: "end" },
    ],
    // defaultValue asegura que `correoCliente` YA esté en state.variables
    // desde el turno 1 (buildInitialVariables, flow-engine.ts) -- así
    // save_data corre determinísticamente sin depender de un nodo
    // "question" previo, que no es lo que este test quiere ejercitar.
    variables: [
      { key: "correoCliente", label: "Correo", type: "string", defaultValue: "ana@test.com" },
    ],
  };
}

function readsSeededVariableFlow(): FlowDefinition {
  return {
    name: "F7 — lee variable sembrada del contacto",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "manual" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [{ id: "e1", source: "start", target: "end" }],
    variables: [],
  };
}

function versionRow(definition: FlowDefinition, overrides: Partial<FlowVersionRow> = {}): FlowVersionRow {
  return {
    tenant_id: TENANT_ID,
    id: "version-1",
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
    tenant_id: TENANT_ID,
    id: "flow-1",
    slug: "f7-test-flow",
    name: "Test",
    description: null,
    status: "published",
    published_version_id: "version-1",
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function normalizedEvent(overrides: Partial<NormalizedFlowEvent> = {}): NormalizedFlowEvent {
  return {
    tenantId: TENANT_ID,
    conversation,
    flowId: "flow-1",
    eventId: randomUUID(),
    eventType: "start",
    payload: {},
    engineEvent: { type: "start" },
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

interface FakeContactDb {
  customFields: Record<string, unknown>;
  tagNames: string[];
}

/**
 * Store fake en memoria. `contactMethods` es opcional a propósito: cuando se
 * omite, el store se comporta EXACTAMENTE como un FlowOrchestratorStore de
 * F1-F6 que nunca implementó estos 3 métodos -- el propio orchestrator debe
 * saltearlos vía `?.()` sin romper nada.
 */
function createFakeStore(opts: {
  definition: FlowDefinition;
  contactDb?: FakeContactDb;
  persistCalls?: Array<{ customFields: Record<string, unknown> }>;
}): FlowOrchestratorStore {
  let executionRow: FlowExecutionRow | null = null;
  const effects = new Map<string, FlowEffectRow>();

  const base: FlowOrchestratorStore = {
    async getActiveExecution() {
      return executionRow;
    },
    async getExecutionById() {
      return executionRow;
    },
    async getFlow() {
      return flowRow();
    },
    async getFlowVersion() {
      return versionRow(opts.definition);
    },
    async createExecution(input) {
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
    async saveExecutionState(_tenantId, _id, state, expectedVersion) {
      executionRow = {
        ...executionRow!,
        ...engineStateToExecutionUpdate(state),
        state_version: expectedVersion + 1,
      };
      const result: SaveExecutionStateResult = { stateVersion: executionRow.state_version };
      return result;
    },
    async insertEventIdempotent(): Promise<InsertEventResult> {
      return { inserted: true, row: null };
    },
    async insertEffectIdempotent(input) {
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
      const result: InsertEffectResult = { inserted: true, row };
      return result;
    },
    async getEffectByEffectId(_tenantId, _execId, effectId) {
      return effects.get(effectId) ?? null;
    },
    async resolveEffectResult(input) {
      const existing = effects.get(input.effectId)!;
      const updated = { ...existing, status: input.status };
      effects.set(input.effectId, updated);
      return { ok: true as const, row: updated, alreadyResolved: false };
    },
    async recordNodeTransition() {},
  };

  if (!opts.contactDb) {
    return base;
  }

  const db = opts.contactDb;
  return {
    ...base,
    async resolveOrCreateContact() {
      return { customFields: db.customFields };
    },
    async getConversationTagNames() {
      return db.tagNames;
    },
    async persistContactCustomFields(_tenantId, _conversation, customFields) {
      opts.persistCalls?.push({ customFields });
      db.customFields = { ...db.customFields, ...customFields };
    },
  };
}

describe("FASE F7 — wiring del Orchestrator (contact/tags), store fake en memoria", () => {
  it("6. siembra custom_fields del contacto + tag:<nombre> en variables al CREAR la ejecución", async () => {
    const db: FakeContactDb = { customFields: { plan: "premium" }, tagNames: ["cliente_vip"] };
    const store = createFakeStore({ definition: readsSeededVariableFlow(), contactDb: db });
    const framework = createTestEffectExecutorFramework({ executors: [] });
    const orchestrator = createExecutionOrchestrator({ store, engine: await import("@/lib/flow/flow-engine"), effectFramework: framework });

    const result = await orchestrator.process(normalizedEvent());
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(result.engineError, undefined);

    const row = await store.getExecutionById(TENANT_ID, result.executionRowId!);
    assert.equal(row?.variables.plan, "premium");
    assert.equal(row?.variables["tag:cliente_vip"], "1");
  });

  it("contacto nuevo (sin custom fields, sin tags) -- no lanza, variables normales intactas (test 10)", async () => {
    const db: FakeContactDb = { customFields: {}, tagNames: [] };
    const store = createFakeStore({ definition: readsSeededVariableFlow(), contactDb: db });
    const framework = createTestEffectExecutorFramework({ executors: [] });
    const orchestrator = createExecutionOrchestrator({ store, engine: await import("@/lib/flow/flow-engine"), effectFramework: framework });

    const result = await orchestrator.process(normalizedEvent());
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    const row = await store.getExecutionById(TENANT_ID, result.executionRowId!);
    assert.equal(row?.variables.hoy !== undefined, true);
  });

  it("8. save_data(target=custom_field) dispara persistContactCustomFields con el valor real", async () => {
    const db: FakeContactDb = { customFields: {}, tagNames: [] };
    const persistCalls: Array<{ customFields: Record<string, unknown> }> = [];
    const store = createFakeStore({ definition: saveDataFlow(), contactDb: db, persistCalls });
    const framework = createTestEffectExecutorFramework({ executors: [] });
    const orchestrator = createExecutionOrchestrator({ store, engine: await import("@/lib/flow/flow-engine"), effectFramework: framework });

    const result = await orchestrator.process(normalizedEvent());
    assert.equal(result.engineError, undefined);
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);

    // El balde de exports queda poblado por el engine (comportamiento
    // preexistente, ver applySaveDataMappings)...
    const row = await store.getExecutionById(TENANT_ID, result.executionRowId!);
    assert.equal(row?.exports.custom_fields.correo, "ana@test.com");

    // ...y F7 lo persiste de verdad en el contacto real vía
    // persistContactCustomFields (antes un balde muerto).
    assert.equal(persistCalls.length, 1);
    assert.deepEqual(persistCalls[0].customFields, { correo: "ana@test.com" });
    assert.equal(db.customFields.correo, "ana@test.com");
  });

  it("regresión -- store SIN los 3 métodos opcionales sigue funcionando idéntico (ningún fake F1-F6 se rompe)", async () => {
    const store = createFakeStore({ definition: readsSeededVariableFlow() });
    const framework = createTestEffectExecutorFramework({ executors: [] });
    const orchestrator = createExecutionOrchestrator({ store, engine: await import("@/lib/flow/flow-engine"), effectFramework: framework });

    const result = await orchestrator.process(normalizedEvent());
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(result.engineError, undefined);
    const row = await store.getExecutionById(TENANT_ID, result.executionRowId!);
    assert.equal(row?.variables.hoy !== undefined, true);
    assert.equal("tag:cliente_vip" in (row?.variables ?? {}), false);
  });
});
