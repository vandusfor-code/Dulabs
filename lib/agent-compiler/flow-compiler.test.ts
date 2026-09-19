/**
 * Agent Compiler (Fase 1) — Step 6 + Step 7.1: IR → FlowDefinition.
 * Pipeline real: Spec → compileBusinessAgent → compileIRToFlowDefinition →
 * validateFlowDefinition / validateFlowForPublish (API existente de lib/flow).
 *
 * Step 7.1: los guardrails PRE-LLM ya NO se duplican en el grafo (viven en el
 * Business Guardrail Gate). El grafo es la máquina comercial multi-turno con
 * turn-taking (question) y tools vía propose_action -> action.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileBusinessAgent } from "@/lib/agent-compiler/compile";
import { compileIRToFlowDefinition } from "@/lib/agent-compiler/flow-compiler";
import { validateFlowDefinition } from "@/lib/flow/validate-graph";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { buildGateRules } from "@/lib/agent-compiler/runtime/guardrail-gate";
import { nuevaSpecMetadata } from "@/lib/agent-compiler/spec/version";
import type { AgentCapabilities, BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import type { CompiledBusinessAgentIR } from "@/lib/agent-compiler/ir";
import type { FlowDefinition, FlowNode } from "@/lib/flow/types";

const NOW = "2026-09-18T00:00:00.000Z";
const CTX = { tenantId: "11111111-1111-4111-8111-111111111111" };
// Horario de atención de prueba (rebanada 2): el provider "nylas" lo exige.
const BH_TEST = { week: Array.from({ length: 7 }, () => ({ closed: false, intervals: [{ open: "09:00", close: "18:00" }] })), exceptions: [] };

function caps(p: Partial<AgentCapabilities>): AgentCapabilities {
  return { faq: false, sales: false, catalog: false, leadCapture: false, scheduling: false, orders: false, payments: false, humanHandoff: false, ...p };
}
function specBase(o: Partial<BusinessAgentSpec> = {}): BusinessAgentSpec {
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
    metadata: nuevaSpecMetadata(NOW),
    ...o,
  };
}
function irDe(spec: BusinessAgentSpec): CompiledBusinessAgentIR {
  const r = compileBusinessAgent(spec, CTX);
  if (!r.success) return assert.fail("el spec debe compilar a IR: " + JSON.stringify(r.diagnostics));
  return r.ir;
}
function flowDe(spec: BusinessAgentSpec): FlowDefinition {
  const r = compileIRToFlowDefinition(irDe(spec), CTX);
  if (!r.success) return assert.fail("la IR debe compilar a FlowDefinition: " + JSON.stringify(r.diagnostics));
  return r.flow;
}
const nodo = (f: FlowDefinition, id: string): FlowNode | undefined => f.nodes.find((n) => n.id === id);
const tieneEdge = (f: FlowDefinition, source: string, target: string, handle?: string) => f.edges.some((e) => e.source === source && e.target === target && (handle === undefined || e.sourceHandle === handle));
const aiAllowed = (n: FlowNode | undefined): string[] => (n && n.type === "ai" ? n.config.allowedTools ?? [] : ["<no-ai>"]);

describe("Agent Compiler — IR → FlowDefinition (Step 7.1)", () => {
  it("1. flow mínimo válido pasa validateFlowDefinition y validateFlowForPublish", () => {
    const f = flowDe(specBase());
    assert.equal(validateFlowDefinition(f).valid, true);
    assert.equal(validateFlowForPublish(f).valid, true);
    assert.ok(nodo(f, "start") && nodo(f, "end") && nodo(f, "welcome"));
  });

  it("1b. el tipo de negocio llega al compiler como contexto de las instrucciones de IA ('Otro' usa el texto libre)", () => {
    const conCatalogo = (identityExtra: Partial<BusinessAgentSpec["identity"]>): FlowDefinition =>
      flowDe(
        specBase({
          capabilities: caps({ faq: true, catalog: true }),
          catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: false },
          identity: { businessName: "Negocio X", agentName: "Ana", language: "es-CO", timezone: "America/Bogota", ...identityExtra },
        }),
      );
    const aiInstr = (f: FlowDefinition): string => {
      const ai = f.nodes.find((n) => n.type === "ai");
      return ai && ai.type === "ai" ? ai.config.instruction ?? "" : "";
    };
    // Tipo normal: la etiqueta aparece como contexto de la instrucción de IA.
    assert.ok(aiInstr(conCatalogo({ businessType: "Salón de belleza / Uñas" })).includes("Salón de belleza / Uñas"));
    // "Otro": se usa el texto libre, nunca el centinela "Otro".
    const otro = aiInstr(conCatalogo({ businessType: "Otro", businessTypeCustom: "Taller de reparación de celulares" }));
    assert.ok(otro.includes("Taller de reparación de celulares"));
    assert.ok(!otro.includes("(Otro)"), "con 'Otro' se compila el texto real, no el centinela");
  });

  it("2. IDENTIFICATION genera un question de captura cuando leadCapture activo", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, leadCapture: true }) }));
    const q = nodo(f, "q-identify");
    assert.ok(q && q.type === "question" && q.config.variableKey === "customer_name");
  });

  it("3. QUALIFICATION (question) precede a QUOTING; QUOTING no es accesible desde start/welcome", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, catalog: true, sales: true }) }));
    assert.ok(nodo(f, "q-qualify")?.type === "question");
    assert.ok(nodo(f, "ai-quote-propose")?.type === "ai");
    assert.ok(!tieneEdge(f, "start", "ai-quote-propose") && !tieneEdge(f, "welcome", "ai-quote-propose"));
    assert.equal(validateFlowForPublish(f).valid, true);
  });

  it("4. scheduling ON genera BOOKING (question + action crítica + rama human)", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, scheduling: true }), scheduling: { enabled: true, provider: "internal", timezone: "America/Bogota", minNoticeMinutes: 60, cancellation: { allowed: true, minNoticeHours: 24 }, confirmation: { required: true, hoursBefore: 24 }, resources: [] } }));
    assert.ok(nodo(f, "q-booking-when")?.type === "question");
    assert.ok(nodo(f, "act-book")?.type === "action");
    // Acción crítica DEBE tener rama failure -> human.
    assert.ok(tieneEdge(f, "act-book", "human-book-fail", "failure"));
    assert.equal(validateFlowForPublish(f).valid, true, JSON.stringify(validateFlowForPublish(f).errors));
  });

  it("5. scheduling OFF NO genera BOOKING", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true }) }));
    assert.equal(nodo(f, "act-book"), undefined);
    assert.equal(nodo(f, "q-booking-when"), undefined);
  });

  it("5b. BOOKING nylas embebe el horario de atención en la acción (rebanada 2)", () => {
    const bh = { week: Array.from({ length: 7 }, () => ({ closed: false, intervals: [{ open: "09:00", close: "18:00" }] })), exceptions: [] };
    const f = flowDe(
      specBase({
        capabilities: caps({ faq: true, scheduling: true }),
        scheduling: { enabled: true, provider: "nylas", timezone: "America/Bogota", minNoticeMinutes: 60, cancellation: { allowed: true, minNoticeHours: 24 }, confirmation: { required: false, hoursBefore: 24 }, resources: [], businessHours: bh },
      }),
    );
    const act = nodo(f, "act-book");
    assert.ok(act && act.type === "action");
    const cfg = (act as { config: { actionType: string; params?: Record<string, string> } }).config;
    assert.equal(cfg.actionType, "crear_cita_nylas_generico");
    assert.ok(cfg.params?.businessHoursJson, "el horario debe ir embebido en la acción de booking");
    assert.equal(JSON.parse(cfg.params!.businessHoursJson).week.length, 7);
  });

  it("6. §H handoff (humanHandoff sin scheduling) NO se duplica en el grafo: sin nodo human", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, humanHandoff: true }), handoff: { rules: [{ id: "h1", description: "asesor", trigger: { kind: "keyword", keywords: ["asesor", "humano"] }, action: "TRANSFER_HUMAN", pauseHours: 2 }], defaultPauseHours: 1 } }));
    assert.equal(f.nodes.some((n) => n.type === "human"), false, "el handoff vive en el Gate, no en el grafo");
  });

  it("7. §H los guardrails NO están en el grafo: start entra a welcome (message), sin condition nodes", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true }), policies: { prohibitions: [{ id: "pm", description: "No mascotas en estudio", scope: "contextual", action: "BLOCK", response: "En estudio no se permiten mascotas.", priority: 5, condition: { match: "all", rules: [{ field: "session_type", operator: "equals", value: "estudio" }, { field: "message", operator: "contains", value: "mascota" }] } }], rules: [] } }));
    const startEdge = f.edges.find((e) => e.source === "start")!;
    assert.equal(nodo(f, startEdge.target)!.id, "welcome");
    assert.equal(f.nodes.some((n) => n.type === "condition"), false, "sin condition nodes de guardrail en el grafo");
  });

  it("8. §H la prohibición se conserva en la IR/Gate (buildGateRules), no en el grafo", () => {
    const spec = specBase({ capabilities: caps({ faq: true }), policies: { prohibitions: [{ id: "pm", description: "x", scope: "contextual", action: "BLOCK", response: "no", priority: 5, condition: { match: "all", rules: [{ field: "session_type", operator: "equals", value: "estudio" }, { field: "message", operator: "contains", value: "mascota" }] } }], rules: [] } });
    const ir = irDe(spec);
    const f = compileIRToFlowDefinition(ir, CTX);
    assert.ok(f.success && f.flow.nodes.every((n) => n.type !== "condition"));
    const gate = buildGateRules(ir).find((r) => r.id === "pm");
    assert.ok(gate && gate.evaluation === "deterministic" && gate.condition?.rules.length === 2 && gate.condition?.match === "all");
  });

  it("9. §2 CATALOG: propose_action autoriza la tool real y hay ACTION cableada por success", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, catalog: true }), catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: false } }));
    const ai = nodo(f, "ai-catalog-propose");
    assert.ok(ai && ai.type === "ai" && ai.config.mode === "propose_action");
    assert.ok(aiAllowed(ai).includes("listar_catalogo_servicios"));
    // propose_action --success--> action(listar_catalogo_servicios)
    assert.ok(tieneEdge(f, "ai-catalog-propose", "act-catalog", "success"));
    const act = nodo(f, "act-catalog");
    assert.ok(act && act.type === "action" && act.config.actionType === "listar_catalogo_servicios");
  });

  it("10. §D precios NUNCA embebidos en el FlowDefinition serializado", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, catalog: true, sales: true, scheduling: true }), catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: false }, scheduling: { enabled: true, provider: "internal", timezone: "America/Bogota", minNoticeMinutes: 60, cancellation: { allowed: true, minNoticeHours: 24 }, confirmation: { required: true, hoursBefore: 24 }, resources: [] } }));
    const serial = JSON.stringify(f);
    assert.ok(!/\$\s?\d|\d{1,3}(?:\.\d{3})+/.test(serial), "no debe haber precios en el grafo");
  });

  it("11. §2 tools por estado: QUALIFICATION es question (sin tools); QUOTING propone su tool real", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, catalog: true, sales: true }) }));
    assert.equal(nodo(f, "q-qualify")?.type, "question");
    const quote = nodo(f, "ai-quote-propose");
    assert.ok(quote && quote.type === "ai" && quote.config.mode === "propose_action");
    assert.ok(aiAllowed(quote).includes("consultar_disponibilidad_catalogo"));
    assert.ok(tieneEdge(f, "ai-quote-propose", "act-quote", "success"));
  });

  it("12. variables declaradas incluyen las de los question de captura", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, leadCapture: true, catalog: true }), catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: false } }));
    const keys = new Set(f.variables.map((v) => v.key));
    assert.ok(keys.has("user_request"));
    assert.ok(keys.has("customer_name"));
    assert.ok(keys.has("service_choice"));
  });

  it("13-15. grafo completo válido (edges consistentes, validateFlowForPublish)", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, catalog: true, sales: true, leadCapture: true, scheduling: true, humanHandoff: true }), scheduling: { enabled: true, provider: "nylas", timezone: "America/Bogota", minNoticeMinutes: 30, cancellation: { allowed: true, minNoticeHours: 12 }, confirmation: { required: true, hoursBefore: 12 }, resources: [{ kind: "specialist", label: "Pro", required: true }], businessHours: BH_TEST }, handoff: { rules: [{ id: "h", description: "asesor", trigger: { kind: "keyword", keywords: ["asesor"] }, action: "TRANSFER_HUMAN" }], defaultPauseHours: 1 }, policies: { prohibitions: [{ id: "pm", description: "x", scope: "contextual", action: "TRANSFER_HUMAN", priority: 3, condition: { match: "all", rules: [{ field: "message", operator: "contains", value: "descuento" }] } }], rules: [] } }));
    const nodeIds = new Set(f.nodes.map((n) => n.id));
    for (const e of f.edges) { assert.ok(nodeIds.has(e.source), `source ${e.source}`); assert.ok(nodeIds.has(e.target), `target ${e.target}`); }
    const vp = validateFlowForPublish(f);
    assert.equal(vp.valid, true, JSON.stringify(vp.errors));
  });

  it("16-17. §10 determinismo e idempotencia (mismo flow y checksum)", () => {
    const spec = specBase({ capabilities: caps({ faq: true, catalog: true, sales: true, humanHandoff: true }) });
    const ir = irDe(spec);
    const a = compileIRToFlowDefinition(ir, CTX);
    const b = compileIRToFlowDefinition(ir, CTX);
    assert.equal(a.success && b.success, true);
    if (a.success && b.success) {
      assert.deepEqual(a.flow, b.flow);
      assert.equal(a.checksum, b.checksum);
    }
  });

  it("18. IR imposible de representar (FIXED_RESPONSE sin respuesta) => ERROR", () => {
    const ir = irDe(specBase());
    const roto: CompiledBusinessAgentIR = { ...ir, guardrails: [...ir.guardrails, { id: "bad", source: { kind: "prohibition", prohibitionId: "bad" }, execution: "PRE_LLM", scope: "business", action: "FIXED_RESPONSE", priority: 0, runtimeBinding: null }] };
    const r = compileIRToFlowDefinition(roto, CTX);
    assert.equal(r.success, false);
    assert.ok(!r.success && r.diagnostics.some((d) => d.code === "GUARDRAIL_NO_RESPONSE"));
  });

  it("19. integración con validateFlowDefinition (grafo generado es válido)", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, catalog: true, sales: true, leadCapture: true }) }));
    assert.equal(validateFlowDefinition(f).valid, true);
  });

  it("20. §J tenant isolation: contexto con otro tenant => ERROR (no cross-tenant)", () => {
    const ir = irDe(specBase());
    const r = compileIRToFlowDefinition(ir, { tenantId: "99999999-9999-4999-8999-999999999999" });
    assert.equal(r.success, false);
    assert.ok(!r.success && r.diagnostics.some((d) => d.code === "TENANT_MISMATCH"));
  });
});

describe("Agent Compiler — mismo motor, múltiples industrias (fixtures)", () => {
  const industrias: { nombre: string; spec: BusinessAgentSpec }[] = [
    {
      nombre: "photography (studio/exterior)",
      spec: specBase({
        identity: { businessName: "Estudio Luz", agentName: "Foto", language: "es-CO", timezone: "America/Bogota" },
        capabilities: caps({ faq: true, catalog: true, sales: true, leadCapture: true, scheduling: true, humanHandoff: true }),
        catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: false },
        scheduling: { enabled: true, provider: "internal", timezone: "America/Bogota", minNoticeMinutes: 120, cancellation: { allowed: true, minNoticeHours: 48 }, confirmation: { required: true, hoursBefore: 48 }, resources: [{ kind: "photographer", label: "Fotógrafo", required: true }, { kind: "studio", label: "Estudio", required: false }] },
        policies: { prohibitions: [{ id: "pets", description: "No mascotas en estudio", scope: "contextual", action: "BLOCK", response: "En estudio no se permiten mascotas; en exteriores sí.", priority: 10, condition: { match: "all", rules: [{ field: "session_type", operator: "equals", value: "estudio" }, { field: "message", operator: "contains", value: "mascota" }] } }], rules: [{ id: "arrive", description: "Llegar 15 min antes", kind: "reminder", priority: 1 }] },
      }),
    },
    {
      nombre: "beauty/salon (haircut/nails)",
      spec: specBase({
        identity: { businessName: "Salón Bella", agentName: "Bella", language: "es-CO", timezone: "America/Bogota" },
        capabilities: caps({ faq: true, catalog: true, sales: true, scheduling: true, humanHandoff: true }),
        catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: false },
        scheduling: { enabled: true, provider: "nylas", timezone: "America/Bogota", minNoticeMinutes: 60, cancellation: { allowed: true, minNoticeHours: 12 }, confirmation: { required: true, hoursBefore: 12 }, resources: [{ kind: "specialist", label: "Especialista", required: true }], businessHours: BH_TEST },
        handoff: { rules: [{ id: "queja", description: "queja", trigger: { kind: "complaint" }, action: "FIXED_RESPONSE_THEN_PAUSE", response: "Lamento lo ocurrido, te comunico con una persona.", pauseHours: 2 }], defaultPauseHours: 1 },
      }),
    },
    {
      nombre: "retail (clothing)",
      spec: specBase({
        identity: { businessName: "Tienda Wear", agentName: "Wear", language: "es-CO", timezone: "America/Bogota" },
        capabilities: caps({ faq: true, catalog: true, leadCapture: true }),
        catalog: { source: "structured", useServices: false, useProducts: true, quoteBeforeQualification: true },
      }),
    },
  ];

  for (const { nombre, spec } of industrias) {
    it(`fixture ${nombre}: compila a un FlowDefinition publicable (sin if industry)`, () => {
      const f = flowDe(spec);
      assert.equal(validateFlowDefinition(f).valid, true, JSON.stringify(validateFlowDefinition(f).errors));
      assert.equal(validateFlowForPublish(f).valid, true, JSON.stringify(validateFlowForPublish(f).errors));
      assert.ok(nodo(f, "start") && nodo(f, "end") && nodo(f, "welcome"));
      assert.ok(!/\$\s?\d/.test(JSON.stringify(f)), "sin precios embebidos");
    });
  }
});
