/**
 * Fase 1 (Blocker #7, autorizado) — enrutamiento de intenciones.
 *
 * Motor puro (sin DB, sin IA real): se simula el effect_result que
 * ClaudeExecutor produciría al clasificar -- prueba la ESTRUCTURA del
 * enrutamiento (a qué sub-grafo entra cada categoría, que nunca se salta la
 * confirmación), no el juicio real de Claude sobre lenguaje natural (eso
 * requeriría una llamada real a Claude, explícitamente fuera de alcance de
 * este blocker: "no ejecutes llamadas reales a Claude").
 *
 * Sin capa de integración real contra Supabase para el router en sí: a
 * diferencia de los adaptadores de citas (que no necesitan IA para
 * probarse), CUALQUIER camino real a través de
 * atenderMensajeConFlow()/atenderMensajeConFlowConFallback() con
 * daniela-router.flow.ts pasa primero por ai-clasificar-intencion, que el
 * orchestrator real despacharía al ClaudeExecutor real. La verificación del
 * cableado handled=false para la rama "otro" (Blocker #7 sobre
 * lib/flow-runtime-bridge.ts) se hace más abajo combinando runFlowEngine
 * (motor real, sin IA) con decidirFallbackDesdeResultado (lógica real de
 * decisión, sin IA) por separado -- sin invocar el orchestrator ni Claude.
 * El resto del camino real (consultar citas reales, servicio no
 * reconocido, etc.) una vez clasificada la intención ya está probado contra
 * Supabase real en los adaptadores de los Blockers #3/#4/#5 -- el router no
 * cambia ese comportamiento, solo decide por cuál puerta entrar.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { danielaRouterFlow } from "@/lib/flows/daniela-router.flow";
import { decidirFallbackDesdeResultado } from "@/lib/flow-runtime-bridge";
import type { FlowEngineState } from "@/lib/flow/engine-types";

function avanzar(flow: ReturnType<typeof danielaRouterFlow>, state: FlowEngineState, event: Parameters<typeof runFlowEngine>[2]) {
  const r = runFlowEngine(flow, state, event);
  assert.equal(r.error, undefined, `no debe haber engineError: ${JSON.stringify(r.error)}`);
  return r.state;
}

/** Arranca el enrutador con un primer mensaje y simula la clasificación indicada. */
function clasificarComo(flow: ReturnType<typeof danielaRouterFlow>, texto: string, clasificacion: string | undefined) {
  let state = createFlowEngineState(flow, { executionId: randomUUID() });
  const inicio = runFlowEngine(flow, state, { type: "start", text: texto });
  assert.equal(inicio.error, undefined);
  state = inicio.state;
  assert.equal(state.pendingEffect?.nodeId, "ai-clasificar-intencion");
  assert.equal(state.variables.__firstMessageText, texto.trim() ? texto : undefined, "el texto del primer mensaje debe estar disponible para clasificar (Blocker #1)");
  return avanzar(flow, state, {
    type: "effect_result",
    success: true,
    effectId: state.pendingEffect!.effectId,
    data: clasificacion !== undefined ? { classification: clasificacion } : {},
  });
}

describe("Fase 1 — Blocker #7: enrutador de intenciones (motor, sin IA real)", () => {
  const flow = danielaRouterFlow();

  it("1/2. 'Quiero una cita' / 'Quiero reservar' -> clasificadas como AGENDAR -> entra a extraer, no agenda", () => {
    for (const texto of ["Quiero una cita", "Quiero reservar"]) {
      let estado = clasificarComo(flow, texto, "agendar");
      assert.equal(estado.pendingEffect?.nodeId, "agendar__ai-extraer");
      assert.equal(estado.status, "waiting_effect");
      estado = avanzar(flow, estado, {
        type: "effect_result",
        success: true,
        effectId: estado.pendingEffect!.effectId,
        data: {},
      });
      assert.equal(estado.currentNodeId, "agendar__q-servicio");
      assert.equal(estado.status, "waiting_input");
    }
  });

  it("3/4. 'Quiero cancelar' / 'Ya no puedo ir' -> clasificadas como CANCELAR -> entra al sub-grafo de cancelar (consulta sus citas primero)", () => {
    for (const texto of ["Quiero cancelar", "Ya no puedo ir mañana"]) {
      const estado = clasificarComo(flow, texto, "cancelar");
      assert.equal(estado.pendingEffect?.nodeId, "cancelar__act-consultar-citas", "debe entrar consultando SUS citas reales, nunca cancelando a ciegas");
      assert.equal(estado.status, "waiting_effect");
    }
  });

  it("5/6. 'Quiero cambiar mi cita' / 'Quiero moverla para mañana' -> clasificadas como REAGENDAR -> entra consultando sus citas primero", () => {
    for (const texto of ["Quiero cambiar mi cita", "Quiero moverla para mañana"]) {
      const estado = clasificarComo(flow, texto, "reagendar");
      assert.equal(estado.pendingEffect?.nodeId, "reagendar__act-consultar-citas");
      assert.equal(estado.status, "waiting_effect");
    }
  });

  it("7/8. '¿Qué cita tengo?' / '¿Para cuándo estoy?' -> clasificadas como CONSULTAR -> consulta real, nunca escribe nada", () => {
    for (const texto of ["¿Qué cita tengo?", "¿Para cuándo estoy?"]) {
      const estado = clasificarComo(flow, texto, "consultar");
      assert.equal(estado.pendingEffect?.nodeId, "act-consultar-citas-router");
      assert.equal(estado.status, "waiting_effect");
    }
  });

  it("9. '¿Cuánto cuesta?' -> clasificada como OTRO -> handoff a Daniela (mensaje + transferir_soporte)", () => {
    const r = clasificarComoConEfectos(flow, "¿Cuánto cuesta?", "otro");
    assert.equal(r.state.pendingEffect?.nodeId, "act-handoff-daniela");
    assert.ok(r.effects.some((e) => e.type === "send_message" && e.nodeId === "msg-handoff-duda"));
  });

  it("10. 'Quiero masaje' -> clasificada como AGENDAR -> servicio no reconocido se detecta en act-validar-servicio (Blocker #3)", () => {
    let estado = clasificarComo(flow, "Quiero masaje", "agendar");
    estado = avanzar(flow, estado, {
      type: "effect_result",
      success: true,
      effectId: estado.pendingEffect!.effectId,
      data: {},
    });
    assert.equal(estado.currentNodeId, "agendar__q-servicio");
    estado = avanzar(flow, estado, { type: "text", text: "masaje" });
    assert.equal(estado.pendingEffect?.nodeId, "agendar__act-validar-servicio");
    const fallo = runFlowEngine(flow, estado, {
      type: "effect_result",
      success: false,
      effectId: estado.pendingEffect!.effectId,
      error: "servicio_no_manejado",
    });
    assert.equal(fallo.error, undefined, "no debe crashear (Blocker #3), ni siquiera entrando vía el enrutador");
    assert.equal(preguntaActualRouter(fallo.state), "agendar__q-servicio", "vuelve a preguntar el servicio tras validación temprana");
  });

  it("11. mensaje ambiguo -> clasificación 'otro' explícita -> handoff a Daniela", () => {
    const r = clasificarComoConEfectos(flow, "no sé qué servicio hacerme", "otro");
    assert.equal(r.state.pendingEffect?.nodeId, "act-handoff-daniela");
  });

  it("12. mensaje vacío -> default -> handoff a Daniela, nunca asume 'agendar'", () => {
    let state = createFlowEngineState(flow, { executionId: randomUUID() });
    const inicio = runFlowEngine(flow, state, { type: "start", text: "" });
    state = inicio.state;
    assert.equal(state.variables.__firstMessageText, undefined, "un mensaje vacío/solo espacios NUNCA se siembra (Blocker #1)");
    const r = runFlowEngine(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: {} });
    assert.equal(r.error, undefined);
    assert.equal(r.state.pendingEffect?.nodeId, "act-handoff-daniela", "sin clasificación reconocible, cae al default con handoff -- NUNCA asume agendar por defecto");
  });

  it("13. SEGURIDAD: clasificar la intención NUNCA por sí sola ejecuta una acción crítica -- todas las ramas de escritura entran por su punto de consulta/pregunta, nunca directo a act-agendar/act-cancelar/act-mover-cita", () => {
    const flowDef = flow;
    const nodosAccionCritica = new Set(["agendar__act-agendar", "cancelar__act-cancelar", "reagendar__act-mover-cita"]);
    const ramasDelClasificador = flowDef.edges.filter((e) => e.source === "ai-clasificar-intencion");
    for (const rama of ramasDelClasificador) {
      assert.equal(nodosAccionCritica.has(rama.target), false, `la rama "${rama.sourceHandle}" del clasificador jamás debe apuntar directo a una acción crítica`);
    }
  });

  it("14. intención válida (agendar) + datos insuficientes -> el sub-grafo sigue pidiendo lo que falta, no avanza a ciegas", () => {
    let estado = clasificarComo(flow, "Quiero una cita", "agendar");
    estado = avanzar(flow, estado, {
      type: "effect_result",
      success: true,
      effectId: estado.pendingEffect!.effectId,
      data: {},
    });
    assert.equal(estado.currentNodeId, "agendar__q-servicio");
    estado = avanzar(flow, estado, { type: "text", text: "manos" });
    assert.equal(estado.pendingEffect?.nodeId, "agendar__act-validar-servicio", "valida servicio antes de pedir fecha");
  });

  it("15. intención válida (cancelar) + cita inexistente -> el sub-grafo informa correctamente, nunca inventa una cita", () => {
    let estado = clasificarComo(flow, "Quiero cancelar mi cita", "cancelar");
    estado = avanzar(flow, estado, { type: "effect_result", success: true, effectId: estado.pendingEffect!.effectId, data: { cantidadCitas: 0, citasActivas: [] } });
    assert.equal(estado.currentNodeId, "cancelar__end-sin-cita");
    assert.equal(estado.status, "completed");
  });
});

function preguntaActualRouter(state: FlowEngineState): string | null {
  return state.status === "waiting_input" ? (state.currentNodeId ?? null) : null;
}

function clasificarComoConEfectos(flow: ReturnType<typeof danielaRouterFlow>, texto: string, clasificacion: string) {
  let state = createFlowEngineState(flow, { executionId: randomUUID() });
  const inicio = runFlowEngine(flow, state, { type: "start", text: texto });
  state = inicio.state;
  return runFlowEngine(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { classification: clasificacion } });
}

describe("Fase 1 — Blocker #7: cableado real del hand-off a Daniela (sin Claude, sin DB)", () => {
  it("clasificación 'otro' -> decidirFallbackDesdeResultado dice handled=true (Flow envió handoff)", () => {
    const flow = danielaRouterFlow();
    let state = createFlowEngineState(flow, { executionId: randomUUID() });
    state = runFlowEngine(flow, state, { type: "start", text: "¿Cuánto cuesta el semipermanente?" }).state;
    const r = runFlowEngine(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { classification: "otro" } });
    assert.equal(r.error, undefined);

    const decision = decidirFallbackDesdeResultado({
      outcome: "processed",
      executionRowId: "row-test",
      effects: r.effects,
      dispatchedEffectIds: [],
    });
    assert.equal(decision.handled, true, "el router debe handoff a Daniela, no ceder a LEGACY");
    assert.equal(decision.motivo, "processed_ok");
  });

  it("clasificación 'agendar' + extract vacío -> pregunta de servicio (1 mensaje) y handled=true", () => {
    const flow = danielaRouterFlow();
    let state = createFlowEngineState(flow, { executionId: randomUUID() });
    state = runFlowEngine(flow, state, { type: "start", text: "Quiero una cita" }).state;
    const clasificado = runFlowEngine(flow, state, {
      type: "effect_result",
      success: true,
      effectId: state.pendingEffect!.effectId,
      data: { classification: "agendar" },
    });
    assert.equal(clasificado.error, undefined);
    const r = runFlowEngine(flow, clasificado.state, {
      type: "effect_result",
      success: true,
      effectId: clasificado.state.pendingEffect!.effectId,
      data: {},
    });
    const envios = r.effects.filter((e) => e.type === "send_message");
    assert.equal(envios.length, 1, "una sola pregunta de servicio, sin saludo duplicado");
    assert.equal(envios[0] && "nodeId" in envios[0] ? envios[0].nodeId : "", "agendar__q-servicio");

    const decision = decidirFallbackDesdeResultado({
      outcome: "processed",
      executionRowId: "row-test-2",
      effects: r.effects,
      dispatchedEffectIds: [],
    });
    assert.equal(decision.handled, true);
    assert.equal(decision.motivo, "processed_ok");
  });
});
