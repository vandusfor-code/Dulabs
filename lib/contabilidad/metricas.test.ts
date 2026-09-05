import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calcularIngresoTotal, compararConAnterior, agruparPorServicio, construirMovimientos } from "./metricas";
import type { FilaCitaCompletada } from "./tipos";

function fila(p: Partial<FilaCitaCompletada>): FilaCitaCompletada {
  return {
    id: 1,
    inicio: "2026-03-18T15:00:00Z",
    nombreCliente: "Cliente Prueba",
    servicioTexto: "Servicio texto libre",
    servicioId: "11111111-1111-1111-1111-111111111111",
    servicioNombre: "Uñas",
    precio: 40000,
    especialistaId: 1,
    profesionalNombre: "Mary",
    estado: "completada",
    ...p,
  };
}

describe("metricas (Fase 10, pura)", () => {
  it("calcularIngresoTotal ignora precios null sin romper (cita sin precio configurado)", () => {
    const total = calcularIngresoTotal([fila({ id: 1, precio: 40000 }), fila({ id: 2, precio: null }), fila({ id: 3, precio: 10000 })]);
    assert.equal(total, 50000);
  });

  it("compararConAnterior calcula el % de variación normal", () => {
    const r = compararConAnterior(150000, 100000);
    assert.equal(r.variacionPorcentual, 50);
  });

  it("compararConAnterior: caída se refleja como negativo", () => {
    const r = compararConAnterior(50000, 100000);
    assert.equal(r.variacionPorcentual, -50);
  });

  it("compararConAnterior: ambos en cero -> 0%, nunca null ni NaN", () => {
    const r = compararConAnterior(0, 0);
    assert.equal(r.variacionPorcentual, 0);
  });

  it("compararConAnterior: anterior=0 y actual>0 -> null (no hay base de comparación, nunca se inventa Infinity)", () => {
    const r = compararConAnterior(50000, 0);
    assert.equal(r.variacionPorcentual, null);
  });

  it("agruparPorServicio agrupa por servicioId real, no por texto", () => {
    const grupos = agruparPorServicio([
      fila({ id: 1, servicioId: "s1", servicioNombre: "Uñas", precio: 40000 }),
      fila({ id: 2, servicioId: "s1", servicioNombre: "Uñas", precio: 40000 }),
      fila({ id: 3, servicioId: "s2", servicioNombre: "Cejas", precio: 15000 }),
    ]);
    assert.equal(grupos.length, 2);
    const unas = grupos.find((g) => g.servicioId === "s1");
    assert.equal(unas?.cantidad, 2);
    assert.equal(unas?.ingresos, 80000);
  });

  it("construirMovimientos conserva valor null como 'sin precio', nunca inventa un número", () => {
    const movimientos = construirMovimientos([fila({ id: 9, precio: null, servicioNombre: null, servicioTexto: "Corte manual" })]);
    assert.equal(movimientos[0].valor, null);
    assert.equal(movimientos[0].servicio, "Corte manual");
  });
});
