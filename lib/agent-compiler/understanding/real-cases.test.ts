// Business Agent 2.0, FASE 2 — casos reales por tipo de negocio (misma taxonomía para todos).
//
// La salida del modelo es la lectura que se espera de él para cada mensaje (guion fijo, sin red). Lo que se verifica
// es lo que hace el BACKEND con ella: fechas ancladas al reloj del servidor (sábado 26-09-2026, 10:00 Bogotá), horas
// solo si el texto del cliente las respalda, slots faltantes, correcciones y señales.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { understandMessage } from "@/lib/agent-compiler/understanding/engine";
import { mergeUnderstoodSlots } from "@/lib/agent-compiler/understanding/merge";
import type { SlotDefinition } from "@/lib/agent-compiler/understanding/slots";
import { fixedClock, input, intent, llm, scriptedProvider, silentLog } from "@/lib/agent-compiler/understanding/testing/harness";

async function understand(text: string, output: Record<string, unknown>, over: Parameters<typeof input>[1] = {}) {
  const r = await understandMessage({ provider: scriptedProvider(output), clock: fixedClock, log: silentLog() }, input(text, over));
  assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
  return r.understanding;
}

const values = (u: Awaited<ReturnType<typeof understand>>) => Object.fromEntries(Object.entries(u.slots).map(([k, s]) => [k, s.value ?? s.status]));

const TIENDA_SLOTS: SlotDefinition[] = [
  { name: "color", kind: "text", description: "Color", origin: "business" },
  { name: "talla", kind: "select", description: "Talla", options: ["S", "M", "L"], origin: "business" },
];

describe("FASE 2 — casos reales", () => {
  it("barbería: 'Hola soy Juan, quiero corte clásico mañana después de las 4.'", async () => {
    const u = await understand(
      "Hola soy Juan, quiero corte clásico mañana después de las 4.",
      llm({
        primaryIntent: intent("BOOKING_REQUEST", 0.93),
        secondaryIntents: [intent("GREETING", 0.6)],
        slots: [
          { name: "customer_name", raw: "Juan" },
          { name: "service", raw: "corte clásico" },
          { name: "date", raw: "mañana", value: "2026-09-27" },
          { name: "time_range", raw: "después de las 4", value: "16:00-" },
        ],
      }),
    );
    assert.deepEqual(values(u), {
      customer_name: { kind: "text", text: "Juan" },
      service: { kind: "text", text: "corte clásico" },
      date: { kind: "date", date: "2026-09-27" },
      time_range: { kind: "time_range", from: "16:00" },
    });
    assert.equal(u.slots.time_range!.normalizedBy, "validated_model_reading", "la tarde la leyó el modelo; el backend verificó que el cliente dijo 4");
    assert.deepEqual(u.missingSlots, [], "la franja cubre la hora esperada; el cupo real lo decide el calendario (FASE 3)");
  });

  it("tienda: 'Quiero dos camisetas negras talla M.'", async () => {
    const u = await understand(
      "Quiero dos camisetas negras talla M.",
      llm({
        primaryIntent: intent("ORDER_REQUEST", 0.94),
        slots: [
          { name: "quantity", raw: "dos" },
          { name: "product", raw: "camisetas" },
          { name: "color", raw: "negras" },
          { name: "talla", raw: "talla M" },
        ],
      }),
      { businessSlots: TIENDA_SLOTS },
    );
    assert.deepEqual(values(u), {
      quantity: { kind: "number", number: 2 },
      product: { kind: "text", text: "camisetas" },
      color: { kind: "text", text: "negras" },
      talla: { kind: "select", option: "M" },
    });
    assert.deepEqual(u.missingSlots, []);
  });

  it("restaurante: 'Somos 4, queremos cenar mañana a las 8.'", async () => {
    const u = await understand(
      "Somos 4, queremos cenar mañana a las 8.",
      llm({
        primaryIntent: intent("BOOKING_REQUEST", 0.9),
        slots: [
          { name: "party_size", raw: "4" },
          { name: "date", raw: "mañana" },
          { name: "time", raw: "a las 8", value: "20:00" },
        ],
      }),
    );
    assert.deepEqual(values(u), {
      party_size: { kind: "number", number: 4 },
      date: { kind: "date", date: "2026-09-27" },
      time: { kind: "time", time: "20:00" },
    });
    assert.equal(u.slots.time!.normalizedBy, "validated_model_reading");
    // "service" es una PISTA del intent (reserva genérica): si una mesa lo requiere lo decide el negocio en FASE 3.
    assert.deepEqual(u.missingSlots, ["service"]);
  });

  it("servicio: 'Necesito una sesión de fotos para el próximo sábado.'", async () => {
    const u = await understand(
      "Necesito una sesión de fotos para el próximo sábado.",
      llm({ primaryIntent: intent("BOOKING_REQUEST", 0.92), slots: [{ name: "service", raw: "sesión de fotos" }, { name: "date", raw: "para el próximo sábado" }] }),
    );
    assert.deepEqual(values(u), { service: { kind: "text", text: "sesión de fotos" }, date: { kind: "date", date: "2026-10-03" } });
    assert.deepEqual(u.missingSlots, ["time"]);
  });

  it("'¿Cuánto cuesta?': precio sin objeto, no se inventa", async () => {
    const u = await understand("¿Cuánto cuesta?", llm({ primaryIntent: intent("PRICE_INQUIRY", 0.9) }));
    assert.deepEqual([u.intent.primary.intent, u.slots, u.missingSlots], ["PRICE_INQUIRY", {}, []]);
  });

  it("'Quiero reservar.': intención clara, datos faltantes explícitos", async () => {
    const u = await understand("Quiero reservar.", llm({ primaryIntent: intent("BOOKING_REQUEST", 0.93) }));
    assert.deepEqual(u.missingSlots, ["service", "date", "time"]);
  });

  it("corrección en dos turnos: 'Mañana a las 4.' -> 'Bueno no, mejor a las 5.'", async () => {
    const t1 = await understand(
      "Mañana a las 4.",
      llm({ primaryIntent: intent("BOOKING_REQUEST", 0.85), slots: [{ name: "date", raw: "Mañana" }, { name: "time", raw: "a las 4", value: "16:00" }] }),
      { lastQuestion: "¿Para qué día y hora?" },
    );
    const m1 = mergeUnderstoodSlots({}, t1);
    assert.deepEqual(m1.slots, { date: "2026-09-27", time: "16:00" });

    const t2 = await understand(
      "Bueno no, mejor a las 5.",
      llm({ primaryIntent: intent("CORRECTION", 0.9), slots: [{ name: "time", raw: "a las 5", value: "17:00", correction: true }] }),
      { knownSlots: m1.slots },
    );
    const m2 = mergeUnderstoodSlots(m1.slots, t2);
    assert.deepEqual(m2.slots, { date: "2026-09-27", time: "17:00" }, "la hora se corrige; la fecha no mencionada se conserva");
    assert.deepEqual([m2.corrected, m2.untouched], [["time"], ["date"]]);
  });

  it("multi-intent: '¿Cuánto cuesta y tienen disponibilidad mañana?'", async () => {
    const u = await understand(
      "¿Cuánto cuesta y tienen disponibilidad mañana?",
      llm({ primaryIntent: intent("PRICE_INQUIRY", 0.88), secondaryIntents: [intent("AVAILABILITY_INQUIRY", 0.86)], slots: [{ name: "date", raw: "mañana" }] }),
    );
    assert.deepEqual([u.intent.primary.intent, u.intent.secondary[0]!.intent], ["PRICE_INQUIRY", "AVAILABILITY_INQUIRY"]);
    assert.deepEqual(u.slots.date!.value, { kind: "date", date: "2026-09-27" });
  });

  it("handoff: 'Quiero hablar con una persona.' es una señal; no se transfiere nada aquí", async () => {
    const u = await understand("Quiero hablar con una persona.", llm({ primaryIntent: intent("HUMAN_HANDOFF", 0.97) }));
    assert.deepEqual(u.signals.handoff, { requested: true, source: "both" });
  });
});
