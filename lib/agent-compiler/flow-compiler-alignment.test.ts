// DuLabs Business — Agent Compiler, Step 7.1 — tests de alineación con el
// Runtime real: turn-taking multi-turno, propose_action -> action, scheduling
// on/off, tool no autorizada, no duplicación Gate/Flow, determinismo, tenant.
// Corre el ORQUESTADOR REAL (createExecutionOrchestrator) con store en memoria
// y executors con registro — sin Supabase ni LLM.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { createExecutionOrchestrator, type NormalizedFlowEvent, type OrchestratorResult } from "@/lib/flow/flow-orchestrator";
import type { AgentCapabilities, BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import type { CompiledBusinessAgentIR } from "@/lib/agent-compiler/ir";
import { compileBusinessAgent } from "@/lib/agent-compiler/compile";
import { compileIRToFlowDefinition } from "@/lib/agent-compiler/flow-compiler";
import { createInMemoryOrchestratorStore } from "@/lib/agent-compiler/runtime/testing/in-memory-store";
import { aiProposes, aiResponds, createRecordingEffectFramework, type LegacyHandler } from "@/lib/agent-compiler/runtime/testing/recording-executors";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CONV = { phoneNumberId: "pn-1", telefonoCliente: "573001112233" };

function caps(p: Partial<AgentCapabilities>): AgentCapabilities {
  return { faq: false, sales: false, catalog: false, leadCapture: false, scheduling: false, orders: false, payments: false, humanHandoff: false, ...p };
}
function spec(o: Partial<BusinessAgentSpec>): BusinessAgentSpec {
  return {
    schemaVersion: "1.0.0",
    identity: { businessName: "Negocio X", agentName: "Ana", language: "es-CO", timezone: "America/Bogota" },
    personality: { primary: "professional", verbosity: "balanced", emojiPolicy: "limited", formality: "neutral" },
    capabilities: caps({ faq: true }),
    catalog: { source: "structured", useServices: false, useProducts: false, quoteBeforeQualification: false },
    policies: { prohibitions: [], rules: [] },
    handoff: { rules: [], defaultPauseHours: 1 },
    scheduling: { enabled: false, provider: "none", timezone: "America/Bogota", minNoticeMinutes: 60, cancellation: { allowed: true, minNoticeHours: 24 }, confirmation: { required: false, hoursBefore: 24 }, resources: [] },
    knowledge: { authority: "secondary", documents: [] },
    metadata: { specVersion: 1, status: "draft", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    ...o,
  };
}
function irDe(s: BusinessAgentSpec, tenantId = TENANT): CompiledBusinessAgentIR {
  const r = compileBusinessAgent(s, { tenantId });
  assert.ok(r.success, "compile: " + JSON.stringify(r.success ? [] : r.diagnostics));
  return r.ir;
}

type AiHandler = LegacyHandler;

function runtimeFor(s: BusinessAgentSpec, ai?: AiHandler, tenantId = TENANT) {
  const ir = irDe(s, tenantId);
  const fr = compileIRToFlowDefinition(ir, { tenantId });
  assert.ok(fr.success, "flow: " + JSON.stringify(fr.success ? [] : fr.diagnostics));
  const store = createInMemoryOrchestratorStore();
  const { flowId } = store.publishFlow({ tenantId, definition: fr.flow });
  const framework = createRecordingEffectFramework(ai ? { ai } : {});
  const orch = createExecutionOrchestrator({ store, engine: { createFlowEngineState, runFlowEngine }, effectFramework: framework.framework });
  let started = false;
  const turn = async (text: string, wamid: string): Promise<OrchestratorResult> => {
    const engineEvent: NormalizedFlowEvent["engineEvent"] = started
      ? { type: "text", text, eventId: wamid }
      : { type: "start", text, eventId: wamid };
    started = true;
    return orch.process({ tenantId, conversation: CONV, flowId, eventId: wamid, eventType: "message", payload: { text }, engineEvent, receivedAt: new Date().toISOString() });
  };
  const exec = () => store.listExecutions(tenantId)[0];
  return { store, framework, turn, exec, flow: fr.flow, ir };
}

const RETAIL = spec({ capabilities: caps({ faq: true, catalog: true, sales: true, leadCapture: true }), catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: false } });
const SALON = spec({ capabilities: caps({ faq: true, catalog: true, sales: true, scheduling: true, humanHandoff: true }), catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: false }, scheduling: { enabled: true, provider: "internal", timezone: "America/Bogota", minNoticeMinutes: 60, cancellation: { allowed: true, minNoticeHours: 12 }, confirmation: { required: true, hoursBefore: 12 }, resources: [{ kind: "specialist", label: "Especialista", required: true }] } });
// Catálogo sin QUALIFICATION (quoteBeforeQualification=true) ni leadCapture:
// welcome -> q-need -> act-faq -> ai-catalog-propose ... (llega rápido al tool).
const CATALOG_FAST = spec({ capabilities: caps({ faq: true, catalog: true }), catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: true } });

describe("Step 7.1 — turn-taking multi-turno (A, B, I)", () => {
  it("A. primer mensaje 'Hola' NO atraviesa qualification/catalog/quoting", async () => {
    const rt = runtimeFor(RETAIL);
    const r = await rt.turn("Hola", "w1");
    assert.equal(r.outcome, "processed");
    const e = rt.exec()!;
    assert.equal(e.status, "waiting_input", "espera respuesta en el primer question");
    assert.equal(e.current_node_id, "q-need");
    assert.equal(rt.framework.aiCalls().length, 0, "sin LLM en el primer turno");
    assert.equal(rt.framework.actionCalls().length, 0, "sin tools en el primer turno");
  });

  it("B. 'Quiero una cita' permanece esperando los datos faltantes (no completa)", async () => {
    const rt = runtimeFor(SALON);
    await rt.turn("Hola", "w1");
    const r = await rt.turn("Quiero una cita", "w2");
    assert.equal(r.outcome, "processed");
    const e = rt.exec()!;
    assert.equal(e.status, "waiting_input", "sigue recolectando datos, no cierra");
    assert.notEqual(e.status, "completed");
  });

  it("I. dos mensajes consecutivos continúan desde current_node_id (no reinician WELCOME)", async () => {
    const rt = runtimeFor(RETAIL);
    await rt.turn("Hola", "w1");
    const nodoTurno1 = rt.exec()!.current_node_id;
    assert.equal(nodoTurno1, "q-need");
    await rt.turn("Necesito una camisa", "w2");
    const e = rt.exec()!;
    assert.equal(rt.store.listExecutions(TENANT).length, 1, "la misma ejecución, no una nueva");
    assert.notEqual(e.current_node_id, "q-need", "avanzó desde donde quedó, no reinició");
    assert.equal(e.current_node_id, "q-identify");
  });
});

describe("Step 7.1 — propose_action -> action + tool security (C, E)", () => {
  it("C. la IA PROPONE la tool de catálogo y el runtime ejecuta la ACTION (no la IA)", async () => {
    const ai: AiHandler = (req) => (req.nodeId === "ai-catalog-propose" ? aiProposes("listar_catalogo_servicios") : aiResponds("ok"));
    const rt = runtimeFor(CATALOG_FAST, ai);
    await rt.turn("Hola", "w1");
    await rt.turn("Quiero ver servicios", "w2"); // responde q-need -> act-faq -> ai-catalog-propose -> act-catalog
    // (act-faq = recuperación de conocimiento R4: acción fija del flujo, no una tool propuesta por la IA)
    const tools = rt.framework.actionCalls().filter((c) => c.nodeId !== "act-faq");
    assert.equal(tools.length, 1, "la ACTION de catálogo se ejecutó (autorizada)");
    assert.equal(tools[0]!.nodeId, "act-catalog");
  });

  it("E. una tool FUERA de allowedTools se rechaza: la ACTION nunca se ejecuta", async () => {
    const ai: AiHandler = (req) => (req.nodeId === "ai-catalog-propose" ? aiProposes("get_contact") : aiResponds("ok"));
    const rt = runtimeFor(CATALOG_FAST, ai);
    await rt.turn("Hola", "w1");
    await rt.turn("Quiero ver servicios", "w2");
    assert.equal(rt.framework.actionCalls().filter((c) => c.nodeId !== "act-faq").length, 0, "tool no autorizada => la ACTION jamás corre");
  });
});

describe("Step 7.1 — estructura (D, F, G, H, J)", () => {
  it("D. el FlowDefinition serializado no contiene precios concretos", () => {
    const rt = runtimeFor(SALON);
    assert.ok(!/\$\s?\d|\d{1,3}(?:\.\d{3})+/.test(JSON.stringify(rt.flow)));
  });

  it("F. scheduling OFF: no hay nodos de BOOKING", () => {
    const rt = runtimeFor(RETAIL);
    assert.equal(rt.flow.nodes.some((n) => n.id === "act-book"), false);
  });

  it("G. scheduling ON con provider soportado (internal) genera BOOKING", () => {
    const rt = runtimeFor(SALON);
    assert.ok(rt.flow.nodes.some((n) => n.id === "act-book" && n.type === "action"));
  });

  it("G'. scheduling sin runtime real (IR.scheduling.available=false) => ERROR, no inventa integración", () => {
    const ir = irDe(SALON);
    const roto: CompiledBusinessAgentIR = { ...ir, scheduling: { ...ir.scheduling, available: false } };
    const r = compileIRToFlowDefinition(roto, { tenantId: TENANT });
    assert.equal(r.success, false);
    assert.ok(!r.success && r.diagnostics.some((d) => d.code === "SCHEDULING_NO_RUNTIME"));
  });

  it("H. una prohibición del Gate NO se duplica como interceptor en el Flow", () => {
    const s = spec({ capabilities: caps({ faq: true }), policies: { prohibitions: [{ id: "pm", description: "x", scope: "contextual", action: "BLOCK", response: "no", priority: 5, condition: { match: "all", rules: [{ field: "message", operator: "contains", value: "mascota" }] } }], rules: [] } });
    const rt = runtimeFor(s);
    // Ninguna condición del flow replica la prohibición del Gate (ni su campo `message`
    // ni su palabra clave): las únicas condiciones son las estructurales del propio flujo (R4).
    assert.equal(rt.flow.nodes.some((n) => n.type === "condition" && JSON.stringify(n.config).includes("mascota")), false);
    assert.equal(rt.flow.nodes.some((n) => n.type === "condition" && JSON.stringify(n.config).includes('"field":"message"')), false);
  });

  it("J. dos tenants con el mismo spec => grafos equivalentes salvo tenantId, sin estado compartido", () => {
    const TA = TENANT;
    const TB = "22222222-2222-4222-8222-222222222222";
    const fa = compileIRToFlowDefinition(irDe(RETAIL, TA), { tenantId: TA });
    const fb = compileIRToFlowDefinition(irDe(RETAIL, TB), { tenantId: TB });
    assert.ok(fa.success && fb.success);
    if (fa.success && fb.success) {
      assert.equal(fa.flow.tenantId, TA);
      assert.equal(fb.flow.tenantId, TB);
      // Grafo equivalente: mismos nodos/edges/variables (ids estables,
      // industry-agnostic). Los únicos deltas son identificadores por tenant:
      // flow.tenantId y metadata.notes (provenance = checksum de la IR, que
      // incluye el tenant por diseño de aislamiento).
      assert.deepEqual(fa.flow.nodes, fb.flow.nodes);
      assert.deepEqual(fa.flow.edges, fb.flow.edges);
      assert.deepEqual(fa.flow.variables, fb.flow.variables);
      assert.notEqual(fa.flow.tenantId, fb.flow.tenantId);
    }
  });
});
