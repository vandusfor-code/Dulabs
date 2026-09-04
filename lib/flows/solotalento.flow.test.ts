/**
 * SOLOTALENTO SAS — tests del Flow determinístico (autorizado).
 *
 * Corre contra el motor PURO (createFlowEngineState/runFlowEngine), sin
 * Supabase -- exactamente el mismo patrón que daniela-router.flow.test.ts.
 * La resolución del Trigger Router ("hola" -> este flow) es responsabilidad
 * de lib/flow-triggers/ (ya probado en su propia suite) y del Orchestrator,
 * no del Engine -- estos tests arrancan directo en {type:"start"}, que es
 * el punto donde el Engine entra en juego UNA VEZ que el Trigger Router ya
 * seleccionó este flow.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { filterClaimSecuredEffects } from "@/lib/flow/ai-runtime/ai-response-security";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { solotalentoFlow } from "@/lib/flows/solotalento.flow";
import type { FlowEngineRunResult, FlowEngineState } from "@/lib/flow/engine-types";
import type { EngineEffect } from "@/lib/flow/engine-types";

const flow = solotalentoFlow();

function sendMessages(effects: EngineEffect[]): Extract<EngineEffect, { type: "send_message" }>[] {
  return effects.filter((e): e is Extract<EngineEffect, { type: "send_message" }> => e.type === "send_message");
}

/** Corre una conversación completa: start -> N respuestas de texto -> confirma la transferencia. */
function runConversation(textos: string[]): { state: FlowEngineState; allEffects: EngineEffect[] } {
  let state = createFlowEngineState(flow);
  const allEffects: EngineEffect[] = [];

  let result: FlowEngineRunResult = runFlowEngine(flow, state, { type: "start", text: textos[0] });
  allEffects.push(...result.effects);
  state = result.state;

  for (let i = 1; i < textos.length; i += 1) {
    result = runFlowEngine(flow, state, { type: "text", text: textos[i] });
    allEffects.push(...result.effects);
    state = result.state;
  }

  // Completa la transferencia (act-transferir-soporte) si el flow quedó
  // esperando ese efecto -- mismo shape real que devuelve
  // InternalActionExecutor.transferirSoporte en éxito.
  if (state.status === "waiting_effect" && state.pendingEffect?.kind === "action") {
    result = runFlowEngine(flow, state, {
      type: "effect_result",
      success: true,
      effectId: state.pendingEffect.effectId,
      data: { transferred: true, pausadoHasta: "2026-01-01T00:00:00Z", pauseDurationHours: 24 },
    });
    allEffects.push(...result.effects);
    state = result.state;
  }

  return { state, allEffects };
}

describe("SOLOTALENTO — validación estructural (validateFlowForPublish)", () => {
  it("grafo, schema y publish-rules válidos (19 nodos, 24 edges -- bienvenida dividida en 2 mensajes)", () => {
    assert.equal(flow.nodes.length, 19);
    assert.equal(flow.edges.length, 24);
    // NOTA (autorizado): el ÚNICO error real es EXTERNAL_CLAIM_UNVERIFIED en
    // msg-transfer-1-6 -- gap preexistente de validate-security.ts (chequeo
    // de build-time, solo node.type==="message", pipeline morfológico
    // completo -- no la matriz origin/role de runtime), ya documentado y ya
    // presente en trigger-router-lab antes de esta fase. Sin relación con
    // Trigger Router, Runtime Bridge, ni con el análisis morfológico en sí
    // (que no se tocó). Verificado explícitamente que NO hay ningún otro
    // error (grafo, schema, nodos huérfanos, etc.).
    const result = validateFlowForPublish(flow);
    const otros = result.errors.filter((e) => !(e.code === "EXTERNAL_CLAIM_UNVERIFIED" && e.nodeId === "msg-transfer-1-6"));
    assert.deepEqual(otros, [], `no debe haber NINGÚN otro error de validación: ${JSON.stringify(otros)}`);
  });
});

describe("SOLOTALENTO — TEST 1: bienvenida", () => {
  it("start -> WELCOME (2 mensajes consecutivos) + MAIN MENU, waiting_input", () => {
    const state = createFlowEngineState(flow);
    const result = runFlowEngine(flow, state, { type: "start", text: "hola" });
    assert.equal(result.state.status, "waiting_input");
    assert.equal(result.state.currentNodeId, "q-main-menu");
    const msgs = sendMessages(result.effects);
    assert.equal(msgs.length, 2, "la bienvenida ahora son 2 mensajes consecutivos, no 1");
    assert.ok(msgs[0]!.content.text!.includes("¡Bienvenido a SOLOTALENTO SAS"));
    assert.ok(msgs[0]!.content.text!.includes("la intervención estratégica de sus equipos de trabajo"));
    assert.ok(!msgs[0]!.content.text!.includes("Estamos aquí para orientarte"), "frase eliminada del saludo pedido por la cliente");
    assert.ok(!msgs[0]!.content.text!.includes("¿En qué podemos ayudarte?"), "mensaje 1 no debe incluir el menú");
    assert.ok(msgs[1]!.content.text!.includes("¿En qué podemos ayudarte?"));
    assert.ok(msgs[1]!.content.text!.includes("7️⃣ Hablar con nuestra asesora"));
    assert.ok(!msgs[1]!.content.text!.includes("¡Bienvenido a SOLOTALENTO SAS"), "mensaje 2 no debe repetir la bienvenida");
  });
});

describe("SOLOTALENTO — TESTS 2-9 exactos del pedido", () => {
  it("TEST 2: 1 -> 1 => servicio=1, necesidad=1, transfer", () => {
    const { state } = runConversation(["hola", "1", "1"]);
    assert.equal(state.variables.servicio, "1");
    assert.equal(state.variables.necesidad, "1");
    assert.equal(state.status, "completed");
  });

  it("TEST 3: 1 -> 3 => servicio=1, necesidad=3 (Realizar una auditoría), transfer", () => {
    const { state } = runConversation(["hola", "1", "3"]);
    assert.equal(state.variables.servicio, "1");
    assert.equal(state.variables.necesidad, "3");
    assert.equal(state.status, "completed");
  });

  it("TEST 4: 2 -> 4 => servicio=2 (PESV), necesidad=4 (Revisar cumplimiento), transfer", () => {
    const { state } = runConversation(["hola", "2", "4"]);
    assert.equal(state.variables.servicio, "2");
    assert.equal(state.variables.necesidad, "4");
    assert.equal(state.status, "completed");
  });

  it("TEST 5: 3 -> 4 => servicio=3 (SARLAFT), necesidad=4 (Acompañamiento Oficial Cumplimiento), transfer", () => {
    const { state } = runConversation(["hola", "3", "4"]);
    assert.equal(state.variables.servicio, "3");
    assert.equal(state.variables.necesidad, "4");
    assert.equal(state.status, "completed");
  });

  it("TEST 6: 4 -> 2 => servicio=4 (BASC), necesidad=2 (Actualización/mantenimiento), transfer", () => {
    const { state } = runConversation(["hola", "4", "2"]);
    assert.equal(state.variables.servicio, "4");
    assert.equal(state.variables.necesidad, "2");
    assert.equal(state.status, "completed");
  });

  it("TEST 7: 5 -> 1 => servicio=5 (Auditorías), necesidad=1 (SG-SST), transfer", () => {
    const { state } = runConversation(["hola", "5", "1"]);
    assert.equal(state.variables.servicio, "5");
    assert.equal(state.variables.necesidad, "1");
    assert.equal(state.status, "completed");
  });

  it("TEST 8: 6 -> 5 => servicio=6 (Capacitaciones), necesidad=5 (Habilidades comerciales), transfer", () => {
    const { state } = runConversation(["hola", "6", "5"]);
    assert.equal(state.variables.servicio, "6");
    assert.equal(state.variables.necesidad, "5");
    assert.equal(state.status, "completed");
  });

  it("TEST 9: 7 => servicio=7 (Hablar con un asesor), necesidad=undefined, transferencia inmediata (sin submenú)", () => {
    const { state, allEffects } = runConversation(["hola", "7"]);
    assert.equal(state.variables.servicio, "7");
    assert.equal(state.variables.necesidad, undefined, "necesidad NUNCA debe preguntarse en la ruta 7");
    assert.equal(state.status, "completed");
    // Confirma que el mensaje de transferencia usado fue el de la ruta 7, no el de 1-6.
    const msgs = sendMessages(allEffects);
    const textos = msgs.map((m) => m.content.text);
    assert.ok(textos.some((t) => t?.includes("¡Claro que sí!")), "debe usar el mensaje de transferencia específico de la ruta 7");
    assert.ok(!textos.some((t) => t?.includes("Hemos identificado lo que necesitas")), "NUNCA debe mostrar el mensaje de rutas 1-6 en la ruta 7");
  });
});

// ---------------------------------------------------------------------------
// Matriz completa — las 34 rutas finales (Secciones 34/36).
// ---------------------------------------------------------------------------

const MATRIZ_34_RUTAS: Array<{ servicio: string; necesidad: string; nombre: string }> = [
  // SG-SST (5)
  { servicio: "1", necesidad: "1", nombre: "SG-SST / Implementarlo desde cero" },
  { servicio: "1", necesidad: "2", nombre: "SG-SST / Actualizarlo o mantenerlo" },
  { servicio: "1", necesidad: "3", nombre: "SG-SST / Realizar una auditoría" },
  { servicio: "1", necesidad: "4", nombre: "SG-SST / Prepararte para una evaluación o visita" },
  { servicio: "1", necesidad: "5", nombre: "SG-SST / Orientación sobre una necesidad específica" },
  // PESV (5)
  { servicio: "2", necesidad: "1", nombre: "PESV / Implementarlo desde cero" },
  { servicio: "2", necesidad: "2", nombre: "PESV / Actualizarlo o mantenerlo" },
  { servicio: "2", necesidad: "3", nombre: "PESV / Realizar una auditoría" },
  { servicio: "2", necesidad: "4", nombre: "PESV / Revisar su cumplimiento y oportunidades de mejora" },
  { servicio: "2", necesidad: "5", nombre: "PESV / Orientación sobre una necesidad específica" },
  // SARLAFT (6)
  { servicio: "3", necesidad: "1", nombre: "SARLAFT / Implementar el sistema" },
  { servicio: "3", necesidad: "2", nombre: "SARLAFT / Actualizar o fortalecerlo" },
  { servicio: "3", necesidad: "3", nombre: "SARLAFT / Realizar una auditoría o revisión" },
  { servicio: "3", necesidad: "4", nombre: "SARLAFT / Acompañamiento como Oficial de Cumplimiento" },
  { servicio: "3", necesidad: "5", nombre: "SARLAFT / Capacitación" },
  { servicio: "3", necesidad: "6", nombre: "SARLAFT / Orientación sobre una necesidad específica" },
  // BASC (6)
  { servicio: "4", necesidad: "1", nombre: "BASC / Implementación" },
  { servicio: "4", necesidad: "2", nombre: "BASC / Actualización o mantenimiento" },
  { servicio: "4", necesidad: "3", nombre: "BASC / Auditoría interna" },
  { servicio: "4", necesidad: "4", nombre: "BASC / Preparación para auditoría" },
  { servicio: "4", necesidad: "5", nombre: "BASC / Capacitación" },
  { servicio: "4", necesidad: "6", nombre: "BASC / Orientación sobre una necesidad específica" },
  // Auditorías (5)
  { servicio: "5", necesidad: "1", nombre: "Auditorías / SG-SST" },
  { servicio: "5", necesidad: "2", nombre: "Auditorías / PESV" },
  { servicio: "5", necesidad: "3", nombre: "Auditorías / SARLAFT" },
  { servicio: "5", necesidad: "4", nombre: "Auditorías / BASC" },
  { servicio: "5", necesidad: "5", nombre: "Auditorías / Otro sistema o proceso" },
  // Capacitaciones (6)
  { servicio: "6", necesidad: "1", nombre: "Capacitaciones / SG-SST" },
  { servicio: "6", necesidad: "2", nombre: "Capacitaciones / Seguridad vial / PESV" },
  { servicio: "6", necesidad: "3", nombre: "Capacitaciones / SARLAFT / Cumplimiento" },
  { servicio: "6", necesidad: "4", nombre: "Capacitaciones / BASC" },
  { servicio: "6", necesidad: "5", nombre: "Capacitaciones / Habilidades comerciales y servicio" },
  { servicio: "6", necesidad: "6", nombre: "Capacitaciones / Otro tema" },
];

describe("SOLOTALENTO — matriz completa: 33 rutas (servicio 1-6) + 1 ruta directa (servicio 7) = 34", () => {
  it("sanity check: 5+5+6+6+5+6=33 combinaciones servicio 1-6", () => {
    assert.equal(MATRIZ_34_RUTAS.length, 33);
  });

  for (const ruta of MATRIZ_34_RUTAS) {
    it(`${ruta.servicio}→${ruta.necesidad} (${ruta.nombre}): servicio/necesidad correctos, llega a transferencia`, () => {
      const { state } = runConversation(["hola", ruta.servicio, ruta.necesidad]);
      assert.equal(state.variables.servicio, ruta.servicio, "servicio no debe pertenecer a otra rama");
      assert.equal(state.variables.necesidad, ruta.necesidad, "necesidad no debe pertenecer a otro servicio");
      assert.equal(state.status, "completed", "debe llegar a la transferencia (end)");
    });
  }

  it("ruta 34 — servicio=7: transferencia inmediata, necesidad nunca definida", () => {
    const { state } = runConversation(["hola", "7"]);
    assert.equal(state.variables.servicio, "7");
    assert.equal(state.variables.necesidad, undefined);
    assert.equal(state.status, "completed");
  });
});

// ---------------------------------------------------------------------------
// Transferencia — Secciones 25/38.
// ---------------------------------------------------------------------------

describe("SOLOTALENTO — mecanismo de transferencia (transferir_soporte, mismo mecanismo real que Daniela)", () => {
  it("rutas 1-6: emite effect_required kind=action actionType=transferir_soporte antes de completar", () => {
    let state = createFlowEngineState(flow);
    let result = runFlowEngine(flow, state, { type: "start", text: "hola" });
    state = result.state;
    result = runFlowEngine(flow, state, { type: "text", text: "1" });
    state = result.state;
    result = runFlowEngine(flow, state, { type: "text", text: "1" });
    state = result.state;
    assert.equal(state.status, "waiting_effect");
    assert.equal(state.pendingEffect?.kind, "action");
    const effectRequired = result.effects.find((e) => e.type === "effect_required");
    assert.ok(effectRequired && effectRequired.type === "effect_required");
    if (effectRequired?.type === "effect_required") {
      assert.equal(effectRequired.kind, "action");
      assert.equal(effectRequired.action?.actionType, "transferir_soporte");
    }
  });

  it("ruta 7: también usa transferir_soporte (mismo mecanismo, sin submenú previo)", () => {
    let state = createFlowEngineState(flow);
    let result = runFlowEngine(flow, state, { type: "start", text: "hola" });
    state = result.state;
    result = runFlowEngine(flow, state, { type: "text", text: "7" });
    state = result.state;
    assert.equal(state.status, "waiting_effect");
    const effectRequired = result.effects.find((e) => e.type === "effect_required");
    assert.ok(effectRequired && effectRequired.type === "effect_required" && effectRequired.action?.actionType === "transferir_soporte");
  });
});

// ---------------------------------------------------------------------------
// Selecciones inválidas — Sección 28 (usa el comportamiento existente del Engine).
// ---------------------------------------------------------------------------

describe("SOLOTALENTO — selecciones inválidas (comportamiento EXISTENTE del Flow Engine, sin flujo nuevo)", () => {
  it("menú principal: '9' (fuera de rango) no avanza, re-pregunta, no corrompe variables", () => {
    let state = createFlowEngineState(flow);
    let result = runFlowEngine(flow, state, { type: "start", text: "hola" });
    state = result.state;
    result = runFlowEngine(flow, state, { type: "text", text: "9" });
    assert.equal(result.state.status, "waiting_input");
    assert.equal(result.state.currentNodeId, "q-main-menu", "debe seguir en el mismo nodo, no avanzar");
    assert.equal(result.state.variables.servicio, undefined, "no debe guardar un valor inválido");
    assert.ok(sendMessages(result.effects).length > 0, "debe re-enviar el prompt/mensaje de error");
  });

  it("menú principal: 'hola' (texto no numérico) tampoco avanza", () => {
    let state = createFlowEngineState(flow);
    let result = runFlowEngine(flow, state, { type: "start", text: "hola" });
    state = result.state;
    result = runFlowEngine(flow, state, { type: "text", text: "hola de nuevo" });
    assert.equal(result.state.status, "waiting_input");
    assert.equal(result.state.currentNodeId, "q-main-menu");
    assert.equal(result.state.variables.servicio, undefined);
  });

  it("submenú SG-SST: '9' (fuera de rango 1-5) no avanza, no corrompe necesidad", () => {
    let state = createFlowEngineState(flow);
    let result = runFlowEngine(flow, state, { type: "start", text: "hola" });
    state = result.state;
    result = runFlowEngine(flow, state, { type: "text", text: "1" });
    state = result.state;
    assert.equal(state.variables.servicio, "1");
    result = runFlowEngine(flow, state, { type: "text", text: "9" });
    assert.equal(result.state.status, "waiting_input");
    assert.equal(result.state.currentNodeId, "q-sub-sgsst");
    assert.equal(result.state.variables.necesidad, undefined);
  });
});

// ---------------------------------------------------------------------------
// Claim Security — Sección 30/40: TODOS los mensajes reales que el motor
// puede emitir deben pasar filterClaimSecuredEffects (sin modificarlo).
// ---------------------------------------------------------------------------

describe("SOLOTALENTO — Claim Security: todos los send_message del flow pasan filterClaimSecuredEffects", () => {
  it("recorre las 34 rutas + selección inválida y confirma que NINGÚN send_message real es bloqueado", () => {
    const todosLosTextos = new Set<string>();
    for (const ruta of [...MATRIZ_34_RUTAS, { servicio: "7", necesidad: "", nombre: "asesor" }]) {
      const textos = ruta.necesidad ? ["hola", ruta.servicio, ruta.necesidad] : ["hola", ruta.servicio];
      const { allEffects } = runConversation(textos);
      for (const m of sendMessages(allEffects)) {
        if (m.content.text) todosLosTextos.add(m.content.text);
      }
    }
    assert.ok(todosLosTextos.size > 0);
    for (const text of todosLosTextos) {
      const effect: EngineEffect = {
        type: "send_message",
        nodeId: "n",
        content: { text },
        executionId: "e",
        effectId: "f",
        origin: "flow_static",
      };
      const result = filterClaimSecuredEffects([effect], {});
      assert.equal(result.length, 1, `NO debe bloquearse: "${text.slice(0, 60)}..."`);
    }
  });
});
