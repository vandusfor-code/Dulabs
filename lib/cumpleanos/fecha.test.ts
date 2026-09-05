import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fechaTenantHoy } from "./fecha";

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
