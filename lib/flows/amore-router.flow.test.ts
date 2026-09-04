/**
 * AMORE (Fase 2, autorizado) — el Flow del asistente pasa el validador real
 * de publicación (schema + grafo + Claim Security), y el GRAFO conecta
 * correctamente sus piezas -- corre con runFlowEngine directo (determinista,
 * sin Claude real, sin Supabase real). La correctitud contra datos REALES
 * de AMORE (catálogo/elegibilidad/horarios/domingo) ya está cubierta en
 * lib/catalogo-servicios-flow-adaptador.test.ts -- este archivo se
 * concentra en que el grafo llame a esas piezas en el orden correcto.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { filterClaimSecuredEffects } from "@/lib/flow/ai-runtime/ai-response-security";
import { amoreRouterFlow, AMORE_MSG_BIENVENIDA } from "@/lib/flows/amore-router.flow";
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

  it("todos los mensajes estáticos pasan Claim Security real (filterClaimSecuredEffects, mismo origin que decide el Engine real)", () => {
    // Mismo criterio EXACTO que flow-engine.ts::staticMessageOrigin (no
    // exportada): un texto con {{variable}} real es "flow_static_interpolated"
    // (pipeline morfológico completo -- puede cargar evidencia real como
    // disponibilidadTexto/precioTexto), texto 100% literal es "flow_static".
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

describe("AMORE — recorrido completo del motor (determinista, sin Claude/Supabase reales)", () => {
  it("Hola -> saludo exacto pedido, espera respuesta", () => {
    const flow = amoreRouterFlow();
    let state = createFlowEngineState(flow);
    let run = runFlowEngine(flow, state, { type: "start", text: "Hola" });
    state = run.state;
    assert.equal(state.status, "waiting_effect");
    run = resolverEfecto(flow, state, { classification: "menu" });
    state = run.state;
    assert.equal(state.status, "waiting_input");
    assert.equal(state.currentNodeId, "q-bienvenida");
    const msgs = sendMessages(run.effects);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0]!.content.text, AMORE_MSG_BIENVENIDA);
  });

  it("recorrido completo AGENDAR: uñas -> catálogo real -> selección -> precio/duración -> sí quiere -> fecha -> disponibilidad real -> traspaso (nunca crea una cita real)", () => {
    const flow = amoreRouterFlow();
    let state = createFlowEngineState(flow);
    let run: FlowEngineRunResult;

    run = runFlowEngine(flow, state, { type: "start", text: "quiero hacerme las uñas" });
    state = run.state;
    run = resolverEfecto(flow, state, { classification: "agendar" });
    state = run.state;
    assert.equal(state.currentNodeId, "act-listar-catalogo");

    run = resolverEfecto(flow, state, { catalogoDisponible: [{ id: "s1", nombre: "Uña", precio: 8000, duracionMin: 15, categoria: "Uñas" }], catalogoTexto: "1️⃣ Uña — $8.000 (15 min)", cantidadCatalogo: 1 });
    state = run.state;
    assert.equal(state.currentNodeId, "ai-extraer-servicio");

    // El primer mensaje ("quiero hacerme las uñas") no nombra un servicio
    // EXACTO del catálogo -- ai-extraer-servicio omite 'servicio', y el
    // camino rápido (resolver por hint) falla -> pasa a preguntar mostrando
    // el catálogo real.
    run = resolverEfecto(flow, state, {});
    state = run.state;
    assert.equal(state.currentNodeId, "act-resolver-servicio-inicial");
    run = resolverEfecto(flow, state, {}, false);
    state = run.state;
    assert.equal(state.status, "waiting_input");
    assert.equal(state.currentNodeId, "q-seleccionar-servicio");
    const catalogoMsg = sendMessages(run.effects);
    assert.match(catalogoMsg[0]!.content.text!, /1️⃣ Uña — \$8\.000 \(15 min\)/);

    run = runFlowEngine(flow, state, { type: "text", text: "la primera" });
    state = run.state;
    run = resolverEfecto(flow, state, { seleccionTipo: "index", seleccionIndice: 1 });
    state = run.state;
    assert.equal(state.currentNodeId, "act-resolver-servicio-elegido");
    run = resolverEfecto(flow, state, { servicioId: "s1", servicio: "Uña", precio: 8000, precioTexto: "$8.000", duracionMin: 15, duracionTexto: "15 min" });
    state = run.state;
    assert.equal(state.status, "waiting_input");
    assert.equal(state.currentNodeId, "q-desea-agendar");
    const precioMsg = sendMessages(run.effects);
    assert.match(precioMsg[0]!.content.text!, /El servicio de Uña tiene un valor de \$8\.000 y una duración aproximada de 15 min/);

    run = runFlowEngine(flow, state, { type: "text", text: "sí quiero" });
    state = run.state;
    run = resolverEfecto(flow, state, { classification: "si" });
    state = run.state;
    assert.equal(state.status, "waiting_input");
    assert.equal(state.currentNodeId, "q-fecha");

    run = runFlowEngine(flow, state, { type: "text", text: "el martes" });
    state = run.state;
    run = resolverEfecto(flow, state, { fecha: "2026-09-08" });
    state = run.state;
    assert.equal(state.currentNodeId, "act-validar-fecha");
    run = resolverEfecto(flow, state, { fecha: "2026-09-08", nuevaFecha: "2026-09-08" });
    state = run.state;
    assert.equal(state.currentNodeId, "act-consultar-disponibilidad");

    run = resolverEfecto(flow, state, {
      disponibilidadTexto: "👩‍🦰 Cristal:\n  • 8:00 a. m.\n\n👩‍🦰 Mary:\n  • 9:00 a. m.\n\n👩‍🦰 Nata:\n  • 1:00 p. m.\n\n👩‍🦰 Jessica:\n  • 3:00 p. m.",
      hayDisponibilidad: true,
    });
    state = run.state;
    // Todo el camino hasta acá pasó por action nodes de solo LECTURA -- ver
    // el test de arriba (agendar_cita_especialista nunca aparece en el
    // grafo): ninguna cita real fue creada en ningún punto de este recorrido.
    assert.equal(state.status, "waiting_effect", "debe seguir hacia el traspaso (transferir_soporte)");
    assert.equal(state.currentNodeId, "act-transferir-reserva");

    const disponibilidadMsgs = sendMessages(run.effects);
    assert.match(disponibilidadMsgs[0]!.content.text!, /Cristal/);
    assert.match(disponibilidadMsgs[0]!.content.text!, /Mary/);
    assert.match(disponibilidadMsgs[0]!.content.text!, /Nata/);
    assert.match(disponibilidadMsgs[0]!.content.text!, /Jessica/);

    run = resolverEfecto(flow, state, { transferred: true, pausadoHasta: "2026-01-01T00:00:00Z", pauseDurationHours: 24 });
    assert.equal(run.state.status, "completed");
    assert.equal(run.state.currentNodeId, "end-reserva-iniciada");
  });

  it("recorrido INFO_SERVICIO: solo pregunta precio -> responde y se detiene, NUNCA pide fecha ni consulta disponibilidad", () => {
    const flow = amoreRouterFlow();
    let state = createFlowEngineState(flow);
    let run: FlowEngineRunResult;

    run = runFlowEngine(flow, state, { type: "start", text: "cuánto cuesta el maquillaje suave" });
    state = run.state;
    run = resolverEfecto(flow, state, { classification: "info_servicio" });
    state = run.state;
    run = resolverEfecto(flow, state, { catalogoDisponible: [{ id: "s2", nombre: "Maquillaje Suave", precio: 60000, duracionMin: 60, categoria: "Maquillaje" }], catalogoTexto: "1️⃣ Maquillaje Suave — $60.000 (1 h)", cantidadCatalogo: 1 });
    state = run.state;
    run = resolverEfecto(flow, state, { servicio: "Maquillaje Suave" });
    state = run.state;
    assert.equal(state.currentNodeId, "act-resolver-servicio-inicial");
    run = resolverEfecto(flow, state, { servicioId: "s2", servicio: "Maquillaje Suave", precio: 60000, precioTexto: "$60.000", duracionMin: 60, duracionTexto: "1 h" });
    state = run.state;
    assert.equal(state.status, "waiting_input");
    assert.equal(state.currentNodeId, "q-desea-agendar");

    run = runFlowEngine(flow, state, { type: "text", text: "no gracias, solo preguntaba" });
    state = run.state;
    run = resolverEfecto(flow, state, { classification: "no" });
    assert.equal(run.state.status, "completed");
    assert.equal(run.state.currentNodeId, "end-info-servicio");
  });

  it("catálogo vacío (defensivo) -> nunca inventa servicios, transfiere a un humano", () => {
    const flow = amoreRouterFlow();
    let state = createFlowEngineState(flow);
    let run = runFlowEngine(flow, state, { type: "start", text: "quiero una cita" });
    state = run.state;
    run = resolverEfecto(flow, state, { classification: "agendar" });
    state = run.state;
    run = resolverEfecto(flow, state, { catalogoDisponible: [], catalogoTexto: "", cantidadCatalogo: 0 });
    state = run.state;
    assert.equal(state.currentNodeId, "act-handoff-sin-catalogo");
  });
});
