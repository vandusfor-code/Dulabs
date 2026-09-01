/**
 * Regresión: mensaje estático de recordatorio tras act-agendar exitoso.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  danielaAgendarCitaFlow,
  DANIELA_MSG_RECORDATORIO_ASISTENCIA,
} from "@/lib/flows/daniela-agendar-cita.flow";
import { danielaCancelarCitaFlow } from "@/lib/flows/daniela-cancelar-cita.flow";
import { danielaReagendarCitaFlow } from "@/lib/flows/daniela-reagendar-cita.flow";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import type { EngineEffect, FlowEngineState } from "@/lib/flow/engine-types";

type RunResult = ReturnType<typeof runFlowEngine>;

function resolverEfecto(
  flow: ReturnType<typeof danielaAgendarCitaFlow>,
  state: FlowEngineState,
  data: Record<string, unknown>,
  success = true,
): RunResult {
  return runFlowEngine(flow, state, {
    type: "effect_result",
    success,
    effectId: state.pendingEffect!.effectId,
    data,
  });
}

function conducirHastaAgendarExitoso() {
  const flow = danielaAgendarCitaFlow();
  let state = createFlowEngineState(flow, {});
  state.variables = { ...state.variables, hoy: "2026-08-30" };
  const efectos: EngineEffect[] = [];
  const push = (r: RunResult) => {
    efectos.push(...(r.effects ?? []));
    return r.state;
  };
  state = push(runFlowEngine(flow, state, { type: "start", text: "Quiero semipermanente el 2026-09-02 a las 17:00 para Duvan" }));
  state = push(resolverEfecto(flow, state, { servicio: "semipermanente", fecha: "2026-09-02", hora: "17:00", nombreCliente: "Duvan" }));
  state = push(resolverEfecto(flow, state, { disponible: true, duracionMin: 120, especialista: "Carla", horariosTomados: [] }));
  state = push(runFlowEngine(flow, state, { type: "text", text: "sí" }));
  state = push(resolverEfecto(flow, state, { classification: "confirma" }));
  state = push(resolverEfecto(flow, state, { citaId: 9001, status: "confirmada", especialista: "Carla" }));
  return { flow, state, efectos };
}

function textoDe(effect: EngineEffect): string {
  if (effect.type !== "send_message") return "";
  return typeof effect.content.text === "string" ? effect.content.text : "";
}

describe("Recordatorio post-confirmación de cita nueva", () => {
  it("1–2. tras agendar OK: dos mensajes, recordatorio después de ai-confirmar", () => {
    const { flow, state, efectos } = conducirHastaAgendarExitoso();
    const run = resolverEfecto(flow, state, { responseText: "🎉 Tu cita quedó confirmada." });
    const salientes = [...efectos, ...(run.effects ?? [])].filter((e) => e.type === "send_message");
    const ultimos = (run.effects ?? []).filter((e) => e.type === "send_message");
    assert.equal(ultimos.length, 2);
    assert.equal(ultimos[0]?.nodeId, "ai-confirmar");
    assert.equal(ultimos[1]?.nodeId, "msg-recordatorio-asistencia");
    assert.equal(textoDe(ultimos[1]!), DANIELA_MSG_RECORDATORIO_ASISTENCIA);
    assert.equal(salientes.filter((e) => e.nodeId === "msg-recordatorio-asistencia").length, 1);
  });

  it("3. si act-agendar falla, no hay recordatorio", () => {
    const flow = danielaAgendarCitaFlow();
    let state = createFlowEngineState(flow, {});
    state.variables = { ...state.variables, hoy: "2026-08-30" };
    state = runFlowEngine(flow, state, { type: "start", text: "Quiero semipermanente el 2026-09-02 a las 17:00 para Duvan" }).state;
    state = resolverEfecto(flow, state, { servicio: "semipermanente", fecha: "2026-09-02", hora: "17:00", nombreCliente: "Duvan" }).state;
    state = resolverEfecto(flow, state, { disponible: true, duracionMin: 120, especialista: "Carla", horariosTomados: [] }).state;
    state = runFlowEngine(flow, state, { type: "text", text: "sí" }).state;
    state = resolverEfecto(flow, state, { classification: "confirma" }).state;
    const run = resolverEfecto(flow, state, { ocupado: true }, false);
    const recordatorios = (run.effects ?? []).filter((e) => e.nodeId?.includes("recordatorio"));
    assert.equal(recordatorios.length, 0);
  });

  it("4. sin confirmar del usuario, no hay recordatorio", () => {
    const flow = danielaAgendarCitaFlow();
    let state = createFlowEngineState(flow, {});
    state.variables = { ...state.variables, hoy: "2026-08-30" };
    const efectos: EngineEffect[] = [];
    const push = (r: RunResult) => {
      efectos.push(...(r.effects ?? []));
      return r.state;
    };
    state = push(runFlowEngine(flow, state, { type: "start", text: "semipermanente 2026-09-02 17:00 Duvan" }));
    state = push(resolverEfecto(flow, state, { servicio: "semipermanente", fecha: "2026-09-02", hora: "17:00", nombreCliente: "Duvan" }));
    state = push(resolverEfecto(flow, state, { disponible: true, duracionMin: 120, especialista: "Carla", horariosTomados: [] }));
    assert.equal(
      efectos.some((e) => e.type === "send_message" && e.nodeId?.includes("recordatorio")),
      false,
    );
  });

  it("5. el recordatorio no es nodo AI", () => {
    const flow = danielaAgendarCitaFlow();
    const nodo = flow.nodes.find((n) => n.id === "msg-recordatorio-asistencia");
    assert.equal(nodo?.type, "message");
  });

  it("8. camino respaldo: un solo recordatorio tras msg-confirmada-respaldo", () => {
    const { flow, state } = conducirHastaAgendarExitoso();
    const run = resolverEfecto(flow, state, {}, false);
    const salientes = (run.effects ?? []).filter((e) => e.type === "send_message");
    assert.equal(salientes.length, 2);
    assert.equal(salientes[1]?.nodeId, "msg-recordatorio-asistencia-respaldo");
    assert.equal(textoDe(salientes[1]!), DANIELA_MSG_RECORDATORIO_ASISTENCIA);
  });

  it("9–10. cancelar y reagendar no tienen nodo recordatorio-asistencia", () => {
    const cancelar = danielaCancelarCitaFlow();
    const reagendar = danielaReagendarCitaFlow();
    assert.equal(cancelar.nodes.some((n) => n.id.includes("recordatorio-asistencia")), false);
    assert.equal(reagendar.nodes.some((n) => n.id.includes("recordatorio-asistencia")), false);
  });

  it("7. act-agendar sigue solo alcanzable desde class:confirma", () => {
    const flow = danielaAgendarCitaFlow();
    const hacia = flow.edges.filter((e) => e.target === "act-agendar");
    assert.equal(hacia.length, 1);
    assert.equal(hacia[0]?.sourceHandle, FLOW_EDGE_HANDLE.aiClass("confirma"));
  });
});
