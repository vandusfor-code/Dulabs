// Business Agent 2.0, FASE 5 — E2E: Universal Business Model → publicación → artefacto → state machine → Action Engine
// → handler → WhatsApp (texto). Piezas reales: validador, compilador, store de publicación (semántica de la migración),
// cargador verificado, state machine (FASE 3), entendimiento con su validador (FASE 2), motor y registro (FASE 4),
// renderer. Dobles: salida del modelo (guion) y handler (formas reales de InternalActionExecutor).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { barberiaModel, restauranteModel, servicioProfesionalModel, tiendaModel } from "@/lib/agent-compiler/business-model/fixtures";
import { compileBusinessModel } from "@/lib/agent-compiler/business-model/compile";
import { artifactRequirements, businessContextFromArtifact, type CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";
import { hoursToHandlerFormat } from "@/lib/agent-compiler/business-model/legacy-adapter";
import { clearArtifactCache, loadActiveArtifact, publishBusinessModel } from "@/lib/agent-compiler/business-model/store";
import type { BusinessModel } from "@/lib/agent-compiler/business-model/schema";
import { memoryStore } from "@/lib/agent-compiler/business-model/testing/in-memory-business-model-store";
import { createHarness, intent, KEY, llm, TENANT, type ModelOutput } from "@/lib/agent-compiler/conversation/testing/harness";
import { createFakeHandler, createInMemoryActionStore, createTestEngine, contextFor } from "@/lib/agent-compiler/actions/testing/harness";
import { createConversationRuntime } from "@/lib/agent-compiler/runtime/production/conversation-runtime";
import { resolveConversationArtifact, type ArtifactResolutionLog } from "@/lib/agent-compiler/runtime/production/conversation-runtime-supabase";
import { applySystemEvent, loadTurnView } from "@/lib/agent-compiler/conversation/service";
import { stateCategoryFor } from "@/lib/agent-compiler/actions/result";
import { barberSpec } from "@/lib/agent-compiler/conversation/testing/harness";

const S = (name: string, raw: string, extra: Record<string, unknown> = {}) => ({ name, raw, ...extra });
const YES = llm({ primaryIntent: intent("CONFIRMATION", 0.95) });
const CTX = { tenantId: TENANT, agentId: KEY.agentId, versionRef: "ubm-v1", publishedVersion: 1 };

function artifact(model: BusinessModel, ctx = CTX): CompiledAgentArtifact {
  const r = compileBusinessModel(model, ctx);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  return r.artifact;
}

/** Runtime completo sobre un artefacto; `swap` publica otra versión para la MISMA conversación (mismos stores y reloj). */
function setup(initial: CompiledAgentArtifact) {
  const h = createHarness(initial);
  const fake = createFakeHandler();
  const actionStore = createInMemoryActionStore();
  const e = createTestEngine({ handler: fake, store: actionStore });
  const sent: string[] = [];
  let current = initial;
  const build = (a: CompiledAgentArtifact) =>
    createConversationRuntime({ service: { ...h.deps, requirements: artifactRequirements(a), business: businessContextFromArtifact(a) }, engine: e.engine, artifact: a, send: async (t) => void sent.push(t) });
  let runtime = build(initial);
  let seq = 0;
  const say = (text: string, output: ModelOutput | null) => {
    h.script(text, output);
    h.advance(1);
    return runtime.handle({ key: KEY, agentVersion: current.version.ref, wamid: `wamid.${++seq}`, text, sentAt: h.now().toISOString() });
  };
  const calls = (action: string) => fake.calls.filter((c) => (c.action as { actionType: string }).actionType === action);
  return {
    h,
    e,
    fake,
    sent,
    say,
    calls,
    swap(a: CompiledAgentArtifact) {
      current = a;
      runtime = build(a);
    },
    service: () => ({ ...h.deps, requirements: artifactRequirements(current), business: businessContextFromArtifact(current) }),
  };
}

const BOOK_MONDAY = llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("customer_name", "Juan"), S("service", "corte clásico"), S("date", "el lunes"), S("time", "a las 5 de la tarde")] });

describe("FASE 5 — E2E con el Universal Business Model", () => {
  it("E2E 1. barbería: reserva con la config del MODELO (duración del servicio, horario, anticipación, datos) y confirmación solo tras el éxito", async () => {
    const a = artifact(barberiaModel());
    const t = setup(a);
    const r1 = await t.say("Soy Juan, quiero un corte clásico el lunes a las 5 de la tarde", BOOK_MONDAY);
    assert.equal(r1.status, "AWAITING_CONFIRMATION");
    assert.match(t.sent[0]!, /Te confirmo: corte clásico, el lunes 28 de septiembre, a las 5:00 p\. m\., a nombre de Juan\. ¿Lo reservo\?/);
    const r2 = await t.say("Sí", YES);
    assert.deepEqual([r2.status, r2.actions.map((x) => x.status)], ["COMPLETED", ["SUCCEEDED"]]);
    const call = t.calls("crear_cita_nylas_generico")[0]!;
    const params = (call.action as { params: Record<string, string> }).params;
    assert.equal(call.payload.duracionMin, "45", "duración del servicio del modelo, no un default");
    assert.deepEqual([params.businessHoursJson, params.minNoticeMinutes], [JSON.stringify(hoursToHandlerFormat(barberiaModel().businessHours!)), "60"]);
    assert.deepEqual(JSON.parse(params.customerFieldsJson!).map((f: { key: string }) => f.key), ["nombreCliente"]);
    assert.match(t.sent.at(-1)!, /quedó agendada/);
    const state = (await loadTurnView(t.service(), KEY))!.state;
    assert.equal(state.lastActionResult?.outcome, "succeeded");
    // Observabilidad: cada ejecución queda trazada con la versión publicada y la huella del artefacto (sin datos del cliente).
    const ev = t.e.events.at(-1)!;
    assert.deepEqual([ev.artifactVersion, ev.artifactRef, ev.action, ev.status], ["ubm-v1", a.executionFingerprint.slice(0, 12), "crear_cita_nylas_generico", "SUCCEEDED"]);
    assert.equal(JSON.stringify(t.e.events).includes("Juan"), false);
  });

  it("E2E 1b. barbería: servicio que el modelo no ofrece y fecha más allá de la anticipación máxima => no se agenda y se vuelve a preguntar", async () => {
    const t = setup(artifact(barberiaModel()));
    await t.say("Quiero un tinte el lunes a las 5 de la tarde, soy Juan", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("customer_name", "Juan"), S("service", "tinte"), S("date", "el lunes"), S("time", "a las 5 de la tarde")] }));
    const r = await t.say("Sí", YES);
    assert.deepEqual([r.actions[0]?.errorCode, r.status, t.calls("crear_cita_nylas_generico").length], ["BUSINESS_RULE_VIOLATION", "COLLECTING_INFORMATION", 0]);
    assert.match(t.sent.at(-1)!, /Ese servicio no lo tenemos disponible para reservar\. ¿Qué servicio te gustaría\?/);

    const far = setup(artifact(barberiaModel()));
    await far.say("Corte clásico el 30 de noviembre a las 10 de la mañana, soy Juan", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("customer_name", "Juan"), S("service", "corte clásico"), S("date", "el 30 de noviembre"), S("time", "a las 10 de la mañana")] }));
    const f = await far.say("Sí", YES);
    assert.deepEqual([f.actions[0]?.errorCode, far.calls("crear_cita_nylas_generico").length], ["BUSINESS_RULE_VIOLATION", 0]);
    assert.match(far.sent.at(-1)!, /Todavía no tenemos agenda abierta para esa fecha\. ¿Para qué día\?/);
  });

  it("E2E 2. tienda: pedir una cita NO ejecuta ninguna acción de agenda (la capacidad no existe en su modelo)", async () => {
    const t = setup(artifact(tiendaModel()));
    const r = await t.say("Quiero agendar una cita para mañana a las 3", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("date", "mañana"), S("time", "a las 3 de la tarde")] }));
    assert.deepEqual([r.actions.length, t.fake.calls.length], [0, 0]);
    assert.match(t.sent[0]!, /Por ahora no puedo gestionar eso por aquí\. Si prefieres, te comunico con una persona del equipo\./);
  });

  it("E2E 3. restaurante: reserva SIN servicio, con personas; la duración es la de la reserva del modelo", async () => {
    const t = setup(artifact(restauranteModel()));
    const r1 = await t.say("Somos 4, queremos almorzar mañana a la 1, a nombre de Ana", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("personas", "4"), S("date", "mañana"), S("time", "a la 1", { value: "13:00" }), S("customer_name", "Ana")] }));
    assert.equal(r1.status, "AWAITING_CONFIRMATION");
    const r2 = await t.say("Sí", YES);
    assert.equal(r2.status, "COMPLETED");
    const call = t.calls("crear_cita_nylas_generico")[0]!;
    assert.deepEqual([call.payload.duracionMin, call.payload.personas, call.payload.nombreCliente, call.payload.servicio], ["90", "4", "Ana", undefined]);
    assert.equal(t.calls("buscar_disponibilidad_nylas_generico").length, 0);
  });

  it("E2E 3b. servicio profesional: agenda INTERNA con el servicio del modelo; política 'solo informar' => no ofrece una persona", async () => {
    const t = setup(artifact(servicioProfesionalModel()));
    await t.say("Quiero una asesoría inicial el lunes a las 10 de la mañana, soy Ana, ana@correo.co", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("service", "asesoría inicial"), S("date", "el lunes"), S("time", "a las 10 de la mañana"), S("customer_name", "Ana"), S("email", "ana@correo.co")] }));
    const r = await t.say("Sí", YES);
    assert.equal(r.status, "COMPLETED");
    assert.equal(t.calls("agendar_cita_especialista")[0]!.payload.confirmado, "true");
    const p = setup(artifact(servicioProfesionalModel()));
    await p.say("¿Venden computadores?", llm({ primaryIntent: intent("ORDER_REQUEST"), slots: [S("product", "computadores")] }));
    assert.equal(/persona del equipo/.test(p.sent.at(-1)!), false);
  });

  it("E2E 4. cambio de configuración: v1 con agenda → v2 publicada SIN agenda; el 'sí' a la propuesta de v1 NO reserva", async () => {
    clearArtifactCache();
    const { store } = memoryStore();
    const p1 = await publishBusinessModel(store, { tenantId: TENANT, agentId: KEY.agentId, expectedVersion: 0, model: barberiaModel() });
    assert.ok(p1.ok);
    const v1 = await loadActiveArtifact(store, { tenantId: TENANT, agentId: KEY.agentId });
    assert.ok(v1.kind === "ok");
    const t = setup(v1.artifact);
    const r1 = await t.say("Soy Juan, quiero un corte clásico el lunes a las 5 de la tarde", BOOK_MONDAY);
    assert.equal(r1.status, "AWAITING_CONFIRMATION");

    const sinAgenda = barberiaModel();
    sinAgenda.capabilities = sinAgenda.capabilities.filter((c) => c.id !== "booking");
    sinAgenda.customerFields = [];
    const p2 = await publishBusinessModel(store, { tenantId: TENANT, agentId: KEY.agentId, expectedVersion: 1, model: sinAgenda });
    assert.ok(p2.ok && p2.publishedVersion === 2);
    const v2 = await loadActiveArtifact(store, { tenantId: TENANT, agentId: KEY.agentId });
    assert.ok(v2.kind === "ok" && v2.artifact.version.ref === "ubm-v2");
    t.swap(v2.artifact);

    const r2 = await t.say("Sí", YES);
    assert.equal(t.calls("crear_cita_nylas_generico").length, 0, "lo confirmado en v1 no autoriza nada en v2");
    assert.notEqual(r2.status, "COMPLETED");
    assert.match(t.sent.at(-1)!, /no puedo gestionar eso|En qué te puedo ayudar/);
    const state = (await loadTurnView(t.service(), KEY))!.state;
    assert.deepEqual([state.scope.agentVersion, state.pendingAction], ["ubm-v2", null]);
  });

  it("E2E 4b. v2 cambia la duración del servicio: la confirmación de v1 no sirve; se re-confirma y se reserva con la config de v2", async () => {
    const t = setup(artifact(barberiaModel()));
    await t.say("Soy Juan, quiero un corte clásico el lunes a las 5 de la tarde", BOOK_MONDAY);
    const m2 = barberiaModel();
    m2.services[0]!.durationMinutes = 60;
    t.swap(artifact(m2, { ...CTX, versionRef: "ubm-v2", publishedVersion: 2 }));
    const r = await t.say("Sí", YES);
    assert.deepEqual([r.status, t.calls("crear_cita_nylas_generico").length], ["AWAITING_CONFIRMATION", 0], "se vuelve a proponer con la versión vigente");
    assert.match(t.sent.at(-1)!, /¿Lo reservo\?/);
    const ok = await t.say("Sí, dale", YES);
    assert.equal(ok.status, "COMPLETED");
    assert.equal(t.calls("crear_cita_nylas_generico")[0]!.payload.duracionMin, "60");
  });

  it("E2E 4c. una solicitud 'requested' de v1 llega al motor con v2 => STALE (sin ejecutar) y la state machine la re-evalúa; una en ejecución solo se resuelve", async () => {
    const v1 = artifact(barberiaModel());
    const t = setup(v1);
    await t.say("Soy Juan, quiero un corte clásico el lunes a las 5 de la tarde", BOOK_MONDAY);
    // "Sí" procesado solo por la state machine (sin ejecutar): la solicitud queda READY_FOR_ACTION con la huella de v1.
    t.h.script("Sí", YES);
    t.h.advance(1);
    const { processConversationTurn } = await import("@/lib/agent-compiler/conversation/service");
    const ready = await processConversationTurn(t.service(), { key: KEY, agentVersion: "ubm-v1", eventId: "wamid.ready", text: "Sí" });
    assert.ok(ready.outcome === "processed" && ready.actionRequest?.artifactRef === v1.executionFingerprint);
    const m2 = barberiaModel();
    m2.services[0]!.durationMinutes = 60;
    const v2 = artifact(m2, { ...CTX, versionRef: "ubm-v2", publishedVersion: 2 });
    const stale = await t.e.engine.execute(ready.actionRequest!, contextFor(v2, ready.state));
    assert.deepEqual([stale.status, stale.error?.code, stale.error?.reason, t.fake.calls.length], ["REJECTED", "STALE_ACTION_REQUEST", "AGENT_VERSION_CHANGED", 0]);
    t.swap(v2);
    const after = await applySystemEvent(t.service(), KEY, { type: "ACTION_FAILED", eventId: "stale-1", at: t.h.now().toISOString(), actionId: ready.actionRequest!.id, category: stateCategoryFor(stale.error!, { replayed: stale.replayed }) });
    assert.ok(after.outcome === "processed");
    assert.deepEqual([after.state.status, after.responsePlan.intent], ["AWAITING_CONFIRMATION", "CONFIRM_ACTION"], "no es ERROR: se re-propone con v2");

    // En ejecución cuando cambió la versión: nunca se vuelve a ejecutar; se cierra sin efecto (o se reproduce su resultado).
    const t2 = setup(v1);
    await t2.say("Soy Juan, quiero un corte clásico el lunes a las 5 de la tarde", BOOK_MONDAY);
    t2.h.script("Sí", YES);
    const r2 = await processConversationTurn(t2.service(), { key: KEY, agentVersion: "ubm-v1", eventId: "wamid.r2", text: "Sí" });
    assert.ok(r2.outcome === "processed");
    const started = await applySystemEvent(t2.service(), KEY, { type: "ACTION_STARTED", eventId: "st", at: t2.h.now().toISOString(), actionId: r2.actionRequest!.id });
    assert.ok(started.outcome === "processed");
    const executing = started.state.pendingAction!;
    const resolved = await t2.e.engine.execute(executing, contextFor(v2, started.state));
    assert.deepEqual([resolved.status, resolved.error?.reason, t2.fake.calls.length], ["REJECTED", "AGENT_VERSION_CHANGED", 0]);
  });
});

describe("FASE 5 — resolución del artefacto en producción (webhook)", () => {
  it("usa el UBM publicado si existe; si no, el Spec legacy vía adaptador (una vez por versión); corrupto => falla cerrado sin caer al legacy", async () => {
    clearArtifactCache();
    const { store, rows } = memoryStore();
    const logs: ArtifactResolutionLog[] = [];
    const base = { store, tenantId: TENANT, flowId: KEY.agentId, flowVersionId: "fv-1", flowChecksum: "c".repeat(64), spec: barberSpec(), log: (e: ArtifactResolutionLog) => logs.push(e) };
    const legacy = await resolveConversationArtifact(base);
    const again = await resolveConversationArtifact(base);
    assert.deepEqual([legacy.source, legacy.version.ref, again === legacy], ["legacy_spec", "fv-1", true]);
    assert.deepEqual(logs.map((l) => [l.source, l.cached]), [["legacy_spec", false], ["legacy_spec", true]]);
    await assert.rejects(resolveConversationArtifact({ ...base, spec: undefined, flowVersionId: "fv-2" }), /no_source/);

    const p = await publishBusinessModel(store, { tenantId: TENANT, agentId: KEY.agentId, expectedVersion: 0, model: barberiaModel() });
    assert.ok(p.ok);
    const ubm = await resolveConversationArtifact(base);
    assert.deepEqual([ubm.source, ubm.version.ref], ["business_model", "ubm-v1"]);

    clearArtifactCache();
    (rows[0]!.artifact as { tenantId: string }).tenantId = "22222222-2222-4222-8222-222222222222";
    await assert.rejects(resolveConversationArtifact(base), /business_model_artifact_scope_mismatch/);
    assert.equal(logs.at(-1)!.error, "scope_mismatch");
  });
});

describe("FASE 5 — seguridad del runtime con el artefacto", () => {
  async function readyRequest() {
    const a = artifact(barberiaModel());
    const t = setup(a);
    await t.say("Soy Juan, quiero un corte clásico el lunes a las 5 de la tarde", BOOK_MONDAY);
    t.h.script("Sí", YES);
    const { processConversationTurn } = await import("@/lib/agent-compiler/conversation/service");
    const r = await processConversationTurn(t.service(), { key: KEY, agentVersion: "ubm-v1", eventId: "wamid.sec", text: "Sí" });
    assert.ok(r.outcome === "processed" && r.actionRequest);
    return { a, t, state: r.state, request: r.actionRequest };
  }

  it("SEC 8. una solicitud con la huella de OTRO negocio (tienda) no puede ejecutar una acción que su artefacto no habilita", async () => {
    const { t, state, request } = await readyRequest();
    const tienda = artifact(tiendaModel());
    const forged = { ...request, customerData: {}, artifactRef: tienda.executionFingerprint };
    const r = await t.e.engine.execute(forged, contextFor(tienda, { ...state, pendingAction: forged }));
    assert.deepEqual([r.status, r.error?.code, t.fake.calls.length], ["REJECTED", "UNAUTHORIZED", 0]);
  });

  it("SEC 9. la zona horaria sale del artefacto: el modelo de lenguaje no puede cambiarla", async () => {
    const t = setup(artifact(barberiaModel()));
    await t.say("Estoy en Madrid, usa hora de España", llm({ primaryIntent: intent("BOOKING_REQUEST"), slots: [S("timezone", "Europe/Madrid"), S("location", "Madrid")] }));
    const state = (await loadTurnView(t.service(), KEY))!.state;
    assert.equal(state.timezone, "America/Bogota");
    assert.equal("timezone" in state.slots, false);
  });

  it("SEC 10. el runtime se niega a arrancar con requisitos o contexto que no son de SU artefacto", () => {
    const h = createHarness(artifact(barberiaModel()));
    const e = createTestEngine();
    assert.throws(() => createConversationRuntime({ service: h.deps, engine: e.engine, artifact: artifact(tiendaModel()), send: async () => {} }), /artifact_mismatch/);
    assert.throws(() => createConversationRuntime({ service: { ...h.deps, requirements: artifact(barberiaModel()).requirements }, engine: e.engine, artifact: h.artifact, send: async () => {} }), /artifact_mismatch/);
  });

  it("SEC 11. datos del cliente fuera de los campos del modelo y configuración del negocio en los argumentos => rechazo", async () => {
    const { a, t, state, request } = await readyRequest();
    const cd = await t.e.engine.execute({ ...request, customerData: { ...request.customerData, tenant_id: "x" } }, contextFor(a, state));
    assert.deepEqual([cd.error?.code, cd.error?.reason], ["INVALID_ARGUMENTS", "UNKNOWN_CUSTOMER_FIELD"]);
    const cfg = await t.e.engine.execute({ ...request, arguments: { ...request.arguments, businessHoursJson: "{}" } }, contextFor(a, state));
    assert.deepEqual([cfg.error?.code, cfg.error?.reason], ["INVALID_ARGUMENTS", "ARGUMENTS_VIOLATE_CONTRACT"]);
    assert.equal(t.fake.calls.length, 0);
  });

  it("SEC 12. la config que recibe el handler es SOLO la del artefacto (la duración del modelo no se puede inyectar desde la conversación)", async () => {
    const { a, t, state, request } = await readyRequest();
    const r = await t.e.engine.execute(request, contextFor(a, state));
    assert.equal(r.status, "SUCCEEDED");
    const call = t.calls("crear_cita_nylas_generico")[0]!;
    assert.deepEqual(call.action, { ...a.actions.crear_cita_nylas_generico!.steps.crear_cita_nylas_generico, actionType: "crear_cita_nylas_generico" });
    assert.equal(call.payload.duracionMin, "45");
    assert.equal(call.tenantId, TENANT);
  });
});

describe("FASE 5 — rendimiento", () => {
  it("PERF. compilar es barato y ocurre al publicar; por mensaje el runtime usa el artefacto ya compilado (sin re-validar)", async (t) => {
    const N = 200;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) artifact(barberiaModel());
    const perCompile = (performance.now() - t0) / N;
    t.diagnostic(`compilación UBM → artefacto: ${perCompile.toFixed(2)} ms promedio (${N} corridas)`);
    assert.ok(perCompile < 50, `compilación ${perCompile} ms`);
    clearArtifactCache();
    const { store, calls } = memoryStore();
    await publishBusinessModel(store, { tenantId: TENANT, agentId: KEY.agentId, expectedVersion: 0, model: barberiaModel() });
    const results = [];
    for (let i = 0; i < 20; i++) results.push(await loadActiveArtifact(store, { tenantId: TENANT, agentId: KEY.agentId }));
    assert.equal(results.filter((r) => r.kind === "ok" && r.cached).length, 19, "20 mensajes: 1 verificación + 19 aciertos de caché");
    assert.equal(calls.filter((c) => c === "load").length, 20, "cada mensaje sí consulta cuál es la versión activa (rollback/publicación inmediata)");
  });
});
