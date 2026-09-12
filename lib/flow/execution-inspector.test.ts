/**
 * Tests de `buildExecutionInspectorDetail` — Execution Inspector, Fase 2
 * (autorizado). Puros: construye bundles sintéticos (filas con la MISMA
 * forma que devolvería Supabase, sin tocar la red) para poder ejercitar
 * TODA la lógica de armado/():sanitización/reconstrucción de camino sin
 * depender de credenciales reales -- mismo criterio que
 * lib/flow/simulate-flow.test.ts.
 *
 * Cobertura de la spec (§ "Testing — mínimo 20 casos"): 7, 8, 9, 10, 11,
 * 12, 13, 14, 17, 18, 19 (los de listado/auth/tenant/paginación -- 1, 2, 3,
 * 4, 5, 6, 15, 16, 20 -- se cubren a nivel API en
 * app/api/flows/[id]/executions/*.test.ts, gateados por HAS_SUPABASE igual
 * que el resto de la suite de integración de /api/flows/*).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FlowDefinition } from "@/lib/flow/types";
import type { FlowEffectRow, FlowEventRow, FlowExecutionRow, FlowNodeTransitionRow } from "@/lib/flow/flow-store-types";
import type { ExecutionDetailBundle } from "@/lib/flow/execution-inspector-store";
import { buildExecutionInspectorDetail } from "@/lib/flow/execution-inspector";

function baseExecution(overrides?: Partial<FlowExecutionRow>): FlowExecutionRow {
  return {
    tenant_id: "tenant-1",
    id: "exec-row-1",
    flow_id: "flow-1",
    flow_version_id: "version-1",
    execution_id: "engine-exec-1",
    phone_number_id: "phone-1",
    telefono_cliente: "573000000000",
    status: "waiting_input",
    current_node_id: "q",
    variables: { nombre: "Ana" },
    expected_input: "text",
    pending_effect: null,
    exports: { lead: {}, custom_fields: {}, webhook_body: {} },
    metadata: {},
    state_version: 0,
    created_at: "2026-09-11T10:00:00.000Z",
    updated_at: "2026-09-11T10:05:00.000Z",
    last_activity_at: "2026-09-11T10:05:00.000Z",
    ...overrides,
  };
}

function bundle(overrides?: Partial<ExecutionDetailBundle>): ExecutionDetailBundle {
  return {
    execution: baseExecution(),
    events: [],
    effects: [],
    transitions: [],
    ...overrides,
  };
}

function testFlow(): FlowDefinition {
  return {
    name: "inspector-test",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "save", type: "save_data", config: { mappings: [] } },
      { id: "cond", type: "condition", config: { rules: [{ field: "nombre", operator: "equals", value: "Ana" }], match: "all" } },
      { id: "msgTrue", type: "message", config: { text: "Hola Ana" } },
      { id: "q", type: "question", config: { text: "?", variableKey: "x", required: true, validation: { kind: "text" } } },
      { id: "act", type: "action", config: { actionType: "crear_lead_enterprise", params: {} } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "save" },
      { id: "e2", source: "save", target: "cond" },
      { id: "e3", source: "cond", target: "msgTrue", sourceHandle: "true" },
      { id: "e4", source: "msgTrue", target: "q" },
      { id: "e5", source: "q", target: "act" },
      { id: "e6", source: "act", target: "end", sourceHandle: "success" },
    ],
    variables: [],
  };
}

describe("Execution Inspector — 7. ejecución sin eventos", () => {
  it("arma el detalle igual, con arrays vacíos, sin lanzar", () => {
    const detail = buildExecutionInspectorDetail(bundle(), { flow: null, flowVersionNumber: null });
    assert.deepEqual(detail.events, []);
    assert.equal(detail.execution.eventsCount, 0);
    assert.deepEqual(detail.timeline, []);
  });
});

describe("Execution Inspector — 8. ejecución con múltiples eventos", () => {
  it("los ordena cronológicamente en el timeline con títulos legibles de los tipos REALES", () => {
    const events: FlowEventRow[] = [
      { id: 1, tenant_id: "t", flow_execution_id: "e", event_id: "ev1", event_type: "conversation_started", raw_payload: {}, processed_at: null, created_at: "2026-09-11T10:00:00.000Z" },
      { id: 2, tenant_id: "t", flow_execution_id: "e", event_id: "ev2", event_type: "message", raw_payload: { text: "hola" }, processed_at: "2026-09-11T10:00:01.000Z", created_at: "2026-09-11T10:00:02.000Z" },
    ];
    const detail = buildExecutionInspectorDetail(bundle({ events }), { flow: null, flowVersionNumber: null });
    assert.equal(detail.execution.eventsCount, 2);
    assert.equal(detail.timeline[0]!.title, "Conversación iniciada");
    assert.equal(detail.timeline[1]!.title, "Mensaje entrante del cliente");
    assert.ok(new Date(detail.timeline[0]!.timestamp).getTime() <= new Date(detail.timeline[1]!.timestamp).getTime());
  });

  it("un event_type NUNCA visto antes no inventa una etiqueta rara -- usa un fallback genérico legible", () => {
    const events: FlowEventRow[] = [
      { id: 1, tenant_id: "t", flow_execution_id: "e", event_id: "ev1", event_type: "un_tipo_futuro", raw_payload: {}, processed_at: null, created_at: "2026-09-11T10:00:00.000Z" },
    ];
    const detail = buildExecutionInspectorDetail(bundle({ events }), { flow: null, flowVersionNumber: null });
    assert.equal(detail.timeline[0]!.title, "Evento: un_tipo_futuro");
  });
});

describe("Execution Inspector — 9. múltiples transiciones + camino sobre el canvas", () => {
  it("reconstruye los nodos silenciosos intermedios (save_data/condition) y arma nodeIds/edgeIds para resaltar en FlowCanvas", () => {
    const flow = testFlow();
    // Realista: "q" (question) y "act" (action) SIEMPRE pausan (waiting_input/
    // waiting_effect) y el orchestrator registra una fila de transición POR
    // CADA pausa/resume (ver flow-orchestrator.ts:590-600) -- nunca colapsa
    // un nodo que pausa dentro de un tramo silencioso. Camino real completo:
    // start -> save -> cond -> msgTrue -> q  (pausa) -> act (pausa) -> end.
    const transitions: FlowNodeTransitionRow[] = [
      { id: 1, tenant_id: "t", flow_execution_id: "e", event_id: "ev1", from_node_id: "start", to_node_id: "q", source_handle: null, occurred_at: "2026-09-11T10:00:00.000Z" },
      { id: 2, tenant_id: "t", flow_execution_id: "e", event_id: "ev2", from_node_id: "q", to_node_id: "act", source_handle: null, occurred_at: "2026-09-11T10:01:00.000Z" },
      { id: 3, tenant_id: "t", flow_execution_id: "e", event_id: "ev3", from_node_id: "act", to_node_id: "end", source_handle: "success", occurred_at: "2026-09-11T10:01:02.000Z" },
    ];
    const detail = buildExecutionInspectorDetail(bundle({ transitions, execution: baseExecution({ status: "completed", current_node_id: "end" }) }), {
      flow,
      flowVersionNumber: 1,
    });
    assert.equal(detail.execution.transitionsCount, 3);
    assert.ok(detail.path.nodeIds.includes("save"), "debe incluir el nodo save_data intermedio, deducido por topología");
    assert.ok(detail.path.nodeIds.includes("cond"), "debe incluir el nodo condition intermedio");
    assert.ok(detail.path.nodeIds.includes("act"), "debe incluir el nodo action observado directamente");
    assert.ok(detail.path.edgeIds.includes("e3"), "debe incluir el edge de la rama TRUE realmente tomada");
    assert.ok(detail.path.edgeIds.includes("e6"), "debe incluir el edge act->end (source_handle success) realmente tomado");
    assert.equal(detail.path.hadAmbiguousSegment, false);
    assert.ok(detail.nodeSteps.some((s) => s.nodeId === "cond" && s.inferred === true));
    assert.ok(detail.nodeSteps.some((s) => s.nodeId === "act" && s.inferred === false));
  });

  it("transiciones sin FlowDefinition disponible -- degrada con gracia (solo nodos observados, sin reconstrucción, nunca lanza)", () => {
    const transitions: FlowNodeTransitionRow[] = [
      { id: 1, tenant_id: "t", flow_execution_id: "e", event_id: "ev1", from_node_id: "start", to_node_id: "end", source_handle: null, occurred_at: "2026-09-11T10:00:00.000Z" },
    ];
    const detail = buildExecutionInspectorDetail(bundle({ transitions }), { flow: null, flowVersionNumber: null });
    assert.deepEqual(detail.path.nodeIds.sort(), ["end", "start"]);
    assert.deepEqual(detail.path.edgeIds, []);
  });
});

describe("Execution Inspector — 10. con efectos", () => {
  it("calcula duración (resolved_at - requested_at) y trae el resultado sanitizado", () => {
    const effects: FlowEffectRow[] = [
      {
        id: 1,
        tenant_id: "t",
        flow_execution_id: "e",
        effect_id: "eff1",
        node_id: "act",
        kind: "action",
        integration_id: null,
        status: "succeeded",
        requested_at: "2026-09-11T10:00:00.000Z",
        resolved_at: "2026-09-11T10:00:02.500Z",
        result_payload_raw: { ok: true },
        result_payload_applied: { leadId: "abc" },
        provider: null,
        provider_model: null,
        created_at: "2026-09-11T10:00:00.000Z",
      },
    ];
    const detail = buildExecutionInspectorDetail(bundle({ effects }), { flow: testFlow(), flowVersionNumber: 1 });
    assert.equal(detail.execution.effectsCount, 1);
    assert.equal(detail.effects[0]!.durationMs, 2500);
    assert.deepEqual(detail.effects[0]!.result, { leadId: "abc" });
    assert.equal(detail.effects[0]!.nodeLabel.includes("act"), true);
    assert.ok(detail.timeline.some((t) => t.kind === "effect"));
  });
});

describe("Execution Inspector — 11. con error / failed", () => {
  it("execution failed + un efecto failed correlacionado -- muestra la pista real disponible, NUNCA inventa un código que el runtime no persiste", () => {
    const effects: FlowEffectRow[] = [
      {
        id: 1,
        tenant_id: "t",
        flow_execution_id: "e",
        effect_id: "eff1",
        node_id: "act",
        kind: "action",
        integration_id: null,
        status: "failed",
        requested_at: "2026-09-11T10:00:00.000Z",
        resolved_at: "2026-09-11T10:00:01.000Z",
        result_payload_raw: { error: "algo_fallo" },
        result_payload_applied: null,
        provider: null,
        provider_model: null,
        created_at: "2026-09-11T10:00:00.000Z",
      },
    ];
    const execution = baseExecution({ status: "failed", current_node_id: "act" });
    const detail = buildExecutionInspectorDetail(bundle({ execution, effects }), { flow: testFlow(), flowVersionNumber: 1 });
    assert.ok(detail.error);
    assert.equal(detail.error!.nodeId, "act");
    assert.match(detail.error!.code, /^EFFECT_FAILED:/);
    assert.match(detail.error!.technical, /action/);
    assert.equal(detail.error!.friendly, "Hubo un problema técnico continuando esta conversación.");
  });

  it("execution failed SIN ningún efecto failed correlacionado -- es honesto: dice que el runtime no persiste el detalle exacto, no inventa uno", () => {
    const execution = baseExecution({ status: "failed", current_node_id: "q" });
    const detail = buildExecutionInspectorDetail(bundle({ execution }), { flow: testFlow(), flowVersionNumber: 1 });
    assert.ok(detail.error);
    assert.equal(detail.error!.code, "NOT_PERSISTED");
    assert.match(detail.error!.technical, /no persiste/);
  });

  it("execution NO failed -- error es null", () => {
    const detail = buildExecutionInspectorDetail(bundle({ execution: baseExecution({ status: "completed" }) }), { flow: null, flowVersionNumber: null });
    assert.equal(detail.error, null);
  });
});

describe("Execution Inspector — 12/13/14. estados reales (completed/waiting_input/transferred)", () => {
  for (const status of ["completed", "waiting_input", "transferred"] as const) {
    it(`status='${status}' se refleja tal cual -- nunca se inventa una taxonomía nueva`, () => {
      const detail = buildExecutionInspectorDetail(bundle({ execution: baseExecution({ status }) }), { flow: null, flowVersionNumber: null });
      assert.equal(detail.execution.status, status);
    });
  }
});

describe("Execution Inspector — 17/18/19. NUNCA expone secretos/tokens/credenciales", () => {
  const SENSITIVE_MARKER = "sk-live-supersecret-deberia-jamas-aparecer-1234567890";

  it("variables con forma de secreto quedan redactadas", () => {
    const execution = baseExecution({ variables: { apiKey: SENSITIVE_MARKER, nombre: "Ana" } });
    const detail = buildExecutionInspectorDetail(bundle({ execution }), { flow: null, flowVersionNumber: null });
    const serialized = JSON.stringify(detail);
    assert.ok(!serialized.includes(SENSITIVE_MARKER), "el valor secreto NUNCA debe aparecer en la respuesta serializada");
    assert.equal(detail.variables.nombre, "Ana", "un valor normal no relacionado sí debe pasar intacto");
  });

  it("raw_payload de un evento con forma de secreto queda redactado", () => {
    const events: FlowEventRow[] = [
      { id: 1, tenant_id: "t", flow_execution_id: "e", event_id: "ev1", event_type: "message", raw_payload: { token: SENSITIVE_MARKER }, processed_at: null, created_at: "2026-09-11T10:00:00.000Z" },
    ];
    const detail = buildExecutionInspectorDetail(bundle({ events }), { flow: null, flowVersionNumber: null });
    assert.ok(!JSON.stringify(detail).includes(SENSITIVE_MARKER));
  });

  it("result_payload de un efecto con forma de secreto queda redactado", () => {
    const effects: FlowEffectRow[] = [
      {
        id: 1,
        tenant_id: "t",
        flow_execution_id: "e",
        effect_id: "eff1",
        node_id: "act",
        kind: "action",
        integration_id: null,
        status: "succeeded",
        requested_at: "2026-09-11T10:00:00.000Z",
        resolved_at: "2026-09-11T10:00:01.000Z",
        result_payload_raw: { access_token: SENSITIVE_MARKER },
        result_payload_applied: { access_token: SENSITIVE_MARKER },
        provider: null,
        provider_model: null,
        created_at: "2026-09-11T10:00:00.000Z",
      },
    ];
    const detail = buildExecutionInspectorDetail(bundle({ effects }), { flow: null, flowVersionNumber: null });
    assert.ok(!JSON.stringify(detail).includes(SENSITIVE_MARKER));
  });

  it("nunca CONSULTA dulabs_flow_credentials/dulabs_flow_integrations ni importa el integration-resolver (los comentarios que MENCIONAN esas tablas para explicar que no se tocan sí son válidos)", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..", "..");
    for (const relPath of ["lib/flow/execution-inspector.ts", "lib/flow/execution-inspector-store.ts"]) {
      const source = readFileSync(path.resolve(repoRoot, relPath), "utf8");
      assert.ok(!/from\(\s*["']dulabs_flow_credentials["']/.test(source), `${relPath} no debe consultar dulabs_flow_credentials`);
      assert.ok(!/from\(\s*["']dulabs_flow_integrations["']/.test(source), `${relPath} no debe consultar dulabs_flow_integrations`);
      assert.ok(!source.includes("getIntegrationCredentials"), `${relPath} no debe llamar getIntegrationCredentials`);
      assert.ok(!/from ["']@\/lib\/flow\/integration-resolver["']/.test(source), `${relPath} no debe importar integration-resolver`);
    }
  });
});
