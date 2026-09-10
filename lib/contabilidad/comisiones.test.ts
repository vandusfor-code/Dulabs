/**
 * Contabilidad (NUEVA FASE, autorizado) — pruebas puras de agruparPorProfesional
 * con la comisión configurada POR SERVICIO (dulabs_servicios.comision_tipo/
 * comision_valor). No toca Supabase -- las funciones de I/O
 * (obtenerComisionesPorServicio/obtenerLineasMultiServicioPorCita) se cubren
 * en reporte.test.ts (integración real, tenants descartables).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agruparPorProfesional, type ConfigComisionServicio, type LineaServicioCita } from "./comisiones";
import type { FilaCitaCompletada } from "./tipos";

function fila(overrides: Partial<FilaCitaCompletada> & { id: number; especialistaId: number }): FilaCitaCompletada {
  return {
    inicio: "2026-03-18T10:00:00Z",
    nombreCliente: "Cliente de prueba",
    servicioTexto: "Servicio",
    servicioId: "serv-1",
    servicioNombre: "Servicio",
    precio: 50000,
    profesionalNombre: "Profesional de prueba",
    estado: "completada",
    ...overrides,
  };
}

describe("agruparPorProfesional -- comisión por servicio (autorizado)", () => {
  it("porcentaje: precio * valor / 100", () => {
    const filas = [fila({ id: 1, especialistaId: 1, servicioId: "s-porcentaje", precio: 50000 })];
    const comisiones = new Map<string, ConfigComisionServicio>([["s-porcentaje", { tipo: "porcentaje", valor: 40 }]]);
    const resultado = agruparPorProfesional(filas, comisiones, new Map());
    assert.deepEqual(resultado[0]?.comision, { estado: "configurada", monto: 20000 });
  });

  it("valor fijo: el mismo monto sin importar el precio del servicio", () => {
    const filas = [fila({ id: 1, especialistaId: 1, servicioId: "s-fijo", precio: 80000 })];
    const comisiones = new Map<string, ConfigComisionServicio>([["s-fijo", { tipo: "valor_fijo", valor: 5000 }]]);
    const resultado = agruparPorProfesional(filas, comisiones, new Map());
    assert.deepEqual(resultado[0]?.comision, { estado: "configurada", monto: 5000 });
  });

  it("0% es una comisión configurada real (monto 0), nunca se confunde con 'no_configurada'", () => {
    const filas = [fila({ id: 1, especialistaId: 1, servicioId: "s-cero", precio: 50000 })];
    const comisiones = new Map<string, ConfigComisionServicio>([["s-cero", { tipo: "porcentaje", valor: 0 }]]);
    const resultado = agruparPorProfesional(filas, comisiones, new Map());
    assert.deepEqual(resultado[0]?.comision, { estado: "configurada", monto: 0 });
  });

  it("100% de comisión -> el monto completo del precio", () => {
    const filas = [fila({ id: 1, especialistaId: 1, servicioId: "s-cien", precio: 50000 })];
    const comisiones = new Map<string, ConfigComisionServicio>([["s-cien", { tipo: "porcentaje", valor: 100 }]]);
    const resultado = agruparPorProfesional(filas, comisiones, new Map());
    assert.deepEqual(resultado[0]?.comision, { estado: "configurada", monto: 50000 });
  });

  it("servicio sin comisión configurada -> 'no_configurada', nunca inventa un valor", () => {
    const filas = [fila({ id: 1, especialistaId: 1, servicioId: "s-sin-config", precio: 50000 })];
    const resultado = agruparPorProfesional(filas, new Map(), new Map());
    assert.deepEqual(resultado[0]?.comision, { estado: "no_configurada" });
  });

  it("varios servicios completados por el mismo profesional -> comisión SUMADA, cada línea con su propio tipo/valor", () => {
    const filas = [
      fila({ id: 1, especialistaId: 1, servicioId: "s-porcentaje", precio: 30000 }),
      fila({ id: 2, especialistaId: 1, servicioId: "s-fijo", precio: 40000 }),
    ];
    const comisiones = new Map<string, ConfigComisionServicio>([
      ["s-porcentaje", { tipo: "porcentaje", valor: 20 }],
      ["s-fijo", { tipo: "valor_fijo", valor: 5000 }],
    ]);
    const resultado = agruparPorProfesional(filas, comisiones, new Map());
    assert.equal(resultado[0]?.ingresos, 70000);
    assert.deepEqual(resultado[0]?.comision, { estado: "configurada", monto: 11000 }); // 6000 + 5000
  });

  it("solo ALGUNOS de los servicios del profesional tienen comisión configurada -> suma únicamente los configurados, nunca inventa el resto", () => {
    const filas = [
      fila({ id: 1, especialistaId: 1, servicioId: "s-configurado", precio: 50000 }),
      fila({ id: 2, especialistaId: 1, servicioId: "s-no-configurado", precio: 30000 }),
    ];
    const comisiones = new Map<string, ConfigComisionServicio>([["s-configurado", { tipo: "porcentaje", valor: 10 }]]);
    const resultado = agruparPorProfesional(filas, comisiones, new Map());
    assert.equal(resultado[0]?.ingresos, 80000);
    assert.deepEqual(resultado[0]?.comision, { estado: "configurada", monto: 5000 }); // solo el configurado
  });

  it("multi-servicio (dulabs_cita_servicios): cada servicio real de la cita se comisiona por separado, no el precio_total con la config de uno solo", () => {
    const filas = [fila({ id: 1, especialistaId: 1, servicioId: "manicure", precio: 90000 })]; // precio_total de la cita
    const comisiones = new Map<string, ConfigComisionServicio>([
      ["manicure", { tipo: "porcentaje", valor: 20 }],
      ["pedicure", { tipo: "porcentaje", valor: 10 }],
      ["cejas", { tipo: "valor_fijo", valor: 5000 }],
    ]);
    const lineasMultiServicio = new Map<number, LineaServicioCita[]>([
      [
        1,
        [
          { servicioId: "manicure", precio: 30000 },
          { servicioId: "pedicure", precio: 40000 },
          { servicioId: "cejas", precio: 20000 },
        ],
      ],
    ]);
    const resultado = agruparPorProfesional(filas, comisiones, lineasMultiServicio);
    assert.equal(resultado[0]?.ingresos, 90000);
    assert.deepEqual(resultado[0]?.comision, { estado: "configurada", monto: 15000 }); // 6000 + 4000 + 5000
  });

  it("precio null en un servicio sin precio fijo -> esa línea no aporta comisión, nunca rompe ni inventa un precio", () => {
    const filas = [fila({ id: 1, especialistaId: 1, servicioId: "s-sin-precio", precio: null })];
    const comisiones = new Map<string, ConfigComisionServicio>([["s-sin-precio", { tipo: "porcentaje", valor: 50 }]]);
    const resultado = agruparPorProfesional(filas, comisiones, new Map());
    assert.equal(resultado[0]?.ingresos, 0);
    assert.deepEqual(resultado[0]?.comision, { estado: "no_configurada" });
  });

  it("aislamiento: cada profesional acumula su propia comisión, nunca se mezcla con la de otro", () => {
    const filas = [
      fila({ id: 1, especialistaId: 1, servicioId: "s-a", precio: 50000 }),
      fila({ id: 2, especialistaId: 2, servicioId: "s-b", precio: 50000 }),
    ];
    const comisiones = new Map<string, ConfigComisionServicio>([
      ["s-a", { tipo: "porcentaje", valor: 40 }],
      ["s-b", { tipo: "porcentaje", valor: 10 }],
    ]);
    const resultado = agruparPorProfesional(filas, comisiones, new Map());
    const p1 = resultado.find((p) => p.especialistaId === 1);
    const p2 = resultado.find((p) => p.especialistaId === 2);
    assert.deepEqual(p1?.comision, { estado: "configurada", monto: 20000 });
    assert.deepEqual(p2?.comision, { estado: "configurada", monto: 5000 });
  });
});
