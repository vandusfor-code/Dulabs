import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { debeConfirmarse, debeRecordarse } from "./vencimiento";

describe("vencimiento (Fase 8, pura)", () => {
  it("debeConfirmarse -- true mientras la cita sea futura", () => {
    const ahora = new Date("2026-03-15T10:00:00Z");
    assert.equal(debeConfirmarse(new Date("2026-03-16T10:00:00Z"), ahora), true);
    assert.equal(debeConfirmarse(new Date("2026-03-14T10:00:00Z"), ahora), false, "una cita que ya pasó no se confirma");
  });

  it("3. recordatorio DENTRO del tiempo configurado -> true", () => {
    const ahora = new Date("2026-03-15T10:00:00Z");
    const cita = new Date("2026-03-16T08:00:00Z"); // faltan 22h, anticipación 24h
    assert.equal(debeRecordarse(cita, 24, ahora), true);
  });

  it("4. recordatorio FUERA del tiempo configurado (todavía muy lejos) -> false", () => {
    const ahora = new Date("2026-03-15T10:00:00Z");
    const cita = new Date("2026-03-18T10:00:00Z"); // faltan 72h, anticipación 24h
    assert.equal(debeRecordarse(cita, 24, ahora), false);
  });

  it("una cita que ya inició/pasó nunca recibe recordatorio, aunque el cron corra tarde", () => {
    const ahora = new Date("2026-03-15T10:00:00Z");
    const cita = new Date("2026-03-15T09:00:00Z"); // ya pasó hace 1h
    assert.equal(debeRecordarse(cita, 24, ahora), false);
  });

  it("exactamente en el límite de anticipación (>=, no >) -> true", () => {
    const ahora = new Date("2026-03-15T10:00:00Z");
    const cita = new Date("2026-03-16T10:00:00Z"); // exactamente 24h
    assert.equal(debeRecordarse(cita, 24, ahora), true);
  });
});
