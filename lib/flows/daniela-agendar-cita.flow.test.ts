/**
 * Fase 0 — prueba de que el Flow diseñado para Daniela es REALIZABLE dentro
 * del validador de publicación real (el mismo que usaría un publish de
 * verdad) -- no una afirmación sin verificar. No publica nada: solo corre
 * `validateFlowForPublish` sobre la definición.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { danielaAgendarCitaFlow } from "@/lib/flows/daniela-agendar-cita.flow";
import { danielaRouterFlow } from "@/lib/flows/daniela-router.flow";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import type { EngineEffect, FlowEngineState } from "@/lib/flow/engine-types";

type RunResult = ReturnType<typeof runFlowEngine>;

describe("Fase 0 — Flow de Daniela pasa el validador real de publicación", () => {
  it("validateFlowForPublish: sin errores", () => {
    const result = validateFlowForPublish(danielaAgendarCitaFlow());
    if (!result.valid) {
      console.error(JSON.stringify(result.errors, null, 2));
    }
    assert.equal(result.valid, true, "el flow debe pasar schema + grafo + reglas de publicación + seguridad");
  });

  it("agendar_cita_especialista es crítica y SÍ tiene rama de fallo (act-agendar --failure--> msg-ocupado)", () => {
    const flow = danielaAgendarCitaFlow();
    const edgesDeAgendar = flow.edges.filter((e) => e.source === "act-agendar");
    assert.ok(edgesDeAgendar.some((e) => e.sourceHandle === "failure"));
  });

  it("la confirmación al cliente ocurre en un nodo AI DESPUÉS de act-agendar, nunca antes", () => {
    const flow = danielaAgendarCitaFlow();
    const nodeIds = flow.nodes.map((n) => n.id);
    const idxAgendar = nodeIds.indexOf("act-agendar");
    const idxConfirmar = nodeIds.indexOf("ai-confirmar");
    assert.ok(idxAgendar < idxConfirmar, "act-agendar debe declararse antes que ai-confirmar");
    const edgeAExito = flow.edges.find((e) => e.source === "act-agendar" && e.sourceHandle === "success");
    assert.equal(edgeAExito?.target, "ai-confirmar");
  });

  it("consultar disponibilidad ocurre antes de agendar (nunca se agenda a ciegas)", () => {
    const flow = danielaAgendarCitaFlow();
    const nodeIds = flow.nodes.map((n) => n.id);
    assert.ok(nodeIds.indexOf("act-consultar") < nodeIds.indexOf("act-agendar"));
  });

  // Fase 1 (bug crítico real, prueba 314 sin confirmación) -- ver nota de
  // diseño completa en daniela-agendar-cita.flow.ts.

  it("q-nombre conecta DIRECTO a act-consultar -- consultar disponibilidad no depende de ningún nodo AI intermedio", () => {
    const flow = danielaAgendarCitaFlow();
    const desdeNombre = flow.edges.filter((e) => e.source === "q-nombre");
    assert.equal(desdeNombre.length, 1);
    assert.equal(desdeNombre[0]?.target, "act-consultar");
    const nodoConsultar = flow.nodes.find((n) => n.id === "act-consultar");
    assert.equal(nodoConsultar?.type, "action", "act-consultar debe ser un nodo action directo, no un ai");
  });

  it("act-agendar SOLO es alcanzable desde la rama 'confirma' de la clasificación -- nunca desde 'no_confirma' ni desde default", () => {
    const flow = danielaAgendarCitaFlow();
    const haciaAgendar = flow.edges.filter((e) => e.target === "act-agendar");
    assert.equal(haciaAgendar.length, 1);
    assert.equal(haciaAgendar[0]?.source, "ai-clasificar-confirmacion");
    assert.equal(haciaAgendar[0]?.sourceHandle, "class:confirma");
  });

  it("ninguna rama de 'no confirma' llega a act-agendar", () => {
    const flow = danielaAgendarCitaFlow();
    const alcanzables = (desde: string): Set<string> => {
      const visitados = new Set<string>();
      const pila = [desde];
      while (pila.length) {
        const actual = pila.pop()!;
        if (visitados.has(actual)) continue;
        visitados.add(actual);
        for (const e of flow.edges.filter((edge) => edge.source === actual)) pila.push(e.target);
      }
      return visitados;
    };
    assert.equal(alcanzables("msg-cita-no-confirmada").has("act-agendar"), false);
    assert.equal(alcanzables("msg-sin-disponibilidad").has("act-agendar"), false);
  });

  it("la pregunta de confirmación ocurre DESPUÉS de consultar disponibilidad y ANTES de act-agendar", () => {
    const flow = danielaAgendarCitaFlow();
    const nodeIds = flow.nodes.map((n) => n.id);
    assert.ok(nodeIds.indexOf("act-consultar") < nodeIds.indexOf("q-confirmar-cita"));
    assert.ok(nodeIds.indexOf("q-confirmar-cita") < nodeIds.indexOf("act-agendar"));
  });

  it("la propuesta de disponibilidad es UN solo nodo de botones (q-confirmar-cita); no existe ai-proponer-cita", () => {
    const flow = danielaAgendarCitaFlow();
    assert.equal(flow.nodes.some((n) => n.id === "ai-proponer-cita"), false);
    const fromCond = flow.edges.find((e) => e.source === "cond-disponible" && e.sourceHandle === "true");
    assert.equal(fromCond?.target, "q-confirmar-cita");
    const q = flow.nodes.find((n) => n.id === "q-confirmar-cita");
    assert.ok(q && q.type === "buttons");
  });
});

// ============================================================
// Fase 3 (corrección definitiva) — tests ESTRUCTURALES de los bugs #2 y #5.
// ============================================================
describe("Fase 3 — estructura del subflow de agendar (bugs #2 y #5)", () => {
  it("Bug #5: NO existe msg-saludo; la primera pregunta de servicio es única (q-servicio)", () => {
    const flow = danielaAgendarCitaFlow();
    assert.equal(flow.nodes.some((n) => n.id === "msg-saludo"), false, "msg-saludo eliminado");
    const preguntasServicio = flow.nodes.filter(
      (n) => n.type === "question" && n.config.variableKey === "servicio",
    );
    assert.equal(preguntasServicio.length, 1, "una sola pregunta de servicio");
  });

  it("Bug #4: existe ai-extraer (extract) al inicio, con outputVariables acotadas", () => {
    const flow = danielaAgendarCitaFlow();
    const extraer = flow.nodes.find((n) => n.id === "ai-extraer");
    assert.ok(extraer && extraer.type === "ai");
    if (extraer.type === "ai") {
      assert.equal(extraer.config.mode, "extract");
      assert.deepEqual(extraer.config.outputVariables, ["servicio", "fecha", "hora", "nombreCliente"]);
    }
    const desdeStart = flow.edges.find((e) => e.source === "start");
    assert.equal(desdeStart?.target, "ai-extraer", "start conecta a la extracción, no a una pregunta");
  });

  it("Bug #2: ai-confirmar tiene rama aiFailure -> msg-confirmada-respaldo -> end (nunca vuelve a act-agendar/act-consultar)", () => {
    const flow = danielaAgendarCitaFlow();
    const fail = flow.edges.find((e) => e.source === "ai-confirmar" && e.sourceHandle === "failure");
    assert.ok(fail, "ai-confirmar debe tener rama de fallo");
    assert.equal(fail?.target, "msg-confirmada-respaldo");
    // El respaldo cierra el flujo y no reingresa a ninguna acción crítica.
    const alcanzables = reachableFrom(flow, "msg-confirmada-respaldo");
    assert.equal(alcanzables.has("act-agendar"), false);
    assert.equal(alcanzables.has("act-consultar"), false);
  });
});

// ============================================================
// Fase 3 — tests de MOTOR (deterministas, sin Claude real) del slot-filling.
// ============================================================
function reachableFrom(flow: ReturnType<typeof danielaAgendarCitaFlow>, from: string): Set<string> {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of flow.edges.filter((x) => x.source === cur)) stack.push(e.target);
  }
  return seen;
}

/** Arranca el flow con un primer mensaje y resuelve el efecto de ai-extraer
 * con lo "extraído" (simulado, sin Claude real). Devuelve el estado + efectos
 * resultantes tras la extracción. */
function arrancarConExtraccion(
  primerMensaje: string,
  extraido: Record<string, unknown>,
): { state: FlowEngineState; effects: EngineEffect[] } {
  const flow = danielaAgendarCitaFlow();
  let state = createFlowEngineState(flow, {});
  state.variables = { ...state.variables, hoy: "2026-08-30" };
  const run1 = runFlowEngine(flow, state, { type: "start", text: primerMensaje });
  state = run1.state;
  assert.equal(state.status, "waiting_effect");
  assert.equal(state.pendingEffect?.nodeId, "ai-extraer");
  const run2 = runFlowEngine(flow, state, {
    type: "effect_result",
    success: true,
    effectId: state.pendingEffect!.effectId,
    data: extraido,
  });
  return { state: run2.state, effects: run2.effects };
}

/** El nodo de pregunta en el que quedó esperando input (o null si no espera). */
function preguntaActual(state: FlowEngineState): string | null {
  return state.status === "waiting_input" ? (state.currentNodeId ?? null) : null;
}

describe("Fase 3 — slot-filling determinista (bugs #4 y #5) vía runFlowEngine", () => {
  it("A. 'Quiero una cita para el viernes a las 5 PM' (extrae fecha+hora, NO servicio) -> pregunta servicio, NO re-pregunta fecha/hora", () => {
    const { state, effects } = arrancarConExtraccion(
      "Quiero una cita para el viernes a las 5:00 PM",
      { fecha: "2026-09-04", hora: "17:00" },
    );
    // La primera pregunta tras extraer debe ser el servicio (lo único faltante).
    assert.equal(preguntaActual(state), "q-servicio");
    const textos = effects.filter((e) => e.type === "send_message").map((e) => (e.type === "send_message" ? e.content : null));
    // Solo UN send_message de pregunta en este turno, y es de servicio.
    assert.equal(textos.length, 1);
  });

  it("A2. tras responder el servicio, avanza a q-nombre (fecha/hora YA están, se saltan) y NUNCA re-pregunta fecha ni hora", () => {
    const flow = danielaAgendarCitaFlow();
    let state = arrancarConExtraccion(
      "Quiero una cita para el viernes a las 5:00 PM",
      { fecha: "2026-09-04", hora: "17:00" },
    ).state;
    assert.equal(preguntaActual(state), "q-servicio");
    const run = runFlowEngine(flow, state, { type: "text", text: "semipermanente" });
    state = run.state;
    // fecha y hora existen -> se saltan -> queda en q-nombre.
    assert.equal(preguntaActual(state), "q-nombre");
    const pidioFecha = run.effects.some((e) => e.type === "send_message" && e.nodeId === "q-fecha");
    const pidioHora = run.effects.some((e) => e.type === "send_message" && e.nodeId === "q-hora");
    assert.equal(pidioFecha, false, "NUNCA re-pregunta la fecha ya dada");
    assert.equal(pidioHora, false, "NUNCA re-pregunta la hora ya dada");
  });

  it("B. mensaje con servicio+fecha+hora (todo extraído) -> NO pregunta ninguno de los tres; solo pide el nombre", () => {
    const { state, effects } = arrancarConExtraccion(
      "Quiero semipermanente el 2026-09-02 a las 17:00",
      { servicio: "semipermanente", fecha: "2026-09-02", hora: "17:00" },
    );
    assert.equal(preguntaActual(state), "q-nombre");
    for (const nodo of ["q-servicio", "q-fecha", "q-hora"]) {
      assert.equal(
        effects.some((e) => e.type === "send_message" && e.nodeId === nodo),
        false,
        `no debe preguntar ${nodo}`,
      );
    }
  });

  it("C. mensaje sin ningún dato ('quiero una cita') -> pregunta el servicio UNA sola vez", () => {
    const { state, effects } = arrancarConExtraccion("Quiero una cita", {});
    assert.equal(preguntaActual(state), "q-servicio");
    const preguntasServicio = effects.filter((e) => e.type === "send_message" && e.nodeId === "q-servicio");
    assert.equal(preguntasServicio.length, 1);
  });

  it("D. un solo turno de arranque NO produce dos preguntas de servicio (bug #5 cerrado end-to-end)", () => {
    const { effects } = arrancarConExtraccion("Quiero una cita", {});
    const enviosPregunta = effects.filter((e) => e.type === "send_message");
    // Exactamente un send_message (la pregunta de servicio), nunca dos.
    assert.equal(enviosPregunta.length, 1);
  });

  it("Bug #2 (motor): si ai-confirmar falla tras act-agendar, cae al respaldo estático y termina (no reintenta acción)", () => {
    const flow = danielaAgendarCitaFlow();
    // Estado sintético: pendiente el efecto de ai-confirmar (ya se agendó).
    const base = createFlowEngineState(flow, {});
    const state: FlowEngineState = {
      ...base,
      status: "waiting_effect",
      currentNodeId: "ai-confirmar",
      pendingEffect: { kind: "ai", nodeId: "ai-confirmar", effectId: "fx-conf" },
      variables: { ...base.variables, citaId: 796, status: "confirmada", especialista: "Carla" },
    };
    const run = runFlowEngine(flow, state, {
      type: "effect_result",
      success: false,
      effectId: "fx-conf",
      error: "unverified_external_claim:appointment.reserved",
    });
    assert.equal(run.error, undefined, "un fallo de ai-confirmar NO debe romper el flow (hay rama de respaldo)");
    assert.ok(
      run.effects.some((e) => e.type === "send_message" && e.nodeId === "msg-confirmada-respaldo"),
      "debe enviar el mensaje de respaldo estático",
    );
    assert.equal(run.state.status, "completed");
  });
});

// ============================================================
// Regresión END-TO-END del incidente real (cita #796) por el MOTOR real
// (danielaAgendarCitaFlow completo, deterministas — sin Claude real).
// Conduce el camino exacto: extraer -> consultar -> proponer -> confirmar
// -> agendar -> ai-confirmar, y verifica las tres salidas críticas.
// ============================================================
function resolverEfecto(
  flow: ReturnType<typeof danielaAgendarCitaFlow>,
  state: FlowEngineState,
  data: Record<string, unknown>,
  success = true,
): RunResult {
  assert.equal(state.status, "waiting_effect", "se esperaba un efecto pendiente");
  return runFlowEngine(flow, state, {
    type: "effect_result",
    success,
    effectId: state.pendingEffect!.effectId,
    data,
  });
}

/** Conduce el flow real hasta DESPUÉS de que act-agendar devuelve SUCCESS
 * (cita creada), dejando la ejecución pausada esperando el efecto de
 * ai-confirmar. Acumula TODOS los efectos emitidos en el camino. */
function conducirHastaAgendarExitoso(): {
  flow: ReturnType<typeof danielaAgendarCitaFlow>;
  state: FlowEngineState;
  efectos: EngineEffect[];
} {
  const flow = danielaAgendarCitaFlow();
  let state = createFlowEngineState(flow, {});
  state.variables = { ...state.variables, hoy: "2026-08-30" };
  const efectos: EngineEffect[] = [];
  const push = (r: RunResult) => {
    efectos.push(...(r.effects ?? []));
    return r.state;
  };

  // start -> ai-extraer (efecto AI de extracción)
  state = push(runFlowEngine(flow, state, { type: "start", text: "Quiero semipermanente el 2026-09-02 a las 17:00 para Duvan" }));
  assert.equal(state.pendingEffect?.nodeId, "ai-extraer");
  // Extrae los 4 datos -> todas las condiciones 'exists' pasan -> act-consultar
  state = push(resolverEfecto(flow, state, { servicio: "semipermanente", fecha: "2026-09-02", hora: "17:00", nombreCliente: "Duvan" }));
  assert.equal(state.pendingEffect?.nodeId, "act-consultar");
  // Disponibilidad REAL: libre → propuesta + botones en el MISMO nodo
  state = push(resolverEfecto(flow, state, { disponible: true, duracionMin: 120, especialista: "Carla", horariosTomados: [] }));
  assert.equal(state.status, "waiting_input");
  assert.equal(state.currentNodeId, "q-confirmar-cita");
  assert.equal(state.expectedInput, "button");
  // Clienta confirma
  state = push(runFlowEngine(flow, state, { type: "text", text: "sí" }));
  assert.equal(state.pendingEffect?.nodeId, "ai-clasificar-confirmacion");
  state = push(resolverEfecto(flow, state, { classification: "confirma" }));
  assert.equal(state.pendingEffect?.nodeId, "act-agendar");
  // act-agendar SUCCESS: cita real creada
  state = push(resolverEfecto(flow, state, { citaId: 796, status: "confirmada", especialista: "Carla" }));
  assert.equal(state.pendingEffect?.nodeId, "ai-confirmar", "tras agendar exitoso pasa a ai-confirmar");
  return { flow, state, efectos };
}

describe("Regresión incidente #796 — motor real, camino completo agendar", () => {
  it("TAREA 3: act-agendar SUCCESS + ai-confirmar FALLA -> respaldo veraz, sin re-consultar, sin segunda cita, sin contradicción", () => {
    const { flow, state, efectos } = conducirHastaAgendarExitoso();
    // ai-confirmar FALLA deliberadamente (Claude/budget/API caído).
    const run = resolverEfecto(flow, state, {}, false);
    const todos = [...efectos, ...(run.effects ?? [])];

    // Salida segura: confirmación estática veraz, y el flujo CIERRA.
    assert.equal(run.error, undefined, "un ai-confirmar caído NO rompe el flow (hay rama de respaldo)");
    assert.ok(
      run.effects?.some((e) => e.type === "send_message" && e.nodeId === "msg-confirmada-respaldo"),
      "envía la confirmación de respaldo veraz",
    );
    assert.equal(run.state.status, "completed");
    assert.equal(run.state.currentNodeId, "end-confirmado-respaldo");

    // NUNCA re-consulta disponibilidad tras agendar (exactamente 1 act-consultar en todo el camino).
    const consultas = todos.filter((e) => e.type === "effect_required" && e.nodeId === "act-consultar");
    assert.equal(consultas.length, 1, "act-consultar ocurre UNA sola vez y antes de agendar");
    // NUNCA una segunda ejecución de act-agendar.
    const agendamientos = todos.filter((e) => e.type === "effect_required" && e.nodeId === "act-agendar");
    assert.equal(agendamientos.length, 1, "act-agendar ocurre UNA sola vez");
    // El respaldo no reingresa a ninguna acción crítica.
    const alcanzables = reachableFrom(flow, "msg-confirmada-respaldo");
    assert.equal(alcanzables.has("act-agendar"), false);
    assert.equal(alcanzables.has("act-consultar"), false);
    // No hay mensaje contradictorio de "ocupado" en este camino.
    assert.equal(
      todos.some((e) => e.type === "send_message" && e.nodeId === "msg-ocupado"),
      false,
      "jamás envía 'ocupado' tras crear la cita",
    );
  });

  it("TAREA 4: camino normal (ai-confirmar OK) -> UNA cita, UNA confirmación, sin consulta posterior", () => {
    const { flow, state, efectos } = conducirHastaAgendarExitoso();
    const run = resolverEfecto(flow, state, { responseText: "¡Listo Duvan! Tu cita quedó confirmada con Carla 💅" });
    const todos = [...efectos, ...(run.effects ?? [])];

    assert.equal(run.state.status, "completed");
    assert.equal(run.state.currentNodeId, "end-confirmado");
    // Una sola confirmación (la del propio ai-confirmar) y ningún respaldo redundante.
    const confirmaciones = (run.effects ?? []).filter((e) => e.type === "send_message");
    assert.equal(confirmaciones.length, 1);
    assert.equal(
      todos.some((e) => e.type === "send_message" && e.nodeId === "msg-confirmada-respaldo"),
      false,
      "no se envía el respaldo cuando ai-confirmar tuvo éxito",
    );
    // Exactamente una consulta y un agendamiento en todo el camino.
    assert.equal(todos.filter((e) => e.type === "effect_required" && e.nodeId === "act-consultar").length, 1);
    assert.equal(todos.filter((e) => e.type === "effect_required" && e.nodeId === "act-agendar").length, 1);
  });

  it("TAREA 5: act-agendar FALLA (ocupado) -> NUNCA confirma, NUNCA respaldo, va a msg-ocupado; ninguna cita fantasma", () => {
    // Conduce hasta act-agendar y lo hace FALLAR (slot tomado en el INSERT real).
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
    assert.equal(state.pendingEffect?.nodeId, "act-agendar");
    // act-agendar FALLA: el adaptador devolvió success=false (ocupado).
    const run = resolverEfecto(flow, state, { ocupado: true }, false);
    const todos = [...efectos, ...(run.effects ?? [])];

    // NO confirma, NO respaldo: cae por la rama de fallo a msg-ocupado.
    assert.equal(run.error, undefined);
    assert.equal(
      todos.some((e) => e.type === "send_message" && e.nodeId === "msg-confirmada-respaldo"),
      false,
      "JAMÁS envía la confirmación de respaldo si act-agendar falló (no hay cita real)",
    );
    assert.equal(
      todos.some((e) => e.type === "send_message" && e.nodeId === "ai-confirmar"),
      false,
      "no ejecuta ai-confirmar si no se agendó",
    );
    assert.ok(
      run.effects?.some((e) => e.type === "send_message" && e.nodeId === "msg-ocupado"),
      "informa 'ocupado' de forma segura, sin afirmar que quedó agendada",
    );
    // Estructuralmente: la rama de fallo de act-agendar NO llega a ai-confirmar ni al respaldo.
    const desdeFallo = reachableFrom(flow, "msg-ocupado");
    assert.equal(desdeFallo.has("ai-confirmar"), false);
    assert.equal(desdeFallo.has("msg-confirmada-respaldo"), false);
  });
});

describe("Regresión router (dos ejecuciones) — el reconocimiento vs. nueva cita deliberada", () => {
  it("TAREA 7a: un 'gracias' tras una cita se clasifica 'otro' -> end-otro SIN mensaje (no reingresa a agendar; LEGACY maneja el cierre)", () => {
    const flow = danielaRouterFlow();
    let state = createFlowEngineState(flow, {});
    const r1 = runFlowEngine(flow, state, { type: "start", text: "Muchas gracias" });
    state = r1.state;
    assert.equal(state.pendingEffect?.nodeId, "ai-clasificar-intencion");
    const r2 = runFlowEngine(flow, state, {
      type: "effect_result",
      success: true,
      effectId: state.pendingEffect!.effectId,
      data: { classification: "otro" },
    });
    assert.equal(r2.state.currentNodeId, "end-otro");
    assert.equal(
      (r2.effects ?? []).some((e) => e.type === "send_message"),
      false,
      "end-otro no envía nada -> el bridge deja pasar a LEGACY (handled=false), nunca re-agenda",
    );
    // NO entró al subflow de agendar.
    assert.equal(r2.state.currentNodeId?.startsWith("agendar__"), false);
  });

  it("TAREA 7b: 'quiero otra cita' se clasifica 'agendar' -> entra deliberadamente al subflow (agendar__ai-extraer)", () => {
    const flow = danielaRouterFlow();
    let state = createFlowEngineState(flow, {});
    const r1 = runFlowEngine(flow, state, { type: "start", text: "Ahora quiero otra cita para el viernes" });
    state = r1.state;
    const r2 = runFlowEngine(flow, state, {
      type: "effect_result",
      success: true,
      effectId: state.pendingEffect!.effectId,
      data: { classification: "agendar" },
    });
    // Entra al subflow real de agendar por su nodo de extracción (una sola pregunta luego).
    assert.equal(r2.state.pendingEffect?.nodeId, "agendar__ai-extraer");
  });

  it("TAREA 2 (duplicado): el router entra a agendar por ai-extraer y existe UNA sola pregunta de servicio (no hay msg-saludo)", () => {
    const flow = danielaRouterFlow();
    // No existe ningún nodo *msg-saludo* en el grafo compuesto.
    assert.equal(flow.nodes.some((n) => n.id.endsWith("msg-saludo")), false);
    const preguntasServicio = flow.nodes.filter(
      (n) => n.type === "question" && n.config.variableKey === "servicio",
    );
    assert.equal(preguntasServicio.length, 1, "una sola pregunta de servicio en todo el router");
    // La arista de clasificación 'agendar' apunta a la extracción, no a una pregunta directa.
    const eAgendar = flow.edges.find((e) => e.sourceHandle === "class:agendar" && e.source === "ai-clasificar-intencion");
    assert.equal(eAgendar?.target, "agendar__ai-extraer");
  });
});
