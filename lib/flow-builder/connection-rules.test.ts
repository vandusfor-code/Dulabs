/**
 * Etapa 3 (Flow Builder, autorizado) — tests de isValidConnection y
 * orphanHandles. Fixture propio con un nodo de cada "familia" de handles
 * (buttons, condition, ai classify, ai success/failure, action, end, y un
 * nodo de salida única).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allOrphanHandles, isValidConnection, orphanHandles } from "@/lib/flow-builder/connection-rules";
import type { FlowDefinition } from "@/lib/flow/types";

function fixture(): FlowDefinition {
  return {
    name: "fixture",
    nodes: [
      { id: "start", type: "start", position: { x: 0, y: 0 }, config: { triggerType: "manual" } },
      { id: "msg-1", type: "message", position: { x: 0, y: 0 }, config: { text: "hola" } },
      {
        id: "bt-1",
        type: "buttons",
        position: { x: 0, y: 0 },
        config: { text: "elige", buttons: [{ id: "si", label: "Sí" }, { id: "no", label: "No" }] },
      },
      { id: "cond-1", type: "condition", position: { x: 0, y: 0 }, config: { rules: [{ field: "x", operator: "exists" }], match: "all" } },
      { id: "ai-classify", type: "ai", position: { x: 0, y: 0 }, config: { instruction: "x", mode: "classify", classifications: ["a", "b"] } },
      { id: "ai-respond", type: "ai", position: { x: 0, y: 0 }, config: { instruction: "x", mode: "respond" } },
      { id: "act-1", type: "action", position: { x: 0, y: 0 }, config: { actionType: "crear_lead_enterprise" } },
      { id: "end-1", type: "end", position: { x: 0, y: 0 }, config: {} },
      { id: "human-1", type: "human", position: { x: 0, y: 0 }, config: { pauseDurationHours: 1 } },
    ],
    edges: [{ id: "e-existente", source: "bt-1", target: "cond-1", sourceHandle: "button:si" }],
    variables: [],
  };
}

describe("isValidConnection — buttons", () => {
  it("acepta button:{id} real", () => {
    assert.equal(isValidConnection(fixture(), { source: "bt-1", target: "msg-1", sourceHandle: "button:no" }), true);
  });
  it("acepta el handle 'text' (fallback de lenguaje natural)", () => {
    assert.equal(isValidConnection(fixture(), { source: "bt-1", target: "msg-1", sourceHandle: "text" }), true);
  });
  it("rechaza un button:{id} que no existe en ese nodo", () => {
    assert.equal(isValidConnection(fixture(), { source: "bt-1", target: "msg-1", sourceHandle: "button:no-existe" }), false);
  });
  it("rechaza sourceHandle ausente en un nodo buttons", () => {
    assert.equal(isValidConnection(fixture(), { source: "bt-1", target: "msg-1" }), false);
  });
});

describe("isValidConnection — condition", () => {
  it("acepta true", () => {
    assert.equal(isValidConnection(fixture(), { source: "cond-1", target: "msg-1", sourceHandle: "true" }), true);
  });
  it("acepta false", () => {
    assert.equal(isValidConnection(fixture(), { source: "cond-1", target: "msg-1", sourceHandle: "false" }), true);
  });
  it("rechaza cualquier otro handle", () => {
    assert.equal(isValidConnection(fixture(), { source: "cond-1", target: "msg-1", sourceHandle: "maybe" }), false);
  });
});

describe("isValidConnection — ai.classify", () => {
  it("acepta class:{valor} declarado", () => {
    assert.equal(isValidConnection(fixture(), { source: "ai-classify", target: "msg-1", sourceHandle: "class:a" }), true);
  });
  it("acepta default", () => {
    assert.equal(isValidConnection(fixture(), { source: "ai-classify", target: "msg-1", sourceHandle: "default" }), true);
  });
  it("rechaza una clasificación no declarada", () => {
    assert.equal(isValidConnection(fixture(), { source: "ai-classify", target: "msg-1", sourceHandle: "class:c" }), false);
  });
});

describe("isValidConnection — ai (modos que no son classify)", () => {
  it("acepta success", () => {
    assert.equal(isValidConnection(fixture(), { source: "ai-respond", target: "msg-1", sourceHandle: "success" }), true);
  });
  it("acepta failure", () => {
    assert.equal(isValidConnection(fixture(), { source: "ai-respond", target: "msg-1", sourceHandle: "failure" }), true);
  });
  it("rechaza class:{valor} en modo no-classify", () => {
    assert.equal(isValidConnection(fixture(), { source: "ai-respond", target: "msg-1", sourceHandle: "class:a" }), false);
  });
});

describe("isValidConnection — action", () => {
  it("acepta success/failure", () => {
    assert.equal(isValidConnection(fixture(), { source: "act-1", target: "msg-1", sourceHandle: "success" }), true);
    assert.equal(isValidConnection(fixture(), { source: "act-1", target: "msg-1", sourceHandle: "failure" }), true);
  });
  it("rechaza cualquier otro handle", () => {
    assert.equal(isValidConnection(fixture(), { source: "act-1", target: "msg-1", sourceHandle: "true" }), false);
  });
});

describe("isValidConnection — end sin salida", () => {
  it("rechaza cualquier conexión con end como origen", () => {
    assert.equal(isValidConnection(fixture(), { source: "end-1", target: "msg-1" }), false);
    assert.equal(isValidConnection(fixture(), { source: "end-1", target: "msg-1", sourceHandle: "default" }), false);
  });
});

describe("isValidConnection — nodos de salida única/implícita (message, human, start...)", () => {
  it("acepta sin sourceHandle", () => {
    assert.equal(isValidConnection(fixture(), { source: "msg-1", target: "human-1" }), true);
    assert.equal(isValidConnection(fixture(), { source: "start", target: "msg-1" }), true);
  });
  it("rechaza si trae un sourceHandle con nombre (no existe ninguno real)", () => {
    assert.equal(isValidConnection(fixture(), { source: "msg-1", target: "human-1", sourceHandle: "success" }), false);
  });
});

describe("isValidConnection — nodos inexistentes", () => {
  it("rechaza source inexistente", () => {
    assert.equal(isValidConnection(fixture(), { source: "no-existe", target: "msg-1" }), false);
  });
  it("rechaza target inexistente", () => {
    assert.equal(isValidConnection(fixture(), { source: "msg-1", target: "no-existe" }), false);
  });
});

describe("isValidConnection — no duplica edges", () => {
  it("rechaza una conexión idéntica (mismo source+sourceHandle+target) a una ya existente", () => {
    assert.equal(isValidConnection(fixture(), { source: "bt-1", target: "cond-1", sourceHandle: "button:si" }), false);
  });
  it("acepta la misma pareja source/target con un sourceHandle distinto", () => {
    assert.equal(isValidConnection(fixture(), { source: "bt-1", target: "cond-1", sourceHandle: "button:no" }), true);
  });
});

describe("orphanHandles", () => {
  it("un nodo buttons con un botón sin edge lo reporta", () => {
    const flow = fixture(); // bt-1 tiene edge para button:si, ninguno para button:no
    const missing = orphanHandles(flow.nodes.find((n) => n.id === "bt-1")!, flow);
    assert.deepEqual(missing.map((h) => h.id).sort(), ["button:no", "text"]);
  });

  it("vacío cuando todos los handles tienen edge", () => {
    let flow = fixture();
    flow = { ...flow, edges: [...flow.edges, { id: "e2", source: "bt-1", target: "msg-1", sourceHandle: "button:no" }, { id: "e3", source: "bt-1", target: "msg-1", sourceHandle: "text" }] };
    const missing = orphanHandles(flow.nodes.find((n) => n.id === "bt-1")!, flow);
    assert.deepEqual(missing, []);
  });

  it("vacío para nodos sin handles con nombre (message, human...)", () => {
    const flow = fixture();
    const missing = orphanHandles(flow.nodes.find((n) => n.id === "msg-1")!, flow);
    assert.deepEqual(missing, []);
  });

  it("vacío para end (sin salida)", () => {
    const flow = fixture();
    const missing = orphanHandles(flow.nodes.find((n) => n.id === "end-1")!, flow);
    assert.deepEqual(missing, []);
  });
});

describe("allOrphanHandles — Professional Editor UX (autorizado)", () => {
  it("recorre TODO el flow y reporta los handles huérfanos de cada nodo, con su nodeId", () => {
    const flow = fixture(); // bt-1 tiene edge para button:si, ninguno para button:no/text
    const warnings = allOrphanHandles(flow);
    const deBt1 = warnings.filter((w) => w.nodeId === "bt-1");
    assert.deepEqual(
      deBt1.map((w) => w.handleId).sort(),
      ["button:no", "text"],
    );
  });

  it("vacío cuando ningún nodo tiene handles huérfanos", () => {
    let flow = fixture();
    flow = {
      ...flow,
      edges: [
        ...flow.edges,
        { id: "e2", source: "bt-1", target: "msg-1", sourceHandle: "button:no" },
        { id: "e3", source: "bt-1", target: "msg-1", sourceHandle: "text" },
      ],
    };
    // Cubre solo bt-1 -- el resto de nodos con handles del fixture (condition/ai/action) pueden
    // seguir teniendo huérfanos propios; se filtra explícitamente para probar SOLO lo que se acaba de cerrar.
    const warnings = allOrphanHandles(flow).filter((w) => w.nodeId === "bt-1");
    assert.deepEqual(warnings, []);
  });

  it("nunca lanza y devuelve [] para un flow sin ningún nodo con handles nombrados", () => {
    const flow: FlowDefinition = {
      name: "solo mensajes",
      nodes: [
        { id: "start", type: "start", position: { x: 0, y: 0 }, config: { triggerType: "manual" } },
        { id: "msg-1", type: "message", position: { x: 0, y: 0 }, config: { text: "hola" } },
      ],
      edges: [{ id: "e1", source: "start", target: "msg-1" }],
      variables: [],
    };
    assert.deepEqual(allOrphanHandles(flow), []);
  });
});
