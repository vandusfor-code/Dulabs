import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCumpleanosNatural } from "@/lib/cumpleanos/parse-cumpleanos-natural";

describe("parseCumpleanosNatural", () => {
  it("'15 de marzo' -> día 15, mes 3", () => {
    assert.deepEqual(parseCumpleanosNatural("15 de marzo"), { ok: true, dia: 15, mes: 3 });
  });
  it("es insensible a mayúsculas/acentos y tolera texto alrededor", () => {
    assert.deepEqual(parseCumpleanosNatural("Es el 3 de Julio, gracias"), { ok: true, dia: 3, mes: 7 });
  });
  it("acepta abreviatura del mes ('15 de mar')", () => {
    assert.deepEqual(parseCumpleanosNatural("15 de mar"), { ok: true, dia: 15, mes: 3 });
  });
  it("'15/03' -> día 15, mes 3", () => {
    assert.deepEqual(parseCumpleanosNatural("15/03"), { ok: true, dia: 15, mes: 3 });
  });
  it("'3-7' -> día 3, mes 7", () => {
    assert.deepEqual(parseCumpleanosNatural("3-7"), { ok: true, dia: 3, mes: 7 });
  });
  it("un año explícito se tolera pero se IGNORA por completo -- nunca se guarda", () => {
    assert.deepEqual(parseCumpleanosNatural("15/03/1990"), { ok: true, dia: 15, mes: 3 });
    assert.deepEqual(parseCumpleanosNatural("15 de marzo de 1990"), { ok: true, dia: 15, mes: 3 });
  });
  it("29 de febrero es válido (nunca se guarda año, así que no hay 'no bisiesto')", () => {
    assert.deepEqual(parseCumpleanosNatural("29 de febrero"), { ok: true, dia: 29, mes: 2 });
  });
  it("día que no existe en el mes -> ok:false (ej. 31 de abril)", () => {
    assert.deepEqual(parseCumpleanosNatural("31 de abril"), { ok: false });
  });
  it("30 de febrero -> ok:false", () => {
    assert.deepEqual(parseCumpleanosNatural("30/02"), { ok: false });
  });
  it("mes fuera de rango -> ok:false", () => {
    assert.deepEqual(parseCumpleanosNatural("15/13"), { ok: false });
  });
  it("sin ninguna fecha reconocible -> ok:false, nunca inventa", () => {
    assert.deepEqual(parseCumpleanosNatural("prefiero no decir"), { ok: false });
    assert.deepEqual(parseCumpleanosNatural("mañana"), { ok: false });
  });
});
