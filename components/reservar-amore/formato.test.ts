/**
 * AMORE (portal) — formatos de fecha, hora y duración que comparten todas las pantallas.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatearDuracion, formatearFechaCorta, formatearFechaLarga, formatearHora12h, formatearMesAnio, sumarDias } from "./formato";

describe("formatearDuracion", () => {
  it("minutos, horas exactas y horas con minutos", () => {
    assert.equal(formatearDuracion(15), "15 min");
    assert.equal(formatearDuracion(60), "1 h");
    assert.equal(formatearDuracion(120), "2 h");
    assert.equal(formatearDuracion(150), "2 h 30 min");
  });
});

describe("formatearHora12h", () => {
  it("convierte «HH:MM» a 12 horas con a. m. / p. m.", () => {
    assert.equal(formatearHora12h("09:00"), "9:00 a. m.");
    assert.equal(formatearHora12h("12:00"), "12:00 p. m.");
    assert.equal(formatearHora12h("12:30"), "12:30 p. m.");
    assert.equal(formatearHora12h("00:30"), "12:30 a. m.");
    assert.equal(formatearHora12h("17:30"), "5:30 p. m.");
  });
});

describe("fechas (hora de Colombia)", () => {
  it("fecha larga y corta, con la primera letra en mayúscula y sin «de» en la corta", () => {
    assert.equal(formatearFechaLarga("2026-10-09"), "Viernes, 9 de octubre");
    assert.equal(formatearFechaCorta("2026-10-09"), "Vie 9 oct");
    assert.equal(formatearMesAnio("2026-10-09"), "Octubre de 2026");
  });

  it("sumar días cruza el fin de mes y de año sin desfases de zona horaria", () => {
    assert.equal(sumarDias("2026-10-30", 3), "2026-11-02");
    assert.equal(sumarDias("2026-12-31", 1), "2027-01-01");
    assert.equal(sumarDias("2026-03-01", -1), "2026-02-28");
  });
});
