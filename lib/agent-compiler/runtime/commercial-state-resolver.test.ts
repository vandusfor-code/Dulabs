/**
 * Bloque 11 — resolución de commercialState. Puro, sin Supabase.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commercialStateFromNodeId, resolveCommercialState } from "@/lib/agent-compiler/runtime/commercial-state-resolver";
import type { FlowOrchestratorStore } from "@/lib/flow/flow-orchestrator";
import type { FlowExecutionRow } from "@/lib/flow/flow-store-types";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CONV = { phoneNumberId: "pn1", telefonoCliente: "573000000000" };

function filaEjecucion(over: Partial<FlowExecutionRow> = {}): FlowExecutionRow {
  return {
    tenant_id: TENANT,
    id: "exec-1",
    flow_id: "flow-1",
    flow_version_id: "v1",
    execution_id: "exec-1",
    phone_number_id: CONV.phoneNumberId,
    telefono_cliente: CONV.telefonoCliente,
    status: "waiting_input",
    state_version: 1,
    current_node_id: "q-qualify",
    variables: {},
    expected_input: "text",
    pending_effect: null,
    exports: { lead: {}, custom_fields: {}, webhook_body: {} },
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    last_activity_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function storeQueDevuelve(row: FlowExecutionRow | null): Pick<FlowOrchestratorStore, "getActiveExecution"> {
  return { async getActiveExecution() { return row; } };
}

describe("commercialStateFromNodeId — tabla determinista", () => {
  it("mapea cada id conocido al estado correcto", () => {
    assert.equal(commercialStateFromNodeId("welcome"), "WELCOME");
    assert.equal(commercialStateFromNodeId("q-need"), "WELCOME");
    assert.equal(commercialStateFromNodeId("q-identify"), "IDENTIFICATION");
    assert.equal(commercialStateFromNodeId("q-qualify"), "QUALIFICATION");
    assert.equal(commercialStateFromNodeId("ai-info"), "INFORMATION");
    assert.equal(commercialStateFromNodeId("ai-catalog-propose"), "CATALOG");
    assert.equal(commercialStateFromNodeId("act-catalog"), "CATALOG");
    assert.equal(commercialStateFromNodeId("q-catalog-choose"), "CATALOG");
    assert.equal(commercialStateFromNodeId("ai-quote-propose"), "QUOTING");
    assert.equal(commercialStateFromNodeId("q-booking-when"), "BOOKING");
    assert.equal(commercialStateFromNodeId("act-book"), "BOOKING");
    assert.equal(commercialStateFromNodeId("human-book-fail"), "HUMAN_TRANSFER");
    assert.equal(commercialStateFromNodeId("st-confirmation"), "CONFIRMATION");
    assert.equal(commercialStateFromNodeId("end"), "COMPLETED");
  });

  it("id no reconocido (nodo dinámico msg-fail:N, o flow hand-built) -> undefined, nunca adivina", () => {
    assert.equal(commercialStateFromNodeId("msg-fail:0"), undefined);
    assert.equal(commercialStateFromNodeId("nodo-de-otro-flow"), undefined);
    assert.equal(commercialStateFromNodeId(null), undefined);
    assert.equal(commercialStateFromNodeId(undefined), undefined);
  });
});

describe("resolveCommercialState — desde la ejecución activa (tenant-scoped)", () => {
  it("sin ejecución activa (primer mensaje) -> undefined, reason no_active_execution", async () => {
    const r = await resolveCommercialState(storeQueDevuelve(null), TENANT, CONV);
    assert.deepEqual(r, { commercialState: undefined, reason: "no_active_execution" });
  });

  it("ejecución activa con current_node_id conocido -> commercialState correcto", async () => {
    const r = await resolveCommercialState(storeQueDevuelve(filaEjecucion({ current_node_id: "ai-catalog-propose" })), TENANT, CONV);
    assert.deepEqual(r, { commercialState: "CATALOG" });
  });

  it("current_node_id null (ejecución recién creada, sin nodo aún) -> undefined", async () => {
    const r = await resolveCommercialState(storeQueDevuelve(filaEjecucion({ current_node_id: null })), TENANT, CONV);
    assert.equal(r.commercialState, undefined);
  });

  it("defensa en profundidad: ejecución de OTRO tenant devuelta por un store bugueado -> undefined, NUNCA expone el estado", async () => {
    const filaDeOtroTenant = filaEjecucion({ tenant_id: "22222222-2222-4222-8222-222222222222", current_node_id: "q-booking-when" });
    const r = await resolveCommercialState(storeQueDevuelve(filaDeOtroTenant), TENANT, CONV);
    assert.deepEqual(r, { commercialState: undefined, reason: "tenant_mismatch" });
  });

  it("node_id no reconocido en una ejecución real -> undefined con reason explícita (nunca inventa un estado)", async () => {
    const r = await resolveCommercialState(storeQueDevuelve(filaEjecucion({ current_node_id: "msg-fail:2" })), TENANT, CONV);
    assert.deepEqual(r, { commercialState: undefined, reason: "unrecognized_node_id" });
  });
});
