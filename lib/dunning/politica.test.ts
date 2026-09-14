// FASE F16.1 (Commercial Scale — Dunning, autorizado) — unit tests puros de
// la política de reintentos (sin Supabase, sin red -- deterministas y
// verificables de inmediato, a diferencia del E2E que sí necesita la
// migración 20261004000000 aplicada). Mismo criterio que
// lib/flow/f14-billing-idempotencia.e2e.test.ts para lib/wompi-webhook.ts:
// la lógica pura se prueba aislada de la infraestructura.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calcularProximoIntento, fechaRecordatorio, debeExpirarFinal, POLITICA_DUNNING } from "./politica";

describe("lib/dunning/politica", () => {
  const primerFallo = new Date("2026-01-01T00:00:00Z");

  it("intento 1 (el que abrió el ciclo) -> próximo reintento a los diasHastaPrimerReintento días", () => {
    const proximo = calcularProximoIntento({ primerFalloAt: primerFallo, intentosRealizados: 1 });
    assert.ok(proximo);
    const diasReales = Math.round((proximo!.getTime() - primerFallo.getTime()) / (24 * 60 * 60 * 1000));
    assert.equal(diasReales, POLITICA_DUNNING.diasHastaPrimerReintento);
  });

  it("intento 2 (primer reintento ya hecho) -> próximo reintento a los diasHastaUltimoIntento días (el último)", () => {
    const proximo = calcularProximoIntento({ primerFalloAt: primerFallo, intentosRealizados: 2 });
    assert.ok(proximo);
    const diasReales = Math.round((proximo!.getTime() - primerFallo.getTime()) / (24 * 60 * 60 * 1000));
    assert.equal(diasReales, POLITICA_DUNNING.diasHastaUltimoIntento);
  });

  it("intento 3 (ya se hizo el último intento configurado) -> null, no hay más reintentos", () => {
    const proximo = calcularProximoIntento({ primerFalloAt: primerFallo, intentosRealizados: 3 });
    assert.equal(proximo, null);
  });

  it("nunca reintenta más allá de maximoIntentos, sin importar qué tan lejos esté la fecha", () => {
    const proximo = calcularProximoIntento({ primerFalloAt: primerFallo, intentosRealizados: POLITICA_DUNNING.maximoIntentos });
    assert.equal(proximo, null);
    const masAlla = calcularProximoIntento({ primerFalloAt: primerFallo, intentosRealizados: POLITICA_DUNNING.maximoIntentos + 5 });
    assert.equal(masAlla, null);
  });

  it("fechaRecordatorio cae en diasHastaRecordatorio días después del primer fallo", () => {
    const fecha = fechaRecordatorio(primerFallo);
    const diasReales = Math.round((fecha.getTime() - primerFallo.getTime()) / (24 * 60 * 60 * 1000));
    assert.equal(diasReales, POLITICA_DUNNING.diasHastaRecordatorio);
  });

  it("debeExpirarFinal es true cuando ya no queda ningún próximo intento (proximoIntentoAt null)", () => {
    assert.equal(debeExpirarFinal({ intentosRealizados: 2, proximoIntentoAt: null }), true);
  });

  it("debeExpirarFinal es true al alcanzar maximoIntentos aunque hubiera una fecha calculada", () => {
    assert.equal(debeExpirarFinal({ intentosRealizados: POLITICA_DUNNING.maximoIntentos, proximoIntentoAt: new Date() }), true);
  });

  it("debeExpirarFinal es false mientras queden intentos Y una fecha de próximo intento real", () => {
    assert.equal(debeExpirarFinal({ intentosRealizados: 1, proximoIntentoAt: new Date(primerFallo.getTime() + 1000) }), false);
  });

  it("la política completa es coherente: primerReintento < recordatorio < ultimoIntento (orden real de negocio)", () => {
    assert.ok(POLITICA_DUNNING.diasHastaPrimerReintento < POLITICA_DUNNING.diasHastaRecordatorio);
    assert.ok(POLITICA_DUNNING.diasHastaRecordatorio < POLITICA_DUNNING.diasHastaUltimoIntento);
  });
});
