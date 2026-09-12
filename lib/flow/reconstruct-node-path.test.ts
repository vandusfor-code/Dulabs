/**
 * Tests de `reconstructNodePath` — módulo puro compartido entre el Simulador
 * (Fase 1) y el Execution Inspector (Fase 2). Cobertura directa además de la
 * que ya lo ejercita indirectamente lib/flow/simulate-flow.test.ts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FlowDefinition, FlowNode } from "@/lib/flow/types";
import { reconstructNodePath } from "@/lib/flow/reconstruct-node-path";

function flowWithCondition(): FlowDefinition {
  return {
    name: "test",
    nodes: [
      { id: "q", type: "question", config: { text: "?", variableKey: "x", required: true, validation: { kind: "text" } } },
      { id: "save", type: "save_data", config: { mappings: [] } },
      { id: "cond", type: "condition", config: { rules: [{ field: "x", operator: "equals", value: "y" }], match: "all" } },
      { id: "msgTrue", type: "message", config: { text: "true" } },
      { id: "msgFalse", type: "message", config: { text: "false" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "q", target: "save" },
      { id: "e2", source: "save", target: "cond" },
      { id: "e3", source: "cond", target: "msgTrue", sourceHandle: "true" },
      { id: "e4", source: "cond", target: "msgFalse", sourceHandle: "false" },
      { id: "e5", source: "msgTrue", target: "end" },
      { id: "e6", source: "msgFalse", target: "end" },
    ],
    variables: [],
  };
}

function nodeMap(flow: FlowDefinition): Map<string, FlowNode> {
  return new Map(flow.nodes.map((n) => [n.id, n]));
}

describe("reconstructNodePath", () => {
  it("mismo nodo -> camino vacío, no ambiguo", () => {
    const flow = flowWithCondition();
    const r = reconstructNodePath(flow, nodeMap(flow), "q", "q");
    assert.deepEqual(r, { hops: [], ambiguous: false });
  });

  it("camino único a través de save_data + condition (rama TRUE) -- deduce la rama del edge, no evalúa la regla", () => {
    const flow = flowWithCondition();
    const r = reconstructNodePath(flow, nodeMap(flow), "q", "msgTrue");
    assert.equal(r.ambiguous, false);
    assert.deepEqual(
      r.hops.map((h) => h.toNodeId),
      ["save", "cond", "msgTrue"],
    );
    assert.equal(r.hops[2]!.sourceHandle, "true");
  });

  it("camino único a través de la rama FALSE", () => {
    const flow = flowWithCondition();
    const r = reconstructNodePath(flow, nodeMap(flow), "q", "msgFalse");
    assert.equal(r.ambiguous, false);
    assert.deepEqual(
      r.hops.map((h) => h.toNodeId),
      ["save", "cond", "msgFalse"],
    );
    assert.equal(r.hops[2]!.sourceHandle, "false");
  });

  it("ambos caminos llegan al MISMO destino (end) -- ambiguo, nunca se adivina cuál rama", () => {
    const flow = flowWithCondition();
    const r = reconstructNodePath(flow, nodeMap(flow), "q", "end");
    assert.equal(r.ambiguous, true);
    assert.equal(r.hops.length, 1);
    assert.equal(r.hops[0]!.toNodeId, "end");
  });

  it("sin camino posible entre nodos silenciosos -> fallback defensivo marcado ambiguo, nunca lanza", () => {
    const flow: FlowDefinition = {
      name: "roto",
      nodes: [
        { id: "a", type: "message", config: { text: "a" } },
        { id: "b", type: "message", config: { text: "b" } },
      ],
      edges: [],
      variables: [],
    };
    const r = reconstructNodePath(flow, nodeMap(flow), "a", "b");
    assert.equal(r.ambiguous, true);
  });

  it("nunca sigue nodos NO silenciosos como intermedios (ej. un 'question' en medio no se atraviesa)", () => {
    const flow: FlowDefinition = {
      name: "con-pregunta-en-medio",
      nodes: [
        { id: "a", type: "message", config: { text: "a" } },
        { id: "q", type: "question", config: { text: "?", variableKey: "x", required: true, validation: { kind: "text" } } },
        { id: "b", type: "message", config: { text: "b" } },
      ],
      edges: [
        { id: "e1", source: "a", target: "q" },
        { id: "e2", source: "q", target: "b" },
      ],
      variables: [],
    };
    // "a" -> "b" NO es alcanzable saltándose "q" (question no es silencioso) -- debe marcar ambiguo/fallback, nunca inventar un camino que pase por un nodo que pausa.
    const r = reconstructNodePath(flow, nodeMap(flow), "a", "b");
    assert.equal(r.ambiguous, true);
  });
});
