/**
 * Rediseño de agendamiento (autorizado) — el Flow de Daniela sigue siendo
 * REALIZABLE dentro del validador de publicación real (schema + grafo +
 * seguridad). No publica nada: solo corre `validateFlowForPublish` sobre la
 * definición, y `runFlowEngine` directo (determinista, sin Claude real).
 *
 * La validación EXHAUSTIVA de los parsers deterministas vive en sus propios
 * archivos: lib/parse-fecha-colombia.test.ts, lib/parse-hora-colombia.test.ts,
 * lib/especialistas-flow-adaptador-horarios.test.ts (listarHorariosDisponibles-
 * Especialista/resolverSeleccionHorario/formatearListaHorarios) y
 * lib/flow-runtime-bridge-escape-hatch.test.ts (escape hatch). Este archivo
 * se concentra en que el GRAFO conecte todo eso correctamente.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { danielaAgendarCitaFlow } from "@/lib/flows/daniela-agendar-cita.flow";
import { danielaRouterFlow } from "@/lib/flows/daniela-router.flow";
import { DANIELA_BUTTON_IDS } from "@/lib/flows/daniela-button-ids";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import type { EngineEffect, FlowEngineState } from "@/lib/flow/engine-types";

type RunResult = ReturnType<typeof runFlowEngine>;
type AgendarFlow = ReturnType<typeof danielaAgendarCitaFlow>;

/** `avoid`: nodos que se tratan como muros -- no se sale de ellos (salvo `from` misma).
 * Sirve para probar "todo camino de A a B pasa OBLIGATORIAMENTE por N": si B deja de
 * ser alcanzable al poner N en avoid, N es una puerta real, no un atajo evitable. */
function reachableFrom(flow: AgendarFlow, from: string, avoid?: Set<string>): Set<string> {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    if (avoid?.has(cur) && cur !== from) continue;
    seen.add(cur);
    for (const e of flow.edges.filter((x) => x.source === cur)) stack.push(e.target);
  }
  return seen;
}

describe("Rediseño de agendamiento — Flow de Daniela pasa el validador real de publicación", () => {
  it("validateFlowForPublish: sin errores", () => {
    const result = validateFlowForPublish(danielaAgendarCitaFlow());
    if (!result.valid) console.error(JSON.stringify(result.errors, null, 2));
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
    assert.ok(nodeIds.indexOf("act-agendar") < nodeIds.indexOf("ai-confirmar"));
    const edgeAExito = flow.edges.find((e) => e.source === "act-agendar" && e.sourceHandle === "success");
    assert.equal(edgeAExito?.target, "ai-confirmar");
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
    assert.equal(reachableFrom(flow, "msg-cita-no-confirmada").has("act-agendar"), false);
  });

  it("Bug #2 (conservado): ai-confirmar tiene rama aiFailure -> msg-confirmada-respaldo -> end, nunca reingresa a act-agendar/act-listar-horarios", () => {
    const flow = danielaAgendarCitaFlow();
    const fail = flow.edges.find((e) => e.source === "ai-confirmar" && e.sourceHandle === "failure");
    assert.equal(fail?.target, "msg-confirmada-respaldo");
    const alcanzables = reachableFrom(flow, "msg-confirmada-respaldo");
    assert.equal(alcanzables.has("act-agendar"), false);
    assert.equal(alcanzables.has("act-listar-horarios"), false);
  });
});

// ============================================================
// Rediseño de agendamiento (autorizado) — estructura del nuevo modelo.
// ============================================================
describe("Rediseño — estructura: fecha/horarios reales reemplazan '¿a qué hora?'", () => {
  it("ya NO existe ninguna pregunta directa de hora (q-hora eliminado) -- la hora se resuelve SIEMPRE contra la lista real", () => {
    const flow = danielaAgendarCitaFlow();
    assert.equal(flow.nodes.some((n) => n.id === "q-hora"), false);
  });

  it("q-fecha SIEMPRE pasa por act-validar-fecha (parser determinista) antes de listar horarios", () => {
    const flow = danielaAgendarCitaFlow();
    // q-fecha converge en cond-nombre (mismo patrón de slot-filling que
    // servicio/fecha/nombre ya usaban) -- act-validar-fecha se alcanza
    // recién cuando AMBOS datos (fecha y nombre) ya están, sin importar si
    // vinieron de la extracción o de las preguntas.
    assert.ok(reachableFrom(flow, "q-fecha").has("act-validar-fecha"));
    const exito = flow.edges.find((e) => e.source === "act-validar-fecha" && e.sourceHandle === "success");
    assert.equal(exito?.target, "act-listar-horarios");
    const fallo = flow.edges.find((e) => e.source === "act-validar-fecha" && e.sourceHandle === "failure");
    assert.equal(fallo?.target, "msg-fecha-invalida");
    const reintento = flow.edges.find((e) => e.source === "msg-fecha-invalida");
    assert.equal(reintento?.target, "q-fecha", "una fecha inválida vuelve a preguntar, nunca sigue con texto crudo");
  });

  it("act-listar-horarios existe y SIN disponibilidad vuelve a pedir fecha (nunca inventa horarios)", () => {
    const flow = danielaAgendarCitaFlow();
    const cond = flow.edges.find((e) => e.source === "act-listar-horarios" && e.sourceHandle === "success");
    assert.equal(cond?.target, "cond-hay-horarios");
    const sinHorarios = flow.edges.find((e) => e.source === "cond-hay-horarios" && e.sourceHandle === "false");
    assert.equal(sinHorarios?.target, "msg-sin-disponibilidad");
    const reintento = flow.edges.find((e) => e.source === "msg-sin-disponibilidad");
    assert.equal(reintento?.target, "q-fecha");
  });

  it("con horarios reales, primero se intenta el camino rápido (act-resolver-seleccion-inicial) antes de preguntar", () => {
    const flow = danielaAgendarCitaFlow();
    const hayHorarios = flow.edges.find((e) => e.source === "cond-hay-horarios" && e.sourceHandle === "true");
    assert.equal(hayHorarios?.target, "act-resolver-seleccion-inicial");
    const ok = flow.edges.find((e) => e.source === "act-resolver-seleccion-inicial" && e.sourceHandle === "success");
    assert.equal(ok?.target, "q-confirmar-cita", "si el hint de hora calza con la lista real, va directo a confirmar");
    const fail = flow.edges.find((e) => e.source === "act-resolver-seleccion-inicial" && e.sourceHandle === "failure");
    assert.equal(fail?.target, "q-seleccionar-horario", "si no calza, cae a la pregunta abierta -- nunca un error visible");
  });

  it("la pregunta abierta de horario muestra la lista real y pasa por IA (interpretar) + acción determinista (validar contra la lista)", () => {
    const flow = danielaAgendarCitaFlow();
    const pregunta = flow.nodes.find((n) => n.id === "q-seleccionar-horario");
    assert.equal(pregunta?.type, "question");
    if (pregunta?.type === "question") assert.match(pregunta.config.text, /horariosDisponiblesTexto/);

    const aInterpretar = flow.edges.find((e) => e.source === "q-seleccionar-horario");
    assert.equal(aInterpretar?.target, "ai-interpretar-seleccion");

    const interpretar = flow.nodes.find((n) => n.id === "ai-interpretar-seleccion");
    assert.equal(interpretar?.type, "ai");
    if (interpretar?.type === "ai") {
      assert.equal(interpretar.config.mode, "extract");
      assert.deepEqual(interpretar.config.outputVariables, ["seleccionTipo", "seleccionIndice", "seleccionHora"]);
    }

    const aResolver = flow.edges.find((e) => e.source === "ai-interpretar-seleccion" && e.sourceHandle === "success");
    assert.equal(aResolver?.target, "act-resolver-seleccion-horario");

    const ok = flow.edges.find((e) => e.source === "act-resolver-seleccion-horario" && e.sourceHandle === "success");
    assert.equal(ok?.target, "q-confirmar-cita");
    const fail = flow.edges.find((e) => e.source === "act-resolver-seleccion-horario" && e.sourceHandle === "failure");
    assert.equal(fail?.target, "msg-seleccion-no-clara");
    const reintento = flow.edges.find((e) => e.source === "msg-seleccion-no-clara");
    assert.equal(reintento?.target, "q-seleccionar-horario", "una selección no clara vuelve a preguntar, NUNCA inventa un horario");
  });

  it("'Otro horario' desde q-confirmar-cita SIEMPRE re-consulta y NUNCA reutiliza el hint de hora ya confirmada (evita re-seleccionar el mismo horario en loop)", () => {
    const flow = danielaAgendarCitaFlow();
    const otroHorario = flow.edges.find((e) => e.source === "q-confirmar-cita" && e.sourceHandle === "button:otro_horario");
    assert.equal(otroHorario?.target, "act-relistar-horarios", "NO debe volver a act-resolver-seleccion-inicial (reusaría el hint viejo)");
    const cond = flow.edges.find((e) => e.source === "act-relistar-horarios" && e.sourceHandle === "success");
    assert.equal(cond?.target, "cond-hay-horarios-otro");
    const hay = flow.edges.find((e) => e.source === "cond-hay-horarios-otro" && e.sourceHandle === "true");
    assert.equal(hay?.target, "q-seleccionar-horario", "va DIRECTO a la pregunta abierta, nunca al camino rápido con el hint viejo");
  });

  it("nunca existe ningún camino donde una hora fuera de la lista real llegue a q-confirmar-cita sin pasar por resolver_seleccion_horario", () => {
    const flow = danielaAgendarCitaFlow();
    const predecesoresDeConfirmar = flow.edges.filter((e) => e.target === "q-confirmar-cita").map((e) => e.source);
    for (const p of predecesoresDeConfirmar) {
      const nodo = flow.nodes.find((n) => n.id === p);
      assert.ok(
        nodo?.type === "action" && nodo.config.actionType === "resolver_seleccion_horario",
        `q-confirmar-cita solo debe ser alcanzable desde resolver_seleccion_horario, no desde "${p}" (${nodo?.type})`,
      );
    }
  });
});

// ============================================================
// Rediseño — cita(s) previa(s) (Parte 13 del pedido).
// ============================================================
describe("Rediseño — cita(s) activa(s) previa(s), antes de recolectar nada", () => {
  it("start conecta a act-consultar-citas-previas, NO directo a ai-extraer", () => {
    const flow = danielaAgendarCitaFlow();
    const desdeStart = flow.edges.find((e) => e.source === "start");
    assert.equal(desdeStart?.target, "act-consultar-citas-previas");
  });

  it("sin citas previas -> sigue directo a ai-extraer, sin preguntar nada de más", () => {
    const flow = danielaAgendarCitaFlow();
    const sinCitas = flow.edges.find((e) => e.source === "cond-tiene-citas-previas" && e.sourceHandle === "false");
    assert.equal(sinCitas?.target, "ai-extraer");
  });

  it("con cita(s) previa(s) -> informa con datos reales y pregunta explícitamente si quiere una adicional (nunca bloquea, nunca asume)", () => {
    const flow = danielaAgendarCitaFlow();
    const conCitas = flow.edges.find((e) => e.source === "cond-tiene-citas-previas" && e.sourceHandle === "true");
    assert.equal(conCitas?.target, "ai-informar-cita-existente");
    const aPregunta = flow.edges.find((e) => e.source === "ai-informar-cita-existente" && e.sourceHandle === "success");
    assert.equal(aPregunta?.target, "q-agendar-adicional");
    const noQuiere = flow.edges.find((e) => e.source === "ai-clasificar-adicional" && e.sourceHandle === "class:no_quiere");
    assert.equal(noQuiere?.target, "msg-mantiene-cita-existente");
    const quiere = flow.edges.find((e) => e.source === "ai-clasificar-adicional" && e.sourceHandle === "class:quiere_adicional");
    assert.equal(quiere?.target, "ai-extraer", "solo si confirma explícitamente, continúa el slot-filling normal");
    const porDefecto = flow.edges.find((e) => e.source === "ai-clasificar-adicional" && e.sourceHandle === "default");
    assert.equal(porDefecto?.target, "msg-mantiene-cita-existente", "ante la duda, nunca crea una cita adicional");
  });

  it("msg-mantiene-cita-existente NUNCA llega a act-agendar", () => {
    const flow = danielaAgendarCitaFlow();
    assert.equal(reachableFrom(flow, "msg-mantiene-cita-existente").has("act-agendar"), false);
  });
});

// ============================================================
// Tests de MOTOR (deterministas, sin Claude real) del camino completo.
// ============================================================
function resolverEfecto(flow: AgendarFlow, state: FlowEngineState, data: Record<string, unknown>, success = true): RunResult {
  assert.equal(state.status, "waiting_effect", "se esperaba un efecto pendiente");
  return runFlowEngine(flow, state, { type: "effect_result", success, effectId: state.pendingEffect!.effectId, data });
}

const HORARIOS_REALES = ["16:00", "17:00", "18:00"];
const HORARIOS_TEXTO = "1️⃣ 4:00 p. m.\n2️⃣ 5:00 p. m.\n3️⃣ 6:00 p. m.";

/** Conduce el flow real desde "start" hasta justo DESPUÉS de que
 * act-consultar-citas-previas y ai-extraer resolvieron (sin citas previas),
 * dejando el estado esperando el efecto de act-validar-servicio. */
function arrancarSinCitasPrevias(
  primerMensaje: string,
  extraido: Record<string, unknown>,
): { flow: AgendarFlow; state: FlowEngineState; efectos: EngineEffect[] } {
  const flow = danielaAgendarCitaFlow();
  let state = createFlowEngineState(flow, {});
  state.variables = { ...state.variables, hoy: "2026-08-30" };
  const efectos: EngineEffect[] = [];
  const push = (r: RunResult) => {
    efectos.push(...(r.effects ?? []));
    return r.state;
  };
  state = push(runFlowEngine(flow, state, { type: "start", text: primerMensaje }));
  assert.equal(state.pendingEffect?.nodeId, "act-consultar-citas-previas");
  state = push(resolverEfecto(flow, state, { cantidadCitas: 0, citasActivas: [] }));
  assert.equal(state.pendingEffect?.nodeId, "ai-extraer");
  state = push(resolverEfecto(flow, state, extraido));
  return { flow, state, efectos };
}

function preguntaActual(state: FlowEngineState): string | null {
  return state.status === "waiting_input" ? (state.currentNodeId ?? null) : null;
}

// ============================================================================
// Objetivo 1 (rediseño de categorías, autorizado) — requisitos explícitos.
// Complementa Objetivo 1, caso 2/3/3b/4/4b (contra Supabase real) en
// lib/especialistas-flow-adaptador.test.ts: acá se prueba el GRAFO
// (botones deterministas, backend no confía en el texto visible, "OK 👌"
// no avanza, continuación tras servicio), no la validación de negocio.
// ============================================================================
describe("Objetivo 1 — categoría antes del servicio (requisitos explícitos)", () => {
  it("1. 'Servicios de Spa' muestra las 3 categorías reales por botón (Manos/Pies/Pestañas), IDs estables", () => {
    const flow = danielaRouterFlow();
    const catNode = flow.nodes.find((n) => n.id === "agendar__q-categoria-servicio");
    assert.ok(catNode && catNode.type === "buttons", "debe ser un menú cerrado de botones, no una pregunta abierta de IA");
    if (catNode.type !== "buttons") return;
    const ids = catNode.config.buttons.map((b) => b.id).sort();
    assert.deepEqual(ids, [DANIELA_BUTTON_IDS.CATEGORIA_MANOS, DANIELA_BUTTON_IDS.CATEGORIA_PESTANAS, DANIELA_BUTTON_IDS.CATEGORIA_PIES].sort());
    // El backend decide por id, nunca por el label visible.
    for (const b of catNode.config.buttons) assert.ok(b.id.startsWith("categoria_"), b.id);
  });

  it("2. seleccionar 'Manos' escribe categoriaSeleccionada con el id ESTABLE del botón, nunca con el label", () => {
    const { flow, state } = arrancarSinCitasPrevias("Quiero una cita", {});
    assert.equal(preguntaActual(state), "q-categoria-servicio");
    const tras = runFlowEngine(flow, state, { type: "button", id: DANIELA_BUTTON_IDS.CATEGORIA_MANOS }).state;
    assert.equal(tras.variables.categoriaSeleccionada, DANIELA_BUTTON_IDS.CATEGORIA_MANOS);
    assert.notEqual(tras.variables.categoriaSeleccionada, "Manos", "nunca el texto visible del botón");
  });

  it("3. seleccionar otra categoría ('Pies') deja su propio id -- cada categoría es independiente", () => {
    const { flow, state } = arrancarSinCitasPrevias("Quiero una cita", {});
    const tras = runFlowEngine(flow, state, { type: "button", id: DANIELA_BUTTON_IDS.CATEGORIA_PIES }).state;
    assert.equal(tras.variables.categoriaSeleccionada, DANIELA_BUTTON_IDS.CATEGORIA_PIES);
    assert.equal(preguntaActual(tras), "q-servicio");
  });

  it("4. servicio real pero de OTRA categoría se rechaza en act-validar-servicio (categoria_no_coincide) -- grafo llega a validar con la categoría en el payload", () => {
    const { flow, state } = arrancarSinCitasPrevias("Quiero una cita", {});
    const conCategoria = runFlowEngine(flow, state, { type: "button", id: DANIELA_BUTTON_IDS.CATEGORIA_MANOS }).state;
    assert.equal(preguntaActual(conCategoria), "q-servicio");
    const conServicio = runFlowEngine(flow, conCategoria, { type: "text", text: "pestañas volumen ruso" }).state;
    assert.equal(conServicio.pendingEffect?.nodeId, "act-validar-servicio");
    // El payload que recibiría el executor SÍ incluye la categoría elegida
    // (mismo mecanismo que ya prueba internal-action-executor: variables de
    // state se mergean a params) -- la validación de negocio real
    // (categoria_no_coincide) ya está probada contra Supabase real en
    // especialistas-flow-adaptador.test.ts, Objetivo 1 caso 4.
    assert.equal(conServicio.variables.categoriaSeleccionada, DANIELA_BUTTON_IDS.CATEGORIA_MANOS);
    const fallo = resolverEfecto(flow, conServicio, {}, false);
    assert.equal(preguntaActual(fallo.state), "q-servicio", "rechazado, vuelve a preguntar servicio SIN perder la categoría");
    assert.equal(fallo.state.variables.categoriaSeleccionada, DANIELA_BUTTON_IDS.CATEGORIA_MANOS, "la categoría elegida se conserva para el reintento");
  });

  it("5. 'OK 👌' no avanza incorrectamente -- ni en la categoría ni en el servicio", () => {
    const { flow, state } = arrancarSinCitasPrevias("Quiero una cita", {});
    assert.equal(preguntaActual(state), "q-categoria-servicio");

    // "OK 👌" no calza con ningún botón de categoría -> texto libre -> se
    // trata como intento de servicio, y falla (no es un servicio real).
    const trasOkEnCategoria = runFlowEngine(flow, state, { type: "text", text: "OK 👌" }).state;
    assert.equal(trasOkEnCategoria.pendingEffect?.nodeId, "act-validar-servicio");
    const falloCategoria = resolverEfecto(flow, trasOkEnCategoria, {}, false);
    assert.equal(preguntaActual(falloCategoria.state), "q-servicio", "no avanza a fecha ni a ningún otro paso");
    assert.equal(falloCategoria.state.variables.servicio, undefined, "nunca queda 'OK 👌' guardado como servicio válido");

    // Mismo resultado si "OK 👌" llega ya con categoría elegida, en q-servicio
    // (q-servicio SÍ escribe la respuesta cruda en variables.servicio al
    // responder, igual que cualquier otra pregunta -- mismo criterio que ya
    // usa el test B con "un masaje" -- pero NUNCA avanza a fecha, y
    // act-validar-servicio rechaza esa respuesta cruda por no ser un
    // servicio real).
    const conCategoria = runFlowEngine(flow, state, { type: "button", id: DANIELA_BUTTON_IDS.CATEGORIA_PIES }).state;
    const trasOkEnServicio = runFlowEngine(flow, conCategoria, { type: "text", text: "OK 👌" }).state;
    assert.equal(trasOkEnServicio.pendingEffect?.nodeId, "act-validar-servicio");
    const falloServicio = resolverEfecto(flow, trasOkEnServicio, {}, false);
    assert.equal(preguntaActual(falloServicio.state), "q-servicio", "vuelve a preguntar, no un loop ciego ni un reinicio del flow");
    assert.notEqual(preguntaActual(falloServicio.state), "q-fecha", "nunca avanza de más solo porque se respondió algo");
  });

  it("6. el flujo continúa correctamente después de seleccionar un servicio real (llega a pedir fecha)", () => {
    const { flow, state } = arrancarSinCitasPrevias("Quiero una cita", {});
    const conCategoria = runFlowEngine(flow, state, { type: "button", id: DANIELA_BUTTON_IDS.CATEGORIA_MANOS }).state;
    const conServicio = runFlowEngine(flow, conCategoria, { type: "text", text: "semipermanente en manos" }).state;
    assert.equal(conServicio.pendingEffect?.nodeId, "act-validar-servicio");
    const validado = resolverEfecto(flow, conServicio, { servicio: "semipermanente en manos", servicioReconocido: true });
    assert.equal(validado.error, undefined);
    assert.equal(validado.state.variables.servicio, "semipermanente en manos", "act-validar-servicio SÍ escribe servicio de vuelta");
    assert.equal(preguntaActual(validado.state), "q-fecha", "sigue con normalidad al siguiente paso real del flow");
  });
});

describe("Motor — slot-filling determinista vía runFlowEngine", () => {
  it("A. mensaje sin ningún dato ('quiero una cita') -> pregunta categoría, luego servicio, cada una UNA sola vez", () => {
    const { flow, state, efectos } = arrancarSinCitasPrevias("Quiero una cita", {});
    assert.equal(preguntaActual(state), "q-categoria-servicio", "Objetivo 1: categoría real antes del servicio");
    const preguntasCategoria = efectos.filter((e) => e.type === "send_message" && e.nodeId === "q-categoria-servicio");
    assert.equal(preguntasCategoria.length, 1);

    const conCategoria = runFlowEngine(flow, state, { type: "button", id: DANIELA_BUTTON_IDS.CATEGORIA_MANOS }).state;
    assert.equal(preguntaActual(conCategoria), "q-servicio");
  });

  it("B. servicio inválido en q-servicio falla en act-validar-servicio y vuelve a preguntar servicio (categoría ya elegida se conserva)", () => {
    const { flow, state: s0 } = arrancarSinCitasPrevias("Quiero una cita", {});
    assert.equal(preguntaActual(s0), "q-categoria-servicio");
    const conCategoria = runFlowEngine(flow, s0, { type: "button", id: DANIELA_BUTTON_IDS.CATEGORIA_MANOS }).state;
    assert.equal(preguntaActual(conCategoria), "q-servicio");
    const state = runFlowEngine(flow, conCategoria, { type: "text", text: "un masaje" }).state;
    assert.equal(state.pendingEffect?.nodeId, "act-validar-servicio");
    const run = resolverEfecto(flow, state, {}, false);
    assert.equal(preguntaActual(run.state), "q-servicio", "vuelve a preguntar servicio tras validación fallida");
    assert.equal(run.state.variables.categoriaSeleccionada, DANIELA_BUTTON_IDS.CATEGORIA_MANOS, "la categoría elegida no se pierde en el reintento");
  });

  it("C. fecha en texto natural ('el sábado') -> act-validar-fecha la normaliza -> act-listar-horarios recibe la fecha YA real", () => {
    const { flow, state: s0 } = arrancarSinCitasPrevias("Quiero semipermanente para Ana", {
      servicio: "semipermanente",
      nombreCliente: "Ana",
    });
    assert.equal(s0.pendingEffect?.nodeId, "act-validar-servicio");
    let state = resolverEfecto(flow, s0, { servicioReconocido: true }).state;
    assert.equal(preguntaActual(state), "q-fecha");
    state = runFlowEngine(flow, state, { type: "text", text: "el sábado" }).state;
    assert.equal(state.pendingEffect?.nodeId, "act-validar-fecha");
    // Simula EXACTAMENTE lo que devolvería el executor real (parseFechaColombia
    // normalizando "el sábado" con hoy=2026-08-30, un domingo -> sábado 2026-09-05).
    const run = resolverEfecto(flow, state, { fecha: "2026-09-05", nuevaFecha: "2026-09-05" });
    assert.equal(run.state.pendingEffect?.nodeId, "act-listar-horarios");
  });

  it("D. fecha inválida ('mmm no sé') -> act-validar-fecha falla -> vuelve a preguntar, NUNCA llega a listar horarios", () => {
    const { flow, state: s0 } = arrancarSinCitasPrevias("Quiero semipermanente para Ana", {
      servicio: "semipermanente",
      nombreCliente: "Ana",
    });
    let state = resolverEfecto(flow, s0, { servicioReconocido: true }).state;
    state = runFlowEngine(flow, state, { type: "text", text: "mmm no sé" }).state;
    assert.equal(state.pendingEffect?.nodeId, "act-validar-fecha");
    const run = resolverEfecto(flow, state, {}, false);
    assert.equal(preguntaActual(run.state), "q-fecha", "una fecha inválida siempre vuelve a preguntar");
    assert.equal(
      run.effects?.some((e) => e.type === "effect_required" && e.nodeId === "act-listar-horarios"),
      false,
      "NUNCA debe llegar a consultar horarios con una fecha inválida",
    );
  });

  it("E. sin horarios ese día -> informa y vuelve a pedir fecha, nunca inventa un horario", () => {
    const { flow, state: s0 } = arrancarSinCitasPrevias("Quiero semipermanente el 2026-09-02 para Ana", {
      servicio: "semipermanente",
      fecha: "2026-09-02",
      nombreCliente: "Ana",
    });
    let state = resolverEfecto(flow, s0, { servicioReconocido: true }).state;
    assert.equal(state.pendingEffect?.nodeId, "act-validar-fecha");
    state = resolverEfecto(flow, state, { fecha: "2026-09-02", nuevaFecha: "2026-09-02" }).state;
    assert.equal(state.pendingEffect?.nodeId, "act-listar-horarios");
    const run = resolverEfecto(flow, state, { horariosDisponibles: [], horariosDisponiblesTexto: "", cantidadHorarios: 0, especialista: "Carla", duracionMin: 60 });
    assert.equal(preguntaActual(run.state), "q-fecha");
  });

  it("F. hay horarios reales, la clienta escribe 'la segunda' -> ai-interpretar-seleccion + act-resolver-seleccion-horario resuelven 16:00→17:00 (índice 2)", () => {
    const { flow, state: s0 } = arrancarSinCitasPrevias("Quiero semipermanente el 2026-09-02 para Ana", {
      servicio: "semipermanente",
      fecha: "2026-09-02",
      nombreCliente: "Ana",
    });
    let state = resolverEfecto(flow, s0, { servicioReconocido: true }).state;
    state = resolverEfecto(flow, state, { fecha: "2026-09-02", nuevaFecha: "2026-09-02" }).state;
    assert.equal(state.pendingEffect?.nodeId, "act-listar-horarios");
    state = resolverEfecto(flow, state, {
      horariosDisponibles: HORARIOS_REALES,
      horariosDisponiblesTexto: HORARIOS_TEXTO,
      cantidadHorarios: HORARIOS_REALES.length,
      especialista: "Carla",
      duracionMin: 60,
    }).state;
    assert.equal(state.pendingEffect?.nodeId, "act-resolver-seleccion-inicial");
    // Sin hint de hora en el primer mensaje -> el camino rápido falla (nada que intentar).
    state = resolverEfecto(flow, state, {}, false).state;
    assert.equal(preguntaActual(state), "q-seleccionar-horario");
    state = runFlowEngine(flow, state, { type: "text", text: "la segunda" }).state;
    assert.equal(state.pendingEffect?.nodeId, "ai-interpretar-seleccion");
    state = resolverEfecto(flow, state, { seleccionTipo: "index", seleccionIndice: 2 }).state;
    assert.equal(state.pendingEffect?.nodeId, "act-resolver-seleccion-horario");
    const run = resolverEfecto(flow, state, { hora: "17:00" });
    assert.equal(run.state.status, "waiting_input");
    assert.equal(run.state.currentNodeId, "q-confirmar-cita");
    assert.equal(run.state.variables.hora, "17:00", "la hora real quedó resuelta -- interpolable en la confirmación");
  });

  it("G. la IA interpreta un horario FUERA de la lista real (alucinado) -> act-resolver-seleccion-horario lo RECHAZA, nunca llega a confirmar", () => {
    const { flow, state: s0 } = arrancarSinCitasPrevias("Quiero semipermanente el 2026-09-02 para Ana", {
      servicio: "semipermanente",
      fecha: "2026-09-02",
      nombreCliente: "Ana",
    });
    let state = resolverEfecto(flow, s0, { servicioReconocido: true }).state;
    state = resolverEfecto(flow, state, { fecha: "2026-09-02", nuevaFecha: "2026-09-02" }).state;
    state = resolverEfecto(flow, state, {
      horariosDisponibles: HORARIOS_REALES,
      horariosDisponiblesTexto: HORARIOS_TEXTO,
      cantidadHorarios: HORARIOS_REALES.length,
      especialista: "Carla",
      duracionMin: 60,
    }).state;
    state = resolverEfecto(flow, state, {}, false).state; // sin hint -> pregunta abierta
    state = runFlowEngine(flow, state, { type: "text", text: "la de las 8" }).state;
    assert.equal(state.pendingEffect?.nodeId, "ai-interpretar-seleccion");
    // Claude "alucina" 20:00, que NO está en HORARIOS_REALES.
    state = resolverEfecto(flow, state, { seleccionTipo: "time", seleccionHora: "20:00" }).state;
    assert.equal(state.pendingEffect?.nodeId, "act-resolver-seleccion-horario");
    // El EXECUTOR real rechazaría esto (ver especialistas-flow-adaptador-horarios.test.ts);
    // acá se simula esa respuesta real: success=false.
    const run = resolverEfecto(flow, state, {}, false);
    assert.equal(preguntaActual(run.state), "q-seleccionar-horario", "nunca llega a q-confirmar-cita con un horario inventado");
    assert.equal(
      run.effects?.some((e) => e.type === "send_message" && e.nodeId === "q-confirmar-cita"),
      false,
    );
  });

  it("H. hint de hora del primer mensaje SÍ calza con la lista real -> camino rápido, sin preguntar de nuevo", () => {
    const { flow, state: s0 } = arrancarSinCitasPrevias("Quiero semipermanente el 2026-09-02 a las 17:00 para Ana", {
      servicio: "semipermanente",
      fecha: "2026-09-02",
      hora: "17:00",
      nombreCliente: "Ana",
    });
    let state = resolverEfecto(flow, s0, { servicioReconocido: true }).state;
    state = resolverEfecto(flow, state, { fecha: "2026-09-02", nuevaFecha: "2026-09-02" }).state;
    state = resolverEfecto(flow, state, {
      horariosDisponibles: HORARIOS_REALES,
      horariosDisponiblesTexto: HORARIOS_TEXTO,
      cantidadHorarios: HORARIOS_REALES.length,
      especialista: "Carla",
      duracionMin: 60,
    }).state;
    assert.equal(state.pendingEffect?.nodeId, "act-resolver-seleccion-inicial");
    const run = resolverEfecto(flow, state, { hora: "17:00" });
    assert.equal(run.state.status, "waiting_input");
    assert.equal(run.state.currentNodeId, "q-confirmar-cita", "va directo a confirmar, nunca pregunta el horario de nuevo");
  });
});

// ============================================================
// Regresión END-TO-END del incidente real (cita #796) por el MOTOR real,
// adaptada al nuevo camino (fecha/horarios reales) -- mismo espíritu que la
// versión original: conducir hasta agendar exitoso y verificar las tres
// salidas críticas.
// ============================================================
function conducirHastaAgendarExitoso(): { flow: AgendarFlow; state: FlowEngineState; efectos: EngineEffect[] } {
  const { flow, state: s0, efectos } = arrancarSinCitasPrevias("Quiero semipermanente el 2026-09-02 a las 17:00 para Duvan", {
    servicio: "semipermanente",
    fecha: "2026-09-02",
    hora: "17:00",
    nombreCliente: "Duvan",
  });
  const push = (r: RunResult) => {
    efectos.push(...(r.effects ?? []));
    return r.state;
  };
  let state = s0;
  assert.equal(state.pendingEffect?.nodeId, "act-validar-servicio");
  state = push(resolverEfecto(flow, state, { servicioReconocido: true }));
  assert.equal(state.pendingEffect?.nodeId, "act-validar-fecha");
  state = push(resolverEfecto(flow, state, { fecha: "2026-09-02", nuevaFecha: "2026-09-02" }));
  assert.equal(state.pendingEffect?.nodeId, "act-listar-horarios");
  state = push(
    resolverEfecto(flow, state, {
      horariosDisponibles: HORARIOS_REALES,
      horariosDisponiblesTexto: HORARIOS_TEXTO,
      cantidadHorarios: HORARIOS_REALES.length,
      especialista: "Carla",
      duracionMin: 120,
    }),
  );
  assert.equal(state.pendingEffect?.nodeId, "act-resolver-seleccion-inicial");
  state = push(resolverEfecto(flow, state, { hora: "17:00" })); // hint calza -> camino rápido
  assert.equal(state.status, "waiting_input");
  assert.equal(state.currentNodeId, "q-confirmar-cita");
  assert.equal(state.expectedInput, "button");
  state = push(runFlowEngine(flow, state, { type: "text", text: "sí" }));
  assert.equal(state.pendingEffect?.nodeId, "ai-clasificar-confirmacion");
  state = push(resolverEfecto(flow, state, { classification: "confirma" }));
  assert.equal(state.pendingEffect?.nodeId, "act-agendar");
  state = push(resolverEfecto(flow, state, { citaId: 796, status: "confirmada", especialista: "Carla" }));
  assert.equal(state.pendingEffect?.nodeId, "ai-confirmar", "tras agendar exitoso pasa a ai-confirmar");
  return { flow, state, efectos };
}

describe("Regresión incidente #796 — motor real, camino completo agendar (adaptado al rediseño)", () => {
  it("act-agendar SUCCESS + ai-confirmar FALLA -> respaldo veraz, sin re-consultar, sin segunda cita, sin contradicción", () => {
    const { flow, state, efectos } = conducirHastaAgendarExitoso();
    const run = resolverEfecto(flow, state, {}, false);
    const todos = [...efectos, ...(run.effects ?? [])];

    assert.equal(run.error, undefined, "un ai-confirmar caído NO rompe el flow (hay rama de respaldo)");
    assert.ok(run.effects?.some((e) => e.type === "send_message" && e.nodeId === "msg-confirmada-respaldo"));
    const salientes = (run.effects ?? []).filter((e) => e.type === "send_message");
    assert.equal(salientes.length, 2, "respaldo + recordatorio estático");
    assert.equal(salientes[0]?.nodeId, "msg-confirmada-respaldo");
    assert.equal(salientes[1]?.nodeId, "msg-recordatorio-asistencia-respaldo");
    assert.equal(run.state.status, "completed");
    assert.equal(run.state.currentNodeId, "end-confirmado-respaldo");

    const listados = todos.filter((e) => e.type === "effect_required" && e.nodeId === "act-listar-horarios");
    assert.equal(listados.length, 1, "act-listar-horarios ocurre UNA sola vez y antes de agendar");
    const agendamientos = todos.filter((e) => e.type === "effect_required" && e.nodeId === "act-agendar");
    assert.equal(agendamientos.length, 1, "act-agendar ocurre UNA sola vez");
    const alcanzables = reachableFrom(flow, "msg-confirmada-respaldo");
    assert.equal(alcanzables.has("act-agendar"), false);
    assert.equal(alcanzables.has("act-listar-horarios"), false);
    assert.equal(todos.some((e) => e.type === "send_message" && e.nodeId === "msg-ocupado"), false, "jamás 'ocupado' tras crear la cita");
  });

  it("camino normal (ai-confirmar OK) -> UNA cita, UNA confirmación, sin consulta posterior", () => {
    const { flow, state, efectos } = conducirHastaAgendarExitoso();
    const run = resolverEfecto(flow, state, { responseText: "¡Listo Duvan! Tu cita quedó confirmada con Carla 💅" });
    const todos = [...efectos, ...(run.effects ?? [])];

    assert.equal(run.state.status, "completed");
    assert.equal(run.state.currentNodeId, "end-confirmado");
    const confirmaciones = (run.effects ?? []).filter((e) => e.type === "send_message");
    assert.equal(confirmaciones.length, 2, "confirmación AI + recordatorio estático");
    assert.equal(confirmaciones[0]?.nodeId, "ai-confirmar");
    assert.equal(confirmaciones[1]?.nodeId, "msg-recordatorio-asistencia");
    assert.equal(todos.some((e) => e.type === "send_message" && e.nodeId === "msg-confirmada-respaldo"), false);
    assert.equal(todos.filter((e) => e.type === "effect_required" && e.nodeId === "act-listar-horarios").length, 1);
    assert.equal(todos.filter((e) => e.type === "effect_required" && e.nodeId === "act-agendar").length, 1);
  });

  it("act-agendar FALLA (ocupado, choque real en el INSERT) -> NUNCA confirma, NUNCA respaldo, va a msg-ocupado; ninguna cita fantasma", () => {
    // Mismo camino que conducirHastaAgendarExitoso() hasta justo ANTES de
    // act-agendar, pero acá se hace FALLAR el INSERT real (slot tomado por
    // otra clienta entre la consulta y la confirmación).
    const flow = danielaAgendarCitaFlow();
    let state = createFlowEngineState(flow, {});
    state.variables = { ...state.variables, hoy: "2026-08-30" };
    const efectos: EngineEffect[] = [];
    const push = (r: RunResult) => {
      efectos.push(...(r.effects ?? []));
      return r.state;
    };
    state = push(runFlowEngine(flow, state, { type: "start", text: "Quiero semipermanente el 2026-09-02 a las 17:00 para Duvan" }));
    state = push(resolverEfecto(flow, state, { cantidadCitas: 0, citasActivas: [] }));
    state = push(resolverEfecto(flow, state, { servicio: "semipermanente", fecha: "2026-09-02", hora: "17:00", nombreCliente: "Duvan" }));
    state = push(resolverEfecto(flow, state, { servicioReconocido: true }));
    state = push(resolverEfecto(flow, state, { fecha: "2026-09-02", nuevaFecha: "2026-09-02" }));
    state = push(
      resolverEfecto(flow, state, {
        horariosDisponibles: HORARIOS_REALES,
        horariosDisponiblesTexto: HORARIOS_TEXTO,
        cantidadHorarios: HORARIOS_REALES.length,
        especialista: "Carla",
        duracionMin: 120,
      }),
    );
    state = push(resolverEfecto(flow, state, { hora: "17:00" }));
    state = push(runFlowEngine(flow, state, { type: "text", text: "sí" }));
    state = push(resolverEfecto(flow, state, { classification: "confirma" }));
    assert.equal(state.pendingEffect?.nodeId, "act-agendar");
    const run = resolverEfecto(flow, state, { ocupado: true }, false);
    const todos = [...efectos, ...(run.effects ?? [])];

    assert.equal(run.error, undefined);
    assert.equal(todos.some((e) => e.type === "send_message" && e.nodeId === "msg-confirmada-respaldo"), false);
    assert.equal(todos.some((e) => e.type === "send_message" && e.nodeId === "ai-confirmar"), false);
    assert.ok(run.effects?.some((e) => e.type === "send_message" && e.nodeId === "msg-ocupado"));
    // Petición explícita del rediseño: msg-ocupado YA NO es un punto muerto
    // -- re-consulta horarios reales y deja reintentar (mismo mecanismo que
    // "Otro horario"), así que ai-confirmar vuelve a ser alcanzable desde
    // acá. La garantía real que importa es otra: NUNCA se llega a
    // ai-confirmar SIN pasar de nuevo por un act-agendar real y exitoso. Se
    // prueba tratando act-agendar como un muro (avoid): si ai-confirmar
    // dejara de ser alcanzable al bloquear ese único nodo, es porque todo
    // camino real pasa por él -- nunca hay un atajo que lo evite.
    const desdeFalloSinReintentarAgendar = reachableFrom(flow, "msg-ocupado", new Set(["act-agendar"]));
    assert.equal(
      desdeFalloSinReintentarAgendar.has("ai-confirmar"),
      false,
      "ai-confirmar solo debe alcanzarse pasando por un act-agendar real, nunca evitándolo",
    );
    assert.equal(
      desdeFalloSinReintentarAgendar.has("msg-confirmada-respaldo"),
      false,
      "mismo criterio para el mensaje de respaldo de confirmación",
    );
  });
});

describe("Regresión router (dos ejecuciones) — el reconocimiento vs. nueva cita deliberada", () => {
  it("un 'gracias' tras una cita se clasifica 'otro' -> handoff (no reingresa a agendar)", () => {
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
    assert.equal(r2.state.pendingEffect?.nodeId, "act-handoff-daniela");
    assert.equal(r2.state.currentNodeId?.startsWith("agendar__"), false);
  });

  it("'quiero otra cita' se clasifica 'agendar' -> entra deliberadamente al subflow (agendar__act-consultar-citas-previas)", () => {
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
    assert.equal(r2.state.pendingEffect?.nodeId, "agendar__act-consultar-citas-previas");
  });

  it("el router entra a agendar por act-consultar-citas-previas y existe UNA sola pregunta de servicio (no hay msg-saludo)", () => {
    const flow = danielaRouterFlow();
    assert.equal(flow.nodes.some((n) => n.id.endsWith("msg-saludo")), false);
    const preguntasServicio = flow.nodes.filter((n) => n.type === "question" && n.config.variableKey === "servicio");
    assert.equal(preguntasServicio.length, 1, "una sola pregunta de servicio en todo el router");
    const eAgendar = flow.edges.find((e) => e.sourceHandle === "class:agendar" && e.source === "ai-clasificar-intencion");
    assert.equal(eAgendar?.target, "agendar__act-consultar-citas-previas");
  });
});
