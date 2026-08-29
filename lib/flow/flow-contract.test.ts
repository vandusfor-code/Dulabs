/**
 * Tests del contrato Flow Builder (Fase 0).
 * Ejecutar: npm run test:flow
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FLOW_VALIDATION_CODES, FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import { safeParseFlowDefinition } from "@/lib/flow/schemas";
import type { FlowDefinition } from "@/lib/flow/types";
import { validateFlowGraph } from "@/lib/flow/validate-graph";
import { validateFlowForPublish, validateFlowDefinitionInput } from "@/lib/flow/validate-publish";

function baseValidFlow(): FlowDefinition {
  return {
    name: "Flow de prueba",
    tenantId: "11111111-1111-4111-8111-111111111111",
    nodes: [
      {
        id: "start-1",
        type: "start",
        config: { triggerType: "first_message" },
      },
      {
        id: "msg-1",
        type: "message",
        config: { text: "Hola, ¿en qué te ayudo?" },
      },
      {
        id: "q-1",
        type: "question",
        config: {
          text: "¿Cuál es tu nombre?",
          variableKey: "nombre",
          required: true,
          validation: { kind: "text" },
        },
      },
      {
        id: "end-1",
        type: "end",
        config: { message: "Gracias" },
      },
    ],
    edges: [
      { id: "e1", source: "start-1", target: "msg-1" },
      { id: "e2", source: "msg-1", target: "q-1" },
      { id: "e3", source: "q-1", target: "end-1" },
    ],
    variables: [{ key: "nombre", label: "Nombre", type: "string", required: true }],
  };
}

describe("Flow contract — schema", () => {
  it("1. acepta un flow válido", () => {
    const flow = baseValidFlow();
    const parsed = safeParseFlowDefinition(flow);
    assert.equal(parsed.success, true);
    const graph = validateFlowGraph(flow);
    assert.equal(graph.valid, true, graph.errors.map((e) => e.message).join("; "));
  });

  it("2. rechaza nodo message sin contenido", () => {
    const flow = baseValidFlow();
    flow.nodes[1] = { id: "msg-1", type: "message", config: {} };
    const parsed = safeParseFlowDefinition(flow);
    assert.equal(parsed.success, false);
  });

  it("3. rechaza edge a nodo inexistente", () => {
    const flow = baseValidFlow();
    flow.edges.push({ id: "bad", source: "q-1", target: "ghost" });
    const result = validateFlowGraph(flow);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === FLOW_VALIDATION_CODES.EDGE_TARGET_NOT_FOUND));
  });
});

describe("Flow contract — grafo", () => {
  it("4. rechaza dos nodos start", () => {
    const flow = baseValidFlow();
    flow.nodes.push({
      id: "start-2",
      type: "start",
      config: { triggerType: "manual" },
    });
    const result = validateFlowGraph(flow);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === FLOW_VALIDATION_CODES.MULTIPLE_START_NODES));
  });

  it("5. rechaza flow sin start", () => {
    const flow = baseValidFlow();
    flow.nodes = flow.nodes.filter((n) => n.type !== "start");
    flow.edges = flow.edges.filter((e) => e.source !== "start-1");
    const result = validateFlowGraph(flow);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === FLOW_VALIDATION_CODES.MISSING_START_NODE));
  });

  it("6. rechaza IDs de nodo duplicados", () => {
    const flow = baseValidFlow();
    flow.nodes.push({
      id: "msg-1",
      type: "message",
      config: { text: "Duplicado" },
    });
    const result = validateFlowGraph(flow);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === FLOW_VALIDATION_CODES.DUPLICATE_NODE_ID));
  });

  it("7. rechaza botón sin transición", () => {
    const flow = baseValidFlow();
    flow.nodes.splice(2, 0, {
      id: "btn-1",
      type: "buttons",
      config: {
        text: "Elige",
        buttons: [
          { id: "si", label: "Sí" },
          { id: "no", label: "No" },
        ],
      },
    });
    flow.edges = [
      { id: "e1", source: "start-1", target: "msg-1" },
      { id: "e2", source: "msg-1", target: "btn-1" },
      { id: "e3", source: "btn-1", target: "q-1", sourceHandle: FLOW_EDGE_HANDLE.button("si") },
      // falta edge para "no"
      { id: "e4", source: "q-1", target: "end-1" },
    ];
    const result = validateFlowGraph(flow);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === FLOW_VALIDATION_CODES.BUTTON_MISSING_EDGE));
  });

  it("8. rechaza condition sin ramas true/false", () => {
    const flow = baseValidFlow();
    flow.variables.push({ key: "edad", label: "Edad", type: "number" });
    flow.nodes.splice(2, 0, {
      id: "cond-1",
      type: "condition",
      config: {
        match: "all",
        rules: [{ field: "edad", operator: "greater_or_equal", value: 18 }],
      },
    });
    flow.edges = [
      { id: "e1", source: "start-1", target: "msg-1" },
      { id: "e2", source: "msg-1", target: "cond-1" },
      { id: "e3", source: "cond-1", target: "q-1", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      // falta false
      { id: "e4", source: "q-1", target: "end-1" },
    ];
    const result = validateFlowGraph(flow);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === FLOW_VALIDATION_CODES.CONDITION_MISSING_BRANCH));
  });

  it("9. rechaza variable inexistente en condición", () => {
    const flow = baseValidFlow();
    flow.nodes.splice(2, 0, {
      id: "cond-1",
      type: "condition",
      config: {
        match: "any",
        rules: [{ field: "desconocida", operator: "exists" }],
      },
    });
    flow.edges = [
      { id: "e1", source: "start-1", target: "msg-1" },
      { id: "e2", source: "msg-1", target: "cond-1" },
      {
        id: "e3",
        source: "cond-1",
        target: "q-1",
        sourceHandle: FLOW_EDGE_HANDLE.conditionTrue,
      },
      {
        id: "e4",
        source: "cond-1",
        target: "end-1",
        sourceHandle: FLOW_EDGE_HANDLE.conditionFalse,
      },
      { id: "e5", source: "q-1", target: "end-1" },
    ];
    const result = validateFlowGraph(flow);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === FLOW_VALIDATION_CODES.UNDEFINED_VARIABLE));
  });

  it("10. rechaza ciclo automático peligroso", () => {
    const flow = baseValidFlow();
    flow.edges.push({ id: "loop", source: "msg-1", target: "msg-1" });
    const result = validateFlowGraph(flow);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === FLOW_VALIDATION_CODES.DANGEROUS_CYCLE));
  });
});

describe("Flow contract — publicación", () => {
  it("11. flow publicable pasa validateFlowForPublish", () => {
    const flow = baseValidFlow();
    const result = validateFlowForPublish(flow);
    assert.equal(result.valid, true, result.errors.map((e) => e.message).join("; "));
  });

  it("12. flow sin end no es publicable", () => {
    const flow = baseValidFlow();
    flow.nodes = flow.nodes.filter((n) => n.type !== "end");
    flow.edges = flow.edges.filter((e) => e.target !== "end-1");
    const inputResult = validateFlowDefinitionInput(flow);
    assert.equal(inputResult.valid, true);
    const publishResult = validateFlowForPublish(flow);
    assert.equal(publishResult.valid, false);
    assert.ok(
      publishResult.errors.some(
        (e) =>
          e.code === FLOW_VALIDATION_CODES.MISSING_END_NODE ||
          e.code === FLOW_VALIDATION_CODES.NO_PATH_TO_END,
      ),
    );
  });
});

describe("Flow contract — nodos específicos", () => {
  it("acepta message con parts (multi-burbuja)", () => {
    const flow = baseValidFlow();
    flow.nodes[1] = {
      id: "msg-1",
      type: "message",
      config: { parts: ["Primera burbuja", "Segunda burbuja"] },
    };
    const parsed = safeParseFlowDefinition(flow);
    assert.equal(parsed.success, true);
  });

  it("acepta action webhook_http en schema (sin ejecutar)", () => {
    const flow = baseValidFlow();
    flow.nodes.splice(3, 0, {
      id: "act-1",
      type: "action",
      config: {
        actionType: "webhook_http",
        url: "https://example.com/hook",
        method: "POST",
        bodyVariableKeys: ["nombre"],
      },
    });
    flow.edges.splice(2, 0, { id: "e-act", source: "q-1", target: "act-1" });
    flow.edges.find((e) => e.id === "e3")!.source = "act-1";
    const parsed = safeParseFlowDefinition(flow);
    assert.equal(parsed.success, true);
  });
});
