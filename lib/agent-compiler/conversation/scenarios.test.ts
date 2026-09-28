// Business Agent 2.0, FASE 3 — conversaciones completas de extremo a extremo (casos 33–39 y escenarios 1–6 del brief).
//
// Cada escenario pasa por el servicio real (entendimiento de FASE 2 + reducer + store con semántica de Postgres) con
// la configuración de un negocio distinto y la MISMA máquina de estados. La salida del modelo tiene guion (sin red);
// la ejecución de acciones la simula el test reportando ACTION_* como lo hará el Action Engine de FASE 4.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  barberSpec,
  createHarness,
  intent,
  llm,
  processed,
  restaurantSpec,
  storeSpec,
  studioSpec,
  values,
} from "@/lib/agent-compiler/conversation/testing/harness";
import { retailSpec } from "@/lib/agent-compiler/runtime/fixtures";

const S = (name: string, raw: string, extra: Record<string, unknown> = {}) => ({ name, raw, ...extra });
const at = () => new Date().toISOString();

describe("FASE 3 — conversaciones completas", () => {
  it("33 / Escenario 1. barbería: acumula sin repetir preguntas y llega a una reserva confirmada", async () => {
    const h = createHarness(barberSpec());
    const pasos = [];
    pasos.push(processed(await h.say("Hola soy Juan.", llm({ primaryIntent: intent("GREETING", 0.95), slots: [S("customer_name", "Juan")] }))));
    pasos.push(processed(await h.say("Quiero un corte clásico.", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("service", "corte clásico")] }))));
    pasos.push(processed(await h.say("Mañana.", llm({ primaryIntent: intent("BOOKING_REQUEST", 0.7), slots: [S("date", "Mañana")] }))));
    pasos.push(processed(await h.say("Después de las 4.", llm({ primaryIntent: intent("BOOKING_REQUEST", 0.7), slots: [S("time_range", "Después de las 4", { value: "16:00-" })] }))));

    assert.deepEqual(values(pasos[3]!), { customer_name: "Juan", service: "corte clásico", date: "2026-09-27", time_range: "16:00-" });
    // Lo que se preguntó en cada turno: nunca un dato ya dado.
    assert.deepEqual(
      pasos.map((p) => [p.responsePlan.intent, p.responsePlan.slot ?? p.responsePlan.action ?? null]),
      [["CONVERSATIONAL", null], ["ASK_FOR_SLOT", "date"], ["ASK_FOR_SLOT", "time"], ["AWAIT_ACTION_RESULT", "buscar_disponibilidad_nylas_generico"]],
    );
    // Falta la hora exacta: el backend pide la disponibilidad real dentro de la franja (la ejecuta FASE 4).
    const lookup = pasos[3]!.actionRequest!;
    assert.deepEqual([lookup.purpose, lookup.arguments, lookup.constraints], ["lookup", { servicio: "corte clásico", fecha: "2026-09-27" }, { franjaHoraria: "16:00-" }]);
    const ofrecidos = processed(await h.system({ type: "ACTION_SUCCEEDED", eventId: "lk-1", at: at(), actionId: lookup.id }));
    assert.deepEqual([ofrecidos.state.status, ofrecidos.responsePlan.slot], ["COLLECTING_INFORMATION", "time"]);

    // "a las 4:30" sin am/pm: la lectura 04:30 del modelo contradice la franja que pidió el cliente => se aclara.
    const dudosa = processed(await h.say("a las 4:30", llm({ primaryIntent: intent("BOOKING_REQUEST", 0.8), slots: [S("time", "a las 4:30", { value: "04:30" })] })));
    assert.deepEqual([dudosa.responsePlan.intent, dudosa.responsePlan.candidates], ["CLARIFY_SLOT", ["04:30", "16:30"]]);
    // La lectura 16:30 la respaldan los números del cliente y cae en su franja => se acepta.
    const hora = processed(await h.say("4:30", llm({ primaryIntent: intent("BOOKING_REQUEST", 0.8), slots: [S("time", "4:30", { value: "16:30" })] })));
    assert.deepEqual([hora.state.status, hora.responsePlan.intent], ["AWAITING_CONFIRMATION", "CONFIRM_ACTION"]);
    const si = processed(await h.say("Sí", llm({ primaryIntent: intent("CONFIRMATION", 0.95) })));
    assert.deepEqual(si.actionRequest!.arguments, { servicio: "corte clásico", fecha: "2026-09-27", hora: "16:30", nombreCliente: "Juan" });
    await h.system({ type: "ACTION_STARTED", eventId: "bk-s", at: at(), actionId: si.actionRequest!.id });
    const fin = processed(await h.system({ type: "ACTION_SUCCEEDED", eventId: "bk-ok", at: at(), actionId: si.actionRequest!.id }));
    assert.equal(fin.state.status, "COMPLETED");
  });

  it("34 / Escenario 2. tienda: conserva producto, cantidad, color y talla; cotiza (no finge tomar el pedido)", async () => {
    const h = createHarness(storeSpec());
    const r = processed(
      await h.say(
        "Quiero dos camisetas negras talla M.",
        llm({ primaryIntent: intent("ORDER_REQUEST", 0.94), slots: [S("quantity", "dos"), S("product", "camisetas"), S("color", "negras"), S("talla", "talla M")] }),
      ),
    );
    assert.deepEqual(values(r), { quantity: "2", product: "camisetas", color: "negras", talla: "M" });
    // No existe acción de runtime para pedidos: el objetivo se atiende como cotización real.
    assert.deepEqual([r.state.goal!.kind, r.actionRequest!.action, r.actionRequest!.arguments], ["quote", "calcular_cotizacion", { items: "2 camisetas" }]);
    assert.deepEqual(r.actionRequest!.customerData, { color: "negras", talla: "M" });

    // Otro negocio sin cotización: el pedido queda "no soportado" (se dice y se ofrece una persona), con los datos guardados.
    const sinVentas = retailSpec();
    sinVentas.capabilities = { ...sinVentas.capabilities, sales: false };
    const h2 = createHarness(sinVentas);
    const u = processed(await h2.say("Quiero dos camisetas", llm({ primaryIntent: intent("ORDER_REQUEST"), slots: [S("quantity", "dos"), S("product", "camisetas")] })));
    assert.deepEqual([u.nextStep.kind, u.responsePlan.intent, u.responsePlan.offerHandoff, values(u)], ["UNSUPPORTED", "UNSUPPORTED", true, { quantity: "2", product: "camisetas" }]);
  });

  it("35. restaurante: sin servicio (configuración), con número de personas obligatorio y el nombre al final", async () => {
    const h = createHarness(restaurantSpec());
    const r = processed(
      await h.say("Somos 4, queremos cenar mañana a las 8.", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("personas", "4"), S("date", "mañana"), S("time", "a las 8", { value: "20:00" })] })),
    );
    assert.deepEqual(values(r), { personas: "4", date: "2026-09-27", time: "20:00" });
    assert.deepEqual([r.responsePlan.intent, r.responsePlan.slot], ["ASK_FOR_SLOT", "customer_name"], "no pide 'servicio': este negocio no lo usa");
    const n = processed(await h.say("A nombre de Ana", llm({ primaryIntent: intent("BOOKING_REQUEST", 0.7), slots: [S("customer_name", "Ana")] })));
    assert.equal(n.state.status, "AWAITING_CONFIRMATION");
    const si = processed(await h.say("Sí", llm({ primaryIntent: intent("CONFIRMATION", 0.95) })));
    assert.deepEqual([si.actionRequest!.arguments, si.actionRequest!.customerData], [{ fecha: "2026-09-27", hora: "20:00", nombreCliente: "Ana" }, { nombreCliente: "Ana", personas: "4" }]);
  });

  it("36. servicio (estudio de fotos, agenda interna): fecha relativa normalizada y acción del proveedor configurado", async () => {
    const h = createHarness(studioSpec());
    const r = processed(
      await h.say("Necesito una sesión de fotos para el próximo sábado.", llm({ primaryIntent: intent("BOOKING_REQUEST", 0.92), slots: [S("service", "sesión de fotos"), S("date", "para el próximo sábado")] })),
    );
    assert.deepEqual(values(r), { service: "sesión de fotos", date: "2026-10-03" });
    assert.deepEqual([r.responsePlan.slot, r.actionRequest], ["time", null], "agenda interna: sin consulta Nylas, se pregunta la hora");
    await h.say("a las 10 de la mañana", llm({ primaryIntent: intent("BOOKING_REQUEST", 0.8), slots: [S("time", "a las 10 de la mañana")] }));
    await h.say("Soy Marta", llm({ primaryIntent: intent("GREETING", 0.6), slots: [S("customer_name", "Marta")] }));
    const si = processed(await h.say("Sí, confirmo", llm({ primaryIntent: intent("CONFIRMATION", 0.95) })));
    assert.deepEqual([si.actionRequest!.action, si.actionRequest!.arguments], ["agendar_cita_especialista", { servicio: "sesión de fotos", fecha: "2026-10-03", hora: "10:00", nombreCliente: "Marta" }]);
  });

  it("37 / Escenario 5. handoff: estado de handoff, datos conservados y el agente deja de responder", async () => {
    const h = createHarness(barberSpec(), { humanControl: true });
    await h.say("Quiero un corte clásico mañana", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("service", "corte clásico"), S("date", "mañana")] }));
    const r = processed(await h.say("Quiero hablar con una persona.", llm({ primaryIntent: intent("HUMAN_HANDOFF", 0.97) })));
    assert.deepEqual([r.state.status, r.state.handoff.status, r.actionRequest!.action], ["HANDOFF_PENDING", "requested", "transferir_soporte"]);
    // La transferencia real (FASE 4) activa la pausa: el agente no interpreta mientras la persona atiende.
    await h.system({ type: "ACTION_SUCCEEDED", eventId: "ho-1", at: at(), actionId: r.actionRequest!.id });
    h.human.active = true;
    const durante = await h.say("¿sigues ahí?", null);
    assert.equal(durante.outcome, "human_control");
    assert.deepEqual(values(durante), { service: "corte clásico", date: "2026-09-27" });
    // La persona libera la conversación: el agente retoma donde estaba.
    h.human.active = false;
    const retoma = processed(await h.say("a las 5 de la tarde", llm({ primaryIntent: intent("BOOKING_REQUEST", 0.8), slots: [S("time", "a las 5 de la tarde")] })));
    assert.deepEqual([retoma.state.status, retoma.state.handoff.status], ["COLLECTING_INFORMATION", "none"]);
    assert.equal(retoma.responsePlan.slot, "customer_name");
  });

  it("38 / Escenario 3. múltiples correcciones: solo queda la información vigente", async () => {
    const h = createHarness(barberSpec());
    await h.say("Soy Juan, quiero un corte clásico mañana a las 4 de la tarde", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("customer_name", "Juan"), S("service", "corte clásico"), S("date", "mañana"), S("time", "a las 4 de la tarde")] }));
    await h.say("no, el viernes", llm({ primaryIntent: intent("CORRECTION"), slots: [S("date", "el viernes", { correction: true })] }));
    const r = processed(await h.say("mejor a las 5", llm({ primaryIntent: intent("CORRECTION"), slots: [S("time", "a las 5", { value: "17:00", correction: true })] })));
    assert.deepEqual(values(r), { customer_name: "Juan", service: "corte clásico", date: "2026-10-02", time: "17:00" });
    assert.equal(r.state.status, "AWAITING_CONFIRMATION");

    // Tienda: "no quiero dos, quiero tres" y "cambia la camiseta negra por la azul".
    const t = createHarness(storeSpec());
    await t.say("Quiero dos camisetas negras", llm({ primaryIntent: intent("ORDER_REQUEST"), slots: [S("quantity", "dos"), S("product", "camisetas"), S("color", "negras")] }));
    await t.say("no quiero dos, quiero tres", llm({ primaryIntent: intent("CORRECTION"), slots: [S("quantity", "tres", { correction: true })] }));
    const c = processed(await t.say("cambia la camiseta negra por la azul", llm({ primaryIntent: intent("CORRECTION"), slots: [S("color", "azul", { correction: true })] })));
    assert.deepEqual(values(c), { quantity: "3", product: "camisetas", color: "azul" });
    assert.deepEqual([c.state.slots.quantity!.status, c.state.slots.color!.previous?.value], ["CORRECTED", { kind: "text", text: "negras" }]);
  });

  it("39. mensajes fuera de orden: un mensaje más viejo no pisa lo que dijo uno posterior", async () => {
    const h = createHarness(barberSpec());
    // B (15:10) llega antes que A (15:05).
    await h.say("Mejor el viernes", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("date", "el viernes")] }), { sentAt: "2026-09-26T15:10:00.000Z" });
    const a = processed(await h.say("Quiero corte clásico mañana", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("service", "corte clásico"), S("date", "mañana")] }), { sentAt: "2026-09-26T15:05:00.000Z" }));
    assert.deepEqual(values(a), { date: "2026-10-02", service: "corte clásico" });
    assert.ok(a.domainEvents.includes("STALE_MESSAGE"));
    assert.equal(a.state.lastMessageAt, "2026-09-26T15:10:00.000Z");
  });

  it("Escenario 4. ambigüedad: 'Quiero reservar.' no inventa servicio ni fecha", async () => {
    const h = createHarness(barberSpec());
    const r = processed(await h.say("Quiero reservar.", llm({ primaryIntent: intent("BOOKING_REQUEST", 0.93) })));
    assert.deepEqual([r.state.goal!.kind, r.state.slots, r.state.status, r.responsePlan.slot], ["booking", {}, "COLLECTING_INFORMATION", "service"]);
  });

  it("Escenario 6. confirmación: 'Sí.' solo confirma si hay una propuesta pendiente compatible", async () => {
    const h = createHarness(barberSpec());
    const suelto = processed(await h.say("Sí.", llm({ primaryIntent: intent("CONFIRMATION", 0.9) })));
    assert.deepEqual([suelto.state.status, suelto.actionRequest, suelto.domainEvents.includes("CONFIRMATION_IGNORED")], ["NEW", null, true]);
    await h.say("Soy Juan, corte clásico mañana a las 4 de la tarde", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("customer_name", "Juan"), S("service", "corte clásico"), S("date", "mañana"), S("time", "a las 4 de la tarde")] }));
    const si = processed(await h.say("Sí.", llm({ primaryIntent: intent("CONFIRMATION", 0.95) })));
    assert.deepEqual([si.state.status, si.actionRequest!.action], ["READY_FOR_ACTION", "crear_cita_nylas_generico"]);
  });
});
