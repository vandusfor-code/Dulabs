import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCumpleanosNatural, parseDiaCumpleanos, parseMesCumpleanos } from "@/lib/cumpleanos/parse-cumpleanos-natural";

describe("parseCumpleanosNatural", () => {
  it("'15 de marzo' -> día 15, mes 3", () => {
    assert.deepEqual(parseCumpleanosNatural("15 de marzo"), { ok: true, dia: 15, mes: 3 });
  });
  // CORRECCIÓN (autorizada, bug real de registro) -- "3 de enero" es
  // exactamente el mensaje real que un cliente envió durante registro_dia
  // (ver lib/amore-entrada-router.ts) y que parseDiaCumpleanos (solo
  // dígitos) rechazaba; este parser combinado SÍ lo reconoce sin cambios.
  it("'3 de enero' -> día 3, mes 1 (caso real reportado en producción)", () => {
    assert.deepEqual(parseCumpleanosNatural("3 de enero"), { ok: true, dia: 3, mes: 1 });
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

describe("Fase 2 AMORE (registro de clientes nuevos) -- parseDiaCumpleanos", () => {
  it("acepta números naturales razonables (1, 01, 15, 28, 31)", () => {
    assert.equal(parseDiaCumpleanos("1"), 1);
    assert.equal(parseDiaCumpleanos("01"), 1);
    assert.equal(parseDiaCumpleanos("15"), 15);
    assert.equal(parseDiaCumpleanos("28"), 28);
    assert.equal(parseDiaCumpleanos("31"), 31);
  });
  it("rechaza 0, 32 y texto no numérico -- nunca inventa", () => {
    assert.equal(parseDiaCumpleanos("0"), null);
    assert.equal(parseDiaCumpleanos("32"), null);
    assert.equal(parseDiaCumpleanos("hola"), null);
  });
});

describe("Fase 2 AMORE (registro de clientes nuevos) -- parseMesCumpleanos (reutiliza MESES/resolverMesPorPrefijo, nunca duplica la tabla)", () => {
  it("acepta 1-12 numérico", () => {
    for (let mes = 1; mes <= 12; mes++) {
      assert.equal(parseMesCumpleanos(String(mes)), mes);
    }
  });
  it("acepta el nombre completo del mes", () => {
    assert.equal(parseMesCumpleanos("marzo"), 3);
    assert.equal(parseMesCumpleanos("Marzo"), 3);
  });
  it("acepta el prefijo real del mes (mínimo 3 letras, mismo criterio que resolverMesPorPrefijo)", () => {
    assert.equal(parseMesCumpleanos("mar"), 3);
  });
  it("rechaza 0, 13 y texto no reconocible -- nunca inventa", () => {
    assert.equal(parseMesCumpleanos("0"), null);
    assert.equal(parseMesCumpleanos("13"), null);
    assert.equal(parseMesCumpleanos("invierno"), null);
  });
});
