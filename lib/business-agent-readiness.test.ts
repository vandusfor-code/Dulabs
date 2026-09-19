/**
 * R8 — validador final de publicación: cada capacidad activa exige lo que necesita para FUNCIONAR de verdad; nada se
 * publica prometiendo algo que el runtime no hace. Puro (los hechos del tenant llegan como datos).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateReadiness, type ReadinessFacts } from "@/lib/business-agent-readiness";
import { nuevaSpecMetadata } from "@/lib/agent-compiler/spec/version";
import type { AgentCapabilities, BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";

const HORARIO = { week: Array.from({ length: 7 }, () => ({ closed: false, intervals: [{ open: "08:00", close: "18:00" }] })), exceptions: [] };
const LISTO: ReadinessFacts = { activeServices: 3, activeProducts: 2, hasKnowledge: true, calendarConnected: true };
const VACIO: ReadinessFacts = { activeServices: 0, activeProducts: 0, hasKnowledge: false, calendarConnected: false };

function caps(p: Partial<AgentCapabilities>): AgentCapabilities {
  return { faq: false, sales: false, catalog: false, leadCapture: false, scheduling: false, orders: false, payments: false, humanHandoff: false, ...p };
}
function spec(over: Partial<BusinessAgentSpec> = {}): BusinessAgentSpec {
  return {
    schemaVersion: "1.0.0",
    identity: { businessName: "Negocio", agentName: "Ana", language: "es-CO", timezone: "America/Bogota" },
    personality: { primary: "professional", verbosity: "balanced", emojiPolicy: "limited", formality: "neutral" },
    capabilities: caps({}),
    catalog: { source: "structured", useServices: false, useProducts: false, quoteBeforeQualification: false },
    policies: { prohibitions: [], rules: [] },
    handoff: { rules: [], defaultPauseHours: 12 },
    scheduling: { enabled: false, provider: "none", timezone: "America/Bogota", minNoticeMinutes: 60, cancellation: { allowed: false, minNoticeHours: 24 }, confirmation: { required: false, hoursBefore: 24 }, resources: [] },
    knowledge: { authority: "secondary", documents: [] },
    metadata: nuevaSpecMetadata("2026-09-19T00:00:00.000Z"),
    ...over,
  };
}
const agenda = (over: Partial<BusinessAgentSpec["scheduling"]> = {}, extra: Partial<BusinessAgentSpec> = {}) =>
  spec({ capabilities: caps({ scheduling: true }), scheduling: { enabled: true, provider: "nylas", timezone: "America/Bogota", minNoticeMinutes: 45, cancellation: { allowed: true, minNoticeHours: 24 }, confirmation: { required: false, hoursBefore: 24 }, resources: [], businessHours: HORARIO, ...over }, ...extra });
const codes = (r: ReturnType<typeof evaluateReadiness>, sev: "blockers" | "warnings" = "blockers") => r[sev].map((i) => i.code);

describe("R8 — agendamiento", () => {
  it("1. Nylas completo (servicios + horario + calendario conectado) => LISTO", () => {
    const r = evaluateReadiness(agenda(), LISTO);
    assert.equal(r.ready, true, JSON.stringify(r.blockers));
    assert.deepEqual(r.blockers, []);
  });

  it("2. sin servicio activo => MISSING_SERVICES; sin calendario => CALENDAR_NOT_CONNECTED; sin horario => BUSINESS_HOURS_MISSING", () => {
    const r = evaluateReadiness(agenda({ businessHours: { week: HORARIO.week.map(() => ({ closed: true, intervals: [] })), exceptions: [] } }), VACIO);
    assert.equal(r.ready, false);
    assert.deepEqual(codes(r).sort(), ["BUSINESS_HOURS_MISSING", "CALENDAR_NOT_CONNECTED", "MISSING_SERVICES"]);
    // Cada bloqueo dice DÓNDE arreglarlo.
    assert.ok(r.blockers.every((b) => !!b.step));
  });

  it("3. provider interno: no exige calendario Nylas; advierte de especialistas y de que cancelar/cambiar no aplica", () => {
    const r = evaluateReadiness(agenda({ provider: "internal" }), { ...LISTO, calendarConnected: false });
    assert.equal(r.ready, true);
    assert.ok(codes(r, "warnings").includes("INTERNAL_PROVIDER_SPECIALISTS"));
    assert.ok(codes(r, "warnings").includes("CANCELLATION_NOT_APPLICABLE"));
  });

  it("4. sin agenda NO se pide calendario ni horario (cada módulo solo con su capacidad)", () => {
    const r = evaluateReadiness(spec({ capabilities: caps({ faq: true }) }), { ...VACIO, hasKnowledge: true });
    assert.equal(r.ready, true);
  });
});

describe("R8 — catálogo, cotización y venta", () => {
  const cat = (over: Partial<BusinessAgentSpec["catalog"]>, c: Partial<AgentCapabilities> = {}) =>
    spec({ capabilities: caps({ catalog: true, ...c }), catalog: { source: "structured", useServices: false, useProducts: false, quoteBeforeQualification: false, ...over } });

  it("5. servicios => exige >=1 servicio; productos => exige >=1 producto; solo productos NO exige servicios", () => {
    assert.deepEqual(codes(evaluateReadiness(cat({ useServices: true }), VACIO)), ["MISSING_SERVICES"]);
    assert.deepEqual(codes(evaluateReadiness(cat({ useProducts: true }), VACIO)), ["MISSING_PRODUCTS"]);
    assert.equal(evaluateReadiness(cat({ useProducts: true }), { ...VACIO, activeProducts: 1 }).ready, true, "solo productos: sin servicios está bien");
    assert.equal(evaluateReadiness(cat({ useServices: true, useProducts: true }), LISTO).ready, true);
  });

  it("6. catálogo sin fuente elegida => CATALOG_SOURCE_MISSING (no se publica un catálogo vacío)", () => {
    assert.ok(codes(evaluateReadiness(cat({}), LISTO)).includes("CATALOG_SOURCE_MISSING"));
  });

  it("7. cotizar sin 'Transferir a un humano' => ADVERTENCIA honesta (cotiza pero no concreta); con transferencia no advierte", () => {
    const sin = evaluateReadiness(cat({ useServices: true }, { sales: true }), LISTO);
    assert.equal(sin.ready, true);
    assert.deepEqual(codes(sin, "warnings"), ["SALES_NO_HANDOFF"]);
    const con = evaluateReadiness(cat({ useServices: true }, { sales: true, humanHandoff: true }), LISTO);
    assert.ok(!codes(con, "warnings").includes("SALES_NO_HANDOFF"));
  });

  it("8. pedidos y cobros NO se publican (no existen en el runtime): bloqueo, no solo un checkbox deshabilitado", () => {
    const r = evaluateReadiness(spec({ capabilities: caps({ orders: true, payments: true }) }), LISTO);
    assert.equal(r.ready, false);
    assert.deepEqual(codes(r), ["CAPABILITY_UNAVAILABLE", "CAPABILITY_UNAVAILABLE"]);
  });
});

describe("R8 — preguntas frecuentes y transferencia", () => {
  it("9. FAQ sin conocimiento => MISSING_KNOWLEDGE; con conocimiento => listo", () => {
    const s = spec({ capabilities: caps({ faq: true }) });
    assert.deepEqual(codes(evaluateReadiness(s, VACIO)), ["MISSING_KNOWLEDGE"]);
    assert.equal(evaluateReadiness(s, { ...VACIO, hasKnowledge: true }).ready, true);
  });

  it("10. transferencia sin NADA que la dispare => bloqueo; solo con disparadores automáticos => advertencia; con regla => limpio", () => {
    const solo = spec({ capabilities: caps({ humanHandoff: true }) });
    assert.deepEqual(codes(evaluateReadiness(solo, LISTO)), ["HANDOFF_NO_TRIGGER"]);
    // Con agenda, un fallo de reserva sí transfiere: listo pero avisa que el cliente no puede PEDIR una persona.
    const conAgenda = agenda({}, { capabilities: caps({ scheduling: true, humanHandoff: true }) });
    const r = evaluateReadiness(conAgenda, LISTO);
    assert.equal(r.ready, true);
    assert.deepEqual(codes(r, "warnings"), ["HANDOFF_NO_CUSTOMER_REQUEST"]);
    const conRegla = spec({ capabilities: caps({ humanHandoff: true }), handoff: { defaultPauseHours: 12, rules: [{ id: "h", description: "pide persona", trigger: { kind: "agent_request" }, action: "TRANSFER_HUMAN", response: "Te comunico." }] } });
    const limpio = evaluateReadiness(conRegla, LISTO);
    assert.equal(limpio.ready, true);
    assert.deepEqual(limpio.warnings, []);
  });

  it("11. FAQ con política 'transferir' cuenta como disparador", () => {
    const s = spec({ capabilities: caps({ faq: true, humanHandoff: true }), knowledge: { authority: "secondary", documents: [], onNoAnswer: "handoff" } });
    assert.ok(!codes(evaluateReadiness(s, LISTO)).includes("HANDOFF_NO_TRIGGER"));
  });
});

describe("R8 — resumen 'Tu agente está configurado para:'", () => {
  it("12. lista cada capacidad activa con datos REALES (conteos, política de citas, pausa)", () => {
    const s = agenda({}, {
      capabilities: caps({ scheduling: true, catalog: true, sales: true, faq: true, humanHandoff: true }),
      catalog: { source: "structured", useServices: true, useProducts: true, quoteBeforeQualification: false },
      handoff: { defaultPauseHours: 8, rules: [{ id: "h", description: "x", trigger: { kind: "agent_request" }, action: "TRANSFER_HUMAN", response: "ok" }] },
    });
    const r = evaluateReadiness(s, LISTO);
    assert.deepEqual(r.summary.map((x) => x.label), ["Agendar citas", "Mostrar catálogo", "Cotizar precios", "Responder preguntas frecuentes", "Transferir a una persona"]);
    const agendar = r.summary.find((x) => x.capability === "scheduling")!.details.join(" | ");
    assert.match(agendar, /Google Calendar \(Nylas\)/);
    assert.match(agendar, /3 servicios activos/);
    assert.match(agendar, /hasta 24 h antes/);
    assert.match(agendar, /Aviso mínimo: 45 min/);
    assert.match(r.summary.find((x) => x.capability === "catalog")!.details.join(" | "), /3 servicios.*2 productos/);
    assert.match(r.summary.find((x) => x.capability === "humanHandoff")!.details.join(" | "), /se pausa 8 h/);
  });

  it("13. sin capacidades => resumen vacío; es determinista (mismas entradas => mismo informe)", () => {
    assert.deepEqual(evaluateReadiness(spec(), LISTO).summary, []);
    const a = JSON.stringify(evaluateReadiness(agenda(), LISTO));
    assert.equal(a, JSON.stringify(evaluateReadiness(agenda(), LISTO)));
  });
});
