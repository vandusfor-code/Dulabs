/**
 * Horario de atención — evaluación determinista (backend authority).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateBusinessHours, hhmmToMinutes, tieneAlgunHorarioAbierto, weekdayDeFecha } from "@/lib/business-hours";
import type { BusinessDaySchedule, BusinessHours, BusinessHoursInterval } from "@/lib/agent-compiler/spec/types";

const FECHA = "2026-09-28";
const WD = weekdayDeFecha(FECHA)!;

function openDay(...intervals: BusinessHoursInterval[]): BusinessDaySchedule {
  return { closed: false, intervals };
}
const CLOSED: BusinessDaySchedule = { closed: true, intervals: [] };

function semanaUniforme(day: BusinessDaySchedule, exceptions: BusinessHours["exceptions"] = []): BusinessHours {
  return { week: Array.from({ length: 7 }, () => day), exceptions };
}
function semanaConDia(day: BusinessDaySchedule, wd: number, override: BusinessDaySchedule): BusinessHours {
  const week = Array.from({ length: 7 }, () => day);
  week[wd] = override;
  return { week, exceptions: [] };
}

describe("evaluateBusinessHours", () => {
  it("1. horario normal: turno dentro del intervalo => ok", () => {
    const r = evaluateBusinessHours(semanaUniforme(openDay({ open: "09:00", close: "18:00" })), { fecha: FECHA, hora: "10:00", durationMin: 60 });
    assert.deepEqual(r, { ok: true });
  });

  it("2. día cerrado => cerrado", () => {
    const r = evaluateBusinessHours(semanaConDia(openDay({ open: "09:00", close: "18:00" }), WD, CLOSED), { fecha: FECHA, hora: "10:00", durationMin: 60 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "cerrado");
  });

  it("3. múltiples intervalos (cierre al mediodía): dentro ok, en el hueco fuera", () => {
    const h = semanaUniforme(openDay({ open: "09:00", close: "12:00" }, { open: "14:00", close: "18:00" }));
    assert.equal(evaluateBusinessHours(h, { fecha: FECHA, hora: "10:00", durationMin: 60 }).ok, true);
    assert.equal(evaluateBusinessHours(h, { fecha: FECHA, hora: "15:00", durationMin: 60 }).ok, true);
    const gap = evaluateBusinessHours(h, { fecha: FECHA, hora: "12:30", durationMin: 30 });
    assert.equal(gap.ok, false);
    if (!gap.ok) assert.equal(gap.reason, "fuera_de_horario");
  });

  it("4. cita que termina después del cierre => fuera_de_horario", () => {
    const h = semanaUniforme(openDay({ open: "09:00", close: "18:00" }));
    const r = evaluateBusinessHours(h, { fecha: FECHA, hora: "17:00", durationMin: 120 }); // termina 19:00
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "fuera_de_horario");
  });

  it("5. bordes exactos: start==open ok; end==close ok; end>close fuera", () => {
    const h = semanaUniforme(openDay({ open: "09:00", close: "18:00" }));
    assert.equal(evaluateBusinessHours(h, { fecha: FECHA, hora: "09:00", durationMin: 60 }).ok, true);
    assert.equal(evaluateBusinessHours(h, { fecha: FECHA, hora: "17:00", durationMin: 60 }).ok, true); // 18:00 == close
    assert.equal(evaluateBusinessHours(h, { fecha: FECHA, hora: "17:00", durationMin: 61 }).ok, false);
  });

  it("6. excepción cerrada manda sobre el día normal", () => {
    const h = semanaUniforme(openDay({ open: "09:00", close: "18:00" }), [{ date: FECHA, closed: true, intervals: [] }]);
    const r = evaluateBusinessHours(h, { fecha: FECHA, hora: "10:00", durationMin: 60 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "cerrado");
  });

  it("7. excepción con horario especial", () => {
    const h = semanaUniforme(CLOSED, [{ date: FECHA, closed: false, intervals: [{ open: "08:00", close: "13:00" }] }]);
    assert.equal(evaluateBusinessHours(h, { fecha: FECHA, hora: "09:00", durationMin: 60 }).ok, true);
    assert.equal(evaluateBusinessHours(h, { fecha: FECHA, hora: "14:00", durationMin: 60 }).ok, false);
  });

  it("8. sin horario configurado (null) => ok (no bloquea, compat)", () => {
    assert.deepEqual(evaluateBusinessHours(null, { fecha: FECHA, hora: "03:00", durationMin: 60 }), { ok: true });
  });

  it("9. hora/duración inválida => config_invalida", () => {
    const h = semanaUniforme(openDay({ open: "09:00", close: "18:00" }));
    assert.equal(evaluateBusinessHours(h, { fecha: FECHA, hora: "25:99", durationMin: 60 }).ok, false);
    assert.equal(evaluateBusinessHours(h, { fecha: FECHA, hora: "10:00", durationMin: 0 }).ok, false);
  });

  it("10. helpers: hhmmToMinutes y tieneAlgunHorarioAbierto", () => {
    assert.equal(hhmmToMinutes("09:30"), 570);
    assert.equal(hhmmToMinutes("24:00"), null);
    assert.equal(tieneAlgunHorarioAbierto(semanaUniforme(openDay({ open: "09:00", close: "18:00" }))), true);
    assert.equal(tieneAlgunHorarioAbierto(semanaUniforme(CLOSED)), false);
    assert.equal(tieneAlgunHorarioAbierto(semanaUniforme(openDay({ open: "18:00", close: "09:00" }))), false); // close<=open
    assert.equal(tieneAlgunHorarioAbierto(null), false);
  });
});
