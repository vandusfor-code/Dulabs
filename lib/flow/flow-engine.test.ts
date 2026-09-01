/**
 * Tests del Flow Engine (Fase 2).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FIRST_MESSAGE_TEXT_VARIABLE_KEY, FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import { FLOW_ENGINE_ERROR_CODES } from "@/lib/flow/engine-types";
import type { FlowDefinition } from "@/lib/flow/types";
import {
  createFlowEngineState,
  runFlowEngine,
  validateQuestionValue,
  resolveNextNodeId,
  DEFAULT_MAX_AUTO_STEPS,
} from "@/lib/flow/flow-engine";

function linearFlow(overrides?: Partial<FlowDefinition>): FlowDefinition {
  return {
    name: "Test",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg", type: "message", config: { text: "Hola" } },
      {
        id: "q",
        type: "question",
        config: {
          text: "Nombre?",
          variableKey: "nombre",
          required: true,
          validation: { kind: "text" },
        },
      },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "msg" },
      { id: "e2", source: "msg", target: "q" },
      { id: "e3", source: "q", target: "end" },
    ],
    variables: [{ key: "nombre", label: "Nombre", type: "string" }],
    ...overrides,
  };
}

describe("Flow Engine — transiciones básicas", () => {
  it("1. START → MESSAGE", () => {
    const flow = linearFlow();
    const state = createFlowEngineState(flow, { executionId: "exec-1" });
    const r = runFlowEngine(flow, state, { type: "start" }, { idGenerator: () => "fx-1" });
    assert.equal(r.state.status, "waiting_input");
    assert.equal(r.state.currentNodeId, "q");
    assert.ok(r.effects.some((e) => e.type === "send_message" && e.nodeId === "msg"));
    assert.ok(r.effects.some((e) => e.type === "send_message" && e.nodeId === "q"));
  });

  it("2. MESSAGE → QUESTION (cadena automática)", () => {
    const flow = linearFlow();
    let state = createFlowEngineState(flow);
    const start = runFlowEngine(flow, state, { type: "start" });
    state = start.state;
    assert.equal(state.currentNodeId, "q");
    assert.equal(state.status, "waiting_input");
  });

  it("3. QUESTION espera input", () => {
    const flow = linearFlow();
    const state = createFlowEngineState(flow);
    const r = runFlowEngine(flow, state, { type: "start" });
    assert.equal(r.state.expectedInput, "text");
    assert.ok(r.effects.some((e) => e.type === "wait_input" && e.inputKind === "text"));
  });

  it("4. QUESTION recibe texto válido", () => {
    const flow = linearFlow();
    let state = createFlowEngineState(flow);
    state = runFlowEngine(flow, state, { type: "start" }).state;
    const r = runFlowEngine(flow, state, { type: "text", text: "Ana" });
    assert.equal(r.state.variables.nombre, "Ana");
    assert.equal(r.state.status, "completed");
  });

  it("5. QUESTION recibe texto inválido", () => {
    const flow = linearFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        {
          id: "q",
          type: "question",
          config: {
            text: "Edad?",
            variableKey: "edad",
            required: true,
            validation: { kind: "number" },
          },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "q" },
        { id: "e2", source: "q", target: "end" },
      ],
      variables: [{ key: "edad", label: "Edad", type: "number" }],
    });
    let state = createFlowEngineState(flow);
    state = runFlowEngine(flow, state, { type: "start" }).state;
    const r = runFlowEngine(flow, state, { type: "text", text: "no-es-numero" });
    assert.equal(r.state.status, "waiting_input");
    assert.ok(r.effects.some((e) => e.type === "invalid_input"));
  });
});

describe("Flow Engine — Fase 1 Blocker #1: texto del primer mensaje en 'start'", () => {
  it("1. sin event.text -> comportamiento EXACTO de antes (sin regresión)", () => {
    const flow = linearFlow();
    const state = createFlowEngineState(flow);
    const r = runFlowEngine(flow, state, { type: "start" });
    assert.equal(r.state.variables[FIRST_MESSAGE_TEXT_VARIABLE_KEY], undefined);
    assert.equal(r.state.currentNodeId, "q");
    assert.equal(r.state.status, "waiting_input");
  });

  it("2. con event.text -> se siembra en variables, SIN tocar expectedInput ni auto-responder la pregunta", () => {
    const flow = linearFlow();
    const state = createFlowEngineState(flow);
    const r = runFlowEngine(flow, state, { type: "start", text: "Hola, quiero pestañas" });
    assert.equal(r.state.variables[FIRST_MESSAGE_TEXT_VARIABLE_KEY], "Hola, quiero pestañas");
    // La pregunta "q" sigue esperando SU propia respuesta -- el texto del
    // primer mensaje nunca se usa como si fuera la respuesta a "nombre".
    assert.equal(r.state.variables.nombre, undefined);
    assert.equal(r.state.currentNodeId, "q");
    assert.equal(r.state.expectedInput, "text");
    assert.equal(r.state.status, "waiting_input");
  });

  it("3. texto vacío o solo espacios -> NO se siembra (evita variables[key]='' fantasma)", () => {
    const flow = linearFlow();
    for (const vacio of ["", "   "]) {
      const state = createFlowEngineState(flow);
      const r = runFlowEngine(flow, state, { type: "start", text: vacio });
      assert.equal(r.state.variables[FIRST_MESSAGE_TEXT_VARIABLE_KEY], undefined, `texto "${vacio}" no debería sembrarse`);
    }
  });

  it("4. el grafo SÍ puede leer la variable (ej. un nodo condition), demostrando que es realmente utilizable", () => {
    const flowConCondicion: FlowDefinition = {
      name: "Test primer mensaje",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        {
          id: "cond",
          type: "condition",
          config: { rules: [{ field: FIRST_MESSAGE_TEXT_VARIABLE_KEY, operator: "contains", value: "pestañas" }], match: "all" },
        },
        { id: "msg-pestanas", type: "message", config: { text: "Vi que quieres pestañas" } },
        { id: "msg-generico", type: "message", config: { text: "¿Qué servicio quieres?" } },
        { id: "end-a", type: "end", config: {} },
        { id: "end-b", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "cond" },
        { id: "e2", source: "cond", target: "msg-pestanas", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
        { id: "e3", source: "cond", target: "msg-generico", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
        { id: "e4", source: "msg-pestanas", target: "end-a" },
        { id: "e5", source: "msg-generico", target: "end-b" },
      ],
      variables: [],
    };

    const conPestanas = runFlowEngine(
      flowConCondicion,
      createFlowEngineState(flowConCondicion),
      { type: "start", text: "Hola, quiero pestañas para mañana" },
    );
    assert.ok(conPestanas.effects.some((e) => e.type === "send_message" && e.nodeId === "msg-pestanas"));

    const sinPestanas = runFlowEngine(
      flowConCondicion,
      createFlowEngineState(flowConCondicion),
      { type: "start", text: "Hola" },
    );
    assert.ok(sinPestanas.effects.some((e) => e.type === "send_message" && e.nodeId === "msg-generico"));
  });
});

describe("Flow Engine — botones y condiciones", () => {
  function buttonsFlow(): FlowDefinition {
    return {
      name: "Buttons",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        {
          id: "btn",
          type: "buttons",
          config: {
            text: "Elige",
            buttons: [
              { id: "si", label: "Sí" },
              { id: "no", label: "No" },
            ],
            variableKey: "resp",
          },
        },
        { id: "yes-end", type: "end", config: { message: "OK" } },
        { id: "no-end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "btn" },
        { id: "e2", source: "btn", target: "yes-end", sourceHandle: FLOW_EDGE_HANDLE.button("si") },
        { id: "e3", source: "btn", target: "no-end", sourceHandle: FLOW_EDGE_HANDLE.button("no") },
      ],
      variables: [],
    };
  }

  it("6. BUTTONS muestra botones", () => {
    const flow = buttonsFlow();
    const r = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" });
    const msg = r.effects.find((e) => e.type === "send_message" && e.nodeId === "btn");
    assert.ok(msg && msg.type === "send_message" && msg.buttons?.length === 2);
  });

  it("6b. BUTTONS interpola {{variables}} en el cuerpo", () => {
    const flow: FlowDefinition = {
      name: "Interp",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        {
          id: "btn",
          type: "buttons",
          config: {
            text: "Hay espacio para {{servicio}} el {{fecha}}",
            buttons: [{ id: "ok", label: "Ok" }],
            variableKey: "resp",
          },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "btn" },
        { id: "e2", source: "btn", target: "end", sourceHandle: FLOW_EDGE_HANDLE.button("ok") },
      ],
      variables: [
        { key: "servicio", label: "Servicio", type: "string" },
        { key: "fecha", label: "Fecha", type: "string" },
      ],
    };
    const state = createFlowEngineState(flow);
    state.variables = { ...state.variables, servicio: "manos", fecha: "2026-10-02" };
    const r = runFlowEngine(flow, state, { type: "start" });
    const msg = r.effects.find((e) => e.type === "send_message" && e.nodeId === "btn");
    assert.ok(msg && msg.type === "send_message");
    assert.equal(msg.content.text, "Hay espacio para manos el 2026-10-02");
  });

  it("7. BUTTONS toma camino correcto", () => {
    const flow = buttonsFlow();
    const state = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" }).state;
    const r = runFlowEngine(flow, state, { type: "button", id: "si" });
    assert.equal(r.state.status, "completed");
    assert.equal(r.state.currentNodeId, "yes-end");
    assert.equal(r.state.variables.resp, "si");
  });

  it("8. BUTTON inexistente", () => {
    const flow = buttonsFlow();
    const state = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" }).state;
    const r = runFlowEngine(flow, state, { type: "button", id: "xxx" });
    assert.equal(r.state.status, "waiting_input");
    assert.ok(r.effects.some((e) => e.type === "invalid_input"));
  });

  it("8b. texto que coincide con el ID del botón se trata como tap", () => {
    const flow = buttonsFlow();
    const state = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" }).state;
    const r = runFlowEngine(flow, state, { type: "text", text: "si" });
    assert.equal(r.error, undefined);
    assert.equal(r.state.status, "completed");
    assert.equal(r.state.currentNodeId, "yes-end");
    assert.equal(r.state.variables.resp, "si");
  });

  it("8c. texto que coincide con el label del botón se trata como tap", () => {
    const flow = buttonsFlow();
    const state = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" }).state;
    const r = runFlowEngine(flow, state, { type: "text", text: "Sí" });
    assert.equal(r.error, undefined);
    assert.equal(r.state.currentNodeId, "yes-end");
  });

  function buttonsFlowConTexto(): FlowDefinition {
    const base = buttonsFlow();
    return {
      ...base,
      nodes: [...base.nodes, { id: "texto-end", type: "end", config: {} }],
      edges: [...base.edges, { id: "e-text", source: "btn", target: "texto-end", sourceHandle: FLOW_EDGE_HANDLE.text }],
    };
  }

  it("8d. texto libre en botones sigue el edge text (NLU) y no duplica el prompt", () => {
    const flow = buttonsFlowConTexto();
    const start = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" });
    assert.equal(start.effects.filter((e) => e.type === "send_message").length, 1);
    const r = runFlowEngine(flow, start.state, { type: "text", text: "me sirve, confírmala" });
    assert.equal(r.error, undefined);
    assert.equal(r.state.currentNodeId, "texto-end");
    assert.equal(r.state.variables.resp, "me sirve, confírmala");
    assert.equal(r.effects.filter((e) => e.type === "send_message").length, 0, "el fallback de texto no reenvía el menú");
  });

  it("8e. texto sin match y sin edge text: invalid_input, no crashea", () => {
    const flow = buttonsFlow();
    const state = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" }).state;
    const r = runFlowEngine(flow, state, { type: "text", text: "otra cosa" });
    assert.equal(r.error, undefined);
    assert.equal(r.state.status, "waiting_input");
    assert.ok(r.effects.some((e) => e.type === "invalid_input"));
  });

  function conditionFlow(match: "all" | "any"): FlowDefinition {
    return {
      name: "Cond",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "set",
          type: "question",
          config: {
            text: "Edad?",
            variableKey: "edad",
            required: true,
            validation: { kind: "number" },
          },
        },
        {
          id: "cond",
          type: "condition",
          config: {
            match,
            rules: [
              { field: "edad", operator: "greater_or_equal", value: 18 },
              { field: "edad", operator: "less_than", value: 65 },
            ],
          },
        },
        { id: "true-end", type: "end", config: {} },
        { id: "false-end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "set" },
        { id: "e2", source: "set", target: "cond" },
        { id: "e3", source: "cond", target: "true-end", sourceHandle: "true" },
        { id: "e4", source: "cond", target: "false-end", sourceHandle: "false" },
      ],
      variables: [{ key: "edad", label: "Edad", type: "number" }],
    };
  }

  it("9. CONDITION true", () => {
    const flow = conditionFlow("all");
    let state = createFlowEngineState(flow);
    state = runFlowEngine(flow, state, { type: "start" }).state;
    state = runFlowEngine(flow, state, { type: "text", text: "30" }).state;
    assert.equal(state.status, "completed");
    assert.equal(state.currentNodeId, "true-end");
  });

  it("10. CONDITION false", () => {
    const flow = conditionFlow("all");
    let state = createFlowEngineState(flow);
    state = runFlowEngine(flow, state, { type: "start" }).state;
    state = runFlowEngine(flow, state, { type: "text", text: "10" }).state;
    assert.equal(state.status, "completed");
    assert.equal(state.currentNodeId, "false-end");
  });

  it("11. CONDITION match all", () => {
    assert.equal(validateQuestionValue({ kind: "number" }, "25", true).ok, true);
    const flow = conditionFlow("all");
    let state = createFlowEngineState(flow);
    state = runFlowEngine(flow, state, { type: "start" }).state;
    state = runFlowEngine(flow, state, { type: "text", text: "25" }).state;
    assert.equal(state.currentNodeId, "true-end");
  });

  it("12. CONDITION match any", () => {
    const flow: FlowDefinition = {
      name: "Any",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "cond",
          type: "condition",
          config: {
            match: "any",
            rules: [
              { field: "vip", operator: "equals", value: true },
              { field: "edad", operator: "greater_or_equal", value: 60 },
            ],
          },
        },
        { id: "true-end", type: "end", config: {} },
        { id: "false-end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "cond" },
        { id: "e2", source: "cond", target: "true-end", sourceHandle: "true" },
        { id: "e3", source: "cond", target: "false-end", sourceHandle: "false" },
      ],
      variables: [
        { key: "vip", label: "VIP", type: "boolean", defaultValue: true },
        { key: "edad", label: "Edad", type: "number", defaultValue: 20 },
      ],
    };
    const r = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" });
    assert.equal(r.state.currentNodeId, "true-end");
  });
});

describe("Flow Engine — acciones, IA, humano", () => {
  it("13. SAVE_DATA actualiza exports", () => {
    const flow: FlowDefinition = {
      name: "Save",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "save",
          type: "save_data",
          config: {
            mappings: [{ variable: "nombre", target: "lead" }],
          },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "save" },
        { id: "e2", source: "save", target: "end" },
      ],
      variables: [{ key: "nombre", label: "Nombre", type: "string", defaultValue: "Luis" }],
    };
    const r = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" });
    assert.deepEqual(r.state.exports.lead, { nombre: "Luis" });
    assert.equal(r.state.status, "completed");
  });

  it("14. ACTION produce EFFECT_REQUIRED", () => {
    const flow: FlowDefinition = {
      name: "Action",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "act",
          type: "action",
          config: { actionType: "crear_lead_enterprise", params: { fuente: "flow" } },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "act" },
        { id: "e2", source: "act", target: "end" },
      ],
      variables: [],
    };
    const r = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" });
    assert.equal(r.state.status, "waiting_effect");
    const fx = r.effects.find((e) => e.type === "effect_required");
    assert.ok(fx && fx.type === "effect_required" && fx.kind === "action");
  });

  it("15. AI produce solicitud de IA", () => {
    const flow: FlowDefinition = {
      name: "AI",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "ai",
          type: "ai",
          config: {
            instruction: "Clasifica intención",
            mode: "classify",
            classifications: ["venta", "soporte"],
          },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "ai" },
        { id: "e2", source: "ai", target: "end" },
      ],
      variables: [],
    };
    const r = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" });
    assert.equal(r.state.status, "waiting_effect");
    assert.ok(r.effects.some((e) => e.type === "effect_required" && e.kind === "ai"));
  });

  it("16. EFFECT_RESULT exitoso continúa", () => {
    const flow: FlowDefinition = {
      name: "Effect OK",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "act",
          type: "action",
          config: { actionType: "transferir_soporte" },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "act" },
        { id: "e2", source: "act", target: "end" },
      ],
      variables: [],
    };
    const state = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" }).state;
    const pending = state.pendingEffect!;
    const r = runFlowEngine(flow, state, {
      type: "effect_result",
      success: true,
      effectId: pending.effectId,
    });
    assert.equal(r.state.status, "completed");
  });

  it("17. EFFECT_RESULT fallido", () => {
    const flow: FlowDefinition = {
      name: "Effect fail",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "act",
          type: "action",
          config: { actionType: "webhook_http", url: "https://example.com/h" },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "act" },
        { id: "e2", source: "act", target: "end" },
      ],
      variables: [],
    };
    const state = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" }).state;
    const r = runFlowEngine(flow, state, {
      type: "effect_result",
      success: false,
      effectId: state.pendingEffect!.effectId,
      error: "HTTP 500",
    });
    assert.equal(r.state.status, "failed");
  });

  it("18. HUMAN transfiere", () => {
    const flow: FlowDefinition = {
      name: "Human",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "human",
          type: "human",
          config: { pauseDurationHours: 24, message: "Te transfiero" },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "human" }],
      variables: [],
    };
    const r = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" });
    assert.equal(r.state.status, "transferred");
    assert.ok(r.effects.some((e) => e.type === "transferred"));
  });

  it("19. END completa", () => {
    const flow = linearFlow();
    let state = createFlowEngineState(flow);
    state = runFlowEngine(flow, state, { type: "start" }).state;
    const r = runFlowEngine(flow, state, { type: "text", text: "Pepe" });
    assert.ok(r.effects.some((e) => e.type === "completed"));
  });
});

describe("Flow Engine — ciclos y límites", () => {
  it("20. ciclo controlado con question", () => {
    const flow: FlowDefinition = {
      name: "Loop OK",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "q",
          type: "question",
          config: {
            text: "Otra vez?",
            variableKey: "retry",
            required: true,
            validation: { kind: "text" },
          },
        },
        {
          id: "cond",
          type: "condition",
          config: {
            match: "all",
            rules: [{ field: "retry", operator: "equals", value: "si" }],
          },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "q" },
        { id: "e2", source: "q", target: "cond" },
        { id: "e3", source: "cond", target: "q", sourceHandle: "true" },
        { id: "e4", source: "cond", target: "end", sourceHandle: "false" },
      ],
      variables: [{ key: "retry", label: "Retry", type: "string" }],
    };
    let state = createFlowEngineState(flow);
    state = runFlowEngine(flow, state, { type: "start" }).state;
    state = runFlowEngine(flow, state, { type: "text", text: "si" }).state;
    assert.equal(state.status, "waiting_input");
    assert.equal(state.currentNodeId, "q");
  });

  it("21. ciclo automático excede límite de pasos", () => {
    const flow: FlowDefinition = {
      name: "Loop bad",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        { id: "m1", type: "message", config: { text: "A" } },
        {
          id: "cond",
          type: "condition",
          config: {
            match: "all",
            rules: [{ field: "flag", operator: "equals", value: true }],
          },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "m1" },
        { id: "e2", source: "m1", target: "cond" },
        { id: "e3", source: "cond", target: "m1", sourceHandle: "true" },
      ],
      variables: [{ key: "flag", label: "F", type: "boolean", defaultValue: true }],
    };
    const r = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" }, {
      maxAutoSteps: 8,
    });
    assert.equal(r.state.status, "failed");
    assert.ok(r.effects.some((e) => e.type === "failed" && e.code === FLOW_ENGINE_ERROR_CODES.MAX_STEPS_EXCEEDED));
  });

  it("22. límite de pasos configurable", () => {
    assert.equal(DEFAULT_MAX_AUTO_STEPS, 64);
  });
});

describe("Flow Engine — errores", () => {
  it("23. nodo inexistente en estado", () => {
    const flow = linearFlow();
    let state = createFlowEngineState(flow);
    state = runFlowEngine(flow, state, { type: "start" }).state;
    state.currentNodeId = "fantasma";
    state.status = "running";
    const r = runFlowEngine(flow, state, { type: "text", text: "x" });
    assert.equal(r.state.status, "failed");
  });

  it("24. edge inexistente vía resolveNextNodeId", () => {
    const flow = linearFlow();
    assert.equal(resolveNextNodeId(flow, "end", "true"), null);
  });

  it("25. variables persisten durante ejecución", () => {
    const flow = linearFlow();
    let state = createFlowEngineState(flow);
    state = runFlowEngine(flow, state, { type: "start" }).state;
    state = runFlowEngine(flow, state, { type: "text", text: "Carlos" }).state;
    assert.equal(state.variables.nombre, "Carlos");
  });
});

describe("Flow Engine — flujo completo", () => {
  it("START → MESSAGE → QUESTION → BUTTONS → CONDITION → ACTION → END", () => {
    const flow: FlowDefinition = {
      name: "Full",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "msg", type: "message", config: { text: "Bienvenido" } },
        {
          id: "q",
          type: "question",
          config: {
            text: "Edad?",
            variableKey: "edad",
            required: true,
            validation: { kind: "number" },
          },
        },
        {
          id: "btn",
          type: "buttons",
          config: {
            text: "¿Interesado?",
            buttons: [
              { id: "si", label: "Sí" },
              { id: "no", label: "No" },
            ],
          },
        },
        {
          id: "cond",
          type: "condition",
          config: {
            match: "all",
            rules: [{ field: "edad", operator: "greater_or_equal", value: 18 }],
          },
        },
        {
          id: "act",
          type: "action",
          config: { actionType: "crear_lead_enterprise" },
        },
        { id: "end", type: "end", config: { message: "Fin" } },
        { id: "skip-end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "msg" },
        { id: "e2", source: "msg", target: "q" },
        { id: "e3", source: "q", target: "btn" },
        { id: "e4", source: "btn", target: "cond", sourceHandle: FLOW_EDGE_HANDLE.button("si") },
        { id: "e5", source: "btn", target: "skip-end", sourceHandle: FLOW_EDGE_HANDLE.button("no") },
        { id: "e6", source: "cond", target: "act", sourceHandle: "true" },
        { id: "e7", source: "cond", target: "skip-end", sourceHandle: "false" },
        { id: "e8", source: "act", target: "end" },
      ],
      variables: [{ key: "edad", label: "Edad", type: "number" }],
    };

    let state = createFlowEngineState(flow, { executionId: "full-1" });
    state = runFlowEngine(flow, state, { type: "start" }).state;
    state = runFlowEngine(flow, state, { type: "text", text: "25" }).state;
    state = runFlowEngine(flow, state, { type: "button", id: "si" }).state;
    assert.equal(state.status, "waiting_effect");
    const fx = state.pendingEffect!;
    const done = runFlowEngine(flow, state, {
      type: "effect_result",
      success: true,
      effectId: fx.effectId,
    });
    assert.equal(done.state.status, "completed");
    assert.equal(done.state.currentNodeId, "end");
    assert.equal(done.state.variables.edad, 25);
  });
});
