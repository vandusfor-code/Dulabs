import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fechaTenantHoy, horaTenantAhora, estaEnVentanaDeEnvio } from "./fecha";

describe("fechaTenantHoy (Fase 6A, cumpleaños)", () => {
  it("resuelve día/mes/año en la zona horaria del tenant, no la del servidor (UTC)", () => {
    // 2026-01-01T02:00:00Z -- en Bogotá (UTC-5) todavía es 2025-12-31 21:00.
    const ahora = new Date("2026-01-01T02:00:00Z");
    const bogota = fechaTenantHoy("America/Bogota", ahora);
    assert.deepEqual(bogota, { dia: 31, mes: 12, anio: 2025 });
  });

  it("otra zona horaria puede ver el mismo instante como el día siguiente", () => {
    const ahora = new Date("2026-01-01T02:00:00Z");
    const tokio = fechaTenantHoy("Asia/Tokyo", ahora); // UTC+9 -> 2026-01-01T11:00 local
    assert.deepEqual(tokio, { dia: 1, mes: 1, anio: 2026 });
  });
});

describe("horaTenantAhora (Mejora Cumpleaños, autorizado)", () => {
  it("devuelve HH:mm en la zona horaria del tenant, nunca la del servidor (UTC)", () => {
    // 2026-03-15T14:30:00Z -- en Bogotá (UTC-5) son las 09:30.
    const ahora = new Date("2026-03-15T14:30:00Z");
    assert.equal(horaTenantAhora("America/Bogota", ahora), "09:30");
  });
});

describe("estaEnVentanaDeEnvio (Mejora Cumpleaños, autorizado) -- hora_envio ya NO es un campo muerto", () => {
  it("dentro de la ventana (exactamente a la hora configurada)", () => {
    const ahora = new Date("2026-03-15T14:00:00Z"); // 09:00 Bogotá
    assert.equal(estaEnVentanaDeEnvio("09:00", "America/Bogota", ahora), true);
  });

  it("dentro de la tolerancia (±15 min)", () => {
    assert.equal(estaEnVentanaDeEnvio("09:00", "America/Bogota", new Date("2026-03-15T14:10:00Z")), true, "10 min después, dentro de la tolerancia");
    assert.equal(estaEnVentanaDeEnvio("09:00", "America/Bogota", new Date("2026-03-15T13:50:00Z")), true, "10 min antes, dentro de la tolerancia");
  });

  it("fuera de la tolerancia -- NUNCA se envía a cualquier hora del día", () => {
    assert.equal(estaEnVentanaDeEnvio("09:00", "America/Bogota", new Date("2026-03-15T15:00:00Z")), false, "1 hora después");
    assert.equal(estaEnVentanaDeEnvio("09:00", "America/Bogota", new Date("2026-03-15T12:00:00Z")), false, "2 horas antes");
  });

  it("maneja el cruce de medianoche sin inflar la diferencia real", () => {
    // hora_envio "23:55", son las "00:05" del día siguiente -- 10 min reales, nunca 1430.
    const ahora = new Date("2026-03-16T05:05:00Z"); // 00:05 Bogotá
    assert.equal(estaEnVentanaDeEnvio("23:55", "America/Bogota", ahora), true);
  });

  it("un tenant configurado a una hora distinta (ej. 18:00) respeta SU propia hora, no una fija para todos", () => {
    const alas18 = new Date("2026-03-15T23:00:00Z"); // 18:00 Bogotá
    assert.equal(estaEnVentanaDeEnvio("18:00", "America/Bogota", alas18), true);
    assert.equal(estaEnVentanaDeEnvio("09:00", "America/Bogota", alas18), false, "un tenant configurado a las 09:00 NO debe activarse a las 18:00");
  });
});
