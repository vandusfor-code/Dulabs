/**
 * Etapa 2 (Flow Builder, autorizado) — tests de validación usando el schema
 * Zod real (flowNodeSchema), sin reglas paralelas inventadas.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorsForPath, validateNodeEdit } from "@/lib/flow-builder/validate-node-edit";
import { updateNodeConfig } from "@/lib/flow-builder/edit-flow";
import type { FlowDefinition, FlowNode } from "@/lib/flow/types";

describe("validateNodeEdit", () => {
  it("nodo válido -> sin errores", () => {
    const node: FlowNode = { id: "msg-1", type: "message", config: { text: "hola" } };
    assert.deepEqual(validateNodeEdit(node), []);
  });

  it("18. config inválida (question sin texto) -> reporta error pero NO rompe el FlowDefinition", () => {
    const flow: FlowDefinition = {
      name: "fixture",
      nodes: [{ id: "q-1", type: "question", config: { text: "", variableKey: "x", required: true, validation: { kind: "text" } } }],
      edges: [],
      variables: [],
    };
    // updateNodeConfig sigue funcionando aunque el valor sea inválido -- el
    // FlowDefinition local se sigue actualizando (para que el usuario vea lo
    // que escribió), la invalidez se reporta aparte.
    const result = updateNodeConfig(flow, "q-1", { text: "", variableKey: "x", required: true, validation: { kind: "text" } });
    assert.equal(result.nodes.length, 1);
    assert.equal(result.nodes[0].id, "q-1");

    const errors = validateNodeEdit(result.nodes[0]);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.path.startsWith("config.text")));
  });

  it("condition con operador equals sin value -> error en config.rules.0.value", () => {
    const node: FlowNode = {
      id: "cond-1",
      type: "condition",
      config: { rules: [{ field: "x", operator: "equals" }], match: "all" },
    };
    const errors = validateNodeEdit(node);
    assert.ok(errors.some((e) => e.path === "config.rules.0.value"));
  });

  it("errorsForPath filtra solo los errores de ese campo o sus hijos", () => {
    const errors = [
      { path: "config.text", message: "a" },
      { path: "config.rules.0.value", message: "b" },
      { path: "config.rules", message: "c" },
    ];
    assert.equal(errorsForPath(errors, "config.text").length, 1);
    assert.equal(errorsForPath(errors, "config.rules").length, 2);
    assert.equal(errorsForPath(errors, "config").length, 3);
  });
});
