import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeText } from "@/lib/flow-triggers/normalize-text";

describe("normalizeText", () => {
  it("lowercase", () => {
    assert.equal(normalizeText("HOLA"), "hola");
  });

  it("trim", () => {
    assert.equal(normalizeText("  hola  "), "hola");
  });

  it("colapsa espacios repetidos (internos)", () => {
    assert.equal(normalizeText("hola    mundo"), "hola mundo");
  });

  it("remueve acentos (normalización Unicode NFD)", () => {
    assert.equal(normalizeText("días"), "dias");
    assert.equal(normalizeText("BUENOS DÍAS"), "buenos dias");
    assert.equal(normalizeText("información"), "informacion");
  });

  it("combina lowercase + trim + espacios + acentos en un solo pase", () => {
    assert.equal(normalizeText("  Buenos   DÍAS  "), "buenos dias");
  });

  it("NO elimina puntuación -- puede cambiar el significado del mensaje", () => {
    assert.equal(normalizeText("¿vendes?"), "¿vendes?");
  });

  it("string vacío -> string vacío", () => {
    assert.equal(normalizeText(""), "");
  });

  it("string de solo espacios -> string vacío", () => {
    assert.equal(normalizeText("   "), "");
  });

  it("es idempotente (normalizar dos veces da el mismo resultado)", () => {
    const once = normalizeText("  Buenos   DÍAS  ");
    assert.equal(normalizeText(once), once);
  });
});
