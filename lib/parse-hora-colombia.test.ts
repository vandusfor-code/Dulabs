import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHoraColombia } from "@/lib/parse-hora-colombia";
import { validateQuestionValue } from "@/lib/flow/flow-engine";
import { danielaAgendarCitaFlow } from "@/lib/flows/daniela-agendar-cita.flow";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import type { FlowEngineState } from "@/lib/flow/engine-types";

function parseFechaHora(fecha: string, hora: string): Date | null {
  const inicio = new Date(`${fecha}T${hora}:00-05:00`);
  return Number.isNaN(inicio.getTime()) ? null : inicio;
}

describe("parseHoraColombia — expresiones inequívocas", () => {
  const CASOS: Array<[string, string]> = [
    ["4 de la tarde", "16:00"],
    ["4 pm", "16:00"],
    ["4:00 pm", "16:00"],
    ["16:00", "16:00"],
    ["16 horas", "16:00"],
    ["a las cuatro de la tarde", "16:00"],
    ["a las 4 pm", "16:00"],
    ["4 de la tarde por favor", "16:00"],
    ["a las 10 de la mañana", "10:00"],
    ["8 de la noche", "20:00"],
  ];

  for (const [entrada, esperado] of CASOS) {
    it(`"${entrada}" → ${esperado}`, () => {
      const r = parseHoraColombia(entrada);
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.hhmm, esperado);
    });
  }
});

describe("parseHoraColombia — variantes razonables", () => {
  const CASOS: Array<[string, string]> = [
    ["4 p.m.", "16:00"],
    ["4 PM", "16:00"],
    ["4:00 PM", "16:00"],
    ["8 pm", "20:00"],
    ["10 de la mañana", "10:00"],
    ["  4 de la tarde  ", "16:00"],
    ["A LAS 4 PM", "16:00"],
  ];

  for (const [entrada, esperado] of CASOS) {
    it(`"${entrada.trim()}" → ${esperado}`, () => {
      const r = parseHoraColombia(entrada);
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.hhmm, esperado);
    });
  }
});

describe("parseHoraColombia — ambiguos (no inventar 16:00)", () => {
  for (const entrada of ["a las 4", "a las cuatro"]) {
    it(`"${entrada}" pide aclaración`, () => {
      const r = parseHoraColombia(entrada);
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.kind, "ambiguous");
        assert.match(r.message, /tarde|mañana/i);
        assert.doesNotMatch(r.message, /16:00/);
      }
    });
  }
});

describe("validateQuestionValue hora_colombia", () => {
  it("normaliza vía validation kind hora_colombia", () => {
    const r = validateQuestionValue({ kind: "hora_colombia" }, "4 de la tarde", true);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, "16:00");
  });

  it("ambiguos devuelven mensaje de aclaración", () => {
    const r = validateQuestionValue({ kind: "hora_colombia" }, "a las 4", true);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /tarde|mañana/i);
  });
});

function arrancarHastaQFecha(): { flow: ReturnType<typeof danielaAgendarCitaFlow>; state: FlowEngineState } {
  const flow = danielaAgendarCitaFlow();
  let state = createFlowEngineState(flow, {});
  state.variables = { ...state.variables, hoy: "2026-09-01" };
  let run = runFlowEngine(flow, state, { type: "start", text: "Quiero semipermanente" });
  state = run.state;
  assert.equal(state.pendingEffect?.nodeId, "ai-extraer");
  run = runFlowEngine(flow, state, {
    type: "effect_result",
    success: true,
    effectId: state.pendingEffect!.effectId,
    data: { servicio: "semipermanente" },
  });
  state = run.state;
  assert.equal(state.currentNodeId, "q-fecha");
  run = runFlowEngine(flow, state, { type: "text", text: "2026-10-16" });
  state = run.state;
  assert.equal(state.currentNodeId, "q-hora");
  return { flow, state };
}

describe("Integración q-hora → variables.hora (camino real del Flow)", () => {
  it('"4 de la tarde" en q-hora termina como variables.hora = "16:00"', () => {
    const { flow, state } = arrancarHastaQFecha();
    const run = runFlowEngine(flow, state, { type: "text", text: "4 de la tarde" });
    assert.equal(run.state.variables.hora, "16:00");
    assert.equal(run.state.currentNodeId, "q-nombre");
  });

  it('"a las 4" en q-hora NO avanza y pide aclaración', () => {
    const { flow, state } = arrancarHastaQFecha();
    const run = runFlowEngine(flow, state, { type: "text", text: "a las 4" });
    assert.equal(run.state.currentNodeId, "q-hora");
    assert.equal(run.state.variables.hora, undefined);
    assert.ok(run.effects.some((e) => e.type === "invalid_input"));
    const invalid = run.effects.find((e) => e.type === "invalid_input");
    assert.ok(invalid && invalid.type === "invalid_input");
    assert.match(invalid.message, /tarde|mañana/i);
  });

  it('parseFechaHora acepta la hora normalizada de q-hora', () => {
    const { flow, state } = arrancarHastaQFecha();
    const run = runFlowEngine(flow, state, { type: "text", text: "4 de la tarde" });
    const hora = String(run.state.variables.hora);
    const parsed = parseFechaHora("2026-10-16", hora);
    assert.ok(parsed);
    assert.equal(parsed!.getUTCHours(), 21); // 16:00 COT = 21:00 UTC
  });
});

describe("danielaAgendarCitaFlow — q-hora usa validation hora_colombia", () => {
  it("nodo q-hora configurado con hora_colombia", () => {
    const flow = danielaAgendarCitaFlow();
    const qHora = flow.nodes.find((n) => n.id === "q-hora");
    assert.ok(qHora && qHora.type === "question");
    if (qHora.type === "question") {
      assert.equal(qHora.config.validation.kind, "hora_colombia");
    }
  });
});
