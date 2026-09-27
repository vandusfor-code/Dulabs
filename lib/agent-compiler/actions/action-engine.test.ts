// Business Agent 2.0, FASE 4 — Action Engine: tests unitarios/integración (AB 1–20) y seguridad (Y 1–20).
//
// Estado REAL (state machine de FASE 3 con entendimiento de FASE 2), configuración REAL (Spec compilado), store con la
// semántica de las funciones de Postgres. El handler es un doble con las respuestas reales de InternalActionExecutor.
// La atomicidad en la base se verifica aparte contra PostgreSQL: scripts/verify-ba-action-engine.sh.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { barberSpec, createHarness, intent, llm, processed, KEY, OTHER_TENANT, studioSpec } from "@/lib/agent-compiler/conversation/testing/harness";
import { contextFor, createTestEngine, createFakeHandler, createInMemoryActionStore, fail, ok } from "@/lib/agent-compiler/actions/testing/harness";
import { argumentsHashOf, filterSlotsByRange } from "@/lib/agent-compiler/actions/engine";
import { ACTION_REGISTRY } from "@/lib/agent-compiler/actions/registry";
import { parseActionResult } from "@/lib/agent-compiler/actions/result";
import { getActionContract } from "@/lib/agent-compiler/contracts/action-contracts";
import { reduceConversation } from "@/lib/agent-compiler/conversation/transitions";
import { buildAgentRequirements } from "@/lib/agent-compiler/conversation/requirements";
import type { ActionRequest } from "@/lib/agent-compiler/conversation/model";

const S = (name: string, raw: string, extra: Record<string, unknown> = {}) => ({ name, raw, ...extra });

/** Barbería con todos los datos y el "sí" del cliente: READY_FOR_ACTION con la reserva confirmada. */
async function readyBooking() {
  const h = createHarness(barberSpec());
  await h.say("Soy Juan, corte clásico mañana a las 5 de la tarde", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("customer_name", "Juan"), S("service", "corte clásico"), S("date", "mañana"), S("time", "a las 5 de la tarde")] }));
  const r = processed(await h.say("Sí", llm({ primaryIntent: intent("CONFIRMATION", 0.95) })));
  assert.equal(r.state.status, "READY_FOR_ACTION");
  return { h, state: r.state, request: r.actionRequest! };
}

const clone = <T>(x: T): T => structuredClone(x);

describe("FASE 4 — Action Engine: ejecución, validación y autorización", () => {
  it("1. acción válida: SUCCEEDED con datos permitidos, handler real con config compilada y claves deterministas", async () => {
    const { state, request } = await readyBooking();
    const { engine, fake, events } = createTestEngine();
    const r = await engine.execute(request, contextFor(barberSpec(), state));
    assert.equal(r.status, "SUCCEEDED");
    assert.deepEqual(Object.keys(r.data).sort(), ["citaId", "fin", "inicio", "reservaTexto", "status"]);
    const call = fake.calls[0]!;
    assert.equal((call.action as { actionType: string }).actionType, "crear_cita_nylas_generico");
    assert.ok(typeof (call.action as { params: Record<string, string> }).params.businessHoursJson === "string", "horario del Spec publicado, no del modelo");
    assert.deepEqual([call.payload.fecha, call.payload.hora, call.payload.appointment_request, call.payload.appointment_pick, call.payload.nombreCliente], ["2026-09-27", "17:00", "2026-09-27", "17:00", "Juan"]);
    assert.deepEqual([call.effectId, call.executionRowId, call.tenantId], [`${request.id}:crear_cita_nylas_generico`, `ba-action:${request.id}`, KEY.tenantId]);
    assert.deepEqual(events.map((e) => [e.action, e.status, e.errorCode]), [["crear_cita_nylas_generico", "SUCCEEDED", null]]);
  });

  it("2. acción inexistente => REJECTED INVALID_ACTION, sin ejecutar", async () => {
    const { state, request } = await readyBooking();
    const { engine, fake } = createTestEngine();
    const r = await engine.execute({ ...request, action: "crear_pedido" }, contextFor(barberSpec(), state));
    assert.deepEqual([r.status, r.error?.code, r.error?.reason, fake.calls.length], ["REJECTED", "INVALID_ACTION", "UNKNOWN_ACTION", 0]);
  });

  it("3. contrato inválido: versión o efecto distinto => INVALID_CONTRACT", async () => {
    const { state, request } = await readyBooking();
    const { engine, fake } = createTestEngine();
    const v = await engine.execute({ ...request, contractVersion: "0.9.0" }, contextFor(barberSpec(), state));
    assert.deepEqual([v.error?.code, v.error?.reason], ["INVALID_CONTRACT", "CONTRACT_VERSION_MISMATCH"]);
    const e = await engine.execute({ ...request, sideEffects: "read_internal" }, contextFor(barberSpec(), state));
    assert.deepEqual([e.error?.code, e.error?.reason], ["INVALID_CONTRACT", "SIDE_EFFECT_MISMATCH"]);
    assert.equal(fake.calls.length, 0);
  });

  it("4. argumentos inválidos o adicionales => INVALID_ARGUMENTS (no se 'ignoran')", async () => {
    const { state, request } = await readyBooking();
    const { engine, fake } = createTestEngine();
    const extra = await engine.execute({ ...request, arguments: { ...request.arguments, tenantId: OTHER_TENANT } }, contextFor(barberSpec(), state));
    assert.deepEqual([extra.error?.code, extra.error?.reason], ["INVALID_ARGUMENTS", "ARGUMENTS_VIOLATE_CONTRACT"]);
    const largo = await engine.execute({ ...request, arguments: { ...request.arguments, servicio: "x".repeat(300) } }, contextFor(barberSpec(), state));
    assert.equal(largo.error?.code, "INVALID_ARGUMENTS");
    const restr = await engine.execute({ ...request, constraints: { permisos: "admin" } }, contextFor(barberSpec(), state));
    assert.deepEqual([restr.error?.code, restr.error?.reason], ["INVALID_ARGUMENTS", "UNKNOWN_CONSTRAINT"]);
    const cliente = await engine.execute({ ...request, customerData: { rol: "admin" } }, contextFor(barberSpec(), state));
    assert.deepEqual([cliente.error?.code, cliente.error?.reason], ["INVALID_ARGUMENTS", "UNKNOWN_CUSTOMER_FIELD"]);
    assert.equal(fake.calls.length, 0);
  });

  it("5. autorización: capacidad desactivada o proveedor distinto en el Spec publicado => UNAUTHORIZED", async () => {
    const { state, request } = await readyBooking();
    const { engine, fake } = createTestEngine();
    const sinAgenda = barberSpec();
    sinAgenda.capabilities = { ...sinAgenda.capabilities, scheduling: false };
    const a = await engine.execute(request, { ...contextFor(barberSpec(), state), spec: sinAgenda });
    assert.deepEqual([a.error?.code, a.error?.reason], ["UNAUTHORIZED", "CAPABILITY_DISABLED"]);
    const interno = barberSpec();
    interno.scheduling = { ...interno.scheduling, provider: "internal" };
    const b = await engine.execute(request, { ...contextFor(barberSpec(), state), spec: interno });
    assert.deepEqual([b.error?.code, b.error?.reason], ["UNAUTHORIZED", "SCHEDULING_PROVIDER_MISMATCH"]);
    assert.equal(fake.calls.length, 0);
  });

  it("6. tenant isolation: contexto de otro tenant / agente / conversación => TENANT_ERROR", async () => {
    const { state, request } = await readyBooking();
    const { engine, fake } = createTestEngine();
    for (const over of [{ tenantId: OTHER_TENANT }, { agentId: "flow-otro" }, { conversation: { phoneNumberId: KEY.phoneNumberId, telefonoCliente: "573009999999" } }]) {
      const r = await engine.execute(request, { ...contextFor(barberSpec(), state), ...over });
      assert.deepEqual([r.status, r.error?.code], ["REJECTED", "TENANT_ERROR"]);
    }
    assert.equal(fake.calls.length, 0);
  });
});

describe("FASE 4 — idempotencia y concurrencia (motor)", () => {
  it("7/8/9. primera ejecución, duplicado en curso y replay completado: UNA sola llamada real", async () => {
    const { state, request } = await readyBooking();
    const store = createInMemoryActionStore();
    const { engine, fake } = createTestEngine({ store });
    const first = await engine.execute(request, contextFor(barberSpec(), state));
    assert.deepEqual([first.status, first.replayed, first.attempt], ["SUCCEEDED", false, 1]);
    const replay = await engine.execute(request, contextFor(barberSpec(), state));
    assert.deepEqual([replay.status, replay.replayed, replay.data.citaId], ["SUCCEEDED", true, "evt_123"]);
    assert.equal(fake.calls.length, 1, "el replay devuelve el resultado guardado: no se reserva dos veces");
    // Duplicado mientras la primera sigue en vuelo.
    const store2 = createInMemoryActionStore();
    const slow = createFakeHandler();
    let release!: () => void;
    slow.on("crear_cita_nylas_generico", () => new Promise((res) => (release = () => res(ok({ citaId: "evt_9", status: "confirmada", inicio: "x", fin: "y", reservaTexto: "ok" })))));
    const e2 = createTestEngine({ store: store2, handler: slow });
    const running = e2.engine.execute(request, contextFor(barberSpec(), state));
    await new Promise((r) => setImmediate(r));
    const dup = await e2.engine.execute(request, contextFor(barberSpec(), state));
    assert.deepEqual([dup.status, dup.error?.reason], ["IN_PROGRESS", "EXECUTION_IN_PROGRESS"]);
    release();
    assert.equal((await running).status, "SUCCEEDED");
    assert.equal(slow.calls.length, 1);
  });

  it("10. concurrencia: N ejecuciones simultáneas de la misma solicitud => exactamente una llamada al handler", async () => {
    const { state, request } = await readyBooking();
    const { engine, fake } = createTestEngine();
    const results = await Promise.all(Array.from({ length: 8 }, () => engine.execute(request, contextFor(barberSpec(), state))));
    assert.equal(fake.calls.length, 1);
    assert.equal(results.filter((r) => r.status === "SUCCEEDED").length >= 1, true);
    assert.ok(results.every((r) => r.status === "SUCCEEDED" || r.status === "IN_PROGRESS"));
  });

  it("clave reutilizada con otra operación => IDEMPOTENCY_CONFLICT", async () => {
    const { state, request } = await readyBooking();
    const store = createInMemoryActionStore();
    const { engine } = createTestEngine({ store });
    await engine.execute(request, contextFor(barberSpec(), state));
    const row = [...store.rows.values()][0]!;
    row.argumentsHash = "f".repeat(64);
    const r = await engine.execute(request, contextFor(barberSpec(), state));
    assert.deepEqual([r.status, r.error?.code], ["REJECTED", "IDEMPOTENCY_CONFLICT"]);
  });

  it("candado de reserva: otra conversación del mismo negocio y fecha espera (CONFLICT reintentable), sin reservar", async () => {
    const { state, request } = await readyBooking();
    const store = createInMemoryActionStore();
    await store.acquireLock({ tenantId: KEY.tenantId, lockKey: "booking:2026-09-27", holder: "otra-conversacion", leaseSeconds: 30 });
    const { engine, fake } = createTestEngine({ store });
    const r = await engine.execute(request, contextFor(barberSpec(), state));
    assert.deepEqual([r.status, r.error?.code, r.error?.reason, r.error?.retryable, fake.calls.length], ["FAILED", "CONFLICT", "BOOKING_IN_PROGRESS", true, 0]);
  });
});

describe("FASE 4 — timeouts, reintentos y errores", () => {
  it("11. timeout de una ESCRITURA => TIMED_OUT ambiguo; un reintento NUNCA la re-ejecuta", async () => {
    const { state, request } = await readyBooking();
    const store = createInMemoryActionStore();
    const hang = createFakeHandler();
    hang.on("crear_cita_nylas_generico", (_r, signal) => new Promise((res) => signal.addEventListener("abort", () => res(fail("TIMEOUT", "aborted")))));
    const original = ACTION_REGISTRY.crear_cita_nylas_generico!.timeoutMs;
    (ACTION_REGISTRY.crear_cita_nylas_generico as { timeoutMs: number }).timeoutMs = 20;
    try {
      const { engine } = createTestEngine({ store, handler: hang });
      const r = await engine.execute(request, contextFor(barberSpec(), state));
      assert.deepEqual([r.status, r.error?.code, r.error?.ambiguous, r.error?.retryable], ["TIMED_OUT", "TIMEOUT", true, false]);
      const again = await engine.execute(request, contextFor(barberSpec(), state));
      assert.deepEqual([again.status, again.replayed], ["TIMED_OUT", true]);
      assert.equal(hang.calls.length, 1, "no se re-ejecuta una escritura de desenlace desconocido");
    } finally {
      (ACTION_REGISTRY.crear_cita_nylas_generico as { timeoutMs: number }).timeoutMs = original;
    }
  });

  it("11b. worker caído a mitad de una escritura (lease vencido) => desenlace desconocido, no se re-ejecuta", async () => {
    const { state, request } = await readyBooking();
    const store = createInMemoryActionStore();
    await store.claim({ tenantId: KEY.tenantId, agentId: KEY.agentId, conversationId: `${KEY.phoneNumberId}:${KEY.telefonoCliente}`, action: request.action, contractVersion: request.contractVersion, idempotencyKey: request.id, argumentsHash: argumentsHashOf(request), leaseSeconds: 30, retakeable: false });
    store.setNow(Date.parse("2026-09-26T16:00:00Z"));
    const { engine, fake } = createTestEngine({ store });
    const r = await engine.execute(request, contextFor(barberSpec(), state));
    assert.deepEqual([r.status, r.error?.reason, r.error?.ambiguous, fake.calls.length], ["TIMED_OUT", "OUTCOME_UNKNOWN", true, 0]);
  });

  it("12. error transitorio en una LECTURA => reintento con backoff acotado y éxito", async () => {
    const h = createHarness(barberSpec());
    const r0 = processed(await h.say("Corte clásico mañana después de las 4", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("service", "corte clásico"), S("date", "mañana"), S("time_range", "después de las 4", { value: "16:00-" })] })));
    assert.equal(r0.actionRequest!.action, "buscar_disponibilidad_nylas_generico");
    const flaky = createFakeHandler();
    let n = 0;
    flaky.on("buscar_disponibilidad_nylas_generico", () => (++n === 1 ? fail("RETRYABLE", "disponibilidad_no_disponible:error_tecnico") : ok({ fecha: "2026-09-27", horariosDisponibles: ["16:00", "17:00"], hayCupos: true })));
    const { engine, sleeps } = createTestEngine({ handler: flaky });
    const r = await engine.execute(r0.actionRequest!, contextFor(barberSpec(), r0.state));
    assert.deepEqual([r.status, n, sleeps], ["SUCCEEDED", 2, [300]]);
  });

  it("13. error permanente => sin reintentos; reintentables solo hasta el máximo", async () => {
    const h = createHarness(barberSpec());
    const r0 = processed(await h.say("Corte clásico mañana después de las 4", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("service", "corte clásico"), S("date", "mañana"), S("time_range", "después de las 4", { value: "16:00-" })] })));
    const down = createFakeHandler();
    down.on("buscar_disponibilidad_nylas_generico", () => fail("RETRYABLE", "disponibilidad_no_disponible:error_tecnico"));
    const { engine, sleeps } = createTestEngine({ handler: down });
    const r = await engine.execute(r0.actionRequest!, contextFor(barberSpec(), r0.state));
    assert.deepEqual([r.status, r.error?.code, down.calls.length, sleeps.length], ["FAILED", "EXTERNAL_ERROR", 2, 1]);
    const perm = createFakeHandler();
    perm.on("buscar_disponibilidad_nylas_generico", () => fail("NON_RETRYABLE", "disponibilidad_no_disponible:calendario_no_conectado"));
    const e2 = createTestEngine({ handler: perm });
    const p = await e2.engine.execute(r0.actionRequest!, contextFor(barberSpec(), r0.state));
    assert.deepEqual([p.error?.code, p.error?.reason, perm.calls.length, e2.sleeps.length], ["BUSINESS_RULE_VIOLATION", "CALENDAR_NOT_CONNECTED", 1, 0]);
  });

  it("14. regla de negocio: horario ocupado => NO reserva, BUSINESS_RULE_VIOLATION con el dato a cambiar", async () => {
    const { state, request } = await readyBooking();
    const busy = createFakeHandler();
    busy.on("crear_cita_nylas_generico", () => fail("NON_RETRYABLE", "ocupado", { ocupado: true }));
    const { engine } = createTestEngine({ handler: busy });
    const r = await engine.execute(request, contextFor(barberSpec(), state));
    assert.deepEqual([r.status, r.error?.code, r.error?.reason, r.invalidSlots], ["FAILED", "BUSINESS_RULE_VIOLATION", "SLOT_TAKEN", ["time"]]);
  });

  it("zona horaria no soportada por los handlers de agenda => no se agenda (no se inventa la conversión)", async () => {
    const { state, request } = await readyBooking();
    const madrid = barberSpec();
    madrid.identity = { ...madrid.identity, timezone: "Europe/Madrid" };
    const { engine, fake } = createTestEngine();
    const r = await engine.execute(request, { ...contextFor(barberSpec(), state), spec: madrid });
    assert.deepEqual([r.error?.code, r.error?.reason, fake.calls.length], ["BUSINESS_RULE_VIOLATION", "TIMEZONE_NOT_SUPPORTED", 0]);
  });
});

describe("FASE 4 — estado, confirmación y solicitudes viejas", () => {
  it("15. stale request: el cliente cambió la hora después de generar la solicitud => STALE_ACTION_REQUEST", async () => {
    const { h, request } = await readyBooking();
    const nuevo = processed(await h.say("No, mejor a las 6 de la tarde", llm({ primaryIntent: intent("CORRECTION"), slots: [S("time", "a las 6 de la tarde", { correction: true })] })));
    assert.equal(nuevo.state.status, "AWAITING_CONFIRMATION");
    const { engine, fake } = createTestEngine();
    const r = await engine.execute(request, contextFor(barberSpec(), nuevo.state));
    assert.deepEqual([r.status, r.error?.code, fake.calls.length], ["REJECTED", "STALE_ACTION_REQUEST", 0]);
    // Una solicitud cuyo contenido no coincide con el estado (manipulada) también se rechaza.
    const { state, request: req2 } = await readyBooking();
    const tampered = { ...req2, arguments: { ...req2.arguments, hora: "06:00" } };
    const t = await engine.execute(tampered, contextFor(barberSpec(), state));
    assert.deepEqual([t.error?.code, t.error?.reason], ["STALE_ACTION_REQUEST", "REQUEST_DOES_NOT_MATCH_STATE"]);
  });

  it("16/17. confirmación requerida: sin confirmación válida (o de otra propuesta) no se ejecuta", async () => {
    const { state, request } = await readyBooking();
    const { engine, fake } = createTestEngine();
    const sin = clone(state);
    sin.pendingAction = { ...sin.pendingAction!, confirmationId: null };
    const r = await engine.execute({ ...request, confirmationId: null }, contextFor(barberSpec(), sin));
    assert.deepEqual([r.error?.code, r.error?.reason], ["CONFIRMATION_REQUIRED", "NO_VALID_CONFIRMATION"]);
    const falsa = clone(state);
    falsa.pendingAction = { ...falsa.pendingAction!, confirmationId: "a".repeat(32) };
    const f2 = await engine.execute({ ...request, confirmationId: "a".repeat(32) }, contextFor(barberSpec(), falsa));
    assert.equal(f2.error?.code, "CONFIRMATION_REQUIRED");
    assert.equal(fake.calls.length, 0);
  });

  it("acción en estado incorrecto (p. ej. esperando confirmación) => INVALID_STATE / STALE", async () => {
    const h = createHarness(barberSpec());
    const r0 = processed(await h.say("Soy Juan, corte clásico mañana a las 5 de la tarde", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("customer_name", "Juan"), S("service", "corte clásico"), S("date", "mañana"), S("time", "a las 5 de la tarde")] })));
    assert.equal(r0.state.status, "AWAITING_CONFIRMATION");
    const { state, request } = await readyBooking();
    const { engine } = createTestEngine();
    const r = await engine.execute(request, contextFor(barberSpec(), { ...clone(state), status: "AWAITING_CONFIRMATION" }));
    assert.deepEqual([r.error?.code, r.error?.reason], ["INVALID_STATE", "STATE_AWAITING_CONFIRMATION"]);
    const noPending = await engine.execute(request, contextFor(barberSpec(), r0.state));
    assert.deepEqual([noPending.error?.code, noPending.error?.reason], ["STALE_ACTION_REQUEST", "NO_PENDING_ACTION"]);
  });

  it("18/19. ActionResult: schema estricto; un resultado manipulado o malformado no se acepta", async () => {
    const { state, request } = await readyBooking();
    const { engine } = createTestEngine();
    const r = await engine.execute(request, contextFor(barberSpec(), state));
    assert.ok(parseActionResult(r).ok);
    assert.equal(parseActionResult({ ...r, status: "SUCCEEDED", error: { code: "TIMEOUT", reason: "X", retryable: false, ambiguous: false } }).ok, false);
    assert.equal(parseActionResult({ ...r, status: "FAILED", error: null }).ok, false);
    assert.equal(parseActionResult({ ...r, extra: 1 }).ok, false);
    assert.equal(parseActionResult({ ...r, invalidSlots: ["Time; DROP"] }).ok, false);
    // Resultado guardado manipulado en la base: el replay no lo acepta.
    const store = createInMemoryActionStore();
    const e = createTestEngine({ store });
    await e.engine.execute(request, contextFor(barberSpec(), state));
    [...store.rows.values()][0]!.result = { status: "SUCCEEDED", hacked: true };
    const replay = await e.engine.execute(request, contextFor(barberSpec(), state));
    assert.deepEqual([replay.status, replay.error?.reason], ["FAILED", "STORED_RESULT_INVALID"]);
  });

  it("20. integración con la state machine: éxito → COMPLETED; regla de negocio → vuelve a pedir el dato; técnico → ERROR", async () => {
    const req = buildAgentRequirements(barberSpec());
    const at = "2026-09-26T15:10:00.000Z";
    const { state, request } = await readyBooking();
    const okState = reduceConversation(state, { type: "ACTION_SUCCEEDED", eventId: "e1", at, actionId: request.id }, { requirements: req, now: at });
    assert.equal(okState.ok && okState.state.status, "COMPLETED");
    const busy = reduceConversation(state, { type: "ACTION_FAILED", eventId: "e2", at, actionId: request.id, category: "BUSINESS_RULE_ERROR", invalidSlots: ["time"] }, { requirements: req, now: at });
    assert.deepEqual(busy.ok && [busy.state.status, busy.state.slots.time!.status, busy.state.slots.customer_name!.value], ["COLLECTING_INFORMATION", "INVALID", { kind: "text", text: "Juan" }]);
    const sinDato = reduceConversation(state, { type: "ACTION_FAILED", eventId: "e3", at, actionId: request.id, category: "BUSINESS_RULE_ERROR", invalidSlots: [] }, { requirements: req, now: at });
    assert.equal(sinDato.ok && sinDato.state.status, "ERROR", "un rechazo sin dato que cambiar no vuelve a proponer lo mismo");
    const tech = reduceConversation(state, { type: "ACTION_FAILED", eventId: "e4", at, actionId: request.id, category: "EXTERNAL_SERVICE_ERROR" }, { requirements: req, now: at });
    assert.equal(tech.ok && tech.state.status, "ERROR");
  });
});

describe("FASE 4 — registro y acciones reales", () => {
  it("cada acción del registro tiene contrato de FASE 1 y política coherente (escrituras sin reintentos)", () => {
    for (const def of Object.values(ACTION_REGISTRY)) {
      const contract = getActionContract(def.action);
      assert.ok(contract, def.action);
      if (def.mutation) assert.equal(def.retry.maxAttempts, 1, `${def.action}: una escritura no se reintenta`);
      assert.ok(def.timeoutMs > 0 && def.timeoutMs <= 30_000, def.action);
      if (["write_external"].includes(contract!.sideEffects)) assert.equal(def.requiresConfirmation, true, `${def.action}: escritura externa exige confirmación`);
    }
    assert.equal("crear_pedido" in ACTION_REGISTRY || "cobrar" in ACTION_REGISTRY, false, "no se inventan acciones sin runtime real");
  });

  it("agenda interna (estudio): la reserva usa agendar_cita_especialista con confirmado=true", async () => {
    const h = createHarness(studioSpec());
    await h.say("Sesión de fotos el próximo sábado a las 10 de la mañana, soy Marta", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("service", "sesión de fotos"), S("date", "el próximo sábado"), S("time", "a las 10 de la mañana"), S("customer_name", "Marta")] }));
    const r = processed(await h.say("Sí", llm({ primaryIntent: intent("CONFIRMATION", 0.95) })));
    const { engine, fake } = createTestEngine();
    const res = await engine.execute(r.actionRequest!, contextFor(studioSpec(), r.state));
    assert.equal(res.status, "SUCCEEDED");
    assert.deepEqual([fake.calls[0]!.payload.confirmado, fake.calls[0]!.payload.fecha], ["true", "2026-10-03"]);
  });

  it("cancelar: con exactamente una cita se cancela; con varias se pide a una persona (no se adivina cuál)", async () => {
    const h = createHarness(barberSpec());
    await h.say("Quiero cancelar mi cita", llm({ primaryIntent: intent("CANCELLATION", 0.95) }));
    const r = processed(await h.say("Sí", llm({ primaryIntent: intent("CONFIRMATION", 0.95) })));
    assert.equal(r.actionRequest!.action, "cancelar_cita_cliente");
    const { engine, fake } = createTestEngine();
    const res = await engine.execute(r.actionRequest!, contextFor(barberSpec(), r.state));
    assert.equal(res.status, "SUCCEEDED");
    assert.deepEqual(fake.calls.map((c) => (c.action as { actionType: string }).actionType), ["listar_citas_cliente", "cancelar_cita_cliente"]);
    assert.equal(fake.calls[1]!.payload.cita_pick, "1");
    const varias = createFakeHandler();
    varias.on("listar_citas_cliente", () => ok({ citasCliente: [{ id: "a" }, { id: "b" }] }));
    const e2 = createTestEngine({ handler: varias });
    const res2 = await e2.engine.execute(r.actionRequest!, contextFor(barberSpec(), r.state));
    assert.deepEqual([res2.error?.code, res2.error?.reason, varias.calls.length], ["BUSINESS_RULE_VIOLATION", "APPOINTMENT_SELECTION_REQUIRED", 1]);
  });

  it("disponibilidad: el backend filtra por la franja pedida; sin cupos en la franja => regla de negocio sobre la franja", async () => {
    assert.deepEqual(filterSlotsByRange(["09:00", "16:00", "17:30"], "16:00-"), ["16:00", "17:30"]);
    assert.deepEqual(filterSlotsByRange(["09:00", "13:00", "19:00"], "afternoon"), ["13:00"]);
    const h = createHarness(barberSpec());
    const r0 = processed(await h.say("Corte clásico mañana después de las 4", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("service", "corte clásico"), S("date", "mañana"), S("time_range", "después de las 4", { value: "16:00-" })] })));
    const { engine } = createTestEngine();
    const r = await engine.execute(r0.actionRequest!, contextFor(barberSpec(), r0.state));
    assert.deepEqual([r.status, r.data.horariosDisponibles, "disponibilidadTexto" in r.data], ["SUCCEEDED", ["16:00", "16:30", "17:00"], false]);
    const manana = createFakeHandler();
    manana.on("buscar_disponibilidad_nylas_generico", () => ok({ fecha: "2026-09-27", horariosDisponibles: ["09:00", "10:00"], hayCupos: true }));
    const e2 = createTestEngine({ handler: manana });
    const vacio = await e2.engine.execute(r0.actionRequest!, contextFor(barberSpec(), r0.state));
    assert.deepEqual([vacio.error?.reason, vacio.invalidSlots], ["NO_AVAILABILITY_IN_RANGE", ["time_range"]]);
  });

  it("solicitud malformada (no cumple el schema de ActionRequest) => INVALID_ACTION", async () => {
    const { state } = await readyBooking();
    const { engine } = createTestEngine();
    const r = await engine.execute({ action: "crear_cita_nylas_generico", arguments: {} } as unknown as ActionRequest, contextFor(barberSpec(), state));
    assert.deepEqual([r.status, r.error?.reason, r.idempotencyKey], ["REJECTED", "MALFORMED_REQUEST", "0".repeat(32)]);
  });
});
