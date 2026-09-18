// DuLabs Business — Agent Compiler, Bloque G — E2E de CADENA COMPLETA (offline).
//
// Prueba la cadena real de extremo a extremo, con infraestructura EN MEMORIA
// (sin Supabase, sin LLM, sin red), pero usando los componentes REALES:
//
//   BusinessAgentSpec
//     -> compileAndCreateDraftVersion (compiler real: Spec->IR->FlowDefinition+GateRules)
//     -> publishBusinessAgentVersion (Registry real, fail-closed si no validado)
//     -> createSupabaseBusinessAgentResolver (resolver real, checksum + tenant)
//     -> atenderMensajeConBusinessAgent (boundary real: blacklist + gate + orquestador)
//        -> Business Guardrail Gate (real)
//        -> createExecutionOrchestrator (orquestador real) + Flow Engine real
//        -> executors con registro (prueban propose_action -> action)
//
// Lo que NO cubre (por diseño offline): el INSERT real de citas
// (dulabs_citas_especialista), la disponibilidad real (Nylas), el RPC de
// publish con row-lock, y el envío real por Meta -- eso es INTEGRATED /
// PRODUCTION VERIFIED, no OFFLINE. Aquí se prueba que el GRAFO cablea esas
// acciones y que la autorización/estado/gate son correctos.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { createExecutionOrchestrator, type NormalizedFlowEvent } from "@/lib/flow/flow-orchestrator";
import type { ClienteConfig } from "@/lib/supabase";
import type { AgentCapabilities, BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { compileAndCreateDraftVersion, publishBusinessAgentVersion } from "@/lib/agent-compiler/registry/registry";
import { createInMemoryBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/testing/in-memory-registry-store";
import { createSupabaseBusinessAgentResolver } from "@/lib/agent-compiler/runtime/production/business-agent-resolver";
import { atenderMensajeConBusinessAgent } from "@/lib/agent-compiler/runtime/production/atender-business-agent";
import { createInMemoryOrchestratorStore } from "@/lib/agent-compiler/runtime/testing/in-memory-store";
import { aiProposes, aiResponds, createRecordingEffectFramework, type LegacyHandler } from "@/lib/agent-compiler/runtime/testing/recording-executors";
import type { SemanticClassifier } from "@/lib/agent-compiler/runtime/guardrail-gate";
import { retailSpec, salonSpec, PROHIBICION_NO_EFECTIVO } from "@/lib/agent-compiler/runtime/fixtures";

const TENANT = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const CONV = "573001112233";

/** Clasificador stub: nunca invocado por specs deterministas; presente por seguridad (sin red). */
const stubClassifier: SemanticClassifier = async () => null;

function caps(p: Partial<AgentCapabilities>): AgentCapabilities {
  return { faq: false, sales: false, catalog: false, leadCapture: false, scheduling: false, orders: false, payments: false, humanHandoff: false, ...p };
}

function cliente(flowId: string, over: Partial<ClienteConfig> = {}): ClienteConfig {
  return {
    id: "cliente-1", id_tenant: TENANT, nombre_negocio: "Negocio X", whatsapp_business_account_id: "waba1",
    phone_number_id: "pn1", telefono_negocio: "573000000000", prompt_sistema: null, api_key_ia: null,
    meta_permanent_token: null, estado_pausa: false, pausado_hasta: null, plan: null, mensajes_usados_mes: 0,
    mes_actual: "2026-09", base_conocimiento: null, base_conocimiento_nombre_archivo: null, base_conocimiento_actualizado_at: null,
    calidad: null, limite_mensajeria: null, estado_verificacion: null, estado_nombre_visible: null, ultima_sincronizacion_meta: null,
    nombre_agente: null, ia_pausada: false, ia_restringida_a: null, ia_numeros_bloqueados: null, forward_to_dumo: false,
    captura_leads: false, agente_id: null, marketplace_activacion_id: null, flow_activo: true, flow_id: flowId,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", ...over,
  };
}

/** Compila+publica un spec al Registry (in-memory) y publica el flow al store del orquestador. */
async function publishAgent(spec: BusinessAgentSpec, tenantId = TENANT) {
  const registryStore = createInMemoryBusinessAgentRegistryStore();
  const draft = await compileAndCreateDraftVersion({ store: registryStore }, { tenantId, spec });
  assert.ok(draft.ok, `draft: ${JSON.stringify(draft)}`);
  if (!draft.ok) throw new Error("unreachable");
  assert.equal(draft.validationStatus, "validated", `validación: ${JSON.stringify(draft.diagnostics)}`);
  const pub = await publishBusinessAgentVersion({ store: registryStore }, { tenantId, flowId: draft.flowId, flowVersionId: draft.flowVersionId });
  assert.ok(pub.ok, `publish: ${JSON.stringify(pub)}`);

  const version = await registryStore.resolvePublishedVersion(tenantId, draft.flowId);
  assert.ok(version, "versión publicada resoluble");

  const orchStore = createInMemoryOrchestratorStore();
  orchStore.publishFlow({ tenantId, flowId: draft.flowId, definition: version!.flow });

  return { registryStore, orchStore, flowId: draft.flowId, flowVersionId: draft.flowVersionId, version: version! };
}

interface Harness {
  orchStore: ReturnType<typeof createInMemoryOrchestratorStore>;
  framework: ReturnType<typeof createRecordingEffectFramework>;
  turn: (text: string, wamid: string) => ReturnType<typeof atenderMensajeConBusinessAgent>;
  gate: { sent: number; transfers: number };
  orchestratorCalls: () => number;
}

function harnessFor(setup: Awaited<ReturnType<typeof publishAgent>>, ai?: LegacyHandler, clienteOver: Partial<ClienteConfig> = {}): Harness {
  const framework = createRecordingEffectFramework(ai ? { ai } : {});
  const orchestrator = createExecutionOrchestrator({ store: setup.orchStore, engine: { createFlowEngineState, runFlowEngine }, effectFramework: framework.framework });
  let calls = 0;
  const spyOrch = { process: (e: NormalizedFlowEvent) => { calls += 1; return orchestrator.process(e); } };
  const gate = { sent: 0, transfers: 0 };
  const seen = new Set<string>();
  const c = cliente(setup.flowId, clienteOver);
  return {
    orchStore: setup.orchStore,
    framework,
    gate,
    orchestratorCalls: () => calls,
    turn: (text, wamid) =>
      atenderMensajeConBusinessAgent({
        supabase: {} as never,
        cliente: c,
        telefonoCliente: CONV,
        texto: text,
        wamid,
        resolver: createSupabaseBusinessAgentResolver({ store: setup.registryStore }),
        classifier: stubClassifier,
        overrides: {
          orchestrator: spyOrch,
          store: setup.orchStore,
          gateSink: {
            async sendMessage() { gate.sent += 1; },
            async transferHuman() { gate.transfers += 1; },
          },
          idempotency: { async claim(_t, w) { return seen.has(w) ? false : (seen.add(w), true); } },
        },
      }),
  };
}

// Catálogo rápido: sin leadCapture ni QUALIFICATION (quoteBeforeQualification),
// para alcanzar el nodo de tool de catálogo en el 2º turno.
const CATALOG_FAST: BusinessAgentSpec = { ...retailSpec(), capabilities: caps({ faq: true, catalog: true }), catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: true }, policies: { prohibitions: [PROHIBICION_NO_EFECTIVO], rules: [] }, handoff: { rules: [], defaultPauseHours: 24 } };

describe("Bloque G — E2E cadena completa (Spec -> compile -> publish -> resolve -> runtime)", () => {
  it("1-6. Spec -> compile -> draft validado -> publish -> resolve inequívoco", async () => {
    const s = await publishAgent(retailSpec());
    assert.ok(s.flowId && s.flowVersionId);
    assert.equal(s.version.validationStatus, "validated");
    assert.ok(s.version.gateRules.length > 0, "el agente publicado conserva sus gate rules");
    // El resolver real resuelve el mismo artefacto, tenant-scoped + checksum ok.
    const resolver = createSupabaseBusinessAgentResolver({ store: s.registryStore });
    const res = await resolver.resolve({} as never, cliente(s.flowId));
    assert.equal(res.kind, "business_agent");
  });

  it("11+13. primer mensaje corre el runtime real y queda en waiting_input (turn-taking), sin completar", async () => {
    const s = await publishAgent(retailSpec());
    const h = harnessFor(s);
    const r = await h.turn("Hola", "w1");
    assert.equal(r.handled, true);
    assert.equal(r.outcome, "flow");
    const exec = h.orchStore.listExecutions(TENANT)[0]!;
    assert.equal(exec.status, "waiting_input", "espera respuesta (multi-turno real)");
    assert.equal(exec.current_node_id, "q-need");
    assert.ok(h.framework.sendMessageCalls().length >= 1, "envió welcome + primera pregunta");
  });

  it("8+11(gate). guardrail PRE-LLM sobre el agente PUBLICADO: 'efectivo' => bloqueo, 0 LLM, 0 orquestador", async () => {
    const s = await publishAgent(retailSpec());
    const h = harnessFor(s);
    const r = await h.turn("quiero pagar en efectivo", "w-block");
    assert.equal(r.outcome, "guardrail_blocked");
    assert.equal(h.orchestratorCalls(), 0, "el Gate cortó ANTES del orquestador");
    assert.equal(h.framework.aiCalls().length, 0);
    assert.equal(h.gate.sent, 1, "DuLabs envió la respuesta fija de la política");
  });

  it("14+18. tool AUTORIZADA end-to-end: la IA propone la tool de catálogo y la ACTION se ejecuta", async () => {
    const s = await publishAgent(CATALOG_FAST);
    const ai: LegacyHandler = (req) => (req.nodeId === "ai-catalog-propose" ? aiProposes("listar_catalogo_servicios") : aiResponds("ok"));
    const h = harnessFor(s, ai);
    await h.turn("Hola", "w1");
    await h.turn("quiero ver servicios", "w2"); // q-need -> ai-info -> ai-catalog-propose -> act-catalog
    assert.equal(h.framework.actionCalls().some((c) => c.nodeId === "act-catalog"), true, "la ACTION de catálogo se ejecutó (autorizada)");
  });

  it("13(reject). tool NO autorizada sobre el agente publicado: la ACTION nunca se ejecuta", async () => {
    const s = await publishAgent(CATALOG_FAST);
    const ai: LegacyHandler = (req) => (req.nodeId === "ai-catalog-propose" ? aiProposes("get_contact") : aiResponds("ok"));
    const h = harnessFor(s, ai);
    await h.turn("Hola", "w1");
    await h.turn("quiero ver servicios", "w2");
    assert.equal(h.framework.actionCalls().length, 0, "tool fuera de allowedTools => rechazada, ACTION jamás corre");
  });

  it("20-22. scheduling: el agente publicado (provider internal) cablea BOOKING con acción crítica + rama failure->human", async () => {
    const s = await publishAgent(salonSpec());
    const ids = new Set(s.version.flow.nodes.map((n) => n.id));
    assert.ok(ids.has("act-book"), "hay nodo de creación de cita");
    const actBook = s.version.flow.nodes.find((n) => n.id === "act-book")!;
    assert.equal(actBook.type, "action");
    // La disponibilidad/creación reales viven en el backend determinista
    // (internal-action-executor -> dulabs_citas_especialista): INTEGRATED /
    // PRODUCTION VERIFIED, fuera de este harness offline. Aquí se prueba que el
    // grafo publicado exige la acción crítica con su rama de fallo a humano.
    assert.ok(s.version.flow.edges.some((e) => e.source === "act-book" && e.target === "human-book-fail" && e.sourceHandle === "failure"));
  });

  it("9. idempotencia: mismo wamid dos veces => segunda vez duplicate (una sola ejecución)", async () => {
    const s = await publishAgent(retailSpec());
    const h = harnessFor(s);
    const r1 = await h.turn("Hola", "w-dup");
    const r2 = await h.turn("Hola", "w-dup");
    assert.equal(r1.outcome, "flow");
    assert.equal(r2.outcome, "duplicate");
  });

  it("7. blacklist: número bloqueado => blocked_number, 0 resolver/orquestador/gate", async () => {
    const s = await publishAgent(retailSpec());
    const h = harnessFor(s, undefined, { ia_numeros_bloqueados: `${CONV},573009998888` });
    const r = await h.turn("Hola", "w-black");
    assert.equal(r.outcome, "blocked_number");
    assert.equal(h.orchestratorCalls(), 0);
    assert.equal(h.gate.sent, 0);
  });

  it("17. tenant isolation: un cliente de OTRO tenant no resuelve el agente del tenant A (=> Legacy)", async () => {
    const s = await publishAgent(retailSpec(), TENANT); // publicado bajo TENANT
    const resolver = createSupabaseBusinessAgentResolver({ store: s.registryStore });
    // Cliente de TENANT_B apuntando (maliciosa/erróneamente) al flowId de A.
    const res = await resolver.resolve({} as never, { phone_number_id: "pnB", id_tenant: TENANT_B, flow_activo: true, flow_id: s.flowId });
    assert.equal(res.kind, "none", "el flow de A no es resoluble bajo el tenant B");
  });

  it("5+19. draft NO publicado => resolver none (Legacy); tras publicar + rollback la versión activa es la correcta", async () => {
    const registryStore = createInMemoryBusinessAgentRegistryStore();
    const resolver = createSupabaseBusinessAgentResolver({ store: registryStore });

    // v1 draft (sin publicar) => none.
    const d1 = await compileAndCreateDraftVersion({ store: registryStore }, { tenantId: TENANT, spec: retailSpec() });
    assert.ok(d1.ok && d1.validationStatus === "validated");
    if (!d1.ok) throw new Error("unreachable");
    const antesDePublicar = await resolver.resolve({} as never, cliente(d1.flowId));
    assert.equal(antesDePublicar.kind, "none", "draft sin publicar no es ejecutable (fail-closed a Legacy)");

    // publish v1.
    await publishBusinessAgentVersion({ store: registryStore }, { tenantId: TENANT, flowId: d1.flowId, flowVersionId: d1.flowVersionId });
    const v1 = await resolver.resolve({} as never, cliente(d1.flowId));
    assert.equal(v1.kind, "business_agent");

    // v2 draft + publish (misma identidad flowId).
    const d2 = await compileAndCreateDraftVersion({ store: registryStore }, { tenantId: TENANT, spec: salonSpec() });
    assert.ok(d2.ok && d2.flowId === d1.flowId, "misma identidad de agente");
    if (!d2.ok) throw new Error("unreachable");
    await publishBusinessAgentVersion({ store: registryStore }, { tenantId: TENANT, flowId: d2.flowId, flowVersionId: d2.flowVersionId });
    const v2 = await resolver.resolve({} as never, cliente(d1.flowId));
    assert.equal(v2.kind === "business_agent" && v2.flowVersionId, d2.flowVersionId, "activo = v2");

    // rollback a v1.
    const rb = await publishBusinessAgentVersion({ store: registryStore }, { tenantId: TENANT, flowId: d1.flowId, flowVersionId: d1.flowVersionId });
    assert.ok(rb.ok);
    const trasRollback = await resolver.resolve({} as never, cliente(d1.flowId));
    assert.equal(trasRollback.kind === "business_agent" && trasRollback.flowVersionId, d1.flowVersionId, "rollback dejó v1 activa");
  });
});
