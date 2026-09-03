/**
 * Etapa 4 (Flow Builder, autorizado) — tests de validation-markers. Fixture
 * de errores cubre exactamente los casos reales de FlowValidationError
 * (lib/flow/errors.ts): con nodeId, con edgeId, con ambos (no debería darse
 * en la práctica pero el filtro debe seguir siendo correcto igual), y sin
 * ninguno -- incluyendo el caso real de SCHEMA_INVALID (solo `path`, nunca
 * nodeId) para probar que se trata como global y NUNCA se intenta ubicar en
 * un nodo parseando ese path.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorsForEdge, errorsForNode, globalErrors } from "@/lib/flow-builder/validation-markers";
import type { FlowValidationError } from "@/lib/flow/errors";

const ERRORS: FlowValidationError[] = [
  { code: "BUTTON_MISSING_EDGE", message: "Botón sin edge", nodeId: "bt-1" },
  { code: "AI_MISSING_BRANCH", message: "Clasificación sin edge", nodeId: "ai-1" },
  { code: "DUPLICATE_EDGE", message: "Edge duplicado", nodeId: "bt-1", edgeId: "e-3" },
  { code: "MISSING_START_NODE", message: "El flow debe tener un nodo start" },
  { code: "NO_PATH_TO_END", message: "No existe camino desde start hasta un nodo end" },
  // Caso real: SCHEMA_INVALID de Zod solo trae `path`, NUNCA nodeId -- ver
  // schemaToValidationResult en lib/flow/validate-publish.ts.
  { code: "SCHEMA_INVALID", message: "Required", path: "nodes.3.config.text" },
];

describe("errorsForNode", () => {
  it("devuelve solo los errores de ESE nodeId", () => {
    const result = errorsForNode(ERRORS, "bt-1");
    assert.equal(result.length, 2);
    assert.ok(result.every((e) => e.nodeId === "bt-1"));
  });

  it("un nodeId sin errores -> array vacío", () => {
    assert.deepEqual(errorsForNode(ERRORS, "cond-1"), []);
  });

  it("no incluye errores globales ni de otro nodo", () => {
    const result = errorsForNode(ERRORS, "ai-1");
    assert.equal(result.length, 1);
    assert.equal(result[0]!.code, "AI_MISSING_BRANCH");
  });
});

describe("errorsForEdge", () => {
  it("devuelve solo los errores de ESE edgeId", () => {
    const result = errorsForEdge(ERRORS, "e-3");
    assert.equal(result.length, 1);
    assert.equal(result[0]!.code, "DUPLICATE_EDGE");
  });

  it("un edgeId sin errores -> array vacío", () => {
    assert.deepEqual(errorsForEdge(ERRORS, "e-999"), []);
  });

  it("un error con nodeId pero sin edgeId nunca aparece acá", () => {
    const result = errorsForEdge(ERRORS, "bt-1");
    assert.deepEqual(result, []);
  });
});

describe("globalErrors", () => {
  it("incluye únicamente errores SIN nodeId y SIN edgeId", () => {
    const result = globalErrors(ERRORS);
    const codes = result.map((e) => e.code).sort();
    assert.deepEqual(codes, ["MISSING_START_NODE", "NO_PATH_TO_END", "SCHEMA_INVALID"]);
  });

  it("un error con nodeId+edgeId NO es global aunque solo tenga uno de los dos evaluado mal", () => {
    const result = globalErrors(ERRORS);
    assert.equal(result.some((e) => e.code === "DUPLICATE_EDGE"), false);
    assert.equal(result.some((e) => e.code === "BUTTON_MISSING_EDGE"), false);
  });

  it("SCHEMA_INVALID sin nodeId se trata como global -- nunca se intenta inferir un nodo desde `path`", () => {
    const result = globalErrors(ERRORS);
    const schemaError = result.find((e) => e.code === "SCHEMA_INVALID");
    assert.ok(schemaError);
    assert.equal(schemaError!.nodeId, undefined);
    assert.equal(schemaError!.path, "nodes.3.config.text");
  });

  it("sin errores -> array vacío", () => {
    assert.deepEqual(globalErrors([]), []);
  });
});
