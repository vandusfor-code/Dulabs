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

  it("A. tap servicios_spa → act-listar-servicios (catálogo real); variables.servicio NO es servicios_spa", () => {
    const flow = danielaRouterFlow();
    const menu = clasificar(flow, "Hola", "menu");
    const tap = runFlowEngine(flow, menu.state, {
      type: "button",
      id: DANIELA_BUTTON_IDS.SERVICIOS_SPA,
    });
    assert.equal(tap.error, undefined);
    assert.equal(tap.state.pendingEffect?.nodeId, "agendar__act-listar-servicios");
    assert.equal(tap.state.variables.servicio, undefined);
    assert.notEqual(tap.state.variables.servicio, "servicios_spa");
  });

  it("B. agendamiento directo sigue extrayendo servicio real vía ai-extraer", () => {
    const flow = danielaRouterFlow();
    const r = clasificar(flow, "Quiero agendar semipermanente en manos", "agendar");
    // Parte 13 del rediseño (autorizado) — consulta citas previas primero.
    assert.equal(r.state.pendingEffect?.nodeId, "agendar__act-consultar-citas-previas");
    const previas = runFlowEngine(flow, r.state, {
      type: "effect_result",
      success: true,
      effectId: r.state.pendingEffect!.effectId,
      data: { cantidadCitas: 0, citasActivas: [] },
    });
    assert.equal(previas.error, undefined);
    assert.equal(previas.state.pendingEffect?.nodeId, "agendar__ai-extraer");
    const extraido = runFlowEngine(flow, previas.state, {
      type: "effect_result",
      success: true,
      effectId: previas.state.pendingEffect!.effectId,
      data: { servicio: "semipermanente en manos" },
    });
    assert.equal(extraido.error, undefined);
    assert.equal(extraido.state.variables.servicio, "semipermanente en manos");
  });

  it("C. tap servicios_spa + seleccionar 'Semipermanente en manos' del catálogo real → variables.servicio correcto", () => {
    const flow = danielaRouterFlow();
    const menu = clasificar(flow, "Hola", "menu");
    const tap = runFlowEngine(flow, menu.state, {
      type: "button",
      id: DANIELA_BUTTON_IDS.SERVICIOS_SPA,
    });
    assert.equal(tap.state.pendingEffect?.nodeId, "agendar__act-listar-servicios");
    const listado = runFlowEngine(flow, tap.state, {
      type: "effect_result",
      success: true,
      effectId: tap.state.pendingEffect!.effectId,
      data: {
        serviciosDisponibles: [{ nombre: "Semipermanente en manos", precio: 45000 }],
        serviciosDisponiblesTexto: "1️⃣ Semipermanente en manos",
        cantidadServicios: 1,
      },
    });
    // Sin hint de servicio (tap de botón) -> el camino rápido falla.
    const sinHint = runFlowEngine(flow, listado.state, {
      type: "effect_result",
      success: false,
      effectId: listado.state.pendingEffect!.effectId,
      data: {},
    });
    assert.equal(sinHint.state.currentNodeId, "agendar__q-seleccionar-servicio");
    const r2 = runFlowEngine(flow, sinHint.state, { type: "text", text: "semipermanente en manos" });
    assert.equal(r2.error, undefined);
    assert.equal(r2.state.pendingEffect?.nodeId, "agendar__ai-interpretar-seleccion-servicio");
    const interpretado = runFlowEngine(flow, r2.state, {
      type: "effect_result",
      success: true,
      effectId: r2.state.pendingEffect!.effectId,
      data: { seleccionTipo: "nombre", seleccionNombre: "Semipermanente en manos" },
    });
    assert.equal(interpretado.state.pendingEffect?.nodeId, "agendar__act-resolver-seleccion-servicio");
    const r3 = runFlowEngine(flow, interpretado.state, {
      type: "effect_result",
      success: true,
      effectId: interpretado.state.pendingEffect!.effectId,
      data: { servicio: "Semipermanente en manos", precio: 45000, precioTexto: "$45.000" },
    });
    assert.equal(r3.error, undefined);
    assert.equal(r3.state.variables.servicio, "Semipermanente en manos");
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

  it("F. info de servicio sin cita → responde con baseConocimiento, NO pasa a un humano (corrección real, chats de sept. 2026)", () => {
    const flow = danielaRouterFlow();
    const clasificado = clasificar(flow, "Quiero información sobre el semipermanente", "info_servicio");
    assert.equal(clasificado.state.pendingEffect?.nodeId, "ai-responder-info-servicio");
    assert.notEqual(clasificado.state.pendingEffect?.nodeId, "act-handoff-daniela");

    // El camino real (ExecutionOrchestrator.process) despacha ESTE efecto
    // pendiente también, en la misma pasada, antes de devolver el control --
    // se simula acá resolviéndolo con una respuesta real de negocio.
    const respondido = runFlowEngine(flow, clasificado.state, {
      type: "effect_result",
      success: true,
      effectId: clasificado.state.pendingEffect!.effectId,
      data: { responseText: "El forrado en gel está en $70.000 💅" },
    });
    assert.equal(respondido.error, undefined);
    const efectosCompletos = [...clasificado.effects, ...respondido.effects];

    const decision = decidirFallbackDesdeResultado({
      outcome: "processed",
      executionRowId: "menu-info",
      effects: efectosCompletos as EngineEffect[],
      dispatchedEffectIds: [],
    });
    assert.equal(decision.handled, true);
    assert.equal(decision.motivo, "processed_ok");
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
