/**
 * AMORE (Fase 3, banco de escenarios, autorizado) — el Flow pasa el
 * validador real de publicación (schema + grafo + Claim Security), y el
 * GRAFO conecta correctamente sus piezas -- corre con runFlowEngine directo
 * (determinista, sin Claude real, sin Supabase real, sin la tabla
 * dulabs_bot_escenarios real). La correctitud del RESOLVER en sí
 * (lib/bot-escenarios/resolver.ts, matching de prioridad, extracción de
 * entidades, filtrado de catálogo) está cubierta en
 * lib/bot-escenarios/resolver.test.ts -- este archivo se concentra en que
 * el grafo despache al nodo correcto según el `modo` que produce ese
 * resolver, y que el ciclo (responder -> esperar el siguiente mensaje ->
 * volver a resolver) funcione de verdad a través de varios turnos.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { filterClaimSecuredEffects } from "@/lib/flow/ai-runtime/ai-response-security";
import { amoreRouterFlow } from "@/lib/flows/amore-router.flow";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import type { EngineEffect, FlowEngineRunResult, FlowEngineState } from "@/lib/flow/engine-types";

type AmoreFlow = ReturnType<typeof amoreRouterFlow>;

function sendMessages(effects: EngineEffect[]): Extract<EngineEffect, { type: "send_message" }>[] {
  return effects.filter((e): e is Extract<EngineEffect, { type: "send_message" }> => e.type === "send_message");
}

function resolverEfecto(flow: AmoreFlow, state: FlowEngineState, data: Record<string, unknown>, success = true): FlowEngineRunResult {
  assert.equal(state.status, "waiting_effect", "se esperaba un efecto pendiente");
  return runFlowEngine(flow, state, { type: "effect_result", success, effectId: state.pendingEffect!.effectId, data });
}

/** Salida completa y realista de resolver_escenario (internal-action-executor.ts) para un turno determinístico. */
function datosResolverDirecto(overrides: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    escenarioCodigo: "001_saludo",
    modo: "deterministic",
    respuestaTexto: "¡Hola! 💗 Qué lindo tenerte por aquí. Cuéntame, ¿en qué puedo ayudarte?",
    requiereIA: "false",
    instruccionIA: "",
    datosIA: [],
    ultimoServicioId: "",
    ultimoServicioNombre: "",
    ultimaCategoria: "",
    ultimaAccionSugerida: "",
    ...overrides,
  };
}

describe("AMORE — validación estructural (validateFlowForPublish)", () => {
  it("grafo, schema y publish-rules válidos (sin errores)", () => {
    const result = validateFlowForPublish(amoreRouterFlow());
    if (!result.valid) console.error(JSON.stringify(result.errors, null, 2));
    assert.deepEqual(result.errors, []);
  });

  it("NUNCA agenda una cita real: agendar_cita_especialista/agendar_cita_marketplace no aparecen en el grafo", () => {
    const flow = amoreRouterFlow();
    const actionTypes = flow.nodes.filter((n) => n.type === "action").map((n) => (n.config as { actionType: string }).actionType);
    assert.ok(!actionTypes.includes("agendar_cita_especialista"));
    assert.ok(!actionTypes.includes("agendar_cita_marketplace"));
  });

  it("todos los mensajes ESTÁTICOS del grafo pasan Claim Security real (filterClaimSecuredEffects) -- el contenido real vive en dulabs_bot_escenarios, verificado aparte", () => {
    const RAW_INTERPOLATION_PATTERN = /\{\{[a-zA-Z0-9_.]+\}\}/;
    const flow = amoreRouterFlow();
    for (const node of flow.nodes) {
      if (node.type !== "message" && node.type !== "question") continue;
      const text = (node.config as { text?: string }).text;
      if (!text) continue;
      const origin = RAW_INTERPOLATION_PATTERN.test(text) ? "flow_static_interpolated" : "flow_static";
      const effect: EngineEffect = { type: "send_message", nodeId: node.id, content: { text }, executionId: "e", effectId: "f", origin };
      const result = filterClaimSecuredEffects([effect], {});
      assert.equal(result.length, 1, `NO debe bloquearse (${node.id}, origin=${origin}): "${text.slice(0, 60)}"`);
    }
  });
});

describe("AMORE — despacho por modo (determinista, sin Claude/Supabase reales)", () => {
  it("modo=deterministic: responde directo con respuestaTexto y queda esperando el siguiente mensaje", () => {
    const flow = amoreRouterFlow();
    let state = createFlowEngineState(flow);
    let run = runFlowEngine(flow, state, { type: "start", text: "Hola" });
    state = run.state;
    assert.equal(state.status, "waiting_effect");
    assert.equal(state.currentNodeId, "act-resolver-escenario");

    run = resolverEfecto(flow, state, datosResolverDirecto({}));
    state = run.state;
    assert.equal(state.status, "waiting_input");
    assert.equal(state.currentNodeId, "q-turno-directo");
    const msgs = sendMessages(run.effects);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0]!.content.text, "¡Hola! 💗 Qué lindo tenerte por aquí. Cuéntame, ¿en qué puedo ayudarte?");
  });

  it("modo=catalog (precio+duración): mismo camino determinístico que deterministic, sin IA", () => {
    const flow = amoreRouterFlow();
    let state = createFlowEngineState(flow);
    let run = runFlowEngine(flow, state, { type: "start", text: "cuánto cuesta el dipping" });
    state = run.state;

    run = resolverEfecto(
      flow,
      state,
      datosResolverDirecto({
        escenarioCodigo: "029_precio",
        modo: "catalog",
        respuestaTexto: "El Dipping tiene un valor de $60.000 y una duración aproximada de 2 h.",
        ultimoServicioId: "s-dipping",
        ultimoServicioNombre: "Dipping",
        ultimaCategoria: "Uñas",
        ultimaAccionSugerida: "ofrecer_portal",
      }),
    );
    state = run.state;
    assert.equal(state.status, "waiting_input");
    assert.equal(state.currentNodeId, "q-turno-directo");
    assert.equal(state.variables.ultimoServicioId, "s-dipping");
    const msgs = sendMessages(run.effects);
    assert.match(msgs[0]!.content.text!, /Dipping.*\$60\.000/);
  });

  it("modo=ai: pasa por el único nodo IA del flow y responde con responseText", () => {
    const flow = amoreRouterFlow();
    let state = createFlowEngineState(flow);
    let run = runFlowEngine(flow, state, { type: "start", text: "no sé qué hacerme, quiero algo bonito" });
    state = run.state;

    run = resolverEfecto(
      flow,
      state,
      datosResolverDirecto({
        escenarioCodigo: "041_recomendacion_unas",
        modo: "ai",
        respuestaTexto: undefined,
        requiereIA: "true",
        instruccionIA: "Recomienda 2-3 opciones reales de uñas, cálida y breve.",
        datosIA: [{ nombre: "Dipping", precioTexto: "$60.000", duracionTexto: "2 h", categoria: "Uñas", descripcion: null }],
      }),
    );
    state = run.state;
    assert.equal(state.status, "waiting_effect");
    assert.equal(state.currentNodeId, "ai-generar-respuesta");

    run = resolverEfecto(flow, state, { responseText: "¡Claro que sí! 💗 Te cuento que el Dipping es una opción real y duradera por $60.000." });
    state = run.state;
    assert.equal(state.status, "waiting_input");
    assert.equal(state.currentNodeId, "q-turno-ia");
    const msgs = sendMessages(run.effects);
    assert.equal(msgs[0]!.content.text, "¡Claro que sí! 💗 Te cuento que el Dipping es una opción real y duradera por $60.000.");
  });

  it("modo=transfer: manda el mensaje ANTES de transferir, transfiere, y termina (nunca crea ninguna cita)", () => {
    const flow = amoreRouterFlow();
    let state = createFlowEngineState(flow);
    let run = runFlowEngine(flow, state, { type: "start", text: "quiero hablar con una persona" });
    state = run.state;

    run = resolverEfecto(
      flow,
      state,
      datosResolverDirecto({
        escenarioCodigo: "110_hablar_con_persona",
        modo: "transfer",
        respuestaTexto: "Claro que sí 💗 Ya te comunico con nuestro equipo.",
      }),
    );
    state = run.state;
    // msg-antes-transferir es automático (no espera input) -- avanza directo
    // hasta el siguiente nodo que sí espera algo real: el efecto de transferir_soporte.
    assert.equal(state.status, "waiting_effect");
    assert.equal(state.currentNodeId, "act-transferir-soporte");
    const msgs = sendMessages(run.effects);
    assert.equal(msgs[0]!.content.text, "Claro que sí 💗 Ya te comunico con nuestro equipo.");

    run = resolverEfecto(flow, state, { transferred: true, pausadoHasta: "2026-01-01T00:00:00Z" });
    assert.equal(run.state.status, "completed");
    assert.equal(run.state.currentNodeId, "end-transferido");
  });

  it("modo=portal: mismo camino determinístico (portal es solo una etiqueta de observabilidad, no cambia el grafo)", () => {
    const flow = amoreRouterFlow();
    let state = createFlowEngineState(flow);
    let run = runFlowEngine(flow, state, { type: "start", text: "quiero agendar el dipping" });
    state = run.state;

    run = resolverEfecto(
      flow,
      state,
      datosResolverDirecto({
        escenarioCodigo: "061_intencion_reservar",
        modo: "portal",
        respuestaTexto: "¡Claro que sí, amiga! 💗 Puedes agendar tu Dipping directamente aquí: https://www.dulabs.co/reservar/amore",
      }),
    );
    state = run.state;
    assert.equal(state.status, "waiting_input");
    assert.equal(state.currentNodeId, "q-turno-directo");
    const msgs = sendMessages(run.effects);
    assert.match(msgs[0]!.content.text!, /dulabs\.co\/reservar\/amore/);
  });

  it("el ciclo funciona a través de VARIOS turnos: responder -> esperar -> volver a resolver con el mensaje nuevo", () => {
    const flow = amoreRouterFlow();
    let state = createFlowEngineState(flow);
    let run = runFlowEngine(flow, state, { type: "start", text: "Hola" });
    state = run.state;
    run = resolverEfecto(flow, state, datosResolverDirecto({}));
    state = run.state;
    assert.equal(state.currentNodeId, "q-turno-directo");

    // Segundo mensaje real de la clienta -- debe volver a act-resolver-escenario.
    run = runFlowEngine(flow, state, { type: "text", text: "quiero saber de uñas" });
    state = run.state;
    assert.equal(state.status, "waiting_effect");
    assert.equal(state.currentNodeId, "act-resolver-escenario");
    assert.equal(state.variables.mensajeActual, "quiero saber de uñas");
  });
});
