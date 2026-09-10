/**
 * Comisión por servicio (autorizado, genérico) -- pruebas puras de la
 * validación compartida entre POST (crear servicio) y PATCH (editar
 * servicio), nunca dos reglas distintas de lo mismo.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validarComision } from "./comision";

describe("validarComision", () => {
  it("sin comisión (ambos undefined) -> válida, tipo/valor null (no configurada)", () => {
    const resultado = validarComision(undefined, undefined);
    assert.deepEqual(resultado, { ok: true, comision: { tipo: null, valor: null } });
  });

  it("{tipo: null, valor: null} -> válida, borra la comisión de vuelta a no configurada", () => {
    const resultado = validarComision(null, null);
    assert.deepEqual(resultado, { ok: true, comision: { tipo: null, valor: null } });
  });

  it("porcentaje válido (20) -> ok", () => {
    const resultado = validarComision("porcentaje", 20);
    assert.deepEqual(resultado, { ok: true, comision: { tipo: "porcentaje", valor: 20 } });
  });

  it("porcentaje 0 -> válido (permitir 0)", () => {
    const resultado = validarComision("porcentaje", 0);
    assert.deepEqual(resultado, { ok: true, comision: { tipo: "porcentaje", valor: 0 } });
  });

  it("porcentaje 100 -> válido (borde superior permitido)", () => {
    const resultado = validarComision("porcentaje", 100);
    assert.deepEqual(resultado, { ok: true, comision: { tipo: "porcentaje", valor: 100 } });
  });

  it("porcentaje 101 -> inválido (fuera de 0-100)", () => {
    const resultado = validarComision("porcentaje", 101);
    assert.equal(resultado.ok, false);
  });

  it("porcentaje negativo -> inválido", () => {
    const resultado = validarComision("porcentaje", -5);
    assert.equal(resultado.ok, false);
  });

  it("valor_fijo válido (5000) -> ok, sin límite de 100", () => {
    const resultado = validarComision("valor_fijo", 5000);
    assert.deepEqual(resultado, { ok: true, comision: { tipo: "valor_fijo", valor: 5000 } });
  });

  it("valor_fijo 0 -> válido (permitir 0)", () => {
    const resultado = validarComision("valor_fijo", 0);
    assert.deepEqual(resultado, { ok: true, comision: { tipo: "valor_fijo", valor: 0 } });
  });

  it("valor_fijo negativo -> inválido", () => {
    const resultado = validarComision("valor_fijo", -1);
    assert.equal(resultado.ok, false);
  });

  it("tipo desconocido -> inválido", () => {
    const resultado = validarComision("otro_tipo", 20);
    assert.equal(resultado.ok, false);
  });

  it("valor no numérico -> inválido, nunca acepta texto libre", () => {
    const resultado = validarComision("porcentaje", "veinte");
    assert.equal(resultado.ok, false);
  });

  it("tipo sin valor -> inválido (deben venir juntos)", () => {
    const resultado = validarComision("porcentaje", undefined);
    assert.equal(resultado.ok, false);
  });

  it("valor sin tipo -> inválido (deben venir juntos)", () => {
    const resultado = validarComision(undefined, 20);
    assert.equal(resultado.ok, false);
  });
});
