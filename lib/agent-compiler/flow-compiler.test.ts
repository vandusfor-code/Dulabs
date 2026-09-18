/**
 * Agent Compiler (Fase 1) — Step 6: IR → FlowDefinition.
 * 20 tests offline + 3 fixtures de industria (photography / salon / retail).
 * Pipeline real: Spec → compileBusinessAgent → compileIRToFlowDefinition →
 * validateFlowDefinition (API existente de lib/flow).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileBusinessAgent } from "@/lib/agent-compiler/compile";
import { compileIRToFlowDefinition } from "@/lib/agent-compiler/flow-compiler";
import { validateFlowDefinition } from "@/lib/flow/validate-graph";
import { nuevaSpecMetadata } from "@/lib/agent-compiler/spec/version";
import type { AgentCapabilities, BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import type { CompiledBusinessAgentIR } from "@/lib/agent-compiler/ir";
import type { FlowDefinition, FlowNode } from "@/lib/flow/types";

const NOW = "2026-09-18T00:00:00.000Z";
const CTX = { tenantId: "11111111-1111-1111-1111-111111111111" };

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

describe("Agent Compiler — IR → FlowDefinition", () => {
  it("1. flow mínimo válido pasa validateFlowDefinition", () => {
    const f = flowDe(specBase());
    assert.equal(validateFlowDefinition(f).valid, true);
    assert.ok(nodo(f, "start") && nodo(f, "end"));
  });

  it("2. WELCOME → IDENTIFICATION cuando leadCapture activo", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, leadCapture: true }) }));
    assert.ok(tieneEdge(f, "st:WELCOME", "st:IDENTIFICATION"));
  });

  it("3. qualification flow: QUALIFICATION antes de QUOTING", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, catalog: true, sales: true }) }));
    assert.ok(nodo(f, "st:QUALIFICATION") && nodo(f, "st:QUOTING"));
    // La máquina de estados fuerza calificar antes de cotizar: QUOTING no es
    // accesible directo desde el inicio y va después de CATALOG.
    assert.ok(tieneEdge(f, "st:CATALOG", "st:QUOTING"));
    assert.ok(!tieneEdge(f, "start", "st:QUOTING") && !tieneEdge(f, "st:WELCOME", "st:QUOTING"));
    assert.equal(validateFlowDefinition(f).valid, true);
  });

  it("4. estados dependientes de capability: scheduling agrega BOOKING", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, scheduling: true }), scheduling: { enabled: true, provider: "internal", timezone: "America/Bogota", minNoticeMinutes: 60, cancellation: { allowed: true, minNoticeHours: 24 }, confirmation: { required: true, hoursBefore: 24 }, resources: [] } }));
    assert.ok(nodo(f, "st:BOOKING"));
  });

  it("5. scheduling desactivado NO genera BOOKING", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true }) }));
    assert.equal(nodo(f, "st:BOOKING"), undefined);
  });

  it("6. human handoff genera rama EXCLUSIVA (human vía interceptor, no en el flujo lineal)", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, humanHandoff: true }), handoff: { rules: [{ id: "h1", description: "asesor", trigger: { kind: "keyword", keywords: ["asesor", "humano"] }, action: "TRANSFER_HUMAN", pauseHours: 2 }], defaultPauseHours: 1 } }));
    const human = f.nodes.find((n) => n.type === "human");
    assert.ok(human, "hay nodo human");
    // El human se alcanza por la rama true de un condition (interceptor), no por el flujo principal.
    assert.ok(f.edges.some((e) => e.target === human!.id && e.sourceHandle === "true"));
    assert.ok(!tieneEdge(f, "st:WELCOME", human!.id));
    assert.equal(validateFlowDefinition(f).valid, true);
  });

  it("7. guardrail contextual se evalúa ANTES del AI (start → condition → main)", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true }), policies: { prohibitions: [{ id: "pm", description: "No mascotas en estudio", scope: "contextual", action: "BLOCK", response: "En estudio no se permiten mascotas.", priority: 5, condition: { match: "all", rules: [{ field: "session_type", operator: "equals", value: "estudio" }, { field: "message", operator: "contains", value: "mascota" }] } }], rules: [] } }));
    const startEdge = f.edges.find((e) => e.source === "start")!;
    assert.equal(nodo(f, startEdge.target)!.type, "condition", "start entra primero a un guardrail");
  });

  it("8. guardrail contextual preserva las 2 reglas (ESTUDIO + MASCOTA)", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true }), policies: { prohibitions: [{ id: "pm", description: "x", scope: "contextual", action: "BLOCK", response: "no", priority: 5, condition: { match: "all", rules: [{ field: "session_type", operator: "equals", value: "estudio" }, { field: "message", operator: "contains", value: "mascota" }] } }], rules: [] } }));
    const cond = f.nodes.find((n) => n.type === "condition");
    assert.ok(cond && cond.type === "condition");
    assert.equal(cond.config.rules.length, 2);
    assert.equal(cond.config.match, "all");
  });

  it("9. catalog tool binding: el AI de CATALOG autoriza listar_catalogo_servicios", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, catalog: true }), catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: false } }));
    const cat = nodo(f, "st:CATALOG");
    assert.ok(cat && cat.type === "ai" && (cat.config.allowedTools ?? []).includes("listar_catalogo_servicios"));
  });

  it("10. precios NUNCA embebidos en el FlowDefinition", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, catalog: true, sales: true }), catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: false } }));
    const serial = JSON.stringify(f);
    // Un precio embebido se vería como "$350.000" o "350.000" (formato COP).
    assert.ok(!/\$\s?\d|\d{1,3}(?:\.\d{3})+/.test(serial), "no debe haber precios en el grafo");
  });

  it("11. tools limitadas por estado: QUALIFICATION sin tools; QUOTING con tool de precio", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, catalog: true, sales: true }) }));
    const q = nodo(f, "st:QUALIFICATION");
    const quote = nodo(f, "st:QUOTING");
    assert.deepEqual(q!.type === "ai" ? q.config.allowedTools : ["x"], []);
    assert.ok(quote && quote.type === "ai" && (quote.config.allowedTools ?? []).includes("consultar_disponibilidad_catalogo"));
  });

  it("12. variables declaradas incluyen las de condiciones y outputs", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, leadCapture: true }), policies: { prohibitions: [{ id: "p", description: "x", scope: "contextual", action: "BLOCK", response: "no", priority: 1, condition: { match: "all", rules: [{ field: "session_type", operator: "equals", value: "estudio" }] } }], rules: [] } }));
    const keys = new Set(f.variables.map((v) => v.key));
    assert.ok(keys.has("session_type"), "campo de condición declarado");
    assert.ok(keys.has("message"));
  });

  it("13-15. edges válidos, sin huérfanos ni edges inválidos (validateFlowDefinition)", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, catalog: true, sales: true, leadCapture: true, scheduling: true, humanHandoff: true }), scheduling: { enabled: true, provider: "nylas", timezone: "America/Bogota", minNoticeMinutes: 30, cancellation: { allowed: true, minNoticeHours: 12 }, confirmation: { required: true, hoursBefore: 12 }, resources: [{ kind: "specialist", label: "Pro", required: true }] }, handoff: { rules: [{ id: "h", description: "asesor", trigger: { kind: "keyword", keywords: ["asesor"] }, action: "TRANSFER_HUMAN" }], defaultPauseHours: 1 }, policies: { prohibitions: [{ id: "pm", description: "x", scope: "contextual", action: "TRANSFER_HUMAN", priority: 3, condition: { match: "all", rules: [{ field: "message", operator: "contains", value: "descuento" }] } }], rules: [] } }));
    const nodeIds = new Set(f.nodes.map((n) => n.id));
    for (const e of f.edges) { assert.ok(nodeIds.has(e.source), `source ${e.source}`); assert.ok(nodeIds.has(e.target), `target ${e.target}`); }
    assert.equal(validateFlowDefinition(f).valid, true, JSON.stringify(validateFlowDefinition(f).errors));
  });

  it("16-17. determinismo e idempotencia (mismo flow y checksum)", () => {
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
    assert.ok(r.diagnostics.some((d) => d.code === "GUARDRAIL_NO_RESPONSE"));
  });

  it("19. integración con validateFlowDefinition (grafo generado es válido)", () => {
    const f = flowDe(specBase({ capabilities: caps({ faq: true, catalog: true, sales: true, leadCapture: true }) }));
    assert.equal(validateFlowDefinition(f).valid, true);
  });

  it("20. tenant isolation: contexto con otro tenant => ERROR (no cross-tenant)", () => {
    const ir = irDe(specBase());
    const r = compileIRToFlowDefinition(ir, { tenantId: "99999999-9999-9999-9999-999999999999" });
    assert.equal(r.success, false);
    assert.ok(r.diagnostics.some((d) => d.code === "TENANT_MISMATCH"));
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
        scheduling: { enabled: true, provider: "nylas", timezone: "America/Bogota", minNoticeMinutes: 60, cancellation: { allowed: true, minNoticeHours: 12 }, confirmation: { required: true, hoursBefore: 12 }, resources: [{ kind: "specialist", label: "Especialista", required: true }] },
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
    it(`fixture ${nombre}: compila a un FlowDefinition válido`, () => {
      const f = flowDe(spec);
      const v = validateFlowDefinition(f);
      assert.equal(v.valid, true, JSON.stringify(v.errors));
      assert.ok(nodo(f, "start") && nodo(f, "end") && nodo(f, "st:WELCOME"));
      const serial = JSON.stringify(f);
      assert.ok(!/\$\s?\d/.test(serial), "sin precios embebidos");
    });
  }
});
