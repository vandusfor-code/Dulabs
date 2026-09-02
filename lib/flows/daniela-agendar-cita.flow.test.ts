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

  // Fix real (prueba real controlada post-publicación de v9, sept. 2026) —
  // act-agendar ahora es alcanzable desde DOS caminos estructuralmente
  // gateados: la rama 'confirma' de la clasificación (texto libre) Y el tap
  // directo del botón "confirmar_cita" (atajo determinista, sin IA -- ver
  // comentario junto a e-confirmar-cita-btn más abajo en este archivo).
  // Ninguno es alcanzable desde 'no_confirma' ni desde texto sin confirmar.
  it("act-agendar SOLO es alcanzable desde la rama 'confirma' de la clasificación o el botón confirmar_cita -- nunca desde 'no_confirma' ni desde default", () => {
    const flow = danielaAgendarCitaFlow();
    const haciaAgendar = flow.edges.filter((e) => e.target === "act-agendar");
    assert.equal(haciaAgendar.length, 2);
    const desdeIA = haciaAgendar.find((e) => e.source === "ai-clasificar-confirmacion");
    const desdeBoton = haciaAgendar.find((e) => e.source === "q-confirmar-cita");
    assert.equal(desdeIA?.sourceHandle, "class:confirma");
    assert.equal(desdeBoton?.sourceHandle, "button:confirmar_cita");
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
// Cierre final Daniela (autorizado) — catálogo real de servicios, requisitos
// explícitos. Complementa la cobertura exhaustiva del parser/resolver
// puros en lib/especialistas-flow-adaptador.test.ts: acá se prueba el
// GRAFO (la lista SIEMPRE sale de una acción real -- nunca botones fijos
// ni texto hardcodeado --, "OK 👌" no avanza, continuación tras servicio
// real), no la lógica de parseo en sí.
// ============================================================================
const SERVICIOS_CATALOGO = [
  { nombre: "Press on", precio: 80000 },
  { nombre: "Dipping", precio: 70000 },
  { nombre: "Semipermanente en manos", precio: 45000 },
];
const SERVICIOS_TEXTO_CATALOGO = "1️⃣ Press on\n2️⃣ Dipping\n3️⃣ Semipermanente en manos";

function listarCatalogo(flow: AgendarFlow, state: FlowEngineState): RunResult {
  assert.equal(state.pendingEffect?.nodeId, "act-listar-servicios");
  return resolverEfecto(flow, state, {
    serviciosDisponibles: SERVICIOS_CATALOGO,
    serviciosDisponiblesTexto: SERVICIOS_TEXTO_CATALOGO,
    cantidadServicios: SERVICIOS_CATALOGO.length,
  });
}

describe("Cierre final Daniela — catálogo real de servicios (requisitos explícitos)", () => {
  it("1. act-listar-servicios es una ACCIÓN real (nunca botones fijos ni una lista hardcodeada en el nodo)", () => {
    const flow = danielaRouterFlow();
    const catNode = flow.nodes.find((n) => n.id === "agendar__act-listar-servicios");
    assert.ok(catNode && catNode.type === "action", "debe ser una acción que consulta el catálogo real, no un menú fijo");
    if (catNode.type !== "action") return;
    assert.equal(catNode.config.actionType, "listar_servicios_especialista");
  });

  it("2. sin hint de servicio, el camino rápido falla y muestra la lista real; seleccionar por NOMBRE resuelve exacto contra esa lista", () => {
    const { flow, state } = arrancarSinCitasPrevias("Quiero una cita", {});
    const listado = listarCatalogo(flow, state).state;
    assert.equal(listado.pendingEffect?.nodeId, "act-resolver-seleccion-inicial-servicio");
    const sinHint = resolverEfecto(flow, listado, {}, false).state;
    assert.equal(preguntaActual(sinHint), "q-seleccionar-servicio");

    const respuesta = runFlowEngine(flow, sinHint, { type: "text", text: "Dipping" }).state;
    assert.equal(respuesta.pendingEffect?.nodeId, "ai-interpretar-seleccion-servicio");
    const interpretado = resolverEfecto(flow, respuesta, { seleccionTipo: "nombre", seleccionNombre: "Dipping" }).state;
    assert.equal(interpretado.pendingEffect?.nodeId, "act-resolver-seleccion-servicio");
    const resuelto = resolverEfecto(flow, interpretado, { servicio: "Dipping", precio: 70000, precioTexto: "$70.000" }).state;
    assert.equal(resuelto.variables.servicio, "Dipping");
    assert.equal(resuelto.variables.precioTexto, "$70.000", "nunca el texto visible del botón/label -- el precio real del catálogo");
  });

  it("3. seleccionar por ÍNDICE (posición de la lista) resuelve al servicio real en esa posición -- cada índice es independiente", () => {
    const { flow, state } = arrancarSinCitasPrevias("Quiero una cita", {});
    const sinHint = resolverEfecto(flow, listarCatalogo(flow, state).state, {}, false).state;
    const respuesta = runFlowEngine(flow, sinHint, { type: "text", text: "la segunda" }).state;
    const interpretado = resolverEfecto(flow, respuesta, { seleccionTipo: "index", seleccionIndice: 2 }).state;
    assert.equal(interpretado.pendingEffect?.nodeId, "act-resolver-seleccion-servicio");
    const resuelto = resolverEfecto(flow, interpretado, { servicio: "Dipping", precio: 70000, precioTexto: "$70.000" }).state;
    assert.equal(preguntaActual(resuelto), "q-fecha", "tras resolver el servicio real, sigue con normalidad al siguiente paso");
  });

  it("4. una selección que NO calza con la lista real se rechaza (act-resolver-seleccion-servicio failure) -- nunca inventa un servicio", () => {
    const { flow, state } = arrancarSinCitasPrevias("Quiero una cita", {});
    const sinHint = resolverEfecto(flow, listarCatalogo(flow, state).state, {}, false).state;
    const respuesta = runFlowEngine(flow, sinHint, { type: "text", text: "un masaje" }).state;
    const interpretado = resolverEfecto(flow, respuesta, { seleccionTipo: "nombre", seleccionNombre: "un masaje" }).state;
    assert.equal(interpretado.pendingEffect?.nodeId, "act-resolver-seleccion-servicio");
    const fallo = resolverEfecto(flow, interpretado, { detalle: "fuera_de_lista" }, false);
    assert.equal(preguntaActual(fallo.state), "q-seleccionar-servicio", "rechazado, vuelve a mostrar la lista real, nunca avanza");
  });

  it("5. 'OK 👌' no avanza incorrectamente -- la IA lo clasifica ambiguo, nunca se inventa una selección", () => {
    const { flow, state } = arrancarSinCitasPrevias("Quiero una cita", {});
    const sinHint = resolverEfecto(flow, listarCatalogo(flow, state).state, {}, false).state;
    assert.equal(preguntaActual(sinHint), "q-seleccionar-servicio");

    const trasOk = runFlowEngine(flow, sinHint, { type: "text", text: "OK 👌" }).state;
    assert.equal(trasOk.pendingEffect?.nodeId, "ai-interpretar-seleccion-servicio");
    const ambiguo = resolverEfecto(flow, trasOk, { seleccionTipo: "ambiguo" }).state;
    assert.equal(ambiguo.pendingEffect?.nodeId, "act-resolver-seleccion-servicio");
    const fallo = resolverEfecto(flow, ambiguo, { detalle: "ambiguo" }, false);
    assert.equal(preguntaActual(fallo.state), "q-seleccionar-servicio", "no avanza a fecha ni a ningún otro paso");
    assert.equal(fallo.state.variables.servicio, undefined, "nunca queda 'OK 👌' guardado como servicio válido");
  });

  it("6. el flujo continúa correctamente después de seleccionar un servicio real (llega a pedir fecha)", () => {
    const { flow, state } = arrancarSinCitasPrevias("Quiero una cita", {});
    const sinHint = resolverEfecto(flow, listarCatalogo(flow, state).state, {}, false).state;
    const respuesta = runFlowEngine(flow, sinHint, { type: "text", text: "semipermanente en manos" }).state;
    const interpretado = resolverEfecto(flow, respuesta, { seleccionTipo: "nombre", seleccionNombre: "Semipermanente en manos" }).state;
    assert.equal(interpretado.pendingEffect?.nodeId, "act-resolver-seleccion-servicio");
    const validado = resolverEfecto(flow, interpretado, { servicio: "Semipermanente en manos", precio: 45000, precioTexto: "$45.000" });
    assert.equal(validado.error, undefined);
    assert.equal(validado.state.variables.servicio, "Semipermanente en manos", "act-resolver-seleccion-servicio SÍ escribe servicio de vuelta");
    assert.equal(preguntaActual(validado.state), "q-fecha", "sigue con normalidad al siguiente paso real del flow");
  });

  it("7. hint de servicio del primer mensaje SÍ calza con la lista real -> camino rápido, sin preguntar de nuevo", () => {
    const { flow, state } = arrancarSinCitasPrevias("Quiero Dipping", { servicio: "Dipping" });
    const listado = listarCatalogo(flow, state).state;
    assert.equal(listado.pendingEffect?.nodeId, "act-resolver-seleccion-inicial-servicio");
    const resuelto = resolverEfecto(flow, listado, { servicio: "Dipping", precio: 70000, precioTexto: "$70.000" });
    assert.equal(preguntaActual(resuelto.state), "q-fecha", "va directo a fecha, nunca pregunta el servicio de nuevo");
    assert.equal(resuelto.state.variables.servicio, "Dipping");
  });
});

describe("Motor — slot-filling determinista vía runFlowEngine", () => {
  it("A. mensaje sin ningún dato ('quiero una cita') -> consulta el catálogo real, luego pregunta el servicio, UNA sola vez", () => {
    const { flow, state } = arrancarSinCitasPrevias("Quiero una cita", {});
    assert.equal(state.pendingEffect?.nodeId, "act-listar-servicios", "Cierre final Daniela: catálogo real antes de preguntar el servicio");
    const listado = listarCatalogo(flow, state).state;
    assert.equal(listado.pendingEffect?.nodeId, "act-resolver-seleccion-inicial-servicio");
    const sinHint = resolverEfecto(flow, listado, {}, false);
    const preguntas = sinHint.effects?.filter((e) => e.type === "send_message" && e.nodeId === "q-seleccionar-servicio") ?? [];
    assert.equal(preguntas.length, 1);
    assert.equal(preguntaActual(sinHint.state), "q-seleccionar-servicio");
  });

  it("B. servicio inválido en q-seleccionar-servicio falla en act-resolver-seleccion-servicio y vuelve a preguntar (misma lista real)", () => {
    const { flow, state: s0 } = arrancarSinCitasPrevias("Quiero una cita", {});
    const sinHint = resolverEfecto(flow, listarCatalogo(flow, s0).state, {}, false).state;
    assert.equal(preguntaActual(sinHint), "q-seleccionar-servicio");
    const respuesta = runFlowEngine(flow, sinHint, { type: "text", text: "un masaje" }).state;
    assert.equal(respuesta.pendingEffect?.nodeId, "ai-interpretar-seleccion-servicio");
    const interpretado = resolverEfecto(flow, respuesta, { seleccionTipo: "nombre", seleccionNombre: "un masaje" }).state;
    assert.equal(interpretado.pendingEffect?.nodeId, "act-resolver-seleccion-servicio");
    const run = resolverEfecto(flow, interpretado, {}, false);
    assert.equal(preguntaActual(run.state), "q-seleccionar-servicio", "vuelve a preguntar servicio tras resolución fallida");
    assert.equal(run.state.variables.servicio, undefined, "nunca queda un servicio inválido guardado");
  });

  it("C. fecha en texto natural ('el sábado') -> act-validar-fecha la normaliza -> act-listar-horarios recibe la fecha YA real", () => {
    const { flow, state: s0 } = arrancarSinCitasPrevias("Quiero Dipping para Ana", {
      servicio: "Dipping",
      nombreCliente: "Ana",
    });
    assert.equal(s0.pendingEffect?.nodeId, "act-listar-servicios");
    let state = resolverEfecto(flow, listarCatalogo(flow, s0).state, { servicio: "Dipping", precio: 70000, precioTexto: "$70.000" }).state;
    assert.equal(preguntaActual(state), "q-fecha");
    state = runFlowEngine(flow, state, { type: "text", text: "el sábado" }).state;
    assert.equal(state.pendingEffect?.nodeId, "act-validar-fecha");
    // Simula EXACTAMENTE lo que devolvería el executor real (parseFechaColombia
    // normalizando "el sábado" con hoy=2026-08-30, un domingo -> sábado 2026-09-05).
    const run = resolverEfecto(flow, state, { fecha: "2026-09-05", nuevaFecha: "2026-09-05" });
    assert.equal(run.state.pendingEffect?.nodeId, "act-listar-horarios");
  });

  it("D. fecha inválida ('mmm no sé') -> act-validar-fecha falla -> vuelve a preguntar, NUNCA llega a listar horarios", () => {
    const { flow, state: s0 } = arrancarSinCitasPrevias("Quiero Dipping para Ana", {
      servicio: "Dipping",
      nombreCliente: "Ana",
    });
    let state = resolverEfecto(flow, listarCatalogo(flow, s0).state, { servicio: "Dipping", precio: 70000, precioTexto: "$70.000" }).state;
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
    const { flow, state: s0 } = arrancarSinCitasPrevias("Quiero Dipping el 2026-09-02 para Ana", {
      servicio: "Dipping",
      fecha: "2026-09-02",
      nombreCliente: "Ana",
    });
    let state = resolverEfecto(flow, listarCatalogo(flow, s0).state, { servicio: "Dipping", precio: 70000, precioTexto: "$70.000" }).state;
    assert.equal(state.pendingEffect?.nodeId, "act-validar-fecha");
    state = resolverEfecto(flow, state, { fecha: "2026-09-02", nuevaFecha: "2026-09-02" }).state;
    assert.equal(state.pendingEffect?.nodeId, "act-listar-horarios");
    const run = resolverEfecto(flow, state, { horariosDisponibles: [], horariosDisponiblesTexto: "", cantidadHorarios: 0, especialista: "Carla", duracionMin: 60 });
    assert.equal(preguntaActual(run.state), "q-fecha");
  });

  it("F. hay horarios reales, la clienta escribe 'la segunda' -> ai-interpretar-seleccion + act-resolver-seleccion-horario resuelven 16:00→17:00 (índice 2)", () => {
    const { flow, state: s0 } = arrancarSinCitasPrevias("Quiero Dipping el 2026-09-02 para Ana", {
      servicio: "Dipping",
      fecha: "2026-09-02",
      nombreCliente: "Ana",
    });
    let state = resolverEfecto(flow, listarCatalogo(flow, s0).state, { servicio: "Dipping", precio: 70000, precioTexto: "$70.000" }).state;
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
    const { flow, state: s0 } = arrancarSinCitasPrevias("Quiero Dipping el 2026-09-02 para Ana", {
      servicio: "Dipping",
      fecha: "2026-09-02",
      nombreCliente: "Ana",
    });
    let state = resolverEfecto(flow, listarCatalogo(flow, s0).state, { servicio: "Dipping", precio: 70000, precioTexto: "$70.000" }).state;
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
    const { flow, state: s0 } = arrancarSinCitasPrevias("Quiero Dipping el 2026-09-02 a las 17:00 para Ana", {
      servicio: "Dipping",
      fecha: "2026-09-02",
      hora: "17:00",
      nombreCliente: "Ana",
    });
    let state = resolverEfecto(flow, listarCatalogo(flow, s0).state, { servicio: "Dipping", precio: 70000, precioTexto: "$70.000" }).state;
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
  const { flow, state: s0, efectos } = arrancarSinCitasPrevias("Quiero Dipping el 2026-09-02 a las 17:00 para Duvan", {
    servicio: "Dipping",
    fecha: "2026-09-02",
    hora: "17:00",
    nombreCliente: "Duvan",
  });
  const push = (r: RunResult) => {
    efectos.push(...(r.effects ?? []));
    return r.state;
  };
  let state = s0;
  assert.equal(state.pendingEffect?.nodeId, "act-listar-servicios");
  state = push(listarCatalogo(flow, state));
  assert.equal(state.pendingEffect?.nodeId, "act-resolver-seleccion-inicial-servicio");
  state = push(resolverEfecto(flow, state, { servicio: "Dipping", precio: 70000, precioTexto: "$70.000" }));
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
    state = push(runFlowEngine(flow, state, { type: "start", text: "Quiero Dipping el 2026-09-02 a las 17:00 para Duvan" }));
    state = push(resolverEfecto(flow, state, { cantidadCitas: 0, citasActivas: [] }));
    state = push(resolverEfecto(flow, state, { servicio: "Dipping", fecha: "2026-09-02", hora: "17:00", nombreCliente: "Duvan" }));
    state = push(listarCatalogo(flow, state));
    state = push(resolverEfecto(flow, state, { servicio: "Dipping", precio: 70000, precioTexto: "$70.000" }));
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
    const preguntasServicio = flow.nodes.filter((n) => n.type === "question" && n.config.variableKey === "seleccionServicioTexto");
    assert.equal(preguntasServicio.length, 1, "una sola pregunta de servicio (catálogo real) en todo el router");
    const eAgendar = flow.edges.find((e) => e.sourceHandle === "class:agendar" && e.source === "ai-clasificar-intencion");
    assert.equal(eAgendar?.target, "agendar__act-consultar-citas-previas");
  });
});
