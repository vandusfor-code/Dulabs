import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { copySelection, duplicateSelection, pasteIntoFlow } from "@/lib/flow-builder/clipboard";
import type { FlowDefinition } from "@/lib/flow/types";

function fixture(): FlowDefinition {
  return {
    name: "fixture",
    nodes: [
      { id: "start", type: "start", position: { x: 0, y: 0 }, config: { triggerType: "first_message" } },
      { id: "msg-1", type: "message", position: { x: 100, y: 0 }, config: { text: "hola", messageRole: "informational" } },
      { id: "msg-2", type: "message", position: { x: 200, y: 0 }, config: { text: "chao", messageRole: "informational" } },
      { id: "end-1", type: "end", position: { x: 300, y: 0 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "msg-1" },
      { id: "e2", source: "msg-1", target: "msg-2" },
      { id: "e3", source: "msg-2", target: "end-1" },
    ],
    variables: [],
  };
}

describe("clipboard — copySelection", () => {
  it("copia solo los nodos pedidos y sus edges INTERNOS (ambos extremos en la selección)", () => {
    const flow = fixture();
    const payload = copySelection(flow, new Set(["msg-1", "msg-2"]));
    assert.equal(payload.nodes.length, 2);
    assert.deepEqual(
      payload.nodes.map((n) => n.id).sort(),
      ["msg-1", "msg-2"],
    );
    assert.equal(payload.edges.length, 1, "solo e2 (msg-1 -> msg-2) tiene AMBOS extremos en la selección");
    assert.equal(payload.edges[0]!.id, "e2");
  });

  it("excluye siempre el nodo start -- nunca se puede copiar (rompería MULTIPLE_START_NODES al pegar)", () => {
    const flow = fixture();
    const payload = copySelection(flow, new Set(["start", "msg-1"]));
    assert.equal(payload.nodes.length, 1);
    assert.equal(payload.nodes[0]!.id, "msg-1");
  });

  it("nunca muta el flow original", () => {
    const flow = fixture();
    const before = JSON.stringify(flow);
    copySelection(flow, new Set(["msg-1"]));
    assert.equal(JSON.stringify(flow), before);
  });
});

describe("clipboard — pasteIntoFlow", () => {
  it("genera IDs completamente nuevos para nodos y edges -- nunca reutiliza los del payload", () => {
    const flow = fixture();
    const payload = copySelection(flow, new Set(["msg-1", "msg-2"]));
    const { flow: pasted, newNodeIds } = pasteIntoFlow(flow, payload);
    assert.equal(pasted.nodes.length, flow.nodes.length + 2);
    assert.equal(newNodeIds.length, 2);
    for (const id of newNodeIds) {
      assert.equal(flow.nodes.some((n) => n.id === id), false, "el nuevo id no debe coincidir con ningún id original");
    }
    const newEdge = pasted.edges.find((e) => !flow.edges.some((orig) => orig.id === e.id));
    assert.ok(newEdge, "el edge interno también debe llegar con un id nuevo");
    assert.ok(newNodeIds.includes(newEdge!.source));
    assert.ok(newNodeIds.includes(newEdge!.target));
  });

  it("preserva la config y desplaza la posición -- nunca pega encima del original", () => {
    const flow = fixture();
    const payload = copySelection(flow, new Set(["msg-1"]));
    const { flow: pasted, newNodeIds } = pasteIntoFlow(flow, payload, { x: 50, y: 50 });
    const pastedNode = pasted.nodes.find((n) => n.id === newNodeIds[0]);
    assert.ok(pastedNode && pastedNode.type === "message");
    if (pastedNode?.type === "message") assert.equal(pastedNode.config.text, "hola");
    assert.deepEqual(pastedNode?.position, { x: 150, y: 50 });
  });

  it("nunca muta el flow original ni el payload", () => {
    const flow = fixture();
    const payload = copySelection(flow, new Set(["msg-1"]));
    const flowBefore = JSON.stringify(flow);
    const payloadBefore = JSON.stringify(payload);
    pasteIntoFlow(flow, payload);
    assert.equal(JSON.stringify(flow), flowBefore);
    assert.equal(JSON.stringify(payload), payloadBefore);
  });

  it("payload vacío (solo se seleccionó start) no agrega nada", () => {
    const flow = fixture();
    const payload = copySelection(flow, new Set(["start"]));
    const { flow: pasted, newNodeIds } = pasteIntoFlow(flow, payload);
    assert.equal(newNodeIds.length, 0);
    assert.equal(pasted, flow);
  });

  it("pegar dos veces seguidas produce IDs distintos entre sí (nunca colisiona)", () => {
    const flow = fixture();
    const payload = copySelection(flow, new Set(["msg-1"]));
    const first = pasteIntoFlow(flow, payload);
    const second = pasteIntoFlow(first.flow, payload);
    assert.notEqual(first.newNodeIds[0], second.newNodeIds[0]);
  });
});

describe("clipboard — duplicateSelection", () => {
  it("duplica un grupo preservando los edges internos entre los nodos duplicados", () => {
    const flow = fixture();
    const { flow: result, newNodeIds } = duplicateSelection(flow, new Set(["msg-1", "msg-2"]));
    assert.equal(newNodeIds.length, 2);
    const internalEdge = result.edges.find((e) => newNodeIds.includes(e.source) && newNodeIds.includes(e.target));
    assert.ok(internalEdge, "el edge msg-1 -> msg-2 debe existir también entre las copias");
  });

  it("nunca modifica los nodos/edges originales al duplicar", () => {
    const flow = fixture();
    const originalNodeCount = flow.nodes.length;
    const originalEdgeCount = flow.edges.length;
    duplicateSelection(flow, new Set(["msg-1", "msg-2"]));
    assert.equal(flow.nodes.length, originalNodeCount);
    assert.equal(flow.edges.length, originalEdgeCount);
  });

  it("duplicar un solo nodo sin conexiones internas no agrega ningún edge", () => {
    const flow = fixture();
    const { flow: result, newNodeIds } = duplicateSelection(flow, new Set(["msg-1"]));
    assert.equal(result.edges.length, flow.edges.length, "ningún edge nuevo -- msg-1 solo no tiene edges internos a sí mismo");
    assert.equal(newNodeIds.length, 1);
  });
});
