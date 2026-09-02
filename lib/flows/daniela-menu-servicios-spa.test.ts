/**
 * Regresión: el botón de menú servicios_spa NO es un servicio real.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { decidirFallbackDesdeResultado } from "@/lib/flow-runtime-bridge";
import { danielaRouterFlow } from "@/lib/flows/daniela-router.flow";
import { DANIELA_BUTTON_IDS } from "@/lib/flows/daniela-button-ids";
import type { EngineEffect } from "@/lib/flow/engine-types";
import type { FlowDefinition } from "@/lib/flow/types";

function clasificar(flow: FlowDefinition, texto: string, classification: string) {
  let state = createFlowEngineState(flow, { executionId: randomUUID() });
  const start = runFlowEngine(flow, state, { type: "start", text: texto });
  assert.equal(start.error, undefined);
  state = start.state;
  const r = runFlowEngine(flow, state, {
    type: "effect_result",
    success: true,
    effectId: state.pendingEffect!.effectId,
    data: { classification },
  });
  assert.equal(r.error, undefined);
  return { state: r.state, effects: [...start.effects, ...r.effects] };
}

describe("Menú servicios_spa — separación menú vs servicio real", () => {
  it("el router publicable sigue siendo válido", () => {
    const result = validateFlowForPublish(danielaRouterFlow());
    if (!result.valid) console.error(JSON.stringify(result.errors, null, 2));
    assert.equal(result.valid, true);
  });

  it("A. tap servicios_spa → q-servicio; variables.servicio NO es servicios_spa", () => {
    const flow = danielaRouterFlow();
    const menu = clasificar(flow, "Hola", "menu");
    const tap = runFlowEngine(flow, menu.state, {
      type: "button",
      id: DANIELA_BUTTON_IDS.SERVICIOS_SPA,
    });
    assert.equal(tap.error, undefined);
    assert.equal(tap.state.currentNodeId, "agendar__q-servicio");
    assert.equal(tap.state.variables.servicio, undefined);
    assert.notEqual(tap.state.variables.servicio, "servicios_spa");
  });

  it("B. agendamiento directo sigue extrayendo servicio real vía ai-extraer", () => {
    const flow = danielaRouterFlow();
    const r = clasificar(flow, "Quiero agendar semipermanente en manos", "agendar");
    assert.equal(r.state.pendingEffect?.nodeId, "agendar__ai-extraer");
    const extraido = runFlowEngine(flow, r.state, {
      type: "effect_result",
      success: true,
      effectId: r.state.pendingEffect!.effectId,
      data: { servicio: "semipermanente en manos" },
    });
    assert.equal(extraido.error, undefined);
    assert.equal(extraido.state.variables.servicio, "semipermanente en manos");
  });

  it("C. tap servicios_spa + texto semipermanente en manos → variables.servicio correcto", () => {
    const flow = danielaRouterFlow();
    const menu = clasificar(flow, "Hola", "menu");
    const tap = runFlowEngine(flow, menu.state, {
      type: "button",
      id: DANIELA_BUTTON_IDS.SERVICIOS_SPA,
    });
    const r2 = runFlowEngine(flow, tap.state, { type: "text", text: "semipermanente en manos" });
    assert.equal(r2.error, undefined);
    assert.equal(r2.state.variables.servicio, "semipermanente en manos");
  });

  it("D. tap productos deriva a Daniela y no entra a agendar", () => {
    const flow = danielaRouterFlow();
    const menu = clasificar(flow, "Hola", "menu");
    const tap = runFlowEngine(flow, menu.state, {
      type: "button",
      id: DANIELA_BUTTON_IDS.PRODUCTOS,
    });
    assert.equal(tap.state.pendingEffect?.nodeId, "act-handoff-daniela");
    assert.equal(
      tap.effects.some((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar"),
      false,
    );
  });

  it("E. 'Quiero comprar una crema' clasifica producto, no agenda", () => {
    const flow = danielaRouterFlow();
    const r = clasificar(flow, "Quiero comprar una crema", "producto");
    assert.equal(r.state.pendingEffect?.nodeId, "act-handoff-daniela");
    assert.equal(
      r.effects.some((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar"),
      false,
    );
  });

  it("F. info de servicio sin cita → handoff a Daniela", () => {
    const flow = danielaRouterFlow();
    const r = clasificar(flow, "Quiero información sobre el semipermanente", "info_servicio");
    assert.equal(r.state.pendingEffect?.nodeId, "act-handoff-daniela");
    const decision = decidirFallbackDesdeResultado({
      outcome: "processed",
      executionRowId: "menu-info",
      effects: r.effects as EngineEffect[],
      dispatchedEffectIds: [],
    });
    assert.equal(decision.handled, true);
  });

  it("6. tap servicios_spa no dispara act-agendar ni act-consultar", () => {
    const flow = danielaRouterFlow();
    const menu = clasificar(flow, "Hola", "menu");
    const tap = runFlowEngine(flow, menu.state, {
      type: "button",
      id: DANIELA_BUTTON_IDS.SERVICIOS_SPA,
    });
    const critico = tap.effects.filter(
      (e) =>
        e.type === "effect_required" &&
        (e.nodeId === "agendar__act-agendar" || e.nodeId === "agendar__act-consultar"),
    );
    assert.equal(critico.length, 0);
  });
});
