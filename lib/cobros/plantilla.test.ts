import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatearMontoCop, limpiarValorVariable, resolverParametrosPlantilla, variablesDelCuerpo } from "./plantilla";

const CUERPO_NUMERICO = "Hola, {{1}} 👋\n⚠️ Tu Agente IA está desactivado debido al vencimiento de tu suscripción.\n\n💳 Para reactivarlo, recuerda realizar el pago de tu mensualidad por {{2}}.";
const CUERPO_CON_SIGNO = "Hola, {{1}}. Recuerda realizar el pago de tu mensualidad por ${{2}}. ¡Muchas gracias!";
const CUERPO_NOMBRADO = "Hola, {{nombre}} 👋 Para reactivarlo, recuerda realizar el pago de tu mensualidad por {{monto}}.";

describe("formatearMontoCop", () => {
  it("escribe el dinero con puntos de miles y sin decimales", () => {
    assert.equal(formatearMontoCop(39990), "39.990");
    assert.equal(formatearMontoCop(39900), "39.900");
    assert.equal(formatearMontoCop(299990), "299.990");
    assert.equal(formatearMontoCop(1000000), "1.000.000");
    assert.equal(formatearMontoCop(950), "950");
    assert.equal(formatearMontoCop(39990.4), "39.990");
  });
});

describe("limpiarValorVariable", () => {
  it("quita saltos de línea, tabuladores y espacios repetidos (Meta los rechaza) y recorta", () => {
    assert.equal(limpiarValorVariable("  AMORE\n\tSalón   Spa  "), "AMORE Salón Spa");
    assert.equal(limpiarValorVariable("x".repeat(100)).length, 60);
    assert.equal(limpiarValorVariable("   "), "");
  });
});

describe("variablesDelCuerpo", () => {
  it("devuelve cada variable una vez, en orden de aparición, aunque se repita o tenga espacios", () => {
    assert.deepEqual(variablesDelCuerpo("a {{ 1 }} b {{2}} c {{1}}").map((v) => v.nombre), ["1", "2"]);
    assert.deepEqual(variablesDelCuerpo("sin variables"), []);
  });
});

describe("resolverParametrosPlantilla", () => {
  it("variables numéricas: {{1}} es el nombre y {{2}} el monto con «$» incluido en el valor (el texto no lo trae)", () => {
    const r = resolverParametrosPlantilla(CUERPO_NUMERICO, { nombre: "AMORE", montoCop: 39990 });
    assert.deepEqual(r, { ok: true, tipo: "posicionales", valores: ["AMORE", "$39.990"], resumen: "nombre=AMORE · monto=$39.990" });
  });

  it("si el texto ya trae el «$» pegado a la variable, el valor va SOLO con el número (nunca «$$39.990»)", () => {
    const r = resolverParametrosPlantilla(CUERPO_CON_SIGNO, { nombre: "AMORE", montoCop: 39990 });
    assert.equal(r.ok && r.tipo === "posicionales" && r.valores[1], "39.990");
    const conEspacio = resolverParametrosPlantilla("Hola {{1}}, tu mensualidad es de $ {{2}}.", { nombre: "AMORE", montoCop: 39990 });
    assert.equal(conEspacio.ok && conEspacio.tipo === "posicionales" && conEspacio.valores[1], "39.990");
  });

  it("variables numéricas escritas al revés en el texto: el valor de {{1}} sigue siendo el nombre", () => {
    const r = resolverParametrosPlantilla("Debes {{2}} de tu plan, {{1}}.", { nombre: "Publibordados web", montoCop: 79990 });
    assert.deepEqual(r.ok && r.tipo === "posicionales" && r.valores, ["Publibordados web", "$79.990"]);
  });

  it("variables con nombre: se mandan con su nombre, y el monto se reconoce por el nombre aunque aparezca primero", () => {
    const normal = resolverParametrosPlantilla(CUERPO_NOMBRADO, { nombre: "AMORE", montoCop: 39990 });
    assert.deepEqual(normal.ok && normal.tipo === "nombrados" && normal.variables, [
      { nombre: "nombre", valor: "AMORE" },
      { nombre: "monto", valor: "$39.990" },
    ]);
    const alReves = resolverParametrosPlantilla("Tu mensualidad de {{valor_mensualidad}} está pendiente, {{nombre_negocio}}.", { nombre: "AMORE", montoCop: 39990 });
    assert.deepEqual(alReves.ok && alReves.tipo === "nombrados" && alReves.variables, [
      { nombre: "valor_mensualidad", valor: "$39.990" },
      { nombre: "nombre_negocio", valor: "AMORE" },
    ]);
  });

  it("variables con nombre sin pistas: primero el nombre y después el monto", () => {
    const r = resolverParametrosPlantilla("Hola {{a}}, son {{b}}.", { nombre: "AMORE", montoCop: 39990 });
    assert.deepEqual(r.ok && r.tipo === "nombrados" && r.variables, [
      { nombre: "a", valor: "AMORE" },
      { nombre: "b", valor: "$39.990" },
    ]);
  });

  it("si la plantilla no tiene EXACTAMENTE dos variables, no se manda nada (nunca se inventan datos)", () => {
    for (const cuerpo of ["Hola, tu pago está pendiente.", "Hola {{1}}, tu pago está pendiente.", "Hola {{1}}, pagas {{2}} el {{3}}."]) {
      const r = resolverParametrosPlantilla(cuerpo, { nombre: "AMORE", montoCop: 39990 });
      assert.equal(r.ok, false, cuerpo);
      assert.equal(!r.ok && r.motivo, "variables_no_coinciden");
    }
    // la misma variable repetida cuenta una sola vez
    assert.equal(resolverParametrosPlantilla("{{1}} {{1}}", { nombre: "A", montoCop: 1 }).ok, false);
  });

  it("limpia el nombre antes de usarlo y, si queda vacío, saluda con «tu negocio»", () => {
    const sucio = resolverParametrosPlantilla(CUERPO_NUMERICO, { nombre: "  AMORE \n Salón ", montoCop: 39990 });
    assert.equal(sucio.ok && sucio.tipo === "posicionales" && sucio.valores[0], "AMORE Salón");
    const vacio = resolverParametrosPlantilla(CUERPO_NUMERICO, { nombre: "  \n ", montoCop: 39990 });
    assert.equal(vacio.ok && vacio.tipo === "posicionales" && vacio.valores[0], "tu negocio");
  });
});
