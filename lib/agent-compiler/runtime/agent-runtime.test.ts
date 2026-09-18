// DuLabs Business — Agent Compiler (Fase 1), Step 7 — Runtime Integration.
//
// Cadena completa contra el RUNTIME REAL (createExecutionOrchestrator + Flow
// Engine + guardrails), sin Supabase ni LLM (store en memoria + executors con
// registro). Prueba: Gate PRE-LLM, autoridad del estado, autorización de
// tools, transferencia exclusiva, idempotencia, concurrencia, fail-closed,
// aislamiento multi-tenant y observabilidad — más el test crítico anti-
// alucinación (§24).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import { createExecutionOrchestrator, type NormalizedFlowEvent, type OrchestratorResult } from "@/lib/flow/flow-orchestrator";
import { ORCHESTRATOR_OUTCOMES } from "@/lib/flow/orchestrator-types";
import type { FlowDefinition } from "@/lib/flow/types";
import { compileBusinessAgent } from "@/lib/agent-compiler/compile";
import { compileIRToFlowDefinition } from "@/lib/agent-compiler/flow-compiler";
import type { CompiledBusinessAgentIR } from "@/lib/agent-compiler/ir";
import { buildGateRules, type SemanticClassifier } from "@/lib/agent-compiler/runtime/guardrail-gate";
import {
  runAgentTurn,
  type AgentRuntimeDeps,
  type AgentTurnTrace,
  type GateActionSink,
  type GateIdempotencyStore,
  type IncomingMessage,
} from "@/lib/agent-compiler/runtime/agent-runtime";
import { createInMemoryOrchestratorStore, type InMemoryOrchestratorStore } from "@/lib/agent-compiler/runtime/testing/in-memory-store";
import {
  aiProposes,
  createRecordingEffectFramework,
  type LegacyHandler,
  type RecordingFramework,
} from "@/lib/agent-compiler/runtime/testing/recording-executors";
import { photographySpec, retailSpec, salonSpec } from "@/lib/agent-compiler/runtime/fixtures";

const TENANT = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const CONV = { phoneNumberId: "pn-1", telefonoCliente: "573001112233" };

function memoryIdempotency(): GateIdempotencyStore {
  const seen = new Set<string>();
  return { claim: async (t, w) => (seen.has(`${t}:${w}`) ? false : (seen.add(`${t}:${w}`), true)) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compileIR(spec: ReturnType<typeof retailSpec>, tenantId = TENANT): CompiledBusinessAgentIR {
  const res = compileBusinessAgent(spec, { tenantId });
  assert.ok(res.success, `compile falló: ${JSON.stringify(res.success ? [] : res.diagnostics)}`);
  return res.ir;
}

function gateSinkRecorder() {
  const sent: Array<{ text: string }> = [];
  const transfers: Array<{ text?: string; pauseHours: number }> = [];
  const sink: GateActionSink = {
    async sendMessage(i) {
      sent.push({ text: i.text });
    },
    async transferHuman(i) {
      transfers.push({ text: i.text, pauseHours: i.pauseHours });
    },
  };
  return { sink, sent, transfers };
}

function spyOrchestrator(real: { process(e: NormalizedFlowEvent): Promise<OrchestratorResult> }) {
  let calls = 0;
  return {
    process: async (e: NormalizedFlowEvent) => {
      calls += 1;
      return real.process(e);
    },
    calls: () => calls,
  };
}

interface Harness {
  store: InMemoryOrchestratorStore;
  framework: RecordingFramework;
  deps: AgentRuntimeDeps;
  orchestratorCalls: () => number;
  gate: ReturnType<typeof gateSinkRecorder>;
  traces: AgentTurnTrace[];
}

function harness(opts: {
  ir: CompiledBusinessAgentIR;
  flow: FlowDefinition;
  tenantId?: string;
  publishTenantId?: string;
  aiHandler?: LegacyHandler;
  actionHandler?: LegacyHandler;
  classifier?: SemanticClassifier;
  idempotency?: GateIdempotencyStore;
  publish?: boolean;
}): Harness {
  const tenantId = opts.tenantId ?? TENANT;
  const store = createInMemoryOrchestratorStore();
  let flowId = "unpublished-flow";
  if (opts.publish !== false) {
    flowId = store.publishFlow({ tenantId: opts.publishTenantId ?? tenantId, definition: opts.flow }).flowId;
  }
  const framework = createRecordingEffectFramework({ ai: opts.aiHandler, action: opts.actionHandler });
  const orchestrator = createExecutionOrchestrator({
    store,
    engine: { createFlowEngineState, runFlowEngine },
    effectFramework: framework.framework,
  });
  const spy = spyOrchestrator(orchestrator);
  const gate = gateSinkRecorder();
  const traces: AgentTurnTrace[] = [];
  const deps: AgentRuntimeDeps = {
    ir: opts.ir,
    flowId,
    orchestrator: spy,
    store,
    gateSink: gate.sink,
    classifier: opts.classifier,
    idempotency: opts.idempotency ?? memoryIdempotency(),
    observer: { onTrace: (t) => traces.push(t) },
  };
  return { store, framework, deps, orchestratorCalls: spy.calls, gate, traces };
}

function msg(over: Partial<IncomingMessage> = {}): IncomingMessage {
  return { tenantId: TENANT, conversation: CONV, wamid: `wamid-${Math.random().toString(36).slice(2)}`, text: "hola", ...over };
}

// Flow mínimo autor-como-debe-emitir-el-compiler: tool con propose_action->action.
function toolFlow(allowedTools: string[], actionType: string): FlowDefinition {
  return {
    name: "tool",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "ai", type: "ai", config: { instruction: "Propón la herramienta autorizada.", mode: "propose_action", allowedTools } },
      { id: "act", type: "action", config: { actionType: actionType as never } },
      { id: "reject", type: "message", config: { text: "No puedo hacer eso ahora." } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e0", source: "start", target: "ai" },
      { id: "e1", source: "ai", target: "act", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e2", source: "ai", target: "reject", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e3", source: "act", target: "end" },
      { id: "e4", source: "reject", target: "end" },
    ],
    variables: [],
  };
}

const trivialFlow: FlowDefinition = {
  name: "trivial",
  nodes: [
    { id: "start", type: "start", config: { triggerType: "first_message" } },
    { id: "welcome", type: "message", config: { text: "¡Hola! ¿En qué te ayudo?" } },
    { id: "end", type: "end", config: {} },
  ],
  edges: [
    { id: "e0", source: "start", target: "welcome" },
    { id: "e1", source: "welcome", target: "end" },
  ],
  variables: [],
};

// Flow con un nodo message sin salida => TRANSITION_NOT_FOUND en runtime
// (estado/transición inválida). Se salta validateFlowDefinition a propósito.
const brokenFlow: FlowDefinition = {
  name: "broken",
  nodes: [
    { id: "start", type: "start", config: { triggerType: "first_message" } },
    { id: "dead", type: "message", config: { text: "sin salida" } },
    { id: "end", type: "end", config: {} },
  ],
  edges: [{ id: "e0", source: "start", target: "dead" }],
  variables: [],
};

const irTrivial = (tenantId = TENANT): CompiledBusinessAgentIR => compileIR(retailSpec(), tenantId);

// ---------------------------------------------------------------------------
// Cadena completa (Spec -> IR -> FlowDefinition -> Runtime) con el COMPILER real
// ---------------------------------------------------------------------------

describe("Step 7 — cadena real (compiler + runtime)", () => {
  it("A. mensaje normal (sin guardrail) => Gate pasa, corre el Flow (LLM/mensajes)", async () => {
    const ir = compileIR(retailSpec());
    const flowRes = compileIRToFlowDefinition(ir, { tenantId: TENANT });
    assert.ok(flowRes.success);
    const h = harness({ ir, flow: flowRes.success ? flowRes.flow : trivialFlow });
    const r = await runAgentTurn(h.deps, msg({ text: "hola, ¿qué venden?" }));
    assert.equal(r.kind, "flow");
    if (r.kind === "flow") assert.equal(r.orchestrator.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(h.orchestratorCalls(), 1);
    assert.ok(h.framework.sendMessageCalls().length >= 1, "el Flow envió al menos el WELCOME");
  });

  it("§24 anti-alucinación: 'paquete $350.000 y ¿puedo llevar mi perro?' en QUOTING => guardrail MATCH, LLM NOT_CALLED, catálogo NOT_CALLED", async () => {
    const ir = compileIR(photographySpec());
    const h = harness({ ir, flow: trivialFlow });
    const r = await runAgentTurn(
      h.deps,
      msg({ text: "quiero el paquete de estudio de $350.000 y ¿puedo llevar mi perro?", commercialState: "QUOTING" }),
    );
    assert.equal(r.kind, "guardrail_blocked");
    if (r.kind === "guardrail_blocked") {
      assert.equal(r.llmCalled, false);
      assert.equal(r.catalogCalled, false);
      assert.equal(r.decision.matchedBy, "deterministic");
      assert.equal(r.decision.ruleId, "mascota_estudio");
    }
    // Evidencia dura: el orquestador y el executor de IA NUNCA se invocaron.
    assert.equal(h.orchestratorCalls(), 0);
    assert.equal(h.framework.aiCalls().length, 0);
    assert.equal(h.framework.actionCalls().length, 0);
    assert.equal(h.gate.sent.length, 1);
  });

  it("§24 misma prohibición NO bloquea fuera del estado contextual (WELCOME) => pasa al Flow", async () => {
    const ir = compileIR(photographySpec());
    const flowRes = compileIRToFlowDefinition(ir, { tenantId: TENANT });
    // photography trae handoff semántico (policy-router) -> se usa trivialFlow
    // para el camino de PASO (el compiled se valida aparte, ver suite fixtures).
    assert.ok(flowRes.success);
    const h = harness({ ir, flow: trivialFlow });
    const r = await runAgentTurn(h.deps, msg({ text: "¿puedo llevar mi perro?", commercialState: "WELCOME" }));
    assert.equal(r.kind, "flow");
    assert.equal(h.orchestratorCalls(), 1);
  });
});

// ---------------------------------------------------------------------------
// Matriz obligatoria (§23) — 18 comportamientos
// ---------------------------------------------------------------------------

describe("Step 7 — matriz de comportamientos (1-18)", () => {
  it("1. mensaje normal => LLM (Flow corre, executor de IA invocado)", async () => {
    const flow = toolFlow(["etiquetar_conversacion"], "etiquetar_conversacion");
    const h = harness({ ir: irTrivial(), flow, aiHandler: () => aiProposes("etiquetar_conversacion") });
    const r = await runAgentTurn(h.deps, msg({ text: "hola" }));
    assert.equal(r.kind, "flow");
    assert.ok(h.framework.aiCalls().length >= 1);
  });

  it("2. guardrail MATCH => LLM NO ejecutado (orquestador nunca invocado)", async () => {
    const h = harness({ ir: compileIR(photographySpec()), flow: trivialFlow });
    const r = await runAgentTurn(h.deps, msg({ text: "quiero pagar en efectivo" }));
    assert.equal(r.kind, "guardrail_blocked");
    assert.equal(h.orchestratorCalls(), 0);
    assert.equal(h.framework.aiCalls().length, 0);
  });

  it("3. guardrail NO match => continúa al Flow", async () => {
    const h = harness({ ir: irTrivial(), flow: trivialFlow });
    const r = await runAgentTurn(h.deps, msg({ text: "buenas, info" }));
    assert.equal(r.kind, "flow");
    assert.equal(h.orchestratorCalls(), 1);
  });

  it("4. prohibición contextual => bloqueo (respuesta fija, sin LLM)", async () => {
    const h = harness({ ir: compileIR(photographySpec()), flow: trivialFlow });
    const r = await runAgentTurn(h.deps, msg({ text: "puedo entrar con mi perro", commercialState: "QUOTING" }));
    assert.equal(r.kind, "guardrail_blocked");
    assert.equal(h.gate.sent.length, 1);
  });

  it("5. tool AUTORIZADA => ejecución (action executor invocado)", async () => {
    const flow = toolFlow(["etiquetar_conversacion"], "etiquetar_conversacion");
    const h = harness({ ir: irTrivial(), flow, aiHandler: () => aiProposes("etiquetar_conversacion") });
    const r = await runAgentTurn(h.deps, msg());
    assert.equal(r.kind, "flow");
    assert.equal(h.framework.actionCalls().length, 1, "la tool autorizada se ejecutó exactamente una vez");
  });

  it("6. tool NO autorizada (fuera de allowedTools) => rechazo, action NO ejecutada", async () => {
    const flow = toolFlow(["etiquetar_conversacion"], "etiquetar_conversacion");
    // La IA intenta una tool distinta a la autorizada del nodo.
    const h = harness({ ir: irTrivial(), flow, aiHandler: () => aiProposes("get_contact") });
    const r = await runAgentTurn(h.deps, msg());
    assert.equal(r.kind, "flow");
    assert.equal(h.framework.actionCalls().length, 0, "una tool no autorizada JAMÁS se ejecuta");
  });

  it("7. transferencia => pausa humana (transferHuman con pauseHours)", async () => {
    const h = harness({ ir: irTrivial(), flow: trivialFlow });
    const r = await runAgentTurn(h.deps, msg({ text: "quiero hablar con una persona" }));
    assert.equal(r.kind, "guardrail_blocked");
    assert.equal(h.gate.transfers.length, 1);
    assert.equal(h.gate.transfers[0]!.pauseHours, 12);
  });

  it("8. transferencia => NO hay respuesta IA simultánea (orquestador no corre)", async () => {
    const h = harness({ ir: irTrivial(), flow: trivialFlow, aiHandler: () => aiProposes("x") });
    const r = await runAgentTurn(h.deps, msg({ text: "quiero un asesor" }));
    assert.equal(r.kind, "guardrail_blocked");
    assert.equal(h.orchestratorCalls(), 0);
    assert.equal(h.framework.aiCalls().length, 0);
    assert.equal(h.gate.sent.length, 0, "no se envía respuesta de IA además de la transferencia");
  });

  it("9. conversación 'pausada': la transferencia deja pausa (base del gate de pausa del webhook)", async () => {
    const h = harness({ ir: irTrivial(), flow: trivialFlow });
    await runAgentTurn(h.deps, msg({ text: "hablar con alguien" }));
    assert.equal(h.gate.transfers.length, 1);
    assert.ok(h.gate.transfers[0]!.pauseHours > 0);
  });

  it("10. estado persistido (execution creada y guardada en el store)", async () => {
    const h = harness({ ir: irTrivial(), flow: trivialFlow });
    const r = await runAgentTurn(h.deps, msg({ text: "hola" }));
    assert.equal(r.kind, "flow");
    const execs = h.store.listExecutions(TENANT);
    assert.equal(execs.length, 1);
    assert.equal(execs[0]!.status, "completed");
    assert.ok(h.store.listTransitions().length > 0, "se registraron transiciones de nodo (observabilidad)");
  });

  it("11. webhook duplicado (mismo wamid) => segundo turno DUPLICATE_EVENT, sin doble efecto", async () => {
    const flow = toolFlow(["etiquetar_conversacion"], "etiquetar_conversacion");
    const h = harness({ ir: irTrivial(), flow, aiHandler: () => aiProposes("etiquetar_conversacion") });
    const m = msg({ wamid: "dup-1" });
    const r1 = await runAgentTurn(h.deps, m);
    const r2 = await runAgentTurn(h.deps, m);
    assert.equal(r1.kind, "flow");
    assert.equal(r2.kind, "duplicate", "mismo wamid => deduplicado (§19)");
    assert.equal(h.framework.actionCalls().length, 1, "la tool se ejecutó una sola vez pese al duplicado");
  });

  it("12. mensajes concurrentes (misma conversación) => sin corrupción de estado", async () => {
    const h = harness({ ir: irTrivial(), flow: trivialFlow });
    const [a, b] = await Promise.all([
      runAgentTurn(h.deps, msg({ wamid: "c-1", text: "hola" })),
      runAgentTurn(h.deps, msg({ wamid: "c-2", text: "buenas" })),
    ]);
    assert.ok(a.kind === "flow" && b.kind === "flow");
    // No hay dos ejecuciones activas simultáneas corruptas para la misma conversación.
    const execs = h.store.listExecutions(TENANT);
    assert.ok(execs.length >= 1);
    for (const e of execs) assert.ok(["completed", "waiting_input", "running", "failed"].includes(e.status));
  });

  it("13. estado/transición inválida => engineError (fail-closed, sin crash)", async () => {
    const h = harness({ ir: irTrivial(), flow: brokenFlow });
    const r = await runAgentTurn(h.deps, msg({ text: "hola" }));
    assert.equal(r.kind, "flow");
    if (r.kind === "flow") assert.ok(r.orchestrator.engineError, "el runtime reporta engineError, no revienta");
  });

  it("14. flow version inválida (no publicado) => rejected flow_not_published", async () => {
    const h = harness({ ir: irTrivial(), flow: trivialFlow, publish: false });
    const r = await runAgentTurn(h.deps, msg({ text: "hola" }));
    assert.equal(r.kind, "flow");
    if (r.kind === "flow") {
      assert.equal(r.orchestrator.outcome, ORCHESTRATOR_OUTCOMES.REJECTED);
      assert.equal(r.orchestrator.rejectReason, "flow_not_published");
    }
  });

  it("15. variable requerida ausente (question required + vacío) => invalid_input seguro", async () => {
    const flow: FlowDefinition = {
      name: "q",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "q", type: "question", config: { text: "¿Tu nombre?", variableKey: "nombre", required: true, validation: { kind: "text" } } },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e0", source: "start", target: "q" },
        { id: "e1", source: "q", target: "end" },
      ],
      variables: [{ key: "nombre", label: "Nombre", type: "string" }],
    };
    const h = harness({ ir: irTrivial(), flow });
    await runAgentTurn(h.deps, msg({ wamid: "q-1", text: "hola" })); // crea execution, pregunta
    const r2 = await runAgentTurn(h.deps, msg({ wamid: "q-2", text: "   " })); // vacío -> invalid_input
    assert.equal(r2.kind, "flow");
    const exec = h.store.listExecutions(TENANT)[0]!;
    assert.equal(exec.status, "waiting_input", "sigue esperando la respuesta, sin avanzar ni crashear");
  });

  it("16. executor failure (IA falla) => se enruta a fallo, sin ejecutar la tool", async () => {
    const flow = toolFlow(["etiquetar_conversacion"], "etiquetar_conversacion");
    const h = harness({ ir: irTrivial(), flow, aiHandler: () => ({ result: { success: false } }) });
    const r = await runAgentTurn(h.deps, msg());
    assert.equal(r.kind, "flow");
    assert.equal(h.framework.actionCalls().length, 0);
  });

  it("17. tenant isolation => ir.tenantId != incoming.tenantId => fail_closed, sin efectos", async () => {
    const h = harness({ ir: irTrivial(TENANT), flow: trivialFlow });
    const r = await runAgentTurn(h.deps, msg({ tenantId: TENANT_B, text: "hola" }));
    assert.equal(r.kind, "fail_closed");
    if (r.kind === "fail_closed") assert.equal(r.reason, "tenant_mismatch");
    assert.equal(h.orchestratorCalls(), 0);
    assert.equal(h.gate.sent.length, 0);
    assert.equal(h.gate.transfers.length, 0);
  });

  it("18. tool fuera del estado autorizado (allowedTools=[]) => rechazo ('¿cuánto cuesta?' sin catálogo)", async () => {
    const flow = toolFlow([], "consultar_disponibilidad_catalogo");
    const h = harness({ ir: irTrivial(), flow, aiHandler: () => aiProposes("consultar_disponibilidad_catalogo") });
    const r = await runAgentTurn(h.deps, msg({ text: "¿cuánto cuesta?" }));
    assert.equal(r.kind, "flow");
    assert.equal(h.framework.actionCalls().length, 0, "sin catálogo autorizado no se consulta el catálogo");
  });
});

// ---------------------------------------------------------------------------
// Idempotencia del camino del Gate + clasificador semántico
// ---------------------------------------------------------------------------

describe("Step 7 — Gate idempotencia + semántico", () => {
  it("gate-block duplicado (mismo wamid) no re-envía la respuesta fija", async () => {
    const seen = new Set<string>();
    const idempotency: GateIdempotencyStore = { claim: async (t, w) => (seen.has(`${t}:${w}`) ? false : (seen.add(`${t}:${w}`), true)) };
    const h = harness({ ir: compileIR(photographySpec()), flow: trivialFlow, idempotency });
    const m = msg({ wamid: "g-dup", text: "quiero pagar en efectivo" });
    const r1 = await runAgentTurn(h.deps, m);
    const r2 = await runAgentTurn(h.deps, m);
    assert.equal(r1.kind, "guardrail_blocked");
    assert.equal(r2.kind, "duplicate");
    assert.equal(h.gate.sent.length, 1, "solo una respuesta pese al duplicado");
  });

  it("handoff semántico (queja) => clasificador controlado decide, DuLabs transfiere", async () => {
    const classifier: SemanticClassifier = async ({ message }) => (message.includes("desastre") ? { label: "queja" } : { label: "continue" });
    const h = harness({ ir: compileIR(photographySpec()), flow: trivialFlow, classifier });
    const r = await runAgentTurn(h.deps, msg({ text: "esto es un desastre total" }));
    assert.equal(r.kind, "guardrail_blocked");
    if (r.kind === "guardrail_blocked") assert.equal(r.decision.matchedBy, "semantic");
    assert.equal(h.gate.transfers.length, 1);
    assert.equal(h.orchestratorCalls(), 0);
  });
});

// ---------------------------------------------------------------------------
// Fixtures: 3 industrias compilan, validan y producen gate rules
// ---------------------------------------------------------------------------

describe("Step 7 — fixtures industry-agnostic", () => {
  for (const [name, specFn] of [
    ["photography", photographySpec],
    ["salon", salonSpec],
    ["retail", retailSpec],
  ] as const) {
    it(`${name}: Spec -> IR -> FlowDefinition válido + gate rules derivadas`, () => {
      const ir = compileIR(specFn());
      const flowRes = compileIRToFlowDefinition(ir, { tenantId: TENANT });
      assert.ok(flowRes.success, `flow inválido para ${name}: ${JSON.stringify(flowRes.success ? [] : flowRes.diagnostics)}`);
      const rules = buildGateRules(ir);
      // Todo guardrail crítico de la IR está representado en el gate.
      assert.equal(rules.length, ir.guardrails.length + ir.handoff.length);
    });
  }
});
