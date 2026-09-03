import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { searchNodes } from "@/lib/flow-builder/search-nodes";
import type { FlowDefinition } from "@/lib/flow/types";

function fixture(): FlowDefinition {
  return {
    name: "fixture",
    nodes: [
      { id: "start", type: "start", position: { x: 0, y: 0 }, config: { triggerType: "first_message" } },
      { id: "msg-bienvenida", label: "Saludo inicial", type: "message", position: { x: 100, y: 0 }, config: { text: "¡Hola! Bienvenido a DuLabs", messageRole: "informational" } },
      { id: "q-nombre", label: "Preguntar nombre", type: "question", position: { x: 200, y: 0 }, config: { text: "¿Cómo te llamas?", variableKey: "nombreCliente", required: true, validation: { kind: "text" } } },
      { id: "cond-vip", type: "condition", position: { x: 300, y: 0 }, config: { rules: [{ field: "plan", operator: "equals", value: "vip" }], match: "all" } },
      { id: "end-1", type: "end", position: { x: 400, y: 0 }, config: {} },
    ],
    edges: [],
    variables: [],
  };
}

describe("searchNodes", () => {
  it("cadena vacía o solo espacios devuelve []", () => {
    const flow = fixture();
    assert.deepEqual(searchNodes(flow, ""), []);
    assert.deepEqual(searchNodes(flow, "   "), []);
  });

  it("busca por label", () => {
    const flow = fixture();
    const result = searchNodes(flow, "saludo");
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, "msg-bienvenida");
  });

  it("busca por id", () => {
    const flow = fixture();
    const result = searchNodes(flow, "q-nombre");
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, "q-nombre");
  });

  it("busca por tipo en español (igual que lo ve el usuario en la paleta)", () => {
    const flow = fixture();
    const result = searchNodes(flow, "condición");
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, "cond-vip");
  });

  it("busca dentro del contenido de la config (texto del mensaje, valor de una regla, variable)", () => {
    const flow = fixture();
    assert.equal(searchNodes(flow, "dulabs").length, 1, "texto del mensaje");
    assert.equal(searchNodes(flow, "vip").length, 1, "value de una regla de condición");
    assert.equal(searchNodes(flow, "nombreCliente").length, 1, "variableKey de la pregunta");
  });

  it("es insensible a mayúsculas", () => {
    const flow = fixture();
    assert.equal(searchNodes(flow, "SALUDO").length, 1);
    assert.equal(searchNodes(flow, "BienVenido").length, 1);
  });

  it("sin coincidencias devuelve array vacío, nunca lanza", () => {
    const flow = fixture();
    assert.deepEqual(searchNodes(flow, "xyz-no-existe"), []);
  });

  it("mantiene el orden estable de flow.nodes", () => {
    const flow = fixture();
    const result = searchNodes(flow, "e"); // matches several
    const ids = result.map((n) => n.id);
    const expectedOrder = flow.nodes.filter((n) => ids.includes(n.id)).map((n) => n.id);
    assert.deepEqual(ids, expectedOrder);
  });
});
