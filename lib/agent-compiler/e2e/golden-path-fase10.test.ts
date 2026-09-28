// Business Agent 2.0, FASE 10 — GOLDEN PATH de punta a punta, como lo vive un negocio NUEVO:
//
//   borrador (onboarding) → validar → vista previa → "Prueba tu agente" → publicar → gate de activación (el REAL)
//   → activar → motor que atiende (despliegue controlado) → mensaje de WhatsApp → entendimiento → reglas → acción
//   segura → respuesta → observabilidad.
//
// Lo que se prueba es COMPORTAMIENTO con la configuración que se publicó: el runtime se arma con el Spec que sirve el
// registro después de publicar (no con un fixture escrito a mano) y se comprueba que su huella es la del artefacto
// publicado. Dobles: stores en memoria con la semántica de las migraciones, hechos del negocio, catálogo/inventario del
// negocio, el handler de reservas (forma real) y el TRANSPORTE del modelo de lenguaje (salida con guion por mensaje).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultHours, emptyDraft, type OnboardingDraft } from "@/lib/agent-compiler/onboarding/draft";
import { activateOnboarding, getOnboarding, previewOnboarding, publishOnboarding, saveOnboardingDraft, testOnboardingAgent, validateOnboarding } from "@/lib/agent-compiler/onboarding/service";
import { barberScenarioReadings, BARBER_SERVICES, createWorld, depsFor, reading, simulationDeps, TENANT_A, TENANT_B, type World } from "@/lib/agent-compiler/onboarding/testing/harness";
import { evaluateBusinessAgentActivation, type ActivationGateDeps } from "@/lib/agent-compiler/lifecycle/activation-gate";
import { evaluateReadiness } from "@/lib/business-agent-readiness";
import { selectAgentEngine, specRolloutEligible } from "@/lib/agent-compiler/runtime/production/engine-selection";
import { artifactOf, createPipeline, out } from "@/lib/agent-compiler/runtime/testing/real-pipeline";
import type { CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";
import { createNativeActionHandler } from "@/lib/agent-compiler/actions/native/handler";
import { memoryInventory, memoryReminders } from "@/lib/agent-compiler/runtime/testing/fase8-fixtures";
import type { InventoryProduct } from "@/lib/agent-compiler/actions/native/products";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";

const S = (name: string, raw: string, value?: string) => ({ name, raw, ...(value ? { value } : {}) });
const TENANT_C = "33333333-3333-4333-8333-333333333333";

/** Barbería nueva: todo lo que el brief pide configurar, con un horario PROPIO (martes a sábado 09:00–19:00). */
function barberiaDraft(): OnboardingDraft {
  const d = emptyDraft();
  d.business = { name: "Barbería Los Andes", description: "Cortes clásicos y barba en Chapinero.", category: "Barbería / Peluquería", assistantName: "Leo", timezone: "America/Bogota" };
  d.offer = { services: true, products: false, showCatalog: true, quotes: true };
  d.booking = { enabled: true, agenda: "calendar", minimumNoticeMinutes: 120, allowChanges: true, changesNoticeHours: 6, reminders: { enabled: true, offsetMinutes: 120 } };
  const open = { open: true, intervals: [{ start: "09:00", end: "19:00" }] };
  const closed = { open: false, intervals: [] };
  d.hours = { week: { sunday: closed, monday: closed, tuesday: open, wednesday: open, thursday: open, friday: open, saturday: open }, exceptions: [] };
  d.support = { handoff: true, pauseHours: 8, answerQuestions: true, whenUnknown: "handoff", whenCannotHelp: "offer_person" };
  d.customerData = { askName: true, askEmail: false, askNotes: false, extra: [] };
  d.tone = "professional";
  d.engine = "state_machine_v1";
  d.restrictedTopics = [{ words: ["política"], reply: "De ese tema no hablamos por aquí." }];
  return d;
}

/** Catálogo real del negocio (dulabs_servicios del tenant): nombres, duración y PRECIO. */
const BARBERIA_CATALOG = [
  { name: "Corte clásico", durationMinutes: 30, price: 30_000 },
  { name: "Corte + barba", durationMinutes: 45, price: 45_000 },
];

/** El gate de activación REAL (evaluateBusinessAgentActivation) con los hechos del mundo de prueba. */
function realGate(world: World, tenantId: string): ActivationGateDeps {
  const deps = depsFor(world, tenantId);
  return {
    store: world.registry,
    numberBelongsToTenant: async (t, pn) => (world.numbers.get(t) ?? []).some((n) => n.phoneNumberId === pn),
    evaluateReadiness: async (_t, version) => evaluateReadiness(version.spec, world.facts),
    hasActivePlan: async () => world.plan,
    otherEngineOnNumber: async () => null,
    engineReadiness: async (_t, version) => (await deps.engineReport!(version.flowId, { publishedSpec: version.spec, draftSpec: null, agentActive: false })).readiness.blockers,
  };
}

/** Publica un borrador de punta a punta por el servicio del onboarding y devuelve lo que SIRVE el registro. */
async function configureAndPublish(world: World, tenantId: string, draft: OnboardingDraft) {
  const deps = depsFor(world, tenantId);
  const saved = await saveOnboardingDraft(deps, { expectedRevision: 0, draft });
  assert.ok(saved.ok, JSON.stringify(saved));
  const v = await validateOnboarding(deps);
  assert.deepEqual([v.valid, v.issues.filter((i) => i.severity === "error")], [true, []], JSON.stringify(v.issues));
  const stages: string[] = [];
  const pub = await publishOnboarding(deps, { expectedRevision: saved.revision }, (e) => e.status === "done" && stages.push(e.stage));
  assert.ok(pub.ok, JSON.stringify(pub));
  assert.deepEqual(stages, ["review", "validate", "compile", "verify", "save", "publish"]);
  const flow = world.registry._debug.flows.find((f) => f.tenantId === tenantId)!;
  const served = await world.registry.resolvePublishedVersion(tenantId, flow.id);
  const active = await world.fakes.modelStore.loadActive(tenantId, flow.id);
  assert.ok(served && active);
  return { deps, flowId: flow.id, served, activeArtifact: active.artifact as CompiledAgentArtifact, revision: saved.revision };
}

describe("FASE 10 — golden path: barbería nueva (citas, precios, horario propio, recordatorios, traspaso, reglas)", () => {
  it("configura → valida → prueba → publica → gate real → piloto → mensaje real → reserva → recordatorio → observabilidad", async () => {
    const world = createWorld();
    const deps = depsFor(world, TENANT_A);

    // 0. Negocio nuevo: nada configurado, nada publicado, nada activo; el borrador NO trae horario inventado.
    const fresh = await getOnboarding(deps);
    assert.deepEqual([fresh.status, fresh.publication, fresh.checklist.readyToActivate], ["NOT_STARTED", null, false]);
    assert.ok(Object.values(fresh.draft.hours.week).every((d) => !d.open), "sin horario hasta que el negocio lo indique");

    // 1–2. Borrador → validar → vista previa (borrador guardado, simulación: nunca efectos reales).
    const { flowId, served, activeArtifact } = await (async () => {
      const draft = barberiaDraft();
      const saved = await saveOnboardingDraft(deps, { expectedRevision: 0, draft });
      assert.ok(saved.ok);
      const v = await validateOnboarding(deps);
      assert.equal(v.valid, true, JSON.stringify(v.issues));
      const hello = await previewOnboarding(deps, simulationDeps({ Hola: reading("GREETING") }), { text: "Hola", state: null, turnId: "p1" });
      assert.ok(hello.ok && hello.replies[0]!.includes("Barbería Los Andes"), JSON.stringify(hello));
      const book = await previewOnboarding(
        deps,
        simulationDeps({ "corte clásico": reading("BOOKING_REQUEST", [S("service", "corte clásico"), S("date", "el martes"), S("time", "a las 10", "10:00"), S("customer_name", "Ana")]) }, [], BARBER_SERVICES),
        { text: "Quiero un corte clásico el martes a las 10, soy Ana", state: null, turnId: "p2" },
      );
      assert.ok(book.ok);
      const yes = await previewOnboarding(deps, simulationDeps({ Sí: reading("CONFIRMATION") }, [], BARBER_SERVICES), { text: "Sí", state: book.state, turnId: "p3" });
      assert.ok(yes.ok);
      assert.deepEqual(yes.actions, [{ action: "crear_cita_nylas_generico", status: "SUCCEEDED", simulated: true }], "la vista previa simula; no reserva");
      // 3. "Prueba tu agente": escenarios según la configuración, sin efectos reales.
      // El ejemplo de reserva se adapta al horario del negocio (el lunes está cerrado: usa el martes).
      const readings = {
        ...barberScenarioReadings(),
        "Quiero agendar un Corte clásico para el martes a las 10 de la mañana": reading("BOOKING_REQUEST", [S("service", "Corte clásico"), S("date", "el martes"), S("time", "a las 10 de la mañana", "10:00")]),
      };
      const t = await testOnboardingAgent(deps, simulationDeps(readings, [], BARBER_SERVICES));
      assert.ok(t.ok && t.passed, JSON.stringify(t));
      assert.ok(t.scenarios.every((s) => s.checks.some((c) => c.label === "No ejecutó acciones reales" && c.ok)));
      // 4. Publicar (etapas reales en orden).
      const stages: string[] = [];
      const pub = await publishOnboarding(deps, { expectedRevision: saved.revision }, (e) => e.status === "done" && stages.push(e.stage));
      assert.ok(pub.ok && pub.publishedVersion === 1, JSON.stringify(pub));
      assert.deepEqual(stages, ["review", "validate", "compile", "verify", "save", "publish"]);
      const flow = world.registry._debug.flows.find((f) => f.tenantId === TENANT_A)!;
      const s = await world.registry.resolvePublishedVersion(TENANT_A, flow.id);
      const a = await world.fakes.modelStore.loadActive(TENANT_A, flow.id);
      return { flowId: flow.id, served: s!, activeArtifact: a!.artifact as CompiledAgentArtifact };
    })();

    // La versión servida es la configuración del negocio (no un fixture): nombre, horario, zona, motor, recordatorios.
    const spec: BusinessAgentSpec = served.spec;
    assert.equal(spec.identity.businessName, "Barbería Los Andes");
    assert.equal(spec.identity.timezone, "America/Bogota");
    assert.deepEqual([spec.runtime?.engine, spec.runtime?.engineChoice, spec.runtime?.reminders?.offsetMinutes, spec.runtime?.tone], ["state_machine_v1", "explicit", 120, "profesional"]);

    // 5. Gate de activación REAL: explica qué falta, por qué y cómo solucionarlo; con todo listo, permite.
    world.credentials = { ...world.credentials, whatsappToken: false };
    const noToken = await evaluateBusinessAgentActivation(realGate(world, TENANT_A), { tenantId: TENANT_A, flowId, phoneNumberId: "pn-a" });
    assert.equal(noToken.kind, "blocked");
    const tokenBlocker = noToken.kind === "blocked" ? noToken.blockers.find((b) => b.detailCode === "WHATSAPP_CREDENTIAL_MISSING") : undefined;
    assert.ok(tokenBlocker?.why && tokenBlocker.fix, "qué falta + por qué + cómo solucionarlo");
    world.credentials = { ...world.credentials, whatsappToken: true };
    world.plan = false;
    const noPlan = await activateOnboarding({ ...deps, activation: { ...deps.activation, evaluate: (f, pn) => evaluateBusinessAgentActivation(realGate(world, TENANT_A), { tenantId: TENANT_A, flowId: f, phoneNumberId: pn }) } }, { phoneNumberId: "pn-a" });
    assert.equal(noPlan.ok, false);
    assert.deepEqual(noPlan.ok ? null : noPlan.blockers.map((b) => [b.what, Boolean(b.why), Boolean(b.fix)]), [["Necesitas un plan activo para que tu agente responda en WhatsApp.", true, true]]);
    world.plan = true;
    const gateDeps = { ...deps, activation: { ...deps.activation, evaluate: (f: string, pn: string) => evaluateBusinessAgentActivation(realGate(world, TENANT_A), { tenantId: TENANT_A, flowId: f, phoneNumberId: pn }) } };
    const act = await activateOnboarding(gateDeps, { phoneNumberId: "pn-a" });
    assert.deepEqual(act, { ok: true, phoneNumberId: "pn-a" });
    assert.equal((await getOnboarding(deps)).status, "ACTIVE");

    // 6. Motor en producción: SOLO si DuLabs lo admitió (piloto explícito); kill switch lo devuelve al motor seguro.
    const eligible = () => specRolloutEligible({ tenantId: TENANT_A, agentId: flowId, versionRef: served.flowVersionId, spec });
    assert.deepEqual(selectAgentEngine({ tenantId: TENANT_A, spec, env: {}, rolloutEligible: eligible }), { engine: "graph_v1", source: "rollout_not_selected" });
    assert.deepEqual(selectAgentEngine({ tenantId: TENANT_A, spec, env: { BUSINESS_AGENT_PILOT_TENANTS: TENANT_A }, rolloutEligible: eligible }), { engine: "state_machine_v1", source: "published" });
    assert.deepEqual(selectAgentEngine({ tenantId: TENANT_A, spec, env: { BUSINESS_AGENT_PILOT_TENANTS: TENANT_A, BUSINESS_AGENT_ENGINE_KILL_SWITCH: TENANT_A }, rolloutEligible: eligible }), { engine: "graph_v1", source: "kill_switch" });

    // 7. Mensajes reales contra la versión PUBLICADA (misma huella que el artefacto activo).
    let clock = Date.parse("2026-09-26T15:00:00Z");
    const reminders = memoryReminders(() => clock);
    const p = createPipeline(spec, {
      tenantId: TENANT_A,
      agentId: flowId,
      versionRef: served.flowVersionId,
      phoneNumberId: "pn-a",
      catalogServices: BARBERIA_CATALOG,
      native: createNativeActionHandler({ reminders, clock: () => new Date(clock) }),
      // Producción carga el artefacto ACTIVO cuando su enlace coincide con la versión servida (resolveConversationArtifact).
      artifact: activeArtifact,
    });
    // Y ese artefacto tiene la MISMA huella de ejecución que el Spec servido (lo exige la publicación: PROJECTION_MISMATCH).
    assert.equal(artifactOf(spec, TENANT_A, flowId, served.flowVersionId).executionFingerprint, activeArtifact.executionFingerprint, "Spec servido y artefacto publicado ejecutan lo mismo");
    assert.equal(p.artifact.presentation.assistantName, "Leo");
    const week = p.artifact.booking!.businessHours!.week; // forma de los handlers: week[0] = domingo
    assert.deepEqual(week.map((d) => !d.closed), [false, false, true, true, true, true, true], "horario del negocio (domingo y lunes cerrados), no una plantilla");
    const say = async (text: string, model: Parameters<typeof p.webhook>[1]) => {
      clock += 60_000;
      return p.webhook(text, model);
    };

    await say("Hola", out("GREETING"));
    // Tono profesional y el nombre del asistente que el negocio configuró.
    assert.equal(p.sent.at(-1), "Hola, soy Leo, el asistente virtual de Barbería Los Andes. ¿En qué puedo ayudarte?");

    // Precio: hecho del catálogo real (nunca del modelo).
    await say("¿Cuánto cuesta el corte clásico?", out("PRICE_INQUIRY", [S("service", "corte clásico", "Corte clásico")]));
    assert.match(p.sent.at(-1)!, /Corte clásico: \$\s?30\.000/);
    assert.doesNotMatch(p.sent.at(-1)!, /45\.000.*Corte clásico/);

    // Cita dentro del horario PROPIO (martes 6:30 p. m. existe aquí; con la plantilla 9–18 no existiría).
    await say(
      "Quiero un corte clásico el martes a las 6:30 de la tarde, soy Ana",
      out("BOOKING_REQUEST", [S("service", "corte clásico", "Corte clásico"), S("date", "el martes"), S("time", "a las 6:30 de la tarde"), S("customer_name", "Ana")]),
    );
    assert.match(p.sent.at(-1)!, /Corte clásico, el martes 29 de septiembre, a las 6:30 p\. m\., a nombre de Ana/);
    assert.equal(p.calls("crear_cita_nylas_generico").length, 0, "sin confirmación no se reserva");
    await say("Sí, confirmo", out("CONFIRMATION"));
    const booked = p.calls("crear_cita_nylas_generico");
    assert.equal(booked.length, 1);
    assert.deepEqual([booked[0]!.tenantId, booked[0]!.payload.servicio, booked[0]!.payload.fecha, booked[0]!.payload.hora], [TENANT_A, "Corte clásico", "2026-09-29", "18:30"]);
    const state = await p.state();
    assert.equal(state!.lastBooking?.start, "2026-09-29T23:30:00.000Z", "6:30 p. m. en Bogotá (zona del negocio)");

    // Recordatorio con el offset configurado (120 min) sobre la cita REAL.
    await say("¿Me recuerdas la cita?", out("REMINDER_REQUEST"));
    assert.equal(reminders.rows.length, 1);
    assert.deepEqual([reminders.rows[0]!.tenantId, reminders.rows[0]!.remindAt, reminders.rows[0]!.status], [TENANT_A, "2026-09-29T21:30:00.000Z", "scheduled"]);

    // Doble confirmación / mensaje repetido: UNA sola reserva.
    await say("Sí, confirmo", out("CONFIRMATION"));
    await p.webhook("Sí, confirmo", out("CONFIRMATION"), "wamid.dup");
    await p.webhook("Sí, confirmo", out("CONFIRMATION"), "wamid.dup");
    assert.equal(p.calls("crear_cita_nylas_generico").length, 1, "nunca una segunda reserva");

    // Regla configurada (tema restringido) y traspaso a persona: ANTES de la IA, sin acciones.
    const before = p.handler.calls.length;
    await say("¿Qué opinas de la política?", out("INFORMATION_REQUEST"));
    assert.equal(p.gate.messages.at(-1), "De ese tema no hablamos por aquí.");
    await say("Quiero hablar con una persona", out("HUMAN_HANDOFF"));
    assert.equal(p.gate.transfers.length, 1);
    assert.equal(p.gate.transfers[0]!.pauseHours, 8, "pausa configurada");
    assert.equal(p.handler.calls.length, before, "reglas y traspaso no ejecutan acciones");

    // 8. Observabilidad: cada turno dice tenant, agente, versión, huella, acción, resultado y latencia (sin texto del cliente).
    const bookingTurn = p.traces.find((t) => t.actions.some((a) => a.action === "crear_cita_nylas_generico"));
    assert.ok(bookingTurn);
    // Versión servida: la del artefacto publicado (modelo v1 → "ubm-v1"), con su huella de ejecución.
    assert.deepEqual([bookingTurn.tenantId, bookingTurn.agentId, bookingTurn.publishedVersion, bookingTurn.artifactFingerprint], [TENANT_A, flowId, activeArtifact.version.ref, activeArtifact.executionFingerprint]);
    assert.equal(activeArtifact.version.ref, "ubm-v1");
    assert.equal(bookingTurn.actions.find((a) => a.action === "crear_cita_nylas_generico")!.status, "SUCCEEDED");
    assert.ok(bookingTurn.latencyMs.total >= 0);
    assert.doesNotMatch(JSON.stringify(p.traces), /Ana|6:30 de la tarde/, "la traza no guarda texto ni nombre del cliente");
  });
});

describe("FASE 10 — golden path: tienda sin citas (productos, precio y stock reales, sin agenda)", () => {
  const PRODUCTS: InventoryProduct[] = [
    { name: "Camisa negra", price: 80_000, stock: 5 },
    { name: "Camisa negra talla M", price: 80_000, stock: 2 },
    { name: "Camisa blanca", price: 75_000, stock: 0 },
  ];

  it("se configura SIN agenda ni horario, publica y consulta el inventario real; nunca reserva", async () => {
    const world = createWorld();
    const d = emptyDraft();
    d.business = { name: "Tienda Sol", category: "Tienda / Retail", timezone: "America/Bogota" };
    d.offer = { services: false, products: true, showCatalog: true, quotes: false };
    d.support = { handoff: true, pauseHours: 24, answerQuestions: true, whenUnknown: "say_so", whenCannotHelp: "offer_person" };
    d.engine = "state_machine_v1";
    // Sin citas: el horario queda sin configurar y NO bloquea (no se le obliga a configurar una agenda).
    const { served, flowId, activeArtifact } = await configureAndPublish(world, TENANT_B, d);
    assert.ok(Object.values(d.hours.week).every((x) => !x.open));
    assert.equal(served.spec.capabilities.scheduling, false);
    assert.deepEqual(Object.keys(activeArtifact.actions).filter((a) => /cita|recordatorio/.test(a)), [], "el artefacto no tiene NINGUNA acción de citas");
    assert.equal(selectAgentEngine({ tenantId: TENANT_B, spec: served.spec, env: world.engineEnv }).engine, "state_machine_v1");

    const inventory = memoryInventory({ [TENANT_B]: PRODUCTS, [TENANT_A]: [{ name: "Camisa roja", price: 1, stock: 99 }] });
    const p = createPipeline(served.spec, { tenantId: TENANT_B, agentId: flowId, phoneNumberId: "pn-b", artifact: activeArtifact, native: createNativeActionHandler({ products: inventory }) });

    const price = await p.say("¿Cuánto cuesta la camisa negra?", out("PRICE_INQUIRY", [S("product", "camisa negra")]));
    assert.match(price.reply!, /Camisa negra cuesta \$\s?80\.000/);
    const m = await p.say("¿Hay talla M?", out("PRODUCT_INQUIRY", [S("product", "talla M")]));
    assert.match(m.reply!, /Camisa negra talla M a \$\s?80\.000\. Hay 2 disponibles\./);
    const none = await p.say("¿Tienen zapatos rojos?", out("PRODUCT_INQUIRY", [S("product", "zapatos rojos")]));
    assert.equal(none.reply, "No encontré «zapatos rojos» en nuestro inventario. ¿Te ayudo a buscar otro producto?", "no inventa");
    const out0 = await p.say("¿y la camisa blanca?", out("PRODUCT_INQUIRY", [S("product", "camisa blanca")]));
    assert.equal(out0.reply, "Camisa blanca está agotado en este momento.", "no ofrece stock inexistente");
    assert.doesNotMatch(out0.reply!, /disponible/);
    // El inventario de OTRO tenant nunca aparece.
    const other = await p.say("¿Tienen camisa roja?", out("PRODUCT_INQUIRY", [S("product", "camisa roja")]));
    assert.match(other.reply!, /No encontré «camisa roja»/);
    assert.ok(inventory.reads.every((t) => t === TENANT_B));

    // Un negocio SIN citas no puede reservar ni programar recordatorios, aunque el modelo lo "entienda" así.
    const book = await p.say("Quiero agendar una cita mañana a las 3", out("BOOKING_REQUEST", [S("date", "mañana"), S("time", "a las 3", "15:00")]));
    const remind = await p.say("recuérdame mañana", out("REMINDER_REQUEST", [S("date", "mañana")]));
    assert.deepEqual([book.actions, remind.actions], [[], []]);
    assert.match(book.reply!, /^Por ahora no puedo gestionar eso por aquí\./);
    assert.equal(p.handler.calls.filter((c) => /cita/.test((c.action as { actionType: string }).actionType)).length, 0);
  });
});

describe("FASE 10 — golden path: negocio híbrido (productos ≠ servicios ≠ citas)", () => {
  it("producto se consulta en el inventario; servicio se agenda con el catálogo de servicios; nunca se cruzan", async () => {
    const world = createWorld();
    world.numbers.set(TENANT_C, [{ phoneNumberId: "pn-c", label: "Salón · •••• 1234", status: "available" }]);
    world.engineEnv = { BUSINESS_AGENT_PILOT_TENANTS: TENANT_C };
    const d = emptyDraft();
    d.business = { name: "Salón Aura", category: "Peluquería y tienda", timezone: "America/Bogota" };
    d.offer = { services: true, products: true, showCatalog: true, quotes: false };
    d.booking = { enabled: true, agenda: "calendar", minimumNoticeMinutes: 60, allowChanges: false, changesNoticeHours: 4 };
    d.hours = defaultHours(); // el negocio eligió la plantilla lunes a viernes 9–18
    d.engine = "state_machine_v1";
    const { served, flowId, activeArtifact } = await configureAndPublish(world, TENANT_C, d);
    assert.deepEqual([served.spec.capabilities.scheduling, served.spec.catalog.useServices, served.spec.catalog.useProducts], [true, true, true]);

    const inventory = memoryInventory({ [TENANT_C]: [{ name: "Cera para cabello", price: 25_000, stock: 4 }] });
    const p = createPipeline(served.spec, {
      tenantId: TENANT_C,
      agentId: flowId,
      phoneNumberId: "pn-c",
      artifact: activeArtifact,
      catalogServices: [{ name: "Corte de dama", durationMinutes: 60, price: 60_000 }],
      native: createNativeActionHandler({ products: inventory }),
    });

    // PRODUCTO → inventario (lectura), nunca una cita.
    const prod = await p.say("¿Tienen cera para cabello?", out("PRODUCT_INQUIRY", [S("product", "cera para cabello")]));
    assert.deepEqual(prod.actions.map((a) => a.action), ["ba_consultar_producto"]);
    assert.match(prod.reply!, /Cera para cabello a \$\s?25\.000/);

    // Un PRODUCTO no se agenda como servicio (la cera no está en el catálogo de servicios).
    const wrong = await p.say("Quiero agendar cera para cabello el lunes", out("BOOKING_REQUEST", [S("service", "cera para cabello"), S("date", "el lunes")]));
    assert.deepEqual(wrong.actions, []);
    assert.match(wrong.reply!, /Ese servicio no lo tenemos\. Estos son nuestros servicios: Corte de dama/);

    // SERVICIO → precio del catálogo de servicios, y la CITA con ese servicio.
    const svcPrice = await p.say("¿Cuánto cuesta el corte de dama?", out("PRICE_INQUIRY", [S("service", "corte de dama", "Corte de dama")]));
    assert.match(svcPrice.reply!, /Corte de dama: \$\s?60\.000/);
    assert.doesNotMatch(svcPrice.reply!, /25\.000/, "el precio del producto no se mezcla con el del servicio");
    await p.say("Quiero un corte de dama el lunes a las 10 de la mañana, soy Eva", out("BOOKING_REQUEST", [S("service", "corte de dama", "Corte de dama"), S("date", "el lunes"), S("time", "a las 10 de la mañana", "10:00"), S("customer_name", "Eva")]));
    const ok = await p.say("sí", out("CONFIRMATION"));
    assert.deepEqual(ok.actions.map((a) => [a.action, a.status]), [["crear_cita_nylas_generico", "SUCCEEDED"]]);
    const booked = p.calls("crear_cita_nylas_generico");
    assert.deepEqual([booked.length, booked[0]!.tenantId, booked[0]!.payload.servicio], [1, TENANT_C, "Corte de dama"]);
    assert.ok(inventory.reads.every((t) => t === TENANT_C));
  });
});
