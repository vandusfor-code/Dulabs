// Business Agent 2.0, FASE 4 (AH) — normalización horaria del Business Agent (sin tocar el parser compartido).
//
// La franja se conserva como franja (no se inventa una hora exacta); una hora sin am/pm solo se acepta si los números
// del cliente respaldan la lectura. Reloj fijo: sábado 26-09-2026 10:00 Bogotá.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { understandMessage } from "@/lib/agent-compiler/understanding/engine";
import { fixedClock, input, intent, llm, scriptedProvider } from "@/lib/agent-compiler/understanding/testing/harness";
import { parseHoraColombia } from "@/lib/parse-hora-colombia";

async function slots(text: string, slotList: Array<{ name: string; raw: string; value?: string }>) {
  const r = await understandMessage({ provider: scriptedProvider(llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: slotList })), clock: fixedClock, log: () => {} }, input(text));
  assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
  return r.understanding.slots;
}

describe("FASE 4 — normalización horaria del Business Agent", () => {
  it("'después de las 4': es una FRANJA; sin lectura del modelo queda ambigua (am/pm), nunca una hora inventada", async () => {
    const s = await slots("después de las 4", [{ name: "time_range", raw: "después de las 4" }]);
    assert.deepEqual([s.time_range!.status, s.time, s.time_range!.value], ["ambiguous", undefined, undefined]);
    const conLectura = await slots("después de las 4", [{ name: "time_range", raw: "después de las 4", value: "16:00-" }]);
    assert.deepEqual(conLectura.time_range!.value, { kind: "time_range", from: "16:00" });
  });

  it("'después de las 16': franja desde las 16:00 (parser)", async () => {
    const s = await slots("después de las 16", [{ name: "time_range", raw: "después de las 16" }]);
    assert.deepEqual([s.time_range!.value, s.time_range!.normalizedBy], [{ kind: "time_range", from: "16:00" }, "parser"]);
  });

  it("'a las 4 de la tarde' y '4 PM': hora exacta 16:00 (parser)", async () => {
    const a = await slots("a las 4 de la tarde", [{ name: "time", raw: "a las 4 de la tarde" }]);
    const b = await slots("4 PM", [{ name: "time", raw: "4 PM" }]);
    assert.deepEqual([a.time!.value, b.time!.value], [{ kind: "time", time: "16:00" }, { kind: "time", time: "16:00" }]);
  });

  it("'entre 4 y 6': franja; la lectura del modelo solo vale si la respaldan los números del cliente", async () => {
    const ok = await slots("entre 4 y 6", [{ name: "time_range", raw: "entre 4 y 6", value: "16:00-18:00" }]);
    assert.deepEqual(ok.time_range!.value, { kind: "time_range", from: "16:00", to: "18:00" });
    const sinLectura = await slots("entre 4 y 6", [{ name: "time_range", raw: "entre 4 y 6" }]);
    assert.equal(sinLectura.time_range!.status, "ambiguous");
  });

  it("'mañana después de las 4': fecha normalizada + franja, sin hora exacta", async () => {
    const s = await slots("mañana después de las 4", [{ name: "date", raw: "mañana" }, { name: "time_range", raw: "después de las 4", value: "16:00-" }]);
    assert.deepEqual([s.date!.value, s.time_range!.value, s.time], [{ kind: "date", date: "2026-09-27" }, { kind: "time_range", from: "16:00" }, undefined]);
  });

  it("'a las 4:30' sin am/pm: el parser compartido lo lee 04:30; el Business Agent no lo acepta a ciegas", async () => {
    assert.deepEqual(parseHoraColombia("4:30"), { ok: true, hhmm: "04:30" }, "comportamiento del parser compartido (no se modifica)");
    const sin = await slots("a las 4:30", [{ name: "time", raw: "a las 4:30" }]);
    assert.deepEqual([sin.time!.status, sin.time!.candidates], ["ambiguous", ["04:30", "16:30"]]);
    const tarde = await slots("a las 4:30", [{ name: "time", raw: "a las 4:30", value: "16:30" }]);
    assert.deepEqual([tarde.time!.value, tarde.time!.normalizedBy], [{ kind: "time", time: "16:30" }, "validated_model_reading"]);
    const inventada = await slots("a las 4:30", [{ name: "time", raw: "a las 4:30", value: "17:30" }]);
    assert.equal(inventada.time!.status, "ambiguous", "una lectura que no calza con 4:30 no se acepta");
    const explicita = await slots("16:30", [{ name: "time", raw: "16:30" }]);
    assert.deepEqual(explicita.time!.value, { kind: "time", time: "16:30" });
  });
});
