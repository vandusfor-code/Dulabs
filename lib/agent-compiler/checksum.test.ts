/**
 * El checksum debe ser estable ante el almacenamiento JSON (jsonb elimina las propiedades `undefined`): el resolvedor de
 * producción recalcula el checksum del flujo desde el JSON guardado y lo compara con el calculado al compilar.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checksumOf, stableStringify } from "@/lib/agent-compiler/checksum";

describe("checksum — semántica JSON", () => {
  it("1. una propiedad undefined equivale a no tenerla", () => {
    assert.equal(checksumOf({ a: 1, b: undefined }), checksumOf({ a: 1 }));
    assert.equal(stableStringify({ a: { x: undefined, y: 2 } }), stableStringify({ a: { y: 2 } }));
  });

  it("2. sobrevive al ciclo JSON (lo que hace Postgres jsonb): mismo checksum antes y después de guardar", () => {
    const flow = { nodes: [{ id: "n1", config: { text: "hola", outputVariables: undefined, allowedTools: [] } }], edges: [{ from: "a", to: "b", handle: undefined }], name: "x" };
    assert.equal(checksumOf(JSON.parse(JSON.stringify(flow))), checksumOf(flow));
  });

  it("3. sigue siendo canónico (orden de claves irrelevante) y sensible a los cambios reales", () => {
    assert.equal(checksumOf({ a: 1, b: 2 }), checksumOf({ b: 2, a: 1 }));
    assert.notEqual(checksumOf({ a: 1 }), checksumOf({ a: 2 }));
    assert.notEqual(checksumOf({ a: null }), checksumOf({}), "null SÍ es un valor (a diferencia de undefined)");
  });

  it("4. un undefined dentro de un arreglo es null (igual que JSON)", () => {
    assert.equal(stableStringify([1, undefined, 3]), "[1,null,3]");
    assert.equal(checksumOf(JSON.parse(JSON.stringify([1, undefined, 3]))), checksumOf([1, undefined, 3]));
  });
});
