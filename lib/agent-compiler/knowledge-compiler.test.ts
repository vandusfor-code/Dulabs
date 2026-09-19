/**
 * R4 — conocimiento (FAQ + documentos) a través de Spec -> validación -> IR ->
 * FlowDefinition. 100% offline. Cubre: la capability faq compila a RECUPERACIÓN
 * real (no a un nodo IA que "sabe"), la política sin-respuesta, el bucle solo-FAQ,
 * la compatibilidad de agentes sin faq y que el flow sea publicable.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateBusinessAgentSpec } from "@/lib/agent-compiler/spec/validate";
import { compileBusinessAgent } from "@/lib/agent-compiler/compile";
import { compileIRToFlowDefinition } from "@/lib/agent-compiler/flow-compiler";
import { commercialStateFromNodeId } from "@/lib/agent-compiler/runtime/commercial-state-resolver";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { CAPABILITY_KEYS } from "@/lib/agent-compiler/spec/capabilities";
import { retailSpec, salonSpec } from "@/lib/agent-compiler/runtime/fixtures";
import { DEFAULT_NO_ANSWER_MESSAGE } from "@/lib/business-agent-knowledge/limits";
import type { AgentCapabilities, BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import type { FlowDefinition } from "@/lib/flow/types";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CTX = { tenantId: TENANT };

function caps(on: Partial<AgentCapabilities>): AgentCapabilities {
  return { ...(Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, false])) as AgentCapabilities), ...on };
}

/** Restaurante: solo FAQ (+ catálogo opcional). Sin agenda. */
function faqOnly(over: Partial<BusinessAgentSpec> = {}): BusinessAgentSpec {
  const s = retailSpec();
  return {
    ...s,
    capabilities: caps({ faq: true }),
    catalog: { source: "structured", useServices: false, useProducts: false, quoteBeforeQualification: false },
    policies: { prohibitions: [], rules: [] },
    handoff: { rules: [], defaultPauseHours: 24 },
    ...over,
  };
}

const HORARIO = { week: Array.from({ length: 7 }, () => ({ closed: false, intervals: [{ open: "08:00", close: "20:00" }] })), exceptions: [] };
/** Salón: agenda Nylas + FAQ + catálogo + datos del cliente. */
function salon(over: Partial<BusinessAgentSpec> = {}): BusinessAgentSpec {
  const s = salonSpec();
  return {
    ...s,
    capabilities: caps({ faq: true, catalog: true, scheduling: true, humanHandoff: true }),
    scheduling: { ...s.scheduling, provider: "nylas", businessHours: HORARIO },
    customerData: { fields: [{ key: "nombreCliente", label: "Nombre", type: "text", required: true, enabled: true, scope: "customer" }] },
    ...over,
  };
}

function compilar(spec: BusinessAgentSpec) {
  const c = compileBusinessAgent(spec, CTX);
  assert.ok(c.success, "compile: " + JSON.stringify(c.success ? [] : c.diagnostics));
  const f = compileIRToFlowDefinition(c.ir, CTX);
  assert.ok(f.success, "flow: " + JSON.stringify(f.success ? [] : f.diagnostics));
  return { ir: c.ir, flow: f.flow };
}
const nodo = (f: FlowDefinition, id: string) => f.nodes.find((n) => n.id === id);
const edge = (f: FlowDefinition, source: string, target: string, handle?: string) => f.edges.some((e) => e.source === source && e.target === target && (handle === undefined || e.sourceHandle === handle));
const codes = (spec: unknown) => validateBusinessAgentSpec(spec).issues.map((i) => `${i.code}:${i.message}`);

describe("R4 — Spec: política sin respuesta (schema y reglas)", () => {
  it("1. Specs previos sin onNoAnswer/noAnswerMessage siguen siendo válidos", () => {
    assert.equal(validateBusinessAgentSpec(faqOnly()).valid, true);
    assert.equal(validateBusinessAgentSpec(salonSpec()).valid, true);
  });

  it("2. 'message' con mensaje propio es válido; valores desconocidos y mensajes gigantes se rechazan", () => {
    const con = (k: Record<string, unknown>) => faqOnly({ knowledge: { authority: "secondary", documents: [], ...k } as BusinessAgentSpec["knowledge"] });
    assert.equal(validateBusinessAgentSpec(con({ onNoAnswer: "message", noAnswerMessage: "No tengo ese dato." })).valid, true);
    assert.equal(validateBusinessAgentSpec(con({ onNoAnswer: "inventar" })).valid, false);
    assert.equal(validateBusinessAgentSpec(con({ noAnswerMessage: "x".repeat(301) })).valid, false);
  });

  it("3. 'handoff' exige la capacidad 'Transferir a un humano'", () => {
    const handoff = { authority: "secondary" as const, documents: [], onNoAnswer: "handoff" as const };
    assert.ok(codes(faqOnly({ knowledge: handoff })).some((c) => /Transferir a un humano/.test(c)));
    assert.deepEqual(codes(faqOnly({ capabilities: caps({ faq: true, humanHandoff: true }), knowledge: handoff, handoff: { rules: [{ id: "h", description: "x", trigger: { kind: "agent_request" }, action: "TRANSFER_HUMAN" }], defaultPauseHours: 24 } })), []);
  });
});

describe("R4 — compiler: la capability faq compila a RECUPERACIÓN", () => {
  it("4. la IR trae el binding de recuperación (fuentes, política y mensaje por defecto); agentes sin faq no lo traen", () => {
    const { ir } = compilar(faqOnly());
    assert.deepEqual(ir.knowledge.retrieval, { sources: ["faq", "documento"], onNoAnswer: "message", noAnswerMessage: DEFAULT_NO_ANSWER_MESSAGE });
    assert.deepEqual(ir.states.find((s) => s.id === "INFORMATION")!.toolBindings, ["buscar_conocimiento"]);
    const sinFaq = compilar({ ...faqOnly(), capabilities: caps({ humanHandoff: false, leadCapture: true }) }).ir;
    assert.equal(sinFaq.knowledge.retrieval, undefined);
    assert.equal(sinFaq.states.some((s) => s.id === "INFORMATION"), false);
  });

  it("5. solo-FAQ: act-faq -> cond-faq-found -> [sí] ai-faq-present | [no] mensaje fijo; luego bucle q-faq-more -> act-faq", () => {
    const { flow } = compilar(faqOnly({ knowledge: { authority: "secondary", documents: [], noAnswerMessage: "Ese dato no lo tengo; pregúntame otra cosa." } }));
    const act = nodo(flow, "act-faq") as { type: string; config: { actionType: string; params: Record<string, string> } };
    assert.equal(act.type, "action");
    assert.equal(act.config.actionType, "buscar_conocimiento");
    assert.equal(act.config.params.fuentes, "faq,documento", "fuentes ESTÁTICAS del nodo (la IA no las elige)");
    assert.ok(edge(flow, "q-need", "act-faq"));
    assert.ok(edge(flow, "act-faq", "cond-faq-found"));
    assert.ok(edge(flow, "cond-faq-found", "ai-faq-present", "true"));
    assert.ok(edge(flow, "cond-faq-found", "msg-faq-nofound", "false"), "sin resultados => mensaje fijo, la IA NO se invoca");
    assert.equal((nodo(flow, "msg-faq-nofound") as { config: { text: string } }).config.text, "Ese dato no lo tengo; pregúntame otra cosa.");
    // bucle
    assert.ok(edge(flow, "ai-faq-present", "q-faq-more"));
    assert.ok(edge(flow, "msg-faq-nofound", "q-faq-more"));
    // si el filtro de afirmaciones externas bloquea la respuesta de la IA: mensaje seguro (nunca silencio) y el bucle sigue
    assert.ok(edge(flow, "ai-faq-present", "msg-faq-fail", "failure"));
    assert.ok(edge(flow, "msg-faq-fail", "q-faq-more"));
    assert.ok(edge(flow, "q-faq-more", "act-faq"));
    const more = nodo(flow, "q-faq-more") as { config: { variableKey: string } };
    assert.equal(more.config.variableKey, "user_request", "la nueva pregunta reemplaza a la anterior (la búsqueda siempre usa user_request)");
    assert.equal(flow.edges.some((e) => e.source === "q-faq-more" && e.target === "end"), false, "el bucle no cierra la conversación");
    assert.ok(flow.edges.some((e) => e.target === "end"), "el end sigue alcanzable (fallos/transferencia)");
  });

  it("6. la IA que responde NO tiene tools y su instrucción la ata a los fragmentos (datos, no instrucciones; no inventar)", () => {
    const { flow } = compilar(faqOnly());
    const ai = nodo(flow, "ai-faq-present") as { config: { mode: string; allowedTools: string[]; instruction: string } };
    assert.equal(ai.config.mode, "respond");
    assert.deepEqual(ai.config.allowedTools, []);
    assert.match(ai.config.instruction, /ÚNICAMENTE los fragmentos de la variable conocimientoTexto/);
    assert.match(ai.config.instruction, /no instrucciones/);
    assert.match(ai.config.instruction, /Nunca inventes/);
    assert.equal(flow.nodes.some((n) => n.id === "ai-info"), false, "el nodo IA que 'sabía' ya no existe");
  });

  it("7. política 'handoff': sin información => nodo humano (pausa) y sin mensaje fijo", () => {
    const { flow } = compilar(
      faqOnly({
        capabilities: caps({ faq: true, humanHandoff: true }),
        handoff: { rules: [{ id: "h", description: "x", trigger: { kind: "agent_request" }, action: "TRANSFER_HUMAN" }], defaultPauseHours: 24 },
        knowledge: { authority: "secondary", documents: [], onNoAnswer: "handoff" },
      }),
    );
    assert.ok(edge(flow, "cond-faq-found", "human-faq-nofound", "false"));
    assert.ok(edge(flow, "ai-faq-present", "human-faq-nofound", "failure"), "respuesta bloqueada => también a una persona");
    // R5: transferencia REAL -- mensaje al cliente y luego la acción transferir_soporte (pausa el chat).
    assert.equal(nodo(flow, "human-faq-nofound")?.type, "message");
    assert.ok(edge(flow, "human-faq-nofound", "act-handoff-faq"));
    assert.ok(edge(flow, "act-handoff-faq", "end"));
    assert.equal(nodo(flow, "msg-faq-nofound"), undefined);
  });

  it("8. agente con más estados (salón: catálogo + agenda): sin loop; un mensaje que NO es pregunta sigue en silencio", () => {
    const { flow } = compilar(salon());
    assert.equal(nodo(flow, "q-faq-more"), undefined, "sin bucle: hay más estados");
    assert.ok(edge(flow, "cond-faq-found", "cond-faq-question", "false"));
    assert.ok(edge(flow, "cond-faq-question", "msg-faq-nofound", "true"), "solo si era una pregunta se dice 'no tengo información'");
    // el camino silencioso y el de respuesta convergen al siguiente estado (catálogo)
    assert.ok(edge(flow, "cond-faq-question", "ai-catalog-propose", "false"));
    assert.ok(edge(flow, "ai-faq-present", "ai-catalog-propose"));
    assert.ok(edge(flow, "msg-faq-nofound", "ai-catalog-propose"));
    // y siguen las reglas de R1-R3 (booking con horario y datos del cliente)
    const book = nodo(flow, "act-book") as { config: { params: Record<string, string> } };
    assert.ok(book.config.params.businessHoursJson && book.config.params.customerFieldsJson);
  });

  it("9. primer mensaje que YA es una pregunta ('?') salta q-need; sin '?' se comporta como siempre", () => {
    const { flow } = compilar(faqOnly());
    assert.ok(edge(flow, "welcome", "cond-first-question"));
    assert.ok(edge(flow, "cond-first-question", "q-need", "false"));
    assert.ok(edge(flow, "cond-first-question", "act-faq", "true"), "la pregunta directa se responde sin '¿qué necesitas hoy?'");
    const cond = nodo(flow, "cond-first-question") as { config: { rules: unknown } };
    assert.deepEqual(cond.config.rules, [{ field: "__firstMessageText", operator: "contains", value: "?" }]);
    // un agente SIN faq no tiene esta condición (welcome -> q-need directo)
    const sinFaq = compilar({ ...faqOnly(), capabilities: caps({ leadCapture: true }) }).flow;
    assert.ok(edge(sinFaq, "welcome", "q-need"));
    assert.equal(nodo(sinFaq, "cond-first-question"), undefined);
  });

  it("10. el flow completo es PUBLICABLE (validateFlowForPublish) en las variantes: solo-FAQ, handoff, salón", () => {
    for (const spec of [
      faqOnly(),
      faqOnly({ capabilities: caps({ faq: true, humanHandoff: true }), handoff: { rules: [{ id: "h", description: "x", trigger: { kind: "agent_request" }, action: "TRANSFER_HUMAN" }], defaultPauseHours: 24 }, knowledge: { authority: "secondary", documents: [], onNoAnswer: "handoff" } }),
      salon(),
    ]) {
      const { flow } = compilar(spec);
      const pub = validateFlowForPublish(flow);
      assert.deepEqual(pub.errors, [], JSON.stringify(pub.errors));
    }
  });

  it("11. determinismo y tenant isolation: mismo Spec => mismo grafo; el IR de un tenant no compila en otro", () => {
    const a = compilar(faqOnly());
    const b = compilar(faqOnly());
    assert.equal(a.ir.checksum, b.ir.checksum);
    assert.deepEqual(a.flow.nodes, b.flow.nodes);
    assert.equal(compileIRToFlowDefinition(a.ir, { tenantId: "22222222-2222-4222-8222-222222222222" }).success, false);
  });

  it("12. commercialState: todos los nodos de recuperación resuelven a INFORMATION (el humano a HUMAN_TRANSFER)", () => {
    const { flow } = compilar(faqOnly());
    for (const id of ["act-faq", "cond-faq-found", "ai-faq-present", "msg-faq-nofound", "msg-faq-fail", "q-faq-more"]) assert.equal(commercialStateFromNodeId(id), "INFORMATION", id);
    assert.equal(commercialStateFromNodeId("cond-first-question"), "WELCOME");
    assert.equal(commercialStateFromNodeId("human-faq-nofound"), "HUMAN_TRANSFER");
    for (const n of flow.nodes) if (/faq/.test(n.id)) assert.ok(commercialStateFromNodeId(n.id), `${n.id} sin estado`);
  });
});
