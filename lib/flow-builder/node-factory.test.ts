/**
 * Etapa 3 (Flow Builder, autorizado) — tests de node-factory: los 10 tipos
 * producen config mínima válida según flowNodeSchema, e ids sin colisiones.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDefaultNode, generateUniqueId } from "@/lib/flow-builder/node-factory";
import { flowNodeSchema } from "@/lib/flow/schemas";
import type { FlowDefinition, FlowNodeType } from "@/lib/flow/types";

const TYPES: FlowNodeType[] = ["start", "message", "question", "buttons", "condition", "ai", "save_data", "action", "human", "end"];

function emptyFlow(): FlowDefinition {
  return { name: "fixture", nodes: [], edges: [], variables: [] };
}

describe("createDefaultNode — config mínima válida para los 10 tipos", () => {
  for (const type of TYPES) {
    it(`${type}: pasa flowNodeSchema`, () => {
      const node = createDefaultNode(type, { x: 10, y: 20 }, emptyFlow());
      assert.equal(node.type, type);
      const result = flowNodeSchema.safeParse(node);
      assert.equal(result.success, true, result.success ? undefined : JSON.stringify(result.error.issues));
    });
  }

  it("usa la posición exacta pedida (posición del drop)", () => {
    const node = createDefaultNode("message", { x: 123, y: 456 }, emptyFlow());
    assert.deepEqual(node.position, { x: 123, y: 456 });
  });

  it("cada tipo trae una etiqueta (label) legible por defecto", () => {
    for (const type of TYPES) {
      const node = createDefaultNode(type, { x: 0, y: 0 }, emptyFlow());
      assert.ok(node.label && node.label.length > 0, `falta label para ${type}`);
    }
  });
});

describe("createDefaultNode — ids sin colisiones", () => {
  it("no repite un id ya usado en el flow", () => {
    const flow: FlowDefinition = { ...emptyFlow(), nodes: [{ id: "x", type: "end", position: { x: 0, y: 0 }, config: {} }] };
    // se generan muchos seguidos para bajar (aún más) la probabilidad de que
    // esta prueba pase "por suerte" si algo rompiera la unicidad
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const node = createDefaultNode("message", { x: 0, y: 0 }, flow);
      assert.notEqual(node.id, "x");
      ids.add(node.id);
    }
    assert.equal(ids.size, 50); // todos distintos entre sí también
  });
});

describe("generateUniqueId — reintenta si la factory produce una colisión", () => {
  it("descarta ids ya usados y devuelve el primero libre", () => {
    let calls = 0;
    const factory = () => {
      calls++;
      return calls === 1 ? "ya-existe" : "libre";
    };
    const id = generateUniqueId(new Set(["ya-existe"]), factory);
    assert.equal(id, "libre");
    assert.equal(calls, 2);
  });

  it("sin colisión, devuelve el primer resultado de la factory", () => {
    const id = generateUniqueId(new Set(["otro"]), () => "nuevo");
    assert.equal(id, "nuevo");
  });
});
