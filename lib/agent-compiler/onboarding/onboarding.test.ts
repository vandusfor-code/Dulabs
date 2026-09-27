// Business Agent 2.0, FASE 6 — configuración guiada: API (servicio + rutas), publicación, simulación y seguridad.
// Numeración según el brief (AI 1–30; los de UX 19–24 están en components/.../onboarding.dom.test.tsx).
// La semántica SQL (atomicidad, conflictos, RLS, concurrencia real) se verifica con scripts/verify-ba-onboarding.sh.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { emptyDraft, parseDraft } from "@/lib/agent-compiler/onboarding/draft";
import { assembleDraft, ONBOARDING_SLOT_MINUTES } from "@/lib/agent-compiler/onboarding/assemble";
import { buildRuntimeSpec } from "@/lib/agent-compiler/onboarding/runtime-spec";
import { activateOnboarding, getOnboarding, previewOnboarding, publishOnboarding, PUBLISH_STAGES, saveOnboardingDraft, testOnboardingAgent, validateOnboarding } from "@/lib/agent-compiler/onboarding/service";
import { TIMEZONE_OPTIONS } from "@/lib/agent-compiler/onboarding/timezones";
import { isValidTimeZone } from "@/lib/agent-compiler/business-model/validate";
import { verifyArtifact } from "@/lib/agent-compiler/business-model/artifact";
import { compileBusinessModel, compileLegacySpec } from "@/lib/agent-compiler/business-model/compile";
import { DURACION_MIN_DEFAULT } from "@/lib/agent-compiler/calendar/nylas-availability";
import { resolveConversationArtifact } from "@/lib/agent-compiler/runtime/production/conversation-runtime-supabase";
import { clearArtifactCache } from "@/lib/agent-compiler/business-model/store";
import { readOnlyHandler } from "@/lib/agent-compiler/onboarding/simulation";
import { STAGE_ORDER } from "@/components/dashboard/business-agent/onboarding/ActivateStep";
import { barberDraft, createWorld, depsFor, NOW, reading, simulationDeps, storeDraft, TENANT_A, TENANT_B } from "@/lib/agent-compiler/onboarding/testing/harness";
import type { EffectDispatchRequest } from "@/lib/flow/executor-types";

async function savedWorld(draft = barberDraft(), tenant = TENANT_A) {
  const world = createWorld();
  const deps = depsFor(world, tenant);
  const s = await saveOnboardingDraft(deps, { expectedRevision: 0, draft });
  assert.ok(s.ok, JSON.stringify(s));
  return { world, deps, revision: s.revision };
}

describe("FASE 6 — API del onboarding (servicio)", () => {
  it("AI 1. GET: un negocio nuevo empieza NOT_STARTED con un borrador vacío y checklist sin activar", async () => {
    const world = createWorld();
    const o = await getOnboarding(depsFor(world, TENANT_A));
    assert.deepEqual([o.status, o.revision, o.savedAt, o.checklist.readyToActivate], ["NOT_STARTED", 0, null, false]);
    assert.equal(o.draft.version, "business-agent.onboarding-draft/1");
    assert.ok(o.issues.some((i) => i.code === "BA-VAL-001" && i.field === "business.name"), "falta el nombre");
    assert.equal(world.events[0]?.event, "onboarding_started");
  });

  it("AI 2. crear borrador: revisión 1, sin publicar ni activar nada", async () => {
    const { world, revision } = await savedWorld();
    assert.equal(revision, 1);
    assert.deepEqual(world.fakes.calls.filter((c) => c === "publish"), []);
    assert.equal(world.bound.length, 0);
    const o = await getOnboarding(depsFor(world, TENANT_A));
    assert.deepEqual([o.status, o.revision], ["READY", 1]);
  });

  it("AI 3. actualizar borrador: revisión optimista (revisión vieja => conflicto, nunca se pisa)", async () => {
    const { deps } = await savedWorld();
    const ok = await saveOnboardingDraft(deps, { expectedRevision: 1, draft: { ...barberDraft(), tone: "direct" } });
    assert.deepEqual([ok.ok, ok.ok && ok.revision], [true, 2]);
    const stale = await saveOnboardingDraft(deps, { expectedRevision: 1, draft: barberDraft() });
    assert.ok(!stale.ok && stale.reason === "conflict" && stale.currentRevision === 2 && stale.code === "BA-DRF-002");
    assert.equal(stale.ok ? "" : stale.message, "Esta configuración cambió en otra sesión. Actualiza antes de continuar.");
  });

  it("AI 4. validar: completo = válido; con errores = problemas humanos con paso y campo", async () => {
    const { deps } = await savedWorld();
    assert.deepEqual(await validateOnboarding(deps).then((v) => [v.valid, v.issues.filter((i) => i.severity === "error")]), [true, []]);
    const bad = barberDraft();
    bad.business.name = "";
    bad.hours.week.monday = { open: true, intervals: [{ start: "18:00", end: "09:00" }] };
    await saveOnboardingDraft(deps, { expectedRevision: 1, draft: bad });
    const v = await validateOnboarding(deps);
    assert.equal(v.valid, false);
    assert.deepEqual(
      v.issues.filter((i) => i.severity === "error").map((i) => [i.step, i.field, i.code]),
      [
        ["negocio", "business.name", "BA-VAL-001"],
        ["horario", "hours.week.monday", "BA-VAL-007"],
      ],
    );
    assert.equal(JSON.stringify(v.issues).match(/capabilit|booking\b|UBM|artifact/i), null, "nada técnico en los mensajes");
  });

  it("AI 5. publicar: etapas reales en orden, versión 1, estado PUBLISHED", async () => {
    const { world, deps } = await savedWorld();
    const stages: string[] = [];
    const r = await publishOnboarding(deps, { expectedRevision: 1 }, (e) => stages.push(`${e.stage}:${e.status}`));
    assert.ok(r.ok && r.publishedVersion === 1, JSON.stringify(r));
    assert.deepEqual(stages, PUBLISH_STAGES.flatMap((s) => [`${s.id}:running`, `${s.id}:done`]));
    assert.deepEqual(STAGE_ORDER, PUBLISH_STAGES.map((s) => ({ id: s.id, label: s.label })), "la pantalla muestra las mismas etapas que ejecuta el servidor");
    assert.deepEqual(world.events.map((e) => e.event).slice(-2), ["publish_started", "publish_succeeded"]);
  });

  it("AI 6. versión publicada y estado: publicación enlazada a la versión que sirve el registro", async () => {
    const { world, deps } = await savedWorld();
    await publishOnboarding(deps, { expectedRevision: 1 });
    const o = await getOnboarding(deps);
    const flow = world.registry._debug.flows.find((f) => f.tenantId === TENANT_A)!;
    assert.deepEqual([o.status, o.pendingChanges, o.publication?.publishedVersion, o.publication?.flowVersionId, o.publication?.draftRevision], ["PUBLISHED", false, 1, flow.publishedVersionId, 1]);
    await saveOnboardingDraft(deps, { expectedRevision: 1, draft: { ...barberDraft(), tone: "professional" } });
    const after = await getOnboarding(deps);
    assert.deepEqual([after.status, after.pendingChanges, after.checklist.items.find((i) => i.id === "publicado")?.ok], ["READY", true, false]);
  });

  it("AI 7. autorización: las 7 rutas exigen sesión (401 sin token, sin tocar datos)", async () => {
    const routes = await Promise.all([
      import("@/app/api/business-agent/onboarding/route"),
      import("@/app/api/business-agent/onboarding/validate/route"),
      import("@/app/api/business-agent/onboarding/publish/route"),
      import("@/app/api/business-agent/onboarding/status/route"),
      import("@/app/api/business-agent/onboarding/preview/route"),
      import("@/app/api/business-agent/onboarding/test/route"),
      import("@/app/api/business-agent/onboarding/activate/route"),
    ]);
    const req = (method: string) => new NextRequest("http://x/api/business-agent/onboarding", { method, headers: { "content-type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify({ tenantId: TENANT_B }) }) });
    const handlers = routes.flatMap((m) => Object.entries(m).filter(([k]) => ["GET", "PUT", "POST"].includes(k)) as Array<[string, (r: NextRequest) => Promise<Response>]>);
    assert.equal(handlers.length, 8);
    for (const [method, h] of handlers) assert.equal((await h(req(method))).status, 401, method);
  });

  it("AI 8. aislamiento: el borrador y la publicación de un tenant no existen para otro", async () => {
    const { world } = await savedWorld();
    const b = depsFor(world, TENANT_B);
    const ob = await getOnboarding(b);
    assert.deepEqual([ob.status, ob.revision, ob.draft.business.name], ["NOT_STARTED", 0, undefined]);
    const pub = await publishOnboarding(b, { expectedRevision: 1 });
    assert.ok(!pub.ok && pub.code === "BA-PUB-001");
    assert.equal(world.fakes.rows.models.length, 0);
  });
});

describe("FASE 6 — publicación", () => {
  it("AI 9. UBM válido: el artefacto guardado verifica (checksum, tenant) y el Spec servido tiene su MISMA huella", async () => {
    const { world, deps } = await savedWorld();
    await publishOnboarding(deps, { expectedRevision: 1 });
    const row = await world.fakes.modelStore.loadActive(TENANT_A, world.registry._debug.flows[0]!.id);
    const v = verifyArtifact(row!.artifact, { tenantId: TENANT_A, agentId: world.registry._debug.flows[0]!.id });
    assert.ok(v.ok && v.artifact.source === "business_model" && v.artifact.version.publishedVersion === 1);
    const flow = world.registry._debug.flows[0]!;
    const served = await world.registry.resolvePublishedVersion(TENANT_A, flow.id);
    const legacy = compileLegacySpec(served!.spec, { tenantId: TENANT_A, agentId: flow.id, versionRef: "x", publishedVersion: null });
    assert.ok(legacy.ok && v.ok);
    assert.equal(legacy.artifact.executionFingerprint, v.artifact.executionFingerprint);
  });

  it("AI 10. UBM inválido: se bloquea en 'validar', no se escribe NADA y el borrador queda intacto", async () => {
    const bad = barberDraft();
    bad.booking.agenda = undefined;
    const { world, deps } = await savedWorld(bad);
    const r = await publishOnboarding(deps, { expectedRevision: 1 });
    assert.ok(!r.ok && r.stage === "validate" && r.code === "BA-PUB-001" && r.issues.some((i) => i.code === "BA-VAL-006"));
    assert.deepEqual([world.fakes.calls.includes("publish"), world.fakes.rows.models.length, world.registry._debug.versions.length], [false, 0, 0]);
    assert.deepEqual((await getOnboarding(deps)).draft, JSON.parse(JSON.stringify(bad)));
  });

  it("AI 11. publicación concurrente (dos pestañas, misma revisión): una gana, la otra recibe conflicto", async () => {
    const { world, deps } = await savedWorld();
    const [a, b] = await Promise.all([publishOnboarding(deps, { expectedRevision: 1 }), publishOnboarding(deps, { expectedRevision: 1 })]);
    const won = [a, b].filter((r) => r.ok);
    const lost = [a, b].filter((r) => !r.ok);
    assert.equal(won.length, 1);
    assert.ok(!lost[0]!.ok && lost[0]!.conflict && lost[0]!.code === "BA-PUB-004");
    assert.equal(lost[0]!.ok ? "" : lost[0]!.message, "Esta configuración cambió en otra sesión. Actualiza antes de publicar.");
    assert.equal(world.fakes.rows.models.length, 1);
  });

  it("AI 12. artefacto persistido: el runtime lo usa porque corresponde a la versión que sirve el registro", async () => {
    clearArtifactCache();
    const { world, deps } = await savedWorld();
    await publishOnboarding(deps, { expectedRevision: 1 });
    const flow = world.registry._debug.flows[0]!;
    const served = await world.registry.resolvePublishedVersion(TENANT_A, flow.id);
    const a = await resolveConversationArtifact({ store: world.fakes.modelStore, tenantId: TENANT_A, flowId: flow.id, flowVersionId: flow.publishedVersionId!, flowChecksum: "c", spec: served!.spec, log: () => {} });
    assert.deepEqual([a.source, a.version.ref], ["business_model", "ubm-v1"]);
  });

  it("AI 13. versión activa: republicar la mueve; si el registro sirve OTRA versión, el runtime usa la del registro", async () => {
    clearArtifactCache();
    const { world, deps } = await savedWorld();
    await publishOnboarding(deps, { expectedRevision: 1 });
    await saveOnboardingDraft(deps, { expectedRevision: 1, draft: { ...barberDraft(), tone: "direct" } });
    const r2 = await publishOnboarding(deps, { expectedRevision: 2 });
    assert.ok(r2.ok && r2.publishedVersion === 2);
    const flow = world.registry._debug.flows[0]!;
    assert.equal((await getOnboarding(deps)).publication?.flowVersionId, flow.publishedVersionId);
    // Rollback por el editor avanzado: el registro vuelve a la primera versión; el modelo activo (v2) ya no es el servido.
    const first = world.fakes.rows.publications[0]!.flowVersionId;
    await world.registry.publishVersion(TENANT_A, flow.id, first);
    const served = await world.registry.resolvePublishedVersion(TENANT_A, flow.id);
    const a = await resolveConversationArtifact({ store: world.fakes.modelStore, tenantId: TENANT_A, flowId: flow.id, flowVersionId: first, flowChecksum: "c", spec: served!.spec, log: () => {} });
    assert.equal(a.source, "legacy_spec", "manda la versión que el registro sirve");
  });

  it("AI 14. publicación fallida (el registro falla): error humano con código, nada escrito, borrador intacto", async () => {
    const { world, deps } = await savedWorld();
    world.fakes.faults.failRegistryPublish = true;
    const r = await publishOnboarding(deps, { expectedRevision: 1 });
    assert.ok(!r.ok && r.stage === "publish" && r.code === "BA-PUB-006" && r.message === "Hubo un problema al publicar tu agente.");
    assert.deepEqual([world.fakes.rows.models.length, world.fakes.rows.publications.length], [0, 0]);
    const o = await getOnboarding(deps);
    assert.deepEqual([o.status, o.draft.business.name], ["READY", "Barbería Norte"]);
    assert.equal(world.events.at(-1)?.event, "publish_failed");
  });

  it("AI 15. reintentar la publicación: con la falla resuelta, la MISMA revisión se publica", async () => {
    const { world, deps } = await savedWorld();
    world.fakes.faults.failRegistryPublish = true;
    assert.equal((await publishOnboarding(deps, { expectedRevision: 1 })).ok, false);
    world.fakes.faults.failRegistryPublish = false;
    const r = await publishOnboarding(deps, { expectedRevision: 1 });
    assert.ok(r.ok && r.publishedVersion === 1);
    assert.equal((await getOnboarding(deps)).status, "PUBLISHED");
  });
});

describe("FASE 6 — simulación", () => {
  it("AI 16. vista previa: responde con el borrador y cada solicitud de acción va marcada simulation=true", async () => {
    const { deps } = await savedWorld();
    const sim = simulationDeps({ "Quiero un corte": reading("BOOKING_REQUEST", [{ name: "service", raw: "corte" }, { name: "date", raw: "el lunes" }, { name: "time", raw: "a las 10", value: "10:00" }, { name: "customer_name", raw: "Ana" }]) });
    const r = await previewOnboarding(deps, sim, { text: "Quiero un corte el lunes a las 10, soy Ana", state: null, turnId: "t1" });
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.replies[0]!, /Te confirmo: corte, el lunes 28 de septiembre, a las 10:00 a\. m\., a nombre de Ana\. ¿Lo reservo\?/);
    const yes = await previewOnboarding(deps, simulationDeps({ "Sí": reading("CONFIRMATION") }), { text: "Sí", state: r.state, turnId: "t2" });
    assert.ok(yes.ok);
    assert.deepEqual(yes.actions, [{ action: "crear_cita_nylas_generico", status: "SUCCEEDED", simulated: true }]);
  });

  it("AI 17. simulación sin efectos: el motor NUNCA llama al handler ni al registro con una escritura; el handler de lecturas las rechaza", async () => {
    const { deps } = await savedWorld();
    const seen: EffectDispatchRequest[] = [];
    const sim = simulationDeps({ "Quiero un corte": reading("BOOKING_REQUEST", [{ name: "service", raw: "corte" }, { name: "date", raw: "el lunes" }, { name: "time", raw: "a las 10", value: "10:00" }, { name: "customer_name", raw: "Ana" }]), "Sí": reading("CONFIRMATION"), "persona": reading("HUMAN_HANDOFF") }, seen);
    const a = await previewOnboarding(deps, sim, { text: "Quiero un corte el lunes a las 10, soy Ana", state: null, turnId: "t1" });
    assert.ok(a.ok);
    const b = await previewOnboarding(deps, sim, { text: "Sí", state: a.state, turnId: "t2" });
    assert.ok(b.ok && /Simulación/.test(b.replies.join(" ")) && !/quedó agendada/i.test(b.replies.join(" ")));
    assert.equal(seen.filter((s) => ["crear_cita_nylas_generico", "transferir_soporte", "cancelar_cita_cliente"].includes((s.action as { actionType: string }).actionType)).length, 0);
    // Defensa en profundidad: aunque algo intentara pasar una escritura al handler de la simulación, se rechaza.
    const guarded = readOnlyHandler(async () => ({ success: true, classification: "SUCCESS", data: {} }));
    const blocked = await guarded({ effectId: "x", executionRowId: "x", executionLogicalId: "x", tenantId: TENANT_A, nodeId: "n", kind: "action", attempt: 1, payload: {}, action: { actionType: "crear_cita_nylas_generico" } as never }, new AbortController().signal);
    assert.deepEqual([blocked.success, blocked.error], [false, "simulation_side_effect_blocked"]);
    // El motor, a nivel de solicitud: ver "FASE 6 — simulación en el Action Engine" (actions/action-engine.test.ts).
  });

  it("AI 18. la vista previa usa el BORRADOR guardado (sin publicar): los cambios se ven al instante; lo publicado no cambia", async () => {
    const { world, deps } = await savedWorld();
    await publishOnboarding(deps, { expectedRevision: 1 });
    await saveOnboardingDraft(deps, { expectedRevision: 1, draft: { ...barberDraft(), business: { ...barberDraft().business, name: "Barbería Sur" } } });
    const r = await previewOnboarding(deps, simulationDeps({ Hola: reading("GREETING") }), { text: "Hola", state: null, turnId: "t" });
    assert.ok(r.ok && r.replies[0]!.includes("Barbería Sur"));
    const flow = world.registry._debug.flows[0]!;
    const served = await world.registry.resolvePublishedVersion(TENANT_A, flow.id);
    assert.equal(served!.spec.identity.businessName, "Barbería Norte", "producción sigue con lo publicado");
  });

  it("Prueba tu agente: conversaciones de ejemplo según la configuración, todas sin efectos reales", async () => {
    const { deps } = await savedWorld();
    const r = await testOnboardingAgent(deps, { readHandler: simulationDeps({}).readHandler, now: () => NOW });
    assert.ok(r.ok);
    assert.deepEqual(r.scenarios.map((s) => [s.id, s.passed]), [["saludo", true], ["reserva", true], ["persona", true], ["tema_restringido", true], ["pregunta", true]]);
    assert.ok(r.scenarios.every((s) => s.checks.some((c) => c.label === "No ejecutó acciones reales" && c.ok)));
  });
});

describe("FASE 6 — seguridad", () => {
  it("AI 25. cruce de tenants: B no puede publicar ni activar el agente de A, ni leer su borrador", async () => {
    const { world, deps } = await savedWorld();
    await publishOnboarding(deps, { expectedRevision: 1 });
    const b = depsFor(world, TENANT_B);
    assert.equal((await getOnboarding(b)).draft.business.name, undefined);
    const act = await activateOnboarding(b, { phoneNumberId: "pn-a" });
    assert.ok(!act.ok && act.code === "BA-ACT-001");
    assert.equal(world.bound.length, 0);
  });

  it("AI 26. suplantación de tenant: el borrador no acepta tenant/agente/checksum (en ningún nivel)", async () => {
    for (const bad of [
      { ...emptyDraft(), tenantId: TENANT_B },
      { ...emptyDraft(), business: { ...emptyDraft().business, tenant_id: TENANT_B } },
      { ...emptyDraft(), agentId: "otro", checksum: "x", compilerVersion: "9.9.9" },
    ]) {
      assert.equal(parseDraft(bad).ok, false);
      const { deps } = await savedWorld();
      const r = await saveOnboardingDraft(deps, { expectedRevision: 1, draft: bad });
      assert.ok(!r.ok && r.reason === "invalid" && r.code === "BA-DRF-001");
    }
    const { readBody } = await import("@/lib/agent-compiler/onboarding/http");
    const r = await readBody(new Request("http://x", { method: "PUT", body: JSON.stringify({ expectedRevision: 1, draft: {}, tenantId: TENANT_B }) }), ["expectedRevision", "draft"]);
    assert.ok(!r.ok && r.response.status === 400);
  });

  it("AI 27. campos protegidos: un dato del cliente llamado como un campo del sistema no se publica", async () => {
    for (const label of ["tenant id", "permissions", "agent id", "fecha", "action"]) {
      const d = barberDraft();
      d.customerData.extra.push({ label, type: "text", required: false });
      assert.ok(assembleDraft(d).issues.some((i) => i.code === "BA-VAL-013" && i.field === "customerData.extra.0.label"), label);
      const { deps } = await savedWorld(d);
      const r = await publishOnboarding(deps, { expectedRevision: 1 });
      assert.ok(!r.ok && r.stage === "validate", label);
    }
  });

  it("AI 28. inyección de capacidades: el borrador no puede nombrar capacidades ni acciones; pedidos/pagos nunca se activan", async () => {
    assert.equal(parseDraft({ ...emptyDraft(), capabilities: [{ id: "payments", enabled: true }] }).ok, false);
    assert.equal(parseDraft({ ...emptyDraft(), offer: { ...emptyDraft().offer, orders: true } }).ok, false);
    const a = assembleDraft(barberDraft());
    assert.equal(a.model.capabilities.some((c) => c.id === "orders" || c.id === "payments"), false);
    const spec = buildRuntimeSpec(a.model, barberDraft(), null, { specVersion: 1, now: NOW.toISOString() });
    assert.deepEqual([spec.capabilities.orders, spec.capabilities.payments], [false, false]);
  });

  it("AI 29. publicar sin autorización o sobre una revisión vieja: 401 en la ruta; conflicto en el servicio", async () => {
    const { POST } = await import("@/app/api/business-agent/onboarding/publish/route");
    assert.equal((await POST(new NextRequest("http://x", { method: "POST", body: JSON.stringify({ expectedRevision: 1 }) }))).status, 401);
    const { deps } = await savedWorld();
    await saveOnboardingDraft(deps, { expectedRevision: 1, draft: barberDraft() });
    const r = await publishOnboarding(deps, { expectedRevision: 1 });
    assert.ok(!r.ok && r.conflict && r.stage === "review");
  });

  it("AI 30. activar sin artefacto publicado o con cambios sin publicar => bloqueado", async () => {
    const { world, deps } = await savedWorld();
    const a = await activateOnboarding(deps, { phoneNumberId: "pn-a" });
    assert.ok(!a.ok && a.code === "BA-ACT-001");
    await publishOnboarding(deps, { expectedRevision: 1 });
    await saveOnboardingDraft(deps, { expectedRevision: 1, draft: { ...barberDraft(), tone: "direct" } });
    const b = await activateOnboarding(deps, { phoneNumberId: "pn-a" });
    assert.ok(!b.ok && b.code === "BA-ACT-002");
    await publishOnboarding(deps, { expectedRevision: 2 });
    world.plan = false;
    const c = await activateOnboarding(deps, { phoneNumberId: "pn-a" });
    assert.ok(!c.ok && c.code === "BA-ACT-003" && c.reasons.some((x) => /plan activo/.test(x)));
    world.plan = true;
    const d = await activateOnboarding(deps, { phoneNumberId: "pn-a" });
    assert.ok(d.ok);
    assert.equal((await getOnboarding(deps)).status, "ACTIVE");
    assert.deepEqual(world.events.filter((e) => e.event.startsWith("activation")).map((e) => e.event).slice(-2), ["activation_started", "activation_succeeded"]);
  });
});

describe("FASE 6 — invariantes de soporte", () => {
  it("zonas horarias ofrecidas: todas IANA válidas; la duración por defecto coincide con la de los handlers", () => {
    for (const t of TIMEZONE_OPTIONS) assert.ok(isValidTimeZone(t.iana), t.iana);
    assert.equal(ONBOARDING_SLOT_MINUTES, DURACION_MIN_DEFAULT);
  });

  it("tienda: sin agenda, con catálogo de productos y cotización; su Spec compila con la misma huella", () => {
    const a = assembleDraft(storeDraft());
    assert.deepEqual(a.issues.filter((i) => i.severity === "error"), []);
    const ctx = { tenantId: TENANT_A, agentId: "flow", versionRef: "x", publishedVersion: 1 };
    const u = compileBusinessModel(a.model, ctx);
    const l = compileLegacySpec(buildRuntimeSpec(a.model, storeDraft(), null, { specVersion: 1, now: NOW.toISOString() }), ctx);
    assert.ok(u.ok && l.ok && u.artifact.executionFingerprint === l.artifact.executionFingerprint);
    assert.equal("crear_cita_nylas_generico" in u.artifact.actions, false);
  });

  it("las reglas avanzadas del agente existente se conservan al publicar desde la configuración guiada", () => {
    const a = assembleDraft(barberDraft());
    const previous = buildRuntimeSpec(a.model, barberDraft(), null, { specVersion: 1, now: NOW.toISOString() });
    previous.policies.rules.push({ id: "r-avanzada", description: "Recordar traer documento.", kind: "reminder", priority: 1 });
    previous.policies.prohibitions.push({ id: "p-avanzada", description: "No dar diagnósticos.", scope: "business", action: "FIXED_RESPONSE", response: "No puedo.", priority: 5 });
    const next = buildRuntimeSpec(a.model, { ...barberDraft(), restrictedTopics: [] }, previous, { specVersion: 2, now: NOW.toISOString() });
    assert.deepEqual([next.policies.rules.map((r) => r.id), next.policies.prohibitions.map((p) => p.id)], [["r-avanzada"], ["p-avanzada"]]);
  });
});
