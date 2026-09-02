/**
 * UX botones Daniela — motor puro, sin Claude real ni WhatsApp real.
 * Cubre A–P del pedido: menú, producto, servicios, NLU, confirmación,
 * cancelación, reagendamiento y no-duplicación de mensajes.
 *
 * Rediseño de agendamiento (autorizado) — adaptado al nuevo camino
 * (cita(s) previa(s) → servicio → fecha real → horarios reales →
 * selección → confirmación). Ver daniela-agendar-cita.flow.test.ts para la
 * cobertura estructural completa del nuevo modelo; este archivo se enfoca
 * en la experiencia de botones/lenguaje natural end-to-end vía el router.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { decidirFallbackDesdeResultado } from "@/lib/flow-runtime-bridge";
import { danielaRouterFlow } from "@/lib/flows/daniela-router.flow";
import { danielaAgendarCitaFlow } from "@/lib/flows/daniela-agendar-cita.flow";
import { danielaCancelarCitaFlow } from "@/lib/flows/daniela-cancelar-cita.flow";
import { danielaReagendarCitaFlow } from "@/lib/flows/daniela-reagendar-cita.flow";
import { DANIELA_BUTTON_IDS } from "@/lib/flows/daniela-button-ids";
import { filterClaimSecuredEffects } from "@/lib/flow/ai-runtime/ai-response-security";
import { VERIFIED_RESULTS_VARIABLE_KEY } from "@/lib/flow/ai-runtime/verified-results";
import { interpolateTemplate } from "@/lib/flow/message-interpolation";
import type { EngineEffect, FlowEngineState } from "@/lib/flow/engine-types";
import type { FlowDefinition, FlowNode } from "@/lib/flow/types";

type Run = ReturnType<typeof runFlowEngine>;

function sendMessages(effects: EngineEffect[]): EngineEffect[] {
  return effects.filter((e) => e.type === "send_message");
}

function messageText(effect: EngineEffect): string {
  if (effect.type !== "send_message") return "";
  return typeof effect.content.text === "string" ? effect.content.text : "";
}

/** Preguntas equivalentes de servicio (catálogo real): deben existir como UNA sola. */
const PREGUNTA_SERVICIO_EQ = /cat[aá]logo de servicios/i;

function textosVisiblesDelNodo(node: FlowNode): string[] {
  if (node.type === "question" || node.type === "buttons") return [node.config.text];
  if (node.type === "message" && node.config.text) return [node.config.text];
  return [];
}

function clasificar(flow: FlowDefinition, texto: string, classification: string): { state: FlowEngineState; effects: EngineEffect[] } {
  let state = createFlowEngineState(flow, { executionId: randomUUID() });
  const start = runFlowEngine(flow, state, { type: "start", text: texto });
  assert.equal(start.error, undefined, start.error?.message);
  state = start.state;
  const r = runFlowEngine(flow, state, {
    type: "effect_result",
    success: true,
    effectId: state.pendingEffect!.effectId,
    data: { classification },
  });
  assert.equal(r.error, undefined, r.error?.message);
  return { state: r.state, effects: [...start.effects, ...r.effects] };
}

/** Rediseño (autorizado) — resuelve act-consultar-citas-previas (Parte 13),
 * primer paso REAL del subflow de agendar, antes de llegar a ai-extraer. */
function resolverCitasPrevias(flow: FlowDefinition, state: FlowEngineState, cantidadCitas = 0): Run {
  assert.equal(state.pendingEffect?.nodeId, "agendar__act-consultar-citas-previas");
  const r = runFlowEngine(flow, state, {
    type: "effect_result",
    success: true,
    effectId: state.pendingEffect!.effectId,
    data: { cantidadCitas, citasActivas: [] },
  });
  assert.equal(r.error, undefined, r.error?.message);
  return r;
}

function extraerVacio(flow: FlowDefinition, state: FlowEngineState): Run {
  assert.equal(state.pendingEffect?.nodeId, "agendar__ai-extraer");
  const r = runFlowEngine(flow, state, {
    type: "effect_result",
    success: true,
    effectId: state.pendingEffect!.effectId,
    data: {},
  });
  assert.equal(r.error, undefined, r.error?.message);
  return r;
}

/** Entra al subflow de agendar (router, clasificación 'agendar') y resuelve
 * SIN citas previas -- deja el estado en ai-extraer, listo para simular la
 * extracción del primer mensaje. */
function entrarAAgendarSinCitasPrevias(texto: string): { flow: FlowDefinition; state: FlowEngineState; effects: EngineEffect[] } {
  const flow = danielaRouterFlow();
  const clasificado = clasificar(flow, texto, "agendar");
  const previas = resolverCitasPrevias(flow, clasificado.state);
  assert.equal(previas.state.pendingEffect?.nodeId, "agendar__ai-extraer");
  return { flow, state: previas.state, effects: [...clasificado.effects, ...previas.effects] };
}

describe("UX botones — validador y candados de citas intactos", () => {
  it("el router combinado sigue pasando validateFlowForPublish", () => {
    const result = validateFlowForPublish(danielaRouterFlow());
    if (!result.valid) console.error(JSON.stringify(result.errors, null, 2));
    assert.equal(result.valid, true);
  });

  // Fix real (prueba real controlada post-publicación de v9, sept. 2026) —
  // act-agendar ahora es alcanzable desde DOS caminos, ambos estructuralmente
  // gateados (nunca desde texto libre sin pasar por alguno de estos): (1) el
  // tap real del botón "✅ Confirmar cita" (valor estructurado y controlado
  // por nosotros, DIRECTO, sin IA de por medio -- ver el comentario en
  // daniela-agendar-cita.flow.ts) y (2) class:confirma de
  // ai-clasificar-confirmacion (para cuando la clienta responde con texto
  // libre en vez de tocar el botón). La barrera de confirmación explícita
  // se mantiene intacta: NINGÚN camino a act-agendar es alcanzable sin que
  // la clienta haya confirmado explícitamente, por botón o por texto claro.
  it("act-agendar del router SOLO es alcanzable desde el botón confirmar_cita o class:confirma", () => {
    const flow = danielaRouterFlow();
    const hacia = flow.edges.filter((e) => e.target === "agendar__act-agendar");
    assert.equal(hacia.length, 2);
    const desdeBoton = hacia.find((e) => e.source === "agendar__q-confirmar-cita");
    const desdeIA = hacia.find((e) => e.source === "agendar__ai-clasificar-confirmacion");
    assert.equal(desdeBoton?.sourceHandle, FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.CONFIRMAR_CITA));
    assert.equal(desdeIA?.sourceHandle, FLOW_EDGE_HANDLE.aiClass("confirma"));
  });

  it("confirmar_cita SÍ apunta directo a act-agendar (atajo determinista, valor estructurado del botón); el texto libre sigue pasando por ai-clasificar-confirmacion", () => {
    const flow = danielaAgendarCitaFlow();
    const btn = flow.edges.find(
      (e) => e.source === "q-confirmar-cita" && e.sourceHandle === FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.CONFIRMAR_CITA),
    );
    assert.equal(btn?.target, "act-agendar");
    const texto = flow.edges.find((e) => e.source === "q-confirmar-cita" && e.sourceHandle === FLOW_EDGE_HANDLE.text);
    assert.equal(texto?.target, "ai-clasificar-confirmacion");
  });

  it("cancelar: act-cancelar sigue DIRECTO desde class:confirma (rediseño: sin ai-proponer-cancelar); mantener_cita no cancela", () => {
    const flow = danielaCancelarCitaFlow();
    const haciaCancelar = flow.edges.filter((e) => e.target === "act-cancelar");
    assert.equal(haciaCancelar.length, 1);
    assert.equal(haciaCancelar[0]?.source, "ai-clasificar-confirmacion");
    assert.equal(haciaCancelar[0]?.sourceHandle, FLOW_EDGE_HANDLE.aiClass("confirma"));
    const mantener = flow.edges.find(
      (e) => e.source === "q-confirmar-cancelacion" && e.sourceHandle === FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.MANTENER_CITA),
    );
    assert.equal(mantener?.target, "msg-cancelacion-abandonada");
  });

  it("reagendar: act-mover-cita solo alcanzable desde class:confirma (rediseño: sin ai-proponer-mover); no desde el menú ni mantener_cita", () => {
    const flow = danielaReagendarCitaFlow();
    const haciaMover = flow.edges.filter((e) => e.target === "act-mover-cita");
    assert.equal(haciaMover.length, 1);
    assert.equal(haciaMover[0]?.source, "ai-clasificar-confirmacion");
    assert.equal(haciaMover[0]?.sourceHandle, FLOW_EDGE_HANDLE.aiClass("confirma"));
    const mantener = flow.edges.find(
      (e) => e.source === "q-confirmar-reagendar" && e.sourceHandle === FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.MANTENER_CITA),
    );
    assert.equal(mantener?.target, "msg-reagendamiento-abandonado");
  });
});

describe("A. saludo → botones Servicios/Productos (sin 'Hablar con Dani')", () => {
  it("clasificación menu envía UN mensaje interactivo con 2 IDs estables", () => {
    const flow = danielaRouterFlow();
    const r = clasificar(flow, "Hola", "menu");
    const envios = sendMessages(r.effects);
    assert.equal(envios.length, 1, "un solo mensaje de menú");
    const msg = envios[0];
    assert.ok(msg && msg.type === "send_message");
    assert.equal(msg.nodeId, "bt-menu-inicial");
    assert.equal(msg.buttons?.length, 2);
    assert.deepEqual(
      msg.buttons?.map((b) => b.id),
      [DANIELA_BUTTON_IDS.SERVICIOS_SPA, DANIELA_BUTTON_IDS.PRODUCTOS],
    );
    assert.match(messageText(msg), /¡Hola!/);
    assert.equal(r.state.status, "waiting_input");
    assert.equal(r.state.expectedInput, "button");
    const decision = decidirFallbackDesdeResultado({
      outcome: "processed",
      executionRowId: "ux-menu",
      effects: r.effects,
      dispatchedEffectIds: [],
    });
    assert.equal(decision.handled, true);
  });

  // Cierre — "Hablar con Dani" (autorizado): el botón se quitó del menú
  // inicial. Un tap con ese ID de botón antiguo (ej. cliente con la
  // plantilla vieja todavía cacheada en WhatsApp) ya no calza contra
  // bt-menu-inicial.config.buttons -- el motor lo rechaza como opción no
  // válida, nunca transfiere. La transferencia a Dani por texto libre
  // ("hablar con Dani") sigue intacta vía el escape hatch determinista
  // (lib/flow-escape-hatch.ts), sin cambios.
  it("tap con el ID antiguo de 'Hablar con Dani' ya no calza -- opción no válida, nunca transfiere", () => {
    const flow = danielaRouterFlow();
    const menu = clasificar(flow, "Hola", "menu");
    const tap = runFlowEngine(flow, menu.state, { type: "button", id: DANIELA_BUTTON_IDS.HABLAR_CON_DANI });
    assert.equal(tap.error, undefined);
    assert.equal(sendMessages(tap.effects).length, 0, "ningún mensaje de transferencia -- el botón ya no existe en el menú");
    assert.equal(
      tap.effects.some((e) => e.type === "invalid_input"),
      true,
      "se rechaza como opción no válida",
    );
    assert.notEqual(tap.state.pendingEffect?.nodeId, "act-handoff-daniela", "nunca transfiere por este botón antiguo");
  });
});

describe("B. botón Productos → derivación humana, NO agendar", () => {
  it("tap productos envía el mensaje de derivación UNA vez y no toca act-agendar", () => {
    const flow = danielaRouterFlow();
    const menu = clasificar(flow, "Hola", "menu");
    const tap = runFlowEngine(flow, menu.state, { type: "button", id: DANIELA_BUTTON_IDS.PRODUCTOS });
    assert.equal(tap.error, undefined);
    const envios = sendMessages(tap.effects);
    assert.equal(envios.length, 1);
    assert.equal(envios[0] && "nodeId" in envios[0] ? envios[0].nodeId : "", "msg-producto");
    assert.equal(tap.state.pendingEffect?.nodeId, "act-handoff-daniela");
    assert.equal(tap.state.status, "waiting_effect");
    assert.equal(tap.effects.some((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar"), false);
  });
});

describe("C. botón Servicios → flujo normal, no crea cita", () => {
  it("tap servicios_spa va directo a act-listar-servicios sin contaminar variables.servicio (bypassa incluso el chequeo de citas previas)", () => {
    const flow = danielaRouterFlow();
    const menu = clasificar(flow, "Hola", "menu");
    const tap = runFlowEngine(flow, menu.state, { type: "button", id: DANIELA_BUTTON_IDS.SERVICIOS_SPA });
    assert.equal(tap.error, undefined);
    assert.equal(tap.state.pendingEffect?.nodeId, "agendar__act-listar-servicios", "Cierre final Daniela: catálogo real antes de pedir el servicio");
    assert.equal(tap.state.variables.servicio, undefined);
    assert.notEqual(tap.state.variables.servicio, "servicios_spa");
    assert.equal(tap.effects.some((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar"), false);

    // Catálogo real (mock del resultado de listar_servicios_especialista).
    const servicios = [
      { nombre: "Press on", precio: 80000 },
      { nombre: "Dipping", precio: 70000 },
      { nombre: "Semipermanente en manos", precio: 45000 },
    ];
    const r1 = runFlowEngine(flow, tap.state, {
      type: "effect_result",
      success: true,
      effectId: tap.state.pendingEffect!.effectId,
      data: { serviciosDisponibles: servicios, serviciosDisponiblesTexto: "1️⃣ Press on\n2️⃣ Dipping\n3️⃣ Semipermanente en manos", cantidadServicios: servicios.length },
    });
    assert.equal(r1.error, undefined);
    // Sin hint de servicio del primer mensaje (tap de botón) -> el camino
    // rápido falla y muestra el catálogo real.
    assert.equal(r1.state.pendingEffect?.nodeId, "agendar__act-resolver-seleccion-inicial-servicio");
    const r2 = runFlowEngine(flow, r1.state, {
      type: "effect_result",
      success: false,
      effectId: r1.state.pendingEffect!.effectId,
      data: { detalle: "ambiguo" },
    });
    assert.equal(r2.error, undefined);
    assert.equal(r2.state.currentNodeId, "agendar__q-seleccionar-servicio");
    const envios = sendMessages(r2.effects);
    assert.equal(envios.length, 1);
    assert.equal(envios[0] && "nodeId" in envios[0] ? envios[0].nodeId : "", "agendar__q-seleccionar-servicio");
    assert.equal(
      tap.effects.some((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar"),
      false,
      "seguir sin crear ninguna cita solo por escribir el servicio",
    );

    const r3 = runFlowEngine(flow, r2.state, { type: "text", text: "Dipping" });
    assert.equal(r3.error, undefined);
    assert.equal(r3.state.pendingEffect?.nodeId, "agendar__ai-interpretar-seleccion-servicio");
    const r4 = runFlowEngine(flow, r3.state, {
      type: "effect_result",
      success: true,
      effectId: r3.state.pendingEffect!.effectId,
      data: { seleccionTipo: "nombre", seleccionNombre: "Dipping" },
    });
    assert.equal(r4.error, undefined);
    assert.equal(r4.state.pendingEffect?.nodeId, "agendar__act-resolver-seleccion-servicio");
    const r5 = runFlowEngine(flow, r4.state, {
      type: "effect_result",
      success: true,
      effectId: r4.state.pendingEffect!.effectId,
      data: { servicio: "Dipping", precio: 70000, precioTexto: "$70.000" },
    });
    assert.equal(r5.error, undefined);
    assert.equal(r5.state.variables.servicio, "Dipping");
    assert.equal(r5.state.variables.precioTexto, "$70.000");
  });
});

describe("D/E. texto PRODUCTO → derivación", () => {
  it("D. 'cuánto cuesta el shampoo' (producto) deriva y no agenda", () => {
    const flow = danielaRouterFlow();
    const r = clasificar(flow, "¿Cuánto cuesta el shampoo?", "producto");
    const envios = sendMessages(r.effects);
    assert.equal(envios.length, 1);
    assert.equal(envios[0] && "nodeId" in envios[0] ? envios[0].nodeId : "", "msg-producto");
    assert.equal(r.state.pendingEffect?.nodeId, "act-handoff-daniela");
    assert.equal(r.effects.some((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar"), false);
  });

  it("E. 'quiero comprar una crema' (producto) deriva", () => {
    const flow = danielaRouterFlow();
    const r = clasificar(flow, "Quiero comprar una crema", "producto");
    assert.equal(r.state.pendingEffect?.nodeId, "act-handoff-daniela");
    assert.equal(sendMessages(r.effects).length, 1);
  });
});

describe("F/G. SERVICIO-INFO vs AGENDAR", () => {
  it("F. 'cuánto cuesta el semipermanente' (info_servicio) responde con baseConocimiento, NO pasa a un humano, NO crea cita", () => {
    const flow = danielaRouterFlow();
    const r = clasificar(flow, "Quiero saber cuánto cuesta el semipermanente", "info_servicio");
    assert.equal(r.state.pendingEffect?.nodeId, "ai-responder-info-servicio");
    assert.notEqual(r.state.pendingEffect?.nodeId, "act-handoff-daniela");
    assert.equal(r.effects.some((e) => e.type === "effect_required" && e.nodeId === "ai-responder-info-servicio"), true);
    assert.equal(sendMessages(r.effects).length, 0, "todavía no hay respuesta -- el nodo IA no se ha resuelto");

    const respondido = runFlowEngine(flow, r.state, {
      type: "effect_result",
      success: true,
      effectId: r.state.pendingEffect!.effectId,
      data: { responseText: "El semipermanente en manos está en $45.000 💅" },
    });
    assert.equal(respondido.error, undefined);
    const efectosCompletos = [...r.effects, ...respondido.effects];
    assert.equal(sendMessages(efectosCompletos).length, 1);

    const decision = decidirFallbackDesdeResultado({
      outcome: "processed",
      executionRowId: "ux-info",
      effects: efectosCompletos,
      dispatchedEffectIds: [],
    });
    assert.equal(decision.handled, true);
    assert.equal(decision.motivo, "processed_ok");
  });

  it("G. 'quiero una cita para semipermanente' (agendar) entra a consultar citas previas, no agenda solo", () => {
    const flow = danielaRouterFlow();
    const r = clasificar(flow, "Hola, quiero una cita para semipermanente", "agendar");
    assert.equal(r.state.pendingEffect?.nodeId, "agendar__act-consultar-citas-previas");
    assert.equal(r.effects.some((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar"), false);
  });
});

const HORARIOS_REALES = ["15:00", "16:00", "17:00"];
const HORARIOS_TEXTO = "1️⃣ 3:00 p. m.\n2️⃣ 4:00 p. m.\n3️⃣ 5:00 p. m.";
const SERVICIOS_REALES = [
  { nombre: "Press on", precio: 80000 },
  { nombre: "Dipping", precio: 70000 },
  { nombre: "Semipermanente en manos", precio: 45000 },
];
const SERVICIOS_TEXTO = "1️⃣ Press on\n2️⃣ Dipping\n3️⃣ Semipermanente en manos";

/** Conduce el router (clasificación 'agendar', sin citas previas) hasta la
 * propuesta final (q-confirmar-cita), con el servicio ("Dipping", nombre
 * real exacto del catálogo) y la hora ya extraídos del primer mensaje,
 * ambos calzando exacto con las listas reales (camino rápido). */
function conducirHastaPropuestaRouter(): { flow: FlowDefinition; state: FlowEngineState; effects: EngineEffect[] } {
  const { flow, state: s0, effects } = entrarAAgendarSinCitasPrevias("Quiero Dipping el 2026-09-18 a las 15:00 para Ana");
  let state = s0;
  const push = (r: Run) => {
    effects.push(...r.effects);
    state = r.state;
    return r;
  };
  push(
    runFlowEngine(flow, state, {
      type: "effect_result",
      success: true,
      effectId: state.pendingEffect!.effectId,
      data: { servicio: "Dipping", fecha: "2026-09-18", hora: "15:00", nombreCliente: "Ana" },
    }),
  );
  assert.equal(state.pendingEffect?.nodeId, "agendar__act-listar-servicios");
  push(
    runFlowEngine(flow, state, {
      type: "effect_result",
      success: true,
      effectId: state.pendingEffect!.effectId,
      data: { serviciosDisponibles: SERVICIOS_REALES, serviciosDisponiblesTexto: SERVICIOS_TEXTO, cantidadServicios: SERVICIOS_REALES.length },
    }),
  );
  assert.equal(state.pendingEffect?.nodeId, "agendar__act-resolver-seleccion-inicial-servicio");
  push(
    runFlowEngine(flow, state, {
      type: "effect_result",
      success: true,
      effectId: state.pendingEffect!.effectId,
      data: { servicio: "Dipping", precio: 70000, precioTexto: "$70.000" },
    }),
  );
  assert.equal(state.pendingEffect?.nodeId, "agendar__act-validar-fecha");
  push(runFlowEngine(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { fecha: "2026-09-18", nuevaFecha: "2026-09-18" } }));
  assert.equal(state.pendingEffect?.nodeId, "agendar__act-listar-horarios");
  push(
    runFlowEngine(flow, state, {
      type: "effect_result",
      success: true,
      effectId: state.pendingEffect!.effectId,
      data: { horariosDisponibles: HORARIOS_REALES, horariosDisponiblesTexto: HORARIOS_TEXTO, cantidadHorarios: HORARIOS_REALES.length, especialista: "Carla", duracionMin: 120 },
    }),
  );
  assert.equal(state.pendingEffect?.nodeId, "agendar__act-resolver-seleccion-inicial");
  push(runFlowEngine(flow, state, { type: "effect_result", success: true, effectId: state.pendingEffect!.effectId, data: { hora: "15:00" } }));
  assert.equal(state.currentNodeId, "agendar__q-confirmar-cita");
  assert.equal(state.expectedInput, "button");
  return { flow, state, effects };
}

describe("H/I/J. propuesta → Confirmar / Otro horario", () => {
  it("H. la propuesta termina en botones confirmar_cita / otro_horario (un prompt de confirmación), con la hora YA resuelta contra la lista real", () => {
    const { effects, state } = conducirHastaPropuestaRouter();
    const confirmaciones = sendMessages(effects).filter((e) => e.type === "send_message" && e.nodeId === "agendar__q-confirmar-cita");
    assert.equal(confirmaciones.length, 1);
    const msg = confirmaciones[0];
    assert.ok(msg && msg.type === "send_message");
    assert.deepEqual(
      msg.buttons?.map((b) => b.id),
      [DANIELA_BUTTON_IDS.CONFIRMAR_CITA, DANIELA_BUTTON_IDS.OTRO_HORARIO],
    );
    assert.equal(state.expectedInput, "button");
    assert.match(messageText(msg), /Dipping/);
    assert.match(messageText(msg), /2026-09-18/);
    assert.match(messageText(msg), /15:00/);
    assert.match(messageText(msg), /Carla/);
    assert.equal(messageText(msg).includes("{{"), false, "los placeholders deben interpolarse");
    assert.equal(/hola\s+\w+/i.test(messageText(msg)), false, "la propuesta no saluda por nombre");
  });

  // Fix real (prueba real controlada post-publicación de v9, sept. 2026) —
  // el tap del botón entra DIRECTO a act-agendar, sin pasar por el
  // clasificador de IA: reproducido dos veces contra el tenant real que
  // Claude clasificaba 'no_confirma' aun con el valor exacto que su propia
  // instrucción dice que debe ser 'confirma' sin duda -- ver el comentario
  // en daniela-agendar-cita.flow.ts. El texto libre SIGUE pasando por
  // ai-clasificar-confirmacion (ver test siguiente).
  it("I. botón Confirmar entra DIRECTO a act-agendar (atajo determinista, sin IA de por medio)", () => {
    const { flow, state } = conducirHastaPropuestaRouter();
    const tap = runFlowEngine(flow, state, { type: "button", id: DANIELA_BUTTON_IDS.CONFIRMAR_CITA });
    assert.equal(tap.error, undefined);
    assert.equal(tap.state.pendingEffect?.nodeId, "agendar__act-agendar");
    assert.equal(tap.state.variables.respuestaConfirmacionAgendarTexto, DANIELA_BUTTON_IDS.CONFIRMAR_CITA);
  });

  it("I2. texto libre confirmando SIGUE pasando por ai-clasificar-confirmacion (la barrera de confirmación no se saltó para texto libre)", () => {
    const { flow, state } = conducirHastaPropuestaRouter();
    const respuesta = runFlowEngine(flow, state, { type: "text", text: "sí, confirmo" });
    assert.equal(respuesta.error, undefined);
    assert.equal(respuesta.state.pendingEffect?.nodeId, "agendar__ai-clasificar-confirmacion");
    const confirma = runFlowEngine(flow, respuesta.state, {
      type: "effect_result",
      success: true,
      effectId: respuesta.state.pendingEffect!.effectId,
      data: { classification: "confirma" },
    });
    assert.equal(confirma.state.pendingEffect?.nodeId, "agendar__act-agendar");
  });

  it("J. botón Otro horario re-consulta y vuelve a preguntar el horario (pregunta abierta), NO crea cita", () => {
    const { flow, state } = conducirHastaPropuestaRouter();
    const tap = runFlowEngine(flow, state, { type: "button", id: DANIELA_BUTTON_IDS.OTRO_HORARIO });
    assert.equal(tap.error, undefined);
    assert.equal(tap.state.pendingEffect?.nodeId, "agendar__act-relistar-horarios");
    assert.equal(tap.effects.some((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar"), false);
    const relistado = runFlowEngine(flow, tap.state, {
      type: "effect_result",
      success: true,
      effectId: tap.state.pendingEffect!.effectId,
      data: { horariosDisponibles: HORARIOS_REALES, horariosDisponiblesTexto: HORARIOS_TEXTO, cantidadHorarios: HORARIOS_REALES.length, especialista: "Carla", duracionMin: 120 },
    });
    assert.equal(relistado.state.currentNodeId, "agendar__q-seleccionar-horario", "va directo a la pregunta abierta, nunca reintenta el hint viejo");
  });
});

describe("K. cancelación con botones y candado existente", () => {
  it("botón cancelar_cita va al clasificador; act-cancelar solo tras confirma (rediseño: directo, sin nodo AI intermedio)", () => {
    const flow = danielaCancelarCitaFlow();
    let state = createFlowEngineState(flow, { executionId: randomUUID() });
    state = runFlowEngine(flow, state, { type: "start", text: "quiero cancelar" }).state;
    state = runFlowEngine(flow, state, {
      type: "effect_result",
      success: true,
      effectId: state.pendingEffect!.effectId,
      data: { cantidadCitas: 1, citasActivas: [{ id: 1, servicio: "manos" }], citaObjetivoId: "1" },
    }).state;
    if (state.pendingEffect?.nodeId === "ai-identificar-unica") {
      state = runFlowEngine(flow, state, {
        type: "effect_result",
        success: true,
        effectId: state.pendingEffect.effectId,
        data: { responseText: "Tienes una cita de manos." },
      }).state;
    }
    assert.equal(state.currentNodeId, "q-confirmar-cancelacion");
    const tap = runFlowEngine(flow, state, { type: "button", id: DANIELA_BUTTON_IDS.CANCELAR_CITA });
    assert.equal(tap.state.pendingEffect?.nodeId, "ai-clasificar-confirmacion");
    const confirma = runFlowEngine(flow, tap.state, {
      type: "effect_result",
      success: true,
      effectId: tap.state.pendingEffect!.effectId,
      data: { classification: "confirma" },
    });
    assert.equal(confirma.state.pendingEffect?.nodeId, "act-cancelar");
  });

  it("botón mantener_cita abandona y no llega a act-cancelar", () => {
    const flow = danielaCancelarCitaFlow();
    let state = createFlowEngineState(flow, { executionId: randomUUID() });
    state = runFlowEngine(flow, state, { type: "start", text: "quiero cancelar" }).state;
    state = runFlowEngine(flow, state, {
      type: "effect_result",
      success: true,
      effectId: state.pendingEffect!.effectId,
      data: { cantidadCitas: 1, citasActivas: [{ id: 1 }], citaObjetivoId: "1" },
    }).state;
    if (state.pendingEffect?.nodeId === "ai-identificar-unica") {
      state = runFlowEngine(flow, state, {
        type: "effect_result",
        success: true,
        effectId: state.pendingEffect.effectId,
        data: { responseText: "ok" },
      }).state;
    }
    const tap = runFlowEngine(flow, state, { type: "button", id: DANIELA_BUTTON_IDS.MANTENER_CITA });
    assert.equal(tap.error, undefined);
    assert.equal(tap.state.currentNodeId, "end-abandonada");
    assert.equal(tap.effects.some((e) => e.type === "effect_required" && e.nodeId === "act-cancelar"), false);
  });
});

describe("L. reagendamiento usa el mecanismo existente (sin listar horarios inventados)", () => {
  it("no hay botones de horarios inventados; confirmar sigue el clasificador", () => {
    const flow = danielaReagendarCitaFlow();
    const horariosInventados = flow.nodes.filter(
      (n) => n.type === "buttons" && n.config.buttons.some((b) => /horario[_ ]?[12]/i.test(b.id)),
    );
    assert.equal(horariosInventados.length, 0);
    const confirmar = flow.nodes.find((n) => n.id === "q-confirmar-reagendar");
    assert.ok(confirmar && confirmar.type === "buttons");
    if (confirmar.type === "buttons") {
      assert.deepEqual(
        confirmar.config.buttons.map((b) => b.id),
        [DANIELA_BUTTON_IDS.CONFIRMAR_CAMBIO, DANIELA_BUTTON_IDS.MANTENER_CITA],
      );
    }
  });
});

describe("M. botones y lenguaje natural equivalentes", () => {
  it("en el menú, texto 'Productos' = tap productos", () => {
    const flow = danielaRouterFlow();
    const menu = clasificar(flow, "Hola", "menu");
    const typed = runFlowEngine(flow, menu.state, { type: "text", text: "Productos" });
    assert.equal(typed.state.pendingEffect?.nodeId, "act-handoff-daniela");
    assert.equal(sendMessages(typed.effects).length, 1);
  });

  // Fix real (sept. 2026) — excepción deliberada a la equivalencia
  // botón/texto de este describe: el tap SÍ diverge del texto libre a
  // propósito (atajo determinista solo para el valor estructurado del
  // botón, ver comentario en daniela-agendar-cita.flow.ts) -- el texto
  // libre sigue exactamente igual que antes, pasando por el clasificador.
  it("en confirmación, el botón va DIRECTO a act-agendar; el texto 'Sí' sigue pasando por el clasificador", () => {
    const { flow, state } = conducirHastaPropuestaRouter();
    const porBoton = runFlowEngine(flow, state, { type: "button", id: DANIELA_BUTTON_IDS.CONFIRMAR_CITA });
    const porTexto = runFlowEngine(flow, state, { type: "text", text: "Sí, confírmala" });
    assert.equal(porBoton.state.pendingEffect?.nodeId, "agendar__act-agendar");
    assert.equal(porTexto.state.pendingEffect?.nodeId, "agendar__ai-clasificar-confirmacion");
  });

  it("lenguaje natural equivalente: 'Sí, confirmo.' / 'Me sirve' / 'Perfecto, agéndala'", () => {
    const { flow, state } = conducirHastaPropuestaRouter();
    for (const frase of ["Sí, confirmo.", "Me sirve", "Perfecto, agéndala"]) {
      const r = runFlowEngine(flow, state, { type: "text", text: frase });
      assert.equal(r.error, undefined, frase);
      assert.equal(r.state.pendingEffect?.nodeId, "agendar__ai-clasificar-confirmacion", frase);
    }
  });
});

describe("N. no hay mensajes duplicados", () => {
  it("menú: un solo send_message", () => {
    const r = clasificar(danielaRouterFlow(), "Hola", "menu");
    assert.equal(sendMessages(r.effects).length, 1);
  });

  it("producto por texto: un solo send_message", () => {
    const r = clasificar(danielaRouterFlow(), "venden cremas?", "producto");
    assert.equal(sendMessages(r.effects).length, 1);
  });

  it("servicios: sin mensaje hasta resolver el catálogo real; luego un solo send_message (q-seleccionar-servicio)", () => {
    const flow = danielaRouterFlow();
    const menu = clasificar(flow, "Hola", "menu");
    const tap = runFlowEngine(flow, menu.state, { type: "button", id: DANIELA_BUTTON_IDS.SERVICIOS_SPA });
    // act-listar-servicios es una acción (requiere despacho real) -- cero
    // mensajes en este turno hasta que el catálogo real se resuelva.
    assert.equal(sendMessages(tap.effects).length, 0);
    assert.equal(tap.state.pendingEffect?.nodeId, "agendar__act-listar-servicios");
    const listado = runFlowEngine(flow, tap.state, {
      type: "effect_result",
      success: true,
      effectId: tap.state.pendingEffect!.effectId,
      data: { serviciosDisponibles: SERVICIOS_REALES, serviciosDisponiblesTexto: SERVICIOS_TEXTO, cantidadServicios: SERVICIOS_REALES.length },
    });
    // Sin hint de servicio (tap de botón) -> el camino rápido falla.
    const fallido = runFlowEngine(flow, listado.state, {
      type: "effect_result",
      success: false,
      effectId: listado.state.pendingEffect!.effectId,
      data: {},
    });
    const envios = sendMessages(fallido.effects);
    assert.equal(envios.length, 1);
    assert.equal(envios[0] && "nodeId" in envios[0]! ? envios[0]!.nodeId : "", "agendar__q-seleccionar-servicio");
    assert.equal(fallido.state.currentNodeId, "agendar__q-seleccionar-servicio");
  });

  it("FALLA si se generan dos preguntas equivalentes de servicio en el mismo turno", () => {
    const { flow, state } = entrarAAgendarSinCitasPrevias("Quiero una cita para el viernes a las 5:00 PM");
    const after = extraerVacio(flow, state);
    // Cierre final Daniela: sin servicio conocido, este turno solo llega
    // hasta act-listar-servicios (acción, requiere despacho real) -- cero
    // mensajes todavía, así que "un solo mensaje" se prueba después de
    // resolverla, no en este mismo turno.
    assert.equal(sendMessages(after.effects).length, 0, `mensajes inesperados antes de resolver el catálogo: ${JSON.stringify(sendMessages(after.effects).map(messageText))}`);
    assert.equal(after.state.pendingEffect?.nodeId, "agendar__act-listar-servicios");
  });

  it("el grafo tiene UNA sola pregunta de servicio (equivalentes cuentan como la misma)", () => {
    const visibles = danielaRouterFlow().nodes.flatMap(textosVisiblesDelNodo);
    const equivalentes = visibles.filter((t) => PREGUNTA_SERVICIO_EQ.test(t));
    assert.equal(equivalentes.length, 1, `nodos con pregunta de servicio: ${JSON.stringify(equivalentes)}`);
  });

  it("ningún texto visible saluda por nombre (Hola Duvan)", () => {
    const visibles = danielaRouterFlow().nodes.flatMap(textosVisiblesDelNodo);
    const nombrados = visibles.filter((t) => /hola\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]{2,}/i.test(t));
    assert.deepEqual(nombrados, [], "no debe haber 'Hola {nombre}' en nodos visibles");
  });

  it("agendar directo: una sola pregunta de servicio (catálogo real) si falta el servicio; no hay saludo", () => {
    // Cierre final Daniela: "semipermanente" no queda claro para ai-extraer
    // en este mensaje (extraerVacio simula extracción vacía a propósito),
    // así que el turno consulta el catálogo real (acción) y, sin hint,
    // termina mostrando la lista real -- mismo criterio de "una sola
    // pregunta por turno" que antes, sobre el nuevo nodo.
    const { flow, state } = entrarAAgendarSinCitasPrevias("Quiero una cita para semipermanente");
    const after = extraerVacio(flow, state);
    assert.equal(after.state.pendingEffect?.nodeId, "agendar__act-listar-servicios");
    const listado = runFlowEngine(flow, after.state, {
      type: "effect_result",
      success: true,
      effectId: after.state.pendingEffect!.effectId,
      data: { serviciosDisponibles: SERVICIOS_REALES, serviciosDisponiblesTexto: SERVICIOS_TEXTO, cantidadServicios: SERVICIOS_REALES.length },
    });
    const fallido = runFlowEngine(flow, listado.state, {
      type: "effect_result",
      success: false,
      effectId: listado.state.pendingEffect!.effectId,
      data: {},
    });
    const envios = sendMessages(fallido.effects);
    assert.equal(envios.length, 1);
    assert.equal(envios[0] && "nodeId" in envios[0] ? envios[0].nodeId : "", "agendar__q-seleccionar-servicio");
    assert.equal(/hola\s+\w+/i.test(messageText(envios[0]!)), false);
  });
});

describe("O. interpolación y claim-security de la propuesta (sin tocar candados)", () => {
  it("interpolateTemplate sustituye {{clave}} y deja vacío lo ausente", () => {
    assert.equal(interpolateTemplate("Hola {{nombre}}, {{faltante}}.", { nombre: "Ana" }), "Hola Ana, .");
  });

  it("la propuesta con evidencia de disponibilidad NO se filtra", () => {
    // NOTA (verificado empíricamente durante el rediseño, no introducido por
    // él): este caso YA fallaba antes de tocar nada de Daniela, con el
    // nombre de source ORIGINAL en producción ("consultar_disponibilidad_
    // especialista"). external-claim-security.ts::SOURCE_TO_ACTION nunca
    // registró ninguna de las acciones de solo-lectura de especialistas
    // (ni la vieja ni "listar_horarios_disponibles_especialista", su
    // reemplazo) -- capabilitiesFromVerifiedEntry devuelve [] para ambas,
    // así que filterClaimSecuredEffects bloquea el mensaje de propuesta
    // igual con cualquiera de los dos nombres. Es un hallazgo real, pero
    // preexistente y fuera del alcance de este rediseño (external-claim-
    // security.ts está explícitamente protegido en este trabajo) -- se deja
    // documentado acá, sin "arreglarlo" tocando ese archivo sin autorización.
    const { effects } = conducirHastaPropuestaRouter();
    const msg = sendMessages(effects).find((e) => e.type === "send_message" && e.nodeId === "agendar__q-confirmar-cita");
    assert.ok(msg && msg.type === "send_message");
    const vars = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        {
          source: "listar_horarios_disponibles_especialista",
          verified: true,
          data: { source: "listar_horarios_disponibles_especialista", verified: true, disponible: true },
        },
      ],
    };
    const kept = filterClaimSecuredEffects([msg], vars);
    assert.equal(kept.length, 1, "la propuesta interpolada debe enviarse si hay appointment.available");
  });
});

describe("P. no crear cita antes de confirmar; una sola confirmación final", () => {
  it("hasta la propuesta no existe effect_required de act-agendar", () => {
    const { effects } = conducirHastaPropuestaRouter();
    assert.equal(effects.some((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar"), false);
  });

  // Fix real (sept. 2026) — el tap ya no pasa por ai-clasificar-confirmacion
  // (atajo determinista directo a act-agendar, ver comentario en
  // daniela-agendar-cita.flow.ts), así que este test ya no simula el paso
  // intermedio de "classification: confirma".
  it("tras confirmar (botón directo) hay UN act-agendar y luego UNA confirmación", () => {
    const { flow, state, effects } = conducirHastaPropuestaRouter();
    const tap = runFlowEngine(flow, state, { type: "button", id: DANIELA_BUTTON_IDS.CONFIRMAR_CITA });
    assert.equal(tap.state.pendingEffect?.nodeId, "agendar__act-agendar");
    const agendado = runFlowEngine(flow, tap.state, {
      type: "effect_result",
      success: true,
      effectId: tap.state.pendingEffect!.effectId,
      data: { citaId: 99, status: "confirmada", especialista: "Carla" },
    });
    const final = runFlowEngine(flow, agendado.state, {
      type: "effect_result",
      success: true,
      effectId: agendado.state.pendingEffect!.effectId,
      data: { responseText: "🎉 Tu cita para semipermanente quedó confirmada con Carla el 2026-09-18 a las 15:00. ¡Te esperamos!" },
    });
    const todos = [...effects, ...tap.effects, ...agendado.effects, ...final.effects];
    assert.equal(todos.filter((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar").length, 1);
    const finales = sendMessages(final.effects);
    assert.equal(finales.length, 2, "confirmación AI + recordatorio estático");
    assert.equal(finales[0] && "nodeId" in finales[0] ? finales[0].nodeId : "", "agendar__ai-confirmar");
    assert.equal(finales[1] && "nodeId" in finales[1] ? finales[1].nodeId : "", "agendar__msg-recordatorio-asistencia");
    assert.equal(/hola\s+\w+/i.test(messageText(finales[0]!)), false);
    assert.equal(final.state.status, "completed");
  });
});

describe("Q. cita(s) previa(s) — Parte 13 del rediseño, vía el router completo", () => {
  it("con una cita previa, se informa y se pregunta antes de continuar; 'no' NO agenda una adicional", () => {
    const flow = danielaRouterFlow();
    const clasificado = clasificar(flow, "Quiero agendar otra vez", "agendar");
    assert.equal(clasificado.state.pendingEffect?.nodeId, "agendar__act-consultar-citas-previas");
    const previas = runFlowEngine(flow, clasificado.state, {
      type: "effect_result",
      success: true,
      effectId: clasificado.state.pendingEffect!.effectId,
      data: { cantidadCitas: 1, citasActivas: [{ id: 5, servicio: "manos", inicio: "2026-09-10T16:00:00Z" }] },
    });
    assert.equal(previas.state.pendingEffect?.nodeId, "agendar__ai-informar-cita-existente");
    const informado = runFlowEngine(flow, previas.state, {
      type: "effect_result",
      success: true,
      effectId: previas.state.pendingEffect!.effectId,
      data: { responseText: "Ya tienes una cita de manos el 10 de septiembre a las 4pm." },
    });
    assert.equal(informado.state.currentNodeId, "agendar__q-agendar-adicional");
    const tap = runFlowEngine(flow, informado.state, { type: "button", id: DANIELA_BUTTON_IDS.NO_AGENDAR_ADICIONAL });
    assert.equal(tap.state.pendingEffect?.nodeId, "agendar__ai-clasificar-adicional");
    const clasificadoNo = runFlowEngine(flow, tap.state, {
      type: "effect_result",
      success: true,
      effectId: tap.state.pendingEffect!.effectId,
      data: { classification: "no_quiere" },
    });
    assert.equal(clasificadoNo.state.currentNodeId, "agendar__end-mantiene-cita-existente");
    assert.equal(clasificadoNo.state.status, "completed");
    assert.equal(clasificadoNo.effects.some((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar"), false);
  });

  it("con una cita previa, 'sí quiero otra' SÍ continúa el flujo normal de agendar", () => {
    const flow = danielaRouterFlow();
    const clasificado = clasificar(flow, "Quiero agendar otra vez", "agendar");
    const previas = runFlowEngine(flow, clasificado.state, {
      type: "effect_result",
      success: true,
      effectId: clasificado.state.pendingEffect!.effectId,
      data: { cantidadCitas: 1, citasActivas: [{ id: 5 }] },
    });
    const informado = runFlowEngine(flow, previas.state, {
      type: "effect_result",
      success: true,
      effectId: previas.state.pendingEffect!.effectId,
      data: { responseText: "Ya tienes una cita." },
    });
    const tap = runFlowEngine(flow, informado.state, { type: "button", id: DANIELA_BUTTON_IDS.AGENDAR_ADICIONAL });
    const clasificadoSi = runFlowEngine(flow, tap.state, {
      type: "effect_result",
      success: true,
      effectId: tap.state.pendingEffect!.effectId,
      data: { classification: "quiere_adicional" },
    });
    assert.equal(clasificadoSi.state.pendingEffect?.nodeId, "agendar__ai-extraer");
  });
});
