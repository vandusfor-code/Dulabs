import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rangoHoy, rangoSemana, rangoMes, rangoPersonalizado, rangoAnterior, rangoAnteriorDe, resolverRango } from "./periodo";

// Miércoles 18 de marzo de 2026, 10:00 a.m. Bogotá -- lejos de cualquier
// borde de semana/mes en ambas direcciones, para que las pruebas sean
// deterministas sin importar qué día se ejecuten.
const AHORA = new Date("2026-03-18T15:00:00Z");

describe("periodo (Fase 10, pura) -- rangos siempre en America/Bogota", () => {
  it("rangoHoy cubre exactamente el día calendario de Bogotá", () => {
    const { desde, hasta } = rangoHoy(AHORA);
    assert.equal(desde.toISOString(), "2026-03-18T05:00:00.000Z"); // 2026-03-18T00:00 Bogotá (UTC-5)
    assert.equal(hasta.toISOString(), "2026-03-19T05:00:00.000Z");
  });

  it("rangoSemana cubre lunes a domingo (Bogotá), incluye 'ahora'", () => {
    const { desde, hasta } = rangoSemana(AHORA);
    assert.equal(desde.toISOString(), "2026-03-16T05:00:00.000Z"); // lunes 16
    assert.equal(hasta.toISOString(), "2026-03-23T05:00:00.000Z"); // lunes 23 (exclusivo)
    assert.ok(AHORA >= desde && AHORA < hasta);
  });

  it("rangoMes cubre el mes calendario completo (Bogotá)", () => {
    const { desde, hasta } = rangoMes(AHORA);
    assert.equal(desde.toISOString(), "2026-03-01T05:00:00.000Z");
    assert.equal(hasta.toISOString(), "2026-04-01T05:00:00.000Z");
  });

  it("rangoMes cruza diciembre->enero correctamente", () => {
    const { desde, hasta } = rangoMes(new Date("2026-12-15T15:00:00Z"));
    assert.equal(desde.toISOString(), "2026-12-01T05:00:00.000Z");
    assert.equal(hasta.toISOString(), "2027-01-01T05:00:00.000Z");
  });

  it("rangoPersonalizado incluye ambos días (desde 00:00 hasta el día siguiente a 'hasta')", () => {
    const rango = rangoPersonalizado("2026-03-10", "2026-03-12");
    assert.ok(rango);
    assert.equal(rango!.desde.toISOString(), "2026-03-10T05:00:00.000Z");
    assert.equal(rango!.hasta.toISOString(), "2026-03-13T05:00:00.000Z");
  });

  it("rangoPersonalizado con fechas inválidas devuelve null", () => {
    assert.equal(rangoPersonalizado("no-es-fecha", "2026-03-12"), null);
  });

  it("rangoAnterior (genérico) es un rango del MISMO largo en milisegundos, inmediatamente antes", () => {
    const semana = rangoSemana(AHORA); // siempre 7 días exactos -> sí coincide con la semana calendario anterior
    const anterior = rangoAnterior(semana);
    assert.equal(anterior.hasta.getTime(), semana.desde.getTime());
    assert.equal(anterior.hasta.getTime() - anterior.desde.getTime(), semana.hasta.getTime() - semana.desde.getTime());
    assert.equal(anterior.desde.toISOString(), "2026-03-09T05:00:00.000Z"); // lunes de la semana anterior
  });

  it("rangoAnteriorDe('mes', ...) usa el MES CALENDARIO anterior, no un tramo de N días (marzo=31 días != febrero=28)", () => {
    const mes = rangoMes(AHORA);
    const anterior = rangoAnteriorDe("mes", mes, AHORA);
    assert.equal(anterior.desde.toISOString(), "2026-02-01T05:00:00.000Z");
    assert.equal(anterior.hasta.toISOString(), "2026-03-01T05:00:00.000Z"); // Febrero completo, no "los 31 días antes de marzo"
  });

  it("rangoAnteriorDe('semana', ...) sigue siendo el genérico (7 días = 7 días, no hay ambigüedad)", () => {
    const semana = rangoSemana(AHORA);
    const anterior = rangoAnteriorDe("semana", semana, AHORA);
    assert.equal(anterior.desde.toISOString(), "2026-03-09T05:00:00.000Z");
  });

  it("resolverRango 'personalizado' sin desde/hasta devuelve null (no rompe)", () => {
    assert.equal(resolverRango("personalizado", AHORA), null);
  });
});
