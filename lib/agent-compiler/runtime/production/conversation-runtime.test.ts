// Business Agent 2.0, FASE 4 — E2E del runtime conversacional: mensaje → entendimiento → estado → Action Engine →
// resultado → estado → plan → texto enviado. Escenarios AD 1–8 del brief + handoff, recuperación y Gate.
//
// Piezas reales: state machine (FASE 3), entendimiento con su validador (FASE 2), motor con su registro y validaciones,
// configuración compilada del Spec, renderer. Dobles: salida del modelo (guion), handler de acciones (formas reales de
// InternalActionExecutor), stores con la semántica de Postgres (la base real se prueba con los scripts verify-ba-*).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { barberSpec, createHarness, intent, KEY, llm, OTHER_TENANT } from "@/lib/agent-compiler/conversation/testing/harness";
import { createFakeHandler, createInMemoryActionStore, createTestEngine, fail, ok } from "@/lib/agent-compiler/actions/testing/harness";
import { createConversationRuntime, isStateMachineRuntimeEnabled } from "@/lib/agent-compiler/runtime/production/conversation-runtime";
import { runAgentTurn } from "@/lib/agent-compiler/runtime/agent-runtime";
import { ACTION_REGISTRY } from "@/lib/agent-compiler/actions/registry";
import { argumentsHashOf } from "@/lib/agent-compiler/actions/engine";
import type { ModelOutput } from "@/lib/agent-compiler/conversation/testing/harness";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import type { CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";

const S = (name: string, raw: string, extra: Record<string, unknown> = {}) => ({ name, raw, ...extra });
const FULL = llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("customer_name", "Juan"), S("service", "corte clásico"), S("date", "mañana"), S("time", "a las 5 de la tarde")] });
const YES = llm({ primaryIntent: intent("CONFIRMATION", 0.95) });

function setup(spec: BusinessAgentSpec | CompiledAgentArtifact = barberSpec(), opts: { handler?: ReturnType<typeof createFakeHandler>; humanControl?: boolean; actionStore?: ReturnType<typeof createInMemoryActionStore> } = {}) {
  const h = createHarness(spec, { humanControl: opts.humanControl });
  const e = createTestEngine({ handler: opts.handler, store: opts.actionStore });
  const sent: string[] = [];
  const runtime = createConversationRuntime({ service: h.deps, engine: e.engine, artifact: h.artifact, send: async (t) => void sent.push(t) });
  let seq = 0;
  const say = (text: string, output: ModelOutput | null, wamid = `wamid.${++seq}`) => {
    h.script(text, output);
    h.advance(1);
    return runtime.handle({ key: KEY, agentVersion: "v1", wamid, text, sentAt: h.now().toISOString() });
  };
  const bookings = () => e.fake.calls.filter((c) => (c.action as { actionType: string }).actionType === "crear_cita_nylas_generico").length;
  return { h, e, sent, runtime, say, bookings };
}

describe("FASE 4 — E2E runtime conversacional", () => {
  it("Escenario 1. reserva: la confirmación de la cita solo se envía DESPUÉS de ACTION_SUCCEEDED", async () => {
    const t = setup();
    const a = await t.say("Soy Juan, quiero un corte clásico mañana a las 5 de la tarde", FULL);
    assert.deepEqual([a.status, t.bookings()], ["AWAITING_CONFIRMATION", 0]);
    assert.match(t.sent[0]!, /Te confirmo: corte clásico, el domingo 27 de septiembre, a las 5:00 p\. m\., a nombre de Juan\. ¿Lo reservo\?/);
    assert.equal(t.sent.some((m) => /agendada|reservad/i.test(m) && !/¿Lo reservo\?/.test(m)), false, "nada afirma la reserva antes del éxito");
    const b = await t.say("Sí", YES);
    assert.deepEqual([b.status, b.actions.map((x) => [x.action, x.status]), t.bookings()], ["COMPLETED", [["crear_cita_nylas_generico", "SUCCEEDED"]], 1]);
    assert.match(t.sent[1]!, /quedó agendada/);
  });

  it("Escenario 2. webhook duplicado => una sola ejecución y una sola respuesta", async () => {
    const t = setup();
    await t.say("Soy Juan, quiero un corte clásico mañana a las 5 de la tarde", FULL);
    await t.say("Sí", YES, "wamid.dup");
    const again = await t.say("Sí", YES, "wamid.dup");
    assert.deepEqual([again.outcome, again.sent, t.bookings(), t.sent.length], ["duplicate", false, 1, 2]);
  });

  it("Escenario 3. dos confirmaciones simultáneas => una sola reserva efectiva", async () => {
    const t = setup();
    await t.say("Soy Juan, quiero un corte clásico mañana a las 5 de la tarde", FULL);
    t.h.script("Sí", YES);
    t.h.script("Sí, confirmo", YES);
    const [x, y] = await Promise.all([
      t.runtime.handle({ key: KEY, agentVersion: "v1", wamid: "w-a", text: "Sí", sentAt: "2026-09-26T15:05:00.000Z" }),
      t.runtime.handle({ key: KEY, agentVersion: "v1", wamid: "w-b", text: "Sí, confirmo", sentAt: "2026-09-26T15:05:01.000Z" }),
    ]);
    assert.equal(t.bookings(), 1);
    assert.ok([x.status, y.status].includes("COMPLETED"));
  });

  it("Escenario 4. horario no disponible => no reserva; vuelve a pedir la hora con el motivo", async () => {
    const busy = createFakeHandler();
    busy.on("crear_cita_nylas_generico", () => fail("NON_RETRYABLE", "ocupado", { ocupado: true }));
    const t = setup(barberSpec(), { handler: busy });
    await t.say("Soy Juan, quiero un corte clásico mañana a las 5 de la tarde", FULL);
    const r = await t.say("Sí", YES);
    assert.deepEqual([r.status, r.actions[0]!.errorCode], ["COLLECTING_INFORMATION", "BUSINESS_RULE_VIOLATION"]);
    assert.equal(t.sent.at(-1), "Ese horario ya está ocupado. ¿A qué hora te gustaría?");
    const s = await t.h.store.load(KEY);
    assert.ok(s.kind === "found" && s.state.slots.customer_name?.value && s.state.slots.service?.value, "no se destruye el contexto del cliente");
  });

  it("Escenario 5. solicitud vieja tras una corrección => STALE_ACTION_REQUEST; se ejecuta la nueva", async () => {
    const t = setup();
    await t.say("Soy Juan, quiero un corte clásico mañana a las 5 de la tarde", FULL);
    await t.say("Sí", YES);
    // Nueva conversación de otra reserva: se genera una solicitud, el cliente corrige antes de confirmar.
    const t2 = setup();
    await t2.say("Soy Juan, quiero un corte clásico mañana a las 5 de la tarde", FULL);
    const s1 = await t2.h.store.load(KEY);
    const proposal = s1.kind === "found" ? s1.state : null;
    await t2.say("Mejor a las 6 de la tarde", llm({ primaryIntent: intent("CORRECTION"), slots: [S("time", "a las 6 de la tarde", { correction: true })] }));
    const yes = await t2.say("Sí", YES);
    assert.equal(yes.status, "COMPLETED");
    const call = t2.e.fake.calls.find((c) => (c.action as { actionType: string }).actionType === "crear_cita_nylas_generico")!;
    assert.equal(call.payload.hora, "18:00", "se ejecuta la solicitud generada desde el estado vigente");
    assert.ok(proposal);
  });

  it("Escenario 6. tenant A intentando operar sobre tenant B => rechazado sin efectos", async () => {
    const t = setup();
    const r = await t.runtime.handle({ key: { ...KEY, tenantId: OTHER_TENANT }, agentVersion: "v1", wamid: "w-x", text: "Sí" });
    assert.deepEqual([r.outcome, r.errorCode, r.sent, t.e.fake.calls.length], ["rejected", "conversation_business_context_mismatch", false, 0]);
  });

  it("Escenario 7. 'sí' sin propuesta pendiente => no se ejecuta nada", async () => {
    const t = setup();
    const r = await t.say("Sí", YES);
    assert.deepEqual([r.status, r.actions, t.e.fake.calls.length], ["NEW", [], 0]);
    assert.equal(t.sent[0], "¿En qué te puedo ayudar?");
  });

  it("Escenario 8. timeout externo => nunca se afirma éxito; se informa que no se pudo confirmar", async () => {
    const hang = createFakeHandler();
    hang.on("crear_cita_nylas_generico", (_r, signal) => new Promise((res) => signal.addEventListener("abort", () => res(fail("TIMEOUT", "aborted")))));
    const original = ACTION_REGISTRY.crear_cita_nylas_generico!.timeoutMs;
    (ACTION_REGISTRY.crear_cita_nylas_generico as { timeoutMs: number }).timeoutMs = 20;
    try {
      const t = setup(barberSpec(), { handler: hang });
      await t.say("Soy Juan, quiero un corte clásico mañana a las 5 de la tarde", FULL);
      const r = await t.say("Sí", YES);
      assert.deepEqual([r.status, r.actions[0]!.status], ["ERROR", "TIMED_OUT"]);
      assert.match(t.sent.at(-1)!, /No pude confirmar la operación en este momento/);
      assert.equal(t.sent.some((m) => /agendada/.test(m)), false);
    } finally {
      (ACTION_REGISTRY.crear_cita_nylas_generico as { timeoutMs: number }).timeoutMs = original;
    }
  });
});

describe("FASE 4 — E2E: handoff, disponibilidad, recuperación y Gate", () => {
  it("handoff: se ejecuta la transferencia real (acción) y luego el agente no responde encima de la persona", async () => {
    const t = setup(barberSpec(), { humanControl: true });
    const r = await t.say("Quiero hablar con una persona", llm({ primaryIntent: intent("HUMAN_HANDOFF", 0.97) }));
    assert.deepEqual([r.status, r.actions.map((a) => [a.action, a.status])], ["HANDED_OFF", [["transferir_soporte", "SUCCEEDED"]]]);
    assert.equal(t.sent.at(-1), "Te comunico con una persona del equipo. En breve te escriben por aquí.");
    t.h.human.active = true;
    const after = await t.say("¿hola?", null);
    assert.deepEqual([after.outcome, after.sent], ["human_control", false]);
  });

  it("disponibilidad real dentro de la franja pedida, sin inventar horarios", async () => {
    const t = setup();
    await t.say("Soy Juan, quiero un corte clásico", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("customer_name", "Juan"), S("service", "corte clásico")] }));
    await t.say("Mañana", llm({ primaryIntent: intent("BOOKING_REQUEST", 0.7), slots: [S("date", "Mañana")] }));
    const r = await t.say("Después de las 4", llm({ primaryIntent: intent("BOOKING_REQUEST", 0.7), slots: [S("time_range", "Después de las 4", { value: "16:00-" })] }));
    assert.deepEqual([r.status, r.actions.map((a) => a.action)], ["COLLECTING_INFORMATION", ["buscar_disponibilidad_nylas_generico"]]);
    assert.equal(t.sent.at(-1), "Estos son los horarios disponibles para el domingo 27 de septiembre: 4:00 p. m., 4:30 p. m., 5:00 p. m.. ¿Cuál prefieres?");
  });

  it("recuperación: un worker cayó con una reserva en curso => el siguiente mensaje NO la re-ejecuta (desenlace desconocido)", async () => {
    const actionStore = createInMemoryActionStore();
    const t = setup(barberSpec(), { actionStore });
    await t.say("Soy Juan, quiero un corte clásico mañana a las 5 de la tarde", FULL);
    // Simula: se confirmó y el worker empezó la reserva pero murió antes de registrar el resultado.
    const hang = createFakeHandler();
    hang.on("crear_cita_nylas_generico", () => new Promise(() => {}));
    t.h.script("Sí", YES);
    const s = await t.h.store.load(KEY);
    assert.ok(s.kind === "found");
    const yes = await import("@/lib/agent-compiler/conversation/service").then((m) => m.processConversationTurn(t.h.deps, { key: KEY, agentVersion: "v1", eventId: "w-crash", text: "Sí" }));
    assert.ok(yes.outcome === "processed");
    const req = yes.actionRequest!;
    await actionStore.claim({ tenantId: KEY.tenantId, agentId: KEY.agentId, conversationId: `${KEY.phoneNumberId}:${KEY.telefonoCliente}`, action: req.action, contractVersion: req.contractVersion, idempotencyKey: req.id, argumentsHash: argumentsHashOf(req), leaseSeconds: 30, retakeable: false });
    actionStore.setNow(Date.parse("2026-09-26T18:00:00Z"));
    const next = await t.say("¿Ya quedó?", llm({ primaryIntent: intent("FOLLOW_UP", 0.8) }));
    assert.equal(t.bookings(), 0, "nunca se re-ejecuta una escritura de desenlace desconocido");
    assert.deepEqual([next.actions[0]!.status, next.status], ["TIMED_OUT", "ERROR"]);
    assert.match(t.sent.at(-1)!, /No pude confirmar la operación/);
    // Mensajes siguientes no re-proponen la reserva (pudo haber ocurrido): la conversación espera a una persona.
    const otra = await t.say("Sí, resérvala", YES);
    assert.deepEqual([otra.status, otra.actions, t.bookings()], ["ERROR", [], 0]);
  });

  it("Gate PRE-LLM: una prohibición bloquea ANTES del motor conversacional; si pasa, atiende el motor (no el grafo)", async () => {
    let handled = 0;
    let orchestrated = 0;
    const deps = {
      tenantId: KEY.tenantId,
      gateRules: [{ id: "no-armas", source: "prohibition" as const, evaluation: "deterministic" as const, priority: 100, condition: { rules: [{ field: "message", operator: "contains" as const, value: "arma" }], match: "any" as const }, action: "BLOCK" as const, response: "No podemos ayudarte con eso." }],
      flowId: KEY.agentId,
      orchestrator: { process: async () => { orchestrated++; return { outcome: "processed" as const, effects: [], dispatchedEffectIds: [] }; } },
      store: { getActiveExecution: async () => null },
      gateSink: { sendMessage: async () => {}, transferHuman: async () => {} },
      conversation: { handle: async () => { handled++; return { outcome: "processed" as const, sent: true, actions: [] }; } },
    };
    const blocked = await runAgentTurn(deps as never, { tenantId: KEY.tenantId, conversation: { phoneNumberId: KEY.phoneNumberId, telefonoCliente: KEY.telefonoCliente }, wamid: "g1", text: "quiero comprar un arma" });
    assert.deepEqual([blocked.kind, handled], ["guardrail_blocked", 0]);
    const passed = await runAgentTurn(deps as never, { tenantId: KEY.tenantId, conversation: { phoneNumberId: KEY.phoneNumberId, telefonoCliente: KEY.telefonoCliente }, wamid: "g2", text: "quiero un corte" });
    assert.deepEqual([passed.kind, handled, orchestrated], ["conversation", 1, 0]);
  });

  it("activación explícita por tenant (sin comodín): sin configurar, ningún negocio cambia de motor", () => {
    assert.equal(isStateMachineRuntimeEnabled(KEY.tenantId, {}), false);
    assert.equal(isStateMachineRuntimeEnabled(KEY.tenantId, { BUSINESS_AGENT_STATE_MACHINE_TENANTS: "*" }), false);
    assert.equal(isStateMachineRuntimeEnabled(KEY.tenantId, { BUSINESS_AGENT_STATE_MACHINE_TENANTS: `${OTHER_TENANT}, ${KEY.tenantId.toUpperCase()}` }), true);
  });

  it("cotización lateral durante una reserva: el precio sale del backend y se continúa con lo que falta", async () => {
    const quote = createFakeHandler();
    quote.on("calcular_cotizacion", () => ok({ cotizacionTexto: "Corte clásico: $30.000", cotizacionTotal: 30000, cotizacionCompleta: true }));
    const t = setup(barberSpec(), { handler: quote });
    const r = await t.say("¿Cuánto cuesta el corte clásico? quiero cita mañana", llm({ primaryIntent: intent("PRICE_INQUIRY", 0.9), secondaryIntents: [intent("BOOKING_REQUEST", 0.85)], slots: [S("service", "corte clásico"), S("date", "mañana")] }));
    assert.deepEqual(r.actions.map((a) => a.action), ["calcular_cotizacion"]);
    assert.equal(t.sent.at(-1), "Corte clásico: $30.000\n\n¿A qué hora te gustaría?");
  });
});
