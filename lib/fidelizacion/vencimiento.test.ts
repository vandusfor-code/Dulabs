import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diasTranscurridos, haVencido } from "./vencimiento";

describe("vencimiento (Fase 7, pura)", () => {
  it("diasTranscurridos cuenta días completos", () => {
    const visita = new Date("2026-01-01T10:00:00Z");
    assert.equal(diasTranscurridos(visita, new Date("2026-01-01T10:00:00Z")), 0);
    assert.equal(diasTranscurridos(visita, new Date("2026-01-11T10:00:00Z")), 10);
    assert.equal(diasTranscurridos(visita, new Date("2026-01-11T09:00:00Z")), 9, "todavía no se cumplen las 10x24h exactas");
  });

  it("2. antes de los días configurados -> no vencido", () => {
    const visita = new Date("2026-01-01T00:00:00Z");
    assert.equal(haVencido(visita, 20, new Date("2026-01-15T00:00:00Z")), false); // 14 días
  });

  it("3. exactamente en el día configurado -> vencido", () => {
    const visita = new Date("2026-01-01T00:00:00Z");
    assert.equal(haVencido(visita, 20, new Date("2026-01-21T00:00:00Z")), true); // exactamente 20 días
  });

  it("un día después de vencido también sigue vencido (>= no ==) -- robusto a un cron que se salta un día", () => {
    const visita = new Date("2026-01-01T00:00:00Z");
    assert.equal(haVencido(visita, 20, new Date("2026-01-25T00:00:00Z")), true);
  });
});
