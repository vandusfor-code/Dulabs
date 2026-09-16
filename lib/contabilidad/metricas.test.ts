import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calcularIngresoTotal, compararConAnterior, agruparPorServicio, construirMovimientos, calcularIngresoVentas, construirMovimientosVenta } from "./metricas";
import type { FilaCitaCompletada } from "./tipos";
import type { VentaProducto } from "@/lib/amore-inventario-ventas";

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

function venta(p: Partial<VentaProducto>): VentaProducto {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    idTenant: "amore-test",
    productoId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    productoNombre: "Shampoo Nutritivo",
    cantidad: 2,
    precioUnitario: 65000,
    total: 130000,
    createdAt: "2026-03-18T16:00:00Z",
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

describe("AMORE (autorizado, Inventario -- 'Registrar venta') -- calcularIngresoVentas/construirMovimientosVenta (pura)", () => {
  it("calcularIngresoVentas suma el total real de cada venta -- nunca precio_unitario * cantidad recalculado acá (ya viene del backend)", () => {
    const total = calcularIngresoVentas([venta({ total: 130000 }), venta({ total: 45000 })]);
    assert.equal(total, 175000);
  });

  it("calcularIngresoVentas con lista vacía -> 0, nunca rompe", () => {
    assert.equal(calcularIngresoVentas([]), 0);
  });

  it("TEST M/N/O (obligatorios) -- construirMovimientosVenta produce un movimiento con el nombre del producto, cantidad, y el total real coincide con la venta", () => {
    const [m] = construirMovimientosVenta([venta({ productoNombre: "Shampoo Nutritivo", cantidad: 2, total: 130000 })]);
    assert.equal(m.tipo, "venta_producto");
    assert.equal(m.servicio, "Shampoo Nutritivo", "el nombre del producto debe estar presente en el movimiento");
    assert.equal(m.cantidad, 2);
    assert.equal(m.valor, 130000, "el total contable debe coincidir EXACTAMENTE con el total de la venta");
    assert.equal(m.cliente, "Venta de producto");
    assert.equal(m.estado, "completada");
  });

  it("nunca confunde una venta de producto con una cita de servicio -- tipo explícito, valor NUNCA null (una venta siempre tiene precio real)", () => {
    const [m] = construirMovimientosVenta([venta({})]);
    assert.notEqual(m.tipo, "servicio");
    assert.notEqual(m.valor, null);
  });
});
