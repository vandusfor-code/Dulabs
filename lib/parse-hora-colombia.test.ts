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

  it("un ambiguo también devuelve horaAmbigua (para que el caller la recuerde)", () => {
    const r = parseHoraColombia("a las 4");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.horaAmbigua, 4);
  });
});

// ---------------------------------------------------------------------------
// Bug real (Daniela) — la clienta contesta EXACTAMENTE lo que el bot le
// preguntó ("¿de la tarde o de la mañana?" -> "tarde") y antes no se
// reconocía en absoluto (caía a "invalid", el mensaje genérico de formato).
// ---------------------------------------------------------------------------
describe("parseHoraColombia — respuesta a la propia desambiguación (horaPendiente)", () => {
  it('"tarde" sola, sin horaPendiente -> sigue siendo inválida (nada que combinar)', () => {
    const r = parseHoraColombia("tarde");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.kind, "invalid");
  });

  it('"tarde" sola + horaPendiente=1 -> 13:00', () => {
    const r = parseHoraColombia("tarde", 1);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.hhmm, "13:00");
  });

  it('"mañana" sola + horaPendiente=9 -> 09:00 (mañana con hora ya AM no cambia la hora)', () => {
    const r = parseHoraColombia("mañana", 9);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.hhmm, "09:00");
  });

  it('"pm" (abreviado) + horaPendiente=7 -> 19:00', () => {
    const r = parseHoraColombia("pm", 7);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.hhmm, "19:00");
  });

  it("un mensaje que no es ni hora ni palabra de período, con horaPendiente presente, sigue inválido (no inventa nada)", () => {
    const r = parseHoraColombia("no sé todavía", 1);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.kind, "invalid");
  });

  it("si el mensaje SÍ trae su propia hora, horaPendiente se ignora (la hora nueva manda)", () => {
    const r = parseHoraColombia("5 de la tarde", 1);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.hhmm, "17:00");
  });
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

  it("ambiguos también exponen horaAmbigua para que el engine la recuerde", () => {
    const r = validateQuestionValue({ kind: "hora_colombia" }, "a las 4", true);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.horaAmbigua, 4);
  });

  it("context.horaPendiente combina una respuesta de solo período", () => {
    const r = validateQuestionValue({ kind: "hora_colombia" }, "tarde", true, { horaPendiente: 4 });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, "16:00");
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
  // act-validar-servicio corre ANTES de fecha/hora/nombre (ver
  // daniela-agendar-cita.flow.ts) -- mismo patrón de resolución que usa
  // daniela-agendar-cita.flow.test.ts para este mismo nodo.
  assert.equal(state.pendingEffect?.nodeId, "act-validar-servicio");
  run = runFlowEngine(flow, state, {
    type: "effect_result",
    success: true,
    effectId: state.pendingEffect!.effectId,
    data: { servicioReconocido: true },
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

  // ---------------------------------------------------------------------------
  // Bug real reportado: la clienta contesta "1", el bot pregunta "¿de la
  // tarde o de la mañana?", y ella contesta exactamente eso ("Tarde") --
  // antes el bot no lo entendía y repetía el mensaje genérico de formato en
  // un loop. Camino 100% real del engine, mismo helper que el resto del
  // archivo -- sin mockear nada de flow-engine.ts.
  // ---------------------------------------------------------------------------
  it('"1" (ambiguo) -> "Tarde" (solo la aclaración) -> variables.hora = "13:00", avanza a q-nombre', () => {
    const { flow, state } = arrancarHastaQFecha();

    const ambiguo = runFlowEngine(flow, state, { type: "text", text: "1" });
    assert.equal(ambiguo.state.currentNodeId, "q-hora", "sigue en q-hora, esperando la aclaración");
    assert.equal(ambiguo.state.variables.hora, undefined);
    const invalid = ambiguo.effects.find((e) => e.type === "invalid_input");
    assert.ok(invalid && invalid.type === "invalid_input");
    assert.match(invalid.message, /tarde|mañana/i);

    const aclarado = runFlowEngine(flow, ambiguo.state, { type: "text", text: "Tarde" });
    assert.equal(aclarado.state.variables.hora, "13:00", "antes de este fix, esto quedaba undefined y el bot repetía el mensaje de formato");
    assert.equal(aclarado.state.currentNodeId, "q-nombre");
  });

  it('"13 horas" en el mismo mensaje ya no es ambiguo -- resultado idéntico sin pasar por la desambiguación', () => {
    const { flow, state } = arrancarHastaQFecha();
    const run = runFlowEngine(flow, state, { type: "text", text: "13 horas" });
    assert.equal(run.state.variables.hora, "13:00");
    assert.equal(run.state.currentNodeId, "q-nombre");
  });

  it("la hora ambigua pendiente no queda colgada para una q-hora futura (variables limpias tras resolver)", () => {
    const { flow, state } = arrancarHastaQFecha();
    const ambiguo = runFlowEngine(flow, state, { type: "text", text: "1" });
    const aclarado = runFlowEngine(flow, ambiguo.state, { type: "text", text: "Tarde" });
    assert.equal(aclarado.state.variables.__horaAmbigua, undefined);
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
