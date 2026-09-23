import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolverMencionUnica } from "@/lib/agenda-v2/entidades-extraidas";

const PROFESIONALES = [{ nombre: "Mary" }, { nombre: "Mariana" }, { nombre: "Nata" }, { nombre: "Cristal" }];
const nombre = (o: { nombre: string }) => o.nombre;

describe("resolverMencionUnica -- palabra completa (nunca subcadena)", () => {
  it("menciones reales extraídas por Gemini", () => {
    assert.equal(resolverMencionUnica("Mary", PROFESIONALES, nombre)?.nombre, "Mary");
    assert.equal(resolverMencionUnica("con Cristal", PROFESIONALES, nombre)?.nombre, "Cristal");
    assert.equal(resolverMencionUnica("que me atienda Mariana", PROFESIONALES, nombre)?.nombre, "Mariana");
  });

  it("regresión: una subcadena NUNCA elige a otra persona", () => {
    assert.equal(resolverMencionUnica("Ana", PROFESIONALES, nombre), undefined, "antes elegía a Mariana");
    assert.equal(resolverMencionUnica("Mar", PROFESIONALES, nombre), undefined, "antes elegía a Mary (o era ambigua con Mariana)");
    assert.equal(resolverMencionUnica("Natalia", PROFESIONALES, nombre), undefined, "antes elegía a Nata");
  });

  it("servicios: el nombre completo que dijo la clienta; una categoría no es un servicio", () => {
    const servicios = [{ nombre: "Dipping" }, { nombre: "Press On" }, { nombre: "Manicure" }, { nombre: "Manicure semipermanente" }];
    assert.equal(resolverMencionUnica("el dipping", servicios, nombre)?.nombre, "Dipping");
    assert.equal(resolverMencionUnica("un manicure semipermanente", servicios, nombre)?.nombre, "Manicure semipermanente");
    assert.equal(resolverMencionUnica("las uñas", servicios, nombre), undefined);
  });
});
