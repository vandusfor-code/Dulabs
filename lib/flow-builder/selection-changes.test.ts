/**
 * Bugfix real (producción, drag&drop de nodos) — tests de applySelectChanges.
 * Ver FlowCanvas.tsx para el contexto completo: sin aplicar los NodeChange/
 * EdgeChange "select" que @xyflow/react reporta, la selección quedaba
 * desincronizada de su store interno y oscilaba infinitamente
 * (seleccionado <-> vacío), causando "Maximum update depth exceeded" al
 * agregar+seleccionar un nodo nuevo desde la paleta.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySelectChanges } from "@/lib/flow-builder/selection-changes";

describe("applySelectChanges", () => {
  it("selected:true agrega el id al set actual", () => {
    const result = applySelectChanges(new Set(), [{ type: "select", id: "n1", selected: true }]);
    assert.deepEqual(result, ["n1"]);
  });

  it("selected:false quita el id del set actual", () => {
    const result = applySelectChanges(new Set(["n1", "n2"]), [{ type: "select", id: "n1", selected: false }]);
    assert.deepEqual(result, ["n2"]);
  });

  it("ignora changes que no son type:'select' (dimensions/position/remove/add)", () => {
    const result = applySelectChanges(new Set(["n1"]), [
      { type: "dimensions", id: "n1" },
      { type: "position", id: "n1" },
      { type: "remove", id: "n2" },
      { type: "add", id: "n3" },
    ]);
    assert.deepEqual(result, ["n1"], "el set de entrada no debe alterarse por changes que no son 'select'");
  });

  it("no muta el set original recibido", () => {
    const original = new Set(["n1"]);
    applySelectChanges(original, [{ type: "select", id: "n2", selected: true }]);
    assert.deepEqual([...original], ["n1"], "applySelectChanges debe ser pura -- nunca mutar el argumento");
  });

  it("varios changes en un solo lote se aplican todos, en orden", () => {
    const result = applySelectChanges(new Set(["n1"]), [
      { type: "select", id: "n2", selected: true },
      { type: "select", id: "n1", selected: false },
      { type: "select", id: "n3", selected: true },
    ]);
    assert.deepEqual(new Set(result), new Set(["n2", "n3"]));
  });

  it("sin changes 'select' -> devuelve exactamente el mismo contenido (idempotente)", () => {
    const result = applySelectChanges(new Set(["n1", "n2"]), []);
    assert.deepEqual(new Set(result), new Set(["n1", "n2"]));
  });

  it("reproduce el escenario real del bug: seleccionar el nodo recién agregado no oscila -- un solo change 'select' da un resultado ESTABLE", () => {
    // Antes del fix, @xyflow/react reportaba alternadamente [] y [nodeId]
    // en llamadas sucesivas para el MISMO estado real -- acá se confirma
    // que, dado el estado real que xyflow reporta (un único change consistente),
    // el resultado es determinista y no requiere una segunda pasada.
    const seleccionado = applySelectChanges(new Set(), [{ type: "select", id: "nodo-nuevo", selected: true }]);
    assert.deepEqual(seleccionado, ["nodo-nuevo"]);
    const otraVezMismoEstado = applySelectChanges(new Set(seleccionado), [{ type: "select", id: "nodo-nuevo", selected: true }]);
    assert.deepEqual(otraVezMismoEstado, ["nodo-nuevo"], "aplicar el mismo change 'selected:true' de nuevo no debe deseleccionar nada");
  });
});
