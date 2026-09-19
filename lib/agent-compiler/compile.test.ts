/**
 * Agent Compiler (Fase 1) — Step 5: núcleo (Spec -> Semantic Analysis -> IR).
 * 18 tests offline. No genera FlowDefinition ni publica.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileBusinessAgent, type CompilerContext } from "@/lib/agent-compiler/compile";
import { nuevaSpecMetadata } from "@/lib/agent-compiler/spec/version";
import type { AgentCapabilities, BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";

const NOW = "2026-09-18T00:00:00.000Z";
const CTX: CompilerContext = { tenantId: "11111111-1111-1111-1111-111111111111" };

function caps(p: Partial<AgentCapabilities>): AgentCapabilities {
  return { faq: false, sales: false, catalog: false, leadCapture: false, scheduling: false, orders: false, payments: false, humanHandoff: false, ...p };
}

function specBase(overrides: Partial<BusinessAgentSpec> = {}): BusinessAgentSpec {
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
    ...overrides,
  };
}

function estados(ir: { states: { id: string }[] }): string[] {
  return ir.states.map((s) => s.id);
}

describe("Agent Compiler — núcleo (IR)", () => {
  it("1. BusinessAgentSpec mínimo compila", () => {
    const r = compileBusinessAgent(specBase(), CTX);
    assert.equal(r.success, true);
    if (!r.success) return;
    assert.deepEqual(estados(r.ir), ["WELCOME", "INFORMATION", "COMPLETED"]);
    assert.equal(r.ir.tenantId, CTX.tenantId);
  });

  it("2. agente con ventas genera QUOTING", () => {
    const r = compileBusinessAgent(specBase({ capabilities: caps({ faq: true, catalog: true, sales: true }) }), CTX);
    assert.equal(r.success, true);
    if (!r.success) return;
    assert.ok(estados(r.ir).includes("QUOTING"));
  });

  it("3. agente con catálogo produce catalog binding a datos estructurados", () => {
    const r = compileBusinessAgent(specBase({ capabilities: caps({ faq: true, catalog: true }), catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: false } }), CTX);
    assert.equal(r.success, true);
    if (!r.success) return;
    assert.ok(estados(r.ir).includes("CATALOG"));
    assert.equal(r.ir.catalogBindings[0]!.source, "dulabs_servicios");
    assert.equal(r.ir.catalogBindings[0]!.access, "internal-action-executor");
    assert.ok(r.ir.catalogBindings[0]!.actions.includes("listar_catalogo_servicios"));
  });

  it("4. agente con prohibiciones genera guardrails PRE_LLM ordenados por prioridad", () => {
    const spec = specBase({
      capabilities: caps({ faq: true, humanHandoff: true }),
      policies: { prohibitions: [
        { id: "p-low", description: "regla baja", scope: "business", action: "FIXED_RESPONSE", response: "no", priority: 1 },
        { id: "p-high", description: "regla alta", scope: "business", action: "TRANSFER_HUMAN", priority: 9 },
      ], rules: [] },
    });
    const r = compileBusinessAgent(spec, CTX);
    assert.equal(r.success, true);
    if (!r.success) return;
    assert.equal(r.ir.guardrails[0]!.id, "p-high", "mayor prioridad primero");
    assert.ok(r.ir.guardrails.every((g) => g.execution === "PRE_LLM"));
    assert.equal(r.ir.guardrails.find((g) => g.id === "p-high")!.runtimeBinding, "transferir_soporte");
  });

  it("5. agente con reglas produce rules IR", () => {
    const r = compileBusinessAgent(specBase({ policies: { prohibitions: [], rules: [{ id: "r1", description: "Llegar 15 min antes", kind: "reminder", priority: 1 }] } }), CTX);
    assert.equal(r.success, true);
    if (!r.success) return;
    assert.equal(r.ir.rules[0]!.kind, "reminder");
  });

  it("6. human handoff: estado HUMAN_TRANSFER + bindings + escape transitions", () => {
    const spec = specBase({ capabilities: caps({ faq: true, humanHandoff: true }), handoff: { rules: [{ id: "h1", description: "pide humano", trigger: { kind: "agent_request" }, action: "TRANSFER_HUMAN", pauseHours: 2 }], defaultPauseHours: 1 } });
    const r = compileBusinessAgent(spec, CTX);
    assert.equal(r.success, true);
    if (!r.success) return;
    assert.ok(estados(r.ir).includes("HUMAN_TRANSFER"));
    assert.equal(r.ir.handoff[0]!.runtimeBinding, "transferir_soporte");
    assert.ok(r.ir.transitions.some((t) => t.kind === "escape_to_transfer" && t.to === "HUMAN_TRANSFER"));
  });

  it("7. scheduling: BOOKING + provider disponible; provider no soportado => error", () => {
    const ok = compileBusinessAgent(specBase({ capabilities: caps({ faq: true, scheduling: true }), scheduling: { enabled: true, provider: "internal", timezone: "America/Bogota", minNoticeMinutes: 60, cancellation: { allowed: true, minNoticeHours: 24 }, confirmation: { required: true, hoursBefore: 24 }, resources: [{ kind: "specialist", label: "Pro", required: true }] } }), CTX);
    assert.equal(ok.success, true);
    if (ok.success) {
      assert.ok(estados(ok.ir).includes("BOOKING"));
      assert.equal(ok.ir.scheduling.available, true);
    }
    const bad = compileBusinessAgent(specBase({ capabilities: caps({ faq: true, scheduling: true }), scheduling: { enabled: true, provider: "google_calendar", timezone: "America/Bogota", minNoticeMinutes: 60, cancellation: { allowed: true, minNoticeHours: 24 }, confirmation: { required: true, hoursBefore: 24 }, resources: [] } }), CTX);
    assert.equal(bad.success, false);
    assert.ok(bad.diagnostics.some((d) => d.code === "SCHEDULING_PROVIDER_UNSUPPORTED" && d.severity === "error"));
  });

  it("8. combinación de capabilities activa múltiples estados", () => {
    const r = compileBusinessAgent(specBase({ capabilities: caps({ faq: true, catalog: true, sales: true, leadCapture: true, humanHandoff: true }) }), CTX);
    assert.equal(r.success, true);
    if (!r.success) return;
    for (const s of ["WELCOME", "IDENTIFICATION", "QUALIFICATION", "CATALOG", "QUOTING", "HUMAN_TRANSFER", "COMPLETED"]) assert.ok(estados(r.ir).includes(s), `falta ${s}`);
  });

  it("9. capability sin backing (payments) => ERROR, no IR", () => {
    const r = compileBusinessAgent(specBase({ capabilities: caps({ faq: true, payments: true }) }), CTX);
    assert.equal(r.success, false);
    assert.ok(r.diagnostics.some((d) => d.severity === "error" && (d.code === "CAPABILITY_UNAVAILABLE" || d.code === "CAPABILITY_NO_BACKING")));
  });

  it("10. policy contextual conserva el contexto (MASCOTA + ESTUDIO)", () => {
    const spec = specBase({
      capabilities: caps({ faq: true }),
      policies: { prohibitions: [{ id: "pm", description: "No mascotas en estudio", scope: "contextual", action: "BLOCK", response: "En estudio no se permiten mascotas.", priority: 5, condition: { match: "all", rules: [{ field: "session_type", operator: "equals", value: "estudio" }, { field: "message", operator: "contains", value: "mascota" }] } }], rules: [] },
    });
    const r = compileBusinessAgent(spec, CTX);
    assert.equal(r.success, true);
    if (!r.success) return;
    const g = r.ir.guardrails[0]!;
    assert.equal(g.scope, "contextual");
    assert.equal(g.condition?.rules.length, 2, "no se reduce a keyword global");
  });

  it("11. catalog binding: los precios NUNCA entran a la IR como texto", () => {
    const r = compileBusinessAgent(specBase({ capabilities: caps({ faq: true, catalog: true }), catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: false } }), CTX);
    assert.equal(r.success, true);
    if (!r.success) return;
    const serial = JSON.stringify(r.ir);
    assert.ok(!/\$\d|precio.*\d{3,}/i.test(serial), "la IR no debe contener precios embebidos");
    assert.equal(r.ir.catalogBindings[0]!.access, "internal-action-executor");
  });

  it("12. personalidad => parámetros de comportamiento (no un prompt gigante)", () => {
    const r = compileBusinessAgent(specBase(), CTX);
    assert.equal(r.success, true);
    if (!r.success) return;
    assert.equal(r.ir.personality.primary, "professional");
    assert.ok(r.ir.personality.styleHints.length >= 3 && r.ir.personality.styleHints.length <= 6);
  });

  it("13. knowledge secondary en la IR", () => {
    const r = compileBusinessAgent(specBase({ knowledge: { authority: "secondary", documents: [{ id: "d1", filename: "x.pdf", uploadedAt: NOW }] } }), CTX);
    assert.equal(r.success, true);
    if (!r.success) return;
    assert.equal(r.ir.knowledge.authority, "secondary");
    assert.deepEqual(r.ir.knowledge.documentIds, ["d1"]);
  });

  it("14. tenant isolation: tenantId viene del contexto; inyectarlo en el Spec => ERROR", () => {
    const inyectado = { ...specBase(), identity: { ...specBase().identity, id_tenant: "otro" } } as unknown;
    const r = compileBusinessAgent(inyectado, CTX);
    assert.equal(r.success, false);
    assert.ok(r.diagnostics.some((d) => d.code === "SPEC_TENANT_INJECTION"));

    const ok = compileBusinessAgent(specBase(), CTX);
    assert.equal(ok.success, true);
    if (ok.success) assert.equal(ok.ir.tenantId, CTX.tenantId);
  });

  it("15. determinismo: mismo Spec+contexto => IR igual", () => {
    const spec = specBase({ capabilities: caps({ faq: true, catalog: true, sales: true, humanHandoff: true }) });
    const a = compileBusinessAgent(spec, CTX);
    const b = compileBusinessAgent(spec, CTX);
    assert.equal(a.success && b.success, true);
    if (a.success && b.success) assert.deepEqual(a.ir, b.ir);
  });

  it("16. idempotencia: mismo checksum; distinto Spec => distinto checksum", () => {
    const a = compileBusinessAgent(specBase(), CTX);
    const b = compileBusinessAgent(specBase(), CTX);
    const c = compileBusinessAgent(specBase({ identity: { ...specBase().identity, agentName: "Otro" } }), CTX);
    assert.equal(a.success && b.success && c.success, true);
    if (a.success && b.success && c.success) {
      assert.equal(a.ir.checksum, b.ir.checksum);
      assert.notEqual(a.ir.checksum, c.ir.checksum);
    }
  });

  it("17. diagnóstico estructurado (code/severity/phase)", () => {
    const r = compileBusinessAgent(specBase({ capabilities: caps({ faq: true, payments: true }) }), CTX);
    assert.equal(r.success, false);
    const d = r.diagnostics.find((x) => x.severity === "error")!;
    assert.ok(typeof d.code === "string" && d.code.length > 0);
    assert.ok(["validation", "semantic_analysis", "ir_generation"].includes(d.phase));
  });

  it("18. configuración inválida (enum) => ERROR en fase validation", () => {
    const bad = { ...specBase(), personality: { ...specBase().personality, primary: "grumpy" } } as unknown;
    const r = compileBusinessAgent(bad, CTX);
    assert.equal(r.success, false);
    assert.ok(r.diagnostics.some((d) => d.phase === "validation" && d.severity === "error"));
  });
});
