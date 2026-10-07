/**
 * CMS comercial — variables controladas: el mínimo mayorista existe UNA vez; un texto nunca sale con llaves a la vista ni con un valor inventado.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VARIABLES, escribioMontoAMano, esVariable, formatearPesos, resolverVariables, variablesEn } from "@/lib/cms-comercial/variables";

describe("variablesEn", () => {
  it("encuentra las variables, sin repetir y tolerando espacios", () => {
    assert.deepEqual(variablesEn("Desde {{minimo_mayorista}} y {{ minimo_mayorista }} en {{direccion_tienda}}"), ["minimo_mayorista", "direccion_tienda"]);
    assert.deepEqual(variablesEn("sin variables, solo $750.000 y {llaves} simples"), []);
    assert.deepEqual(variablesEn("{{}} {{ }} {{inventada}}"), ["", "inventada"]);
  });

  it("la lista de variables es cerrada", () => {
    assert.deepEqual([...VARIABLES], ["minimo_mayorista", "direccion_tienda", "nombre_negocio"]);
    assert.equal(esVariable("minimo_mayorista"), true);
    assert.equal(esVariable("precio_oro"), false);
    assert.equal(esVariable("__proto__"), false);
  });
});

describe("resolverVariables — fail-closed", () => {
  const valores = { minimo_mayorista: "$750.000", nombre_negocio: "Delacour & Orus Joyería" };

  it("reemplaza todas las apariciones", () => {
    const r = resolverVariables("En {{nombre_negocio}} la compra inicial parte desde {{minimo_mayorista}}. ¡{{ minimo_mayorista }}!", valores);
    assert.deepEqual(r, { ok: true, texto: "En Delacour & Orus Joyería la compra inicial parte desde $750.000. ¡$750.000!" });
  });

  it("un texto sin variables sale idéntico", () => {
    assert.deepEqual(resolverVariables("Hola", {}), { ok: true, texto: "Hola" });
  });

  it("una variable desconocida impide entregar el texto", () => {
    const r = resolverVariables("Precio del oro: {{precio_oro}}", valores);
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.desconocidas, ["precio_oro"]);
  });

  it("una variable conocida SIN valor configurado impide entregar el texto (nunca un valor inventado)", () => {
    const r = resolverVariables("Estamos en {{direccion_tienda}}", valores);
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.sinValor, ["direccion_tienda"]);
    const vacio = resolverVariables("Estamos en {{direccion_tienda}}", { direccion_tienda: "" });
    assert.equal(vacio.ok, false);
  });

  it("un valor con llaves no puede colar otra variable", () => {
    const r = resolverVariables("{{direccion_tienda}}", { direccion_tienda: "Calle 1 {{minimo_mayorista}}", minimo_mayorista: "$1" });
    assert.equal(r.ok, false);
  });
});

describe("formatearPesos y montos escritos a mano", () => {
  it("formatea en pesos colombianos", () => {
    assert.equal(formatearPesos(750000), "$750.000");
    assert.equal(formatearPesos(1250000), "$1.250.000");
    assert.equal(formatearPesos(999), "$999");
  });

  it("detecta el monto escrito a mano y no confunde con otros números ni con la variable", () => {
    for (const texto of ["Desde $750.000", "desde 750.000 pesos", "parte desde $750000", "compra mínima de $ 750.000.", "750.000"]) {
      assert.equal(escribioMontoAMano(texto, 750000), true, texto);
    }
    for (const texto of ["Desde {{minimo_mayorista}}", "1.750.000", "7.500.000", "750.000.000", "tenemos 7500 productos", "ref 1750000", "sin números"]) {
      assert.equal(escribioMontoAMano(texto, 750000), false, texto);
    }
  });
});
