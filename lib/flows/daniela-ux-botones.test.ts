/**
 * UX botones Daniela — motor puro, sin Claude real ni WhatsApp real.
 * Cubre A–N del pedido: menú, producto, servicios, NLU, confirmación,
 * cancelación, reagendamiento y no-duplicación de mensajes.
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

/** Preguntas equivalentes de servicio: deben existir como UNA sola. */
const PREGUNTA_SERVICIO_EQ =
  /qu[eé]\s+servicio\s+(?:te\s+gustar[ií]a|quieres|deseas)\s+agendar/i;

function textosVisiblesDelNodo(node: FlowNode): string[] {
  if (node.type === "question" || node.type === "buttons") {
    return [node.config.text];
  }
  if (node.type === "message" && node.config.text) {
    return [node.config.text];
  }
  return [];
}

function clasificar(
  flow: FlowDefinition,
  texto: string,
  classification: string,
): { state: FlowEngineState; effects: EngineEffect[] } {
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

describe("UX botones — validador y candados de citas intactos", () => {
  it("el router combinado sigue pasando validateFlowForPublish", () => {
    const result = validateFlowForPublish(danielaRouterFlow());
    if (!result.valid) console.error(JSON.stringify(result.errors, null, 2));
    assert.equal(result.valid, true);
  });

  it("act-agendar del router SOLO es alcanzable desde class:confirma", () => {
    const flow = danielaRouterFlow();
    const hacia = flow.edges.filter((e) => e.target === "agendar__act-agendar");
    assert.equal(hacia.length, 1);
    assert.equal(hacia[0]?.source, "agendar__ai-clasificar-confirmacion");
    assert.equal(hacia[0]?.sourceHandle, FLOW_EDGE_HANDLE.aiClass("confirma"));
  });

  it("confirmar_cita NO apunta directo a act-agendar", () => {
    const flow = danielaAgendarCitaFlow();
    const btn = flow.edges.find(
      (e) => e.source === "q-confirmar-cita" && e.sourceHandle === FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.CONFIRMAR_CITA),
    );
    assert.equal(btn?.target, "ai-clasificar-confirmacion");
  });

  it("cancelar: act-cancelar sigue solo desde ai-proponer-cancelar; mantener_cita no cancela", () => {
    const flow = danielaCancelarCitaFlow();
    const haciaProponer = flow.edges.filter((e) => e.target === "ai-proponer-cancelar");
    assert.equal(haciaProponer.length, 1);
    assert.equal(haciaProponer[0]?.sourceHandle, FLOW_EDGE_HANDLE.aiClass("confirma"));
    const mantener = flow.edges.find(
      (e) =>
        e.source === "q-confirmar-cancelacion" &&
        e.sourceHandle === FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.MANTENER_CITA),
    );
    assert.equal(mantener?.target, "msg-cancelacion-abandonada");
  });

  it("reagendar: act-mover-cita no es alcanzable desde el menú ni desde mantener_cita", () => {
    const flow = danielaReagendarCitaFlow();
    const haciaMover = flow.edges.filter((e) => e.target === "act-mover-cita");
    assert.ok(haciaMover.every((e) => e.source === "ai-proponer-mover"));
    const mantener = flow.edges.find(
      (e) =>
        e.source === "q-confirmar-reagendar" &&
        e.sourceHandle === FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.MANTENER_CITA),
    );
    assert.equal(mantener?.target, "msg-reagendamiento-abandonado");
  });
});

describe("A. saludo → botones Servicios/Productos", () => {
  it("clasificación menu envía UN mensaje interactivo con IDs estables", () => {
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
});

describe("B. botón Productos → derivación humana, NO agendar", () => {
  it("tap productos envía el mensaje de derivación UNA vez y no toca act-agendar", () => {
    const flow = danielaRouterFlow();
    const menu = clasificar(flow, "Hola", "menu");
    const tap = runFlowEngine(flow, menu.state, {
      type: "button",
      id: DANIELA_BUTTON_IDS.PRODUCTOS,
    });
    assert.equal(tap.error, undefined);
    const envios = sendMessages(tap.effects);
    assert.equal(envios.length, 1);
    assert.equal(envios[0] && "nodeId" in envios[0] ? envios[0].nodeId : "", "msg-producto");
    assert.equal(tap.state.pendingEffect?.nodeId, "act-handoff-daniela");
    assert.equal(tap.state.status, "waiting_effect");
    assert.equal(
      tap.effects.some((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar"),
      false,
    );
  });
});

describe("C. botón Servicios → flujo normal, no crea cita", () => {
  it("tap servicios_spa va directo a q-servicio sin contaminar variables.servicio", () => {
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
    assert.equal(
      tap.effects.some((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar"),
      false,
    );
    const envios = sendMessages(tap.effects);
    assert.equal(envios.length, 1);
    assert.equal(envios[0] && "nodeId" in envios[0] ? envios[0].nodeId : "", "agendar__q-servicio");
    assert.match(messageText(envios[0]!), PREGUNTA_SERVICIO_EQ);
    const r2 = runFlowEngine(flow, tap.state, { type: "text", text: "semipermanente en manos" });
    assert.equal(r2.error, undefined);
    assert.equal(r2.state.variables.servicio, "semipermanente en manos");
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
    assert.equal(
      r.effects.some((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar"),
      false,
    );
  });

  it("E. 'quiero comprar una crema' (producto) deriva", () => {
    const flow = danielaRouterFlow();
    const r = clasificar(flow, "Quiero comprar una crema", "producto");
    assert.equal(r.state.pendingEffect?.nodeId, "act-handoff-daniela");
    assert.equal(sendMessages(r.effects).length, 1);
  });
});

describe("F/G. SERVICIO-INFO vs AGENDAR", () => {
  it("F. 'cuánto cuesta el semipermanente' (info_servicio) handoff a Daniela, NO crea cita", () => {
    const flow = danielaRouterFlow();
    const r = clasificar(flow, "Quiero saber cuánto cuesta el semipermanente", "info_servicio");
    assert.equal(r.state.pendingEffect?.nodeId, "act-handoff-daniela");
    assert.ok(sendMessages(r.effects).some((e) => "nodeId" in e && e.nodeId === "msg-handoff-tema"));
    const decision = decidirFallbackDesdeResultado({
      outcome: "processed",
      executionRowId: "ux-info",
      effects: r.effects,
      dispatchedEffectIds: [],
    });
    assert.equal(decision.handled, true);
    assert.equal(decision.motivo, "processed_ok");
  });

  it("G. 'quiero una cita para semipermanente' (agendar) entra a extraer, no agenda solo", () => {
    const flow = danielaRouterFlow();
    const r = clasificar(flow, "Hola, quiero una cita para semipermanente", "agendar");
    assert.equal(r.state.pendingEffect?.nodeId, "agendar__ai-extraer");
    assert.equal(
      r.effects.some((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar"),
      false,
    );
  });
});

function conducirHastaPropuestaRouter(): { flow: FlowDefinition; state: FlowEngineState; effects: EngineEffect[] } {
  const flow = danielaRouterFlow();
  const clasificado = clasificar(flow, "Quiero semipermanente el 2026-09-18 a las 15:00 para Ana", "agendar");
  let state = clasificado.state;
  const effects = [...clasificado.effects];
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
      data: { servicio: "semipermanente", fecha: "2026-09-18", hora: "15:00", nombreCliente: "Ana" },
    }),
  );
  push(
    runFlowEngine(flow, state, {
      type: "effect_result",
      success: true,
      effectId: state.pendingEffect!.effectId,
      data: { disponible: true, duracionMin: 120, especialista: "Carla", horariosTomados: [] },
    }),
  );
  assert.equal(state.currentNodeId, "agendar__q-confirmar-cita");
  assert.equal(state.expectedInput, "button");
  return { flow, state, effects };
}

describe("H/I/J. propuesta → Confirmar / Otro horario", () => {
  it("H. la propuesta termina en botones confirmar_cita / otro_horario (un prompt de confirmación)", () => {
    const { effects, state } = conducirHastaPropuestaRouter();
    const confirmaciones = sendMessages(effects).filter(
      (e) => e.type === "send_message" && e.nodeId === "agendar__q-confirmar-cita",
    );
    assert.equal(confirmaciones.length, 1);
    const msg = confirmaciones[0];
    assert.ok(msg && msg.type === "send_message");
    assert.deepEqual(
      msg.buttons?.map((b) => b.id),
      [DANIELA_BUTTON_IDS.CONFIRMAR_CITA, DANIELA_BUTTON_IDS.OTRO_HORARIO],
    );
    assert.equal(state.expectedInput, "button");
    assert.match(messageText(msg), /semipermanente/);
    assert.match(messageText(msg), /2026-09-18/);
    assert.match(messageText(msg), /15:00/);
    assert.match(messageText(msg), /Carla/);
    assert.equal(messageText(msg).includes("{{"), false, "los placeholders deben interpolarse");
    assert.equal(/hola\s+\w+/i.test(messageText(msg)), false, "la propuesta no saluda por nombre");
  });

  it("I. botón Confirmar entra al clasificador existente, no a act-agendar", () => {
    const { flow, state } = conducirHastaPropuestaRouter();
    const tap = runFlowEngine(flow, state, { type: "button", id: DANIELA_BUTTON_IDS.CONFIRMAR_CITA });
    assert.equal(tap.error, undefined);
    assert.equal(tap.state.pendingEffect?.nodeId, "agendar__ai-clasificar-confirmacion");
    assert.equal(tap.state.variables.respuestaConfirmacionAgendarTexto, DANIELA_BUTTON_IDS.CONFIRMAR_CITA);
    const confirma = runFlowEngine(flow, tap.state, {
      type: "effect_result",
      success: true,
      effectId: tap.state.pendingEffect!.effectId,
      data: { classification: "confirma" },
    });
    assert.equal(confirma.state.pendingEffect?.nodeId, "agendar__act-agendar");
  });

  it("J. botón Otro horario vuelve a fecha y NO crea cita", () => {
    const { flow, state } = conducirHastaPropuestaRouter();
    const tap = runFlowEngine(flow, state, { type: "button", id: DANIELA_BUTTON_IDS.OTRO_HORARIO });
    assert.equal(tap.error, undefined);
    assert.equal(tap.state.currentNodeId, "agendar__q-fecha");
    assert.equal(
      tap.effects.some((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar"),
      false,
    );
  });
});

describe("K. cancelación con botones y candado existente", () => {
  it("botón cancelar_cita va al clasificador; act-cancelar solo tras confirma", () => {
    const flow = danielaCancelarCitaFlow();
    let state = createFlowEngineState(flow, { executionId: randomUUID() });
    state = runFlowEngine(flow, state, { type: "start", text: "quiero cancelar" }).state;
    state = runFlowEngine(flow, state, {
      type: "effect_result",
      success: true,
      effectId: state.pendingEffect!.effectId,
      data: { cantidadCitas: 1, citasActivas: [{ id: 1, servicio: "manos" }], citaObjetivoId: "1" },
    }).state;
    // Puede pasar por AI de identificación; si queda en confirmar, seguimos.
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
    assert.equal(confirma.state.pendingEffect?.nodeId, "ai-proponer-cancelar");
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
    assert.equal(
      tap.effects.some((e) => e.type === "effect_required" && e.nodeId === "act-cancelar"),
      false,
    );
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

  it("en confirmación, texto 'Sí' entra al mismo clasificador que el botón", () => {
    const { flow, state } = conducirHastaPropuestaRouter();
    const porBoton = runFlowEngine(flow, state, { type: "button", id: DANIELA_BUTTON_IDS.CONFIRMAR_CITA });
    const porTexto = runFlowEngine(flow, state, { type: "text", text: "Sí, confírmala" });
    assert.equal(porBoton.state.pendingEffect?.nodeId, "agendar__ai-clasificar-confirmacion");
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

  it("servicios: un solo send_message (q-servicio) al tocar el botón", () => {
    const flow = danielaRouterFlow();
    const menu = clasificar(flow, "Hola", "menu");
    const tap = runFlowEngine(flow, menu.state, { type: "button", id: DANIELA_BUTTON_IDS.SERVICIOS_SPA });
    assert.equal(sendMessages(tap.effects).length, 1);
    assert.equal(sendMessages(tap.effects)[0] && "nodeId" in sendMessages(tap.effects)[0]! ? sendMessages(tap.effects)[0]!.nodeId : "", "agendar__q-servicio");
    assert.equal(tap.state.currentNodeId, "agendar__q-servicio");
  });

  it("FALLA si se generan dos preguntas equivalentes de servicio en el mismo turno", () => {
    const flow = danielaRouterFlow();
    const clasificado = clasificar(flow, "Quiero una cita para el viernes a las 5:00 PM", "agendar");
    const after = extraerVacio(flow, clasificado.state);
    const equivalentes = sendMessages(after.effects)
      .map(messageText)
      .filter((t) => PREGUNTA_SERVICIO_EQ.test(t));
    assert.equal(equivalentes.length, 1, `preguntas de servicio duplicadas: ${JSON.stringify(equivalentes)}`);
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

  it("agendar directo: una sola pregunta de servicio si falta; no hay saludo", () => {
    const flow = danielaRouterFlow();
    const r = clasificar(flow, "Quiero una cita para semipermanente", "agendar");
    const after = extraerVacio(flow, r.state);
    const envios = sendMessages(after.effects);
    assert.equal(envios.length, 1);
    assert.equal(envios[0] && "nodeId" in envios[0] ? envios[0].nodeId : "", "agendar__q-servicio");
    assert.equal(/hola\s+\w+/i.test(messageText(envios[0]!)), false);
  });
});

describe("O. interpolación y claim-security de la propuesta (sin tocar candados)", () => {
  it("interpolateTemplate sustituye {{clave}} y deja vacío lo ausente", () => {
    assert.equal(
      interpolateTemplate("Hola {{nombre}}, {{faltante}}.", { nombre: "Ana" }),
      "Hola Ana, .",
    );
  });

  it("la propuesta con evidencia de disponibilidad NO se filtra", () => {
    const { effects } = conducirHastaPropuestaRouter();
    const msg = sendMessages(effects).find(
      (e) => e.type === "send_message" && e.nodeId === "agendar__q-confirmar-cita",
    );
    assert.ok(msg && msg.type === "send_message");
    const vars = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        {
          source: "consultar_disponibilidad_especialista",
          verified: true,
          data: { source: "consultar_disponibilidad_especialista", verified: true, disponible: true },
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
    assert.equal(
      effects.some((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar"),
      false,
    );
  });

  it("tras confirmar + clasificar confirma hay UN act-agendar y luego UNA confirmación", () => {
    const { flow, state, effects } = conducirHastaPropuestaRouter();
    const tap = runFlowEngine(flow, state, { type: "button", id: DANIELA_BUTTON_IDS.CONFIRMAR_CITA });
    const confirma = runFlowEngine(flow, tap.state, {
      type: "effect_result",
      success: true,
      effectId: tap.state.pendingEffect!.effectId,
      data: { classification: "confirma" },
    });
    assert.equal(confirma.state.pendingEffect?.nodeId, "agendar__act-agendar");
    const agendado = runFlowEngine(flow, confirma.state, {
      type: "effect_result",
      success: true,
      effectId: confirma.state.pendingEffect!.effectId,
      data: { citaId: 99, status: "confirmada", especialista: "Carla" },
    });
    const final = runFlowEngine(flow, agendado.state, {
      type: "effect_result",
      success: true,
      effectId: agendado.state.pendingEffect!.effectId,
      data: { responseText: "🎉 Tu cita para semipermanente quedó confirmada con Carla el 2026-09-18 a las 15:00. ¡Te esperamos!" },
    });
    const todos = [...effects, ...tap.effects, ...confirma.effects, ...agendado.effects, ...final.effects];
    assert.equal(todos.filter((e) => e.type === "effect_required" && e.nodeId === "agendar__act-agendar").length, 1);
    const finales = sendMessages(final.effects);
    assert.equal(finales.length, 2, "confirmación AI + recordatorio estático");
    assert.equal(finales[0] && "nodeId" in finales[0] ? finales[0].nodeId : "", "agendar__ai-confirmar");
    assert.equal(finales[1] && "nodeId" in finales[1] ? finales[1].nodeId : "", "agendar__msg-recordatorio-asistencia");
    assert.equal(/hola\s+\w+/i.test(messageText(finales[0]!)), false);
    assert.equal(final.state.status, "completed");
  });
});
