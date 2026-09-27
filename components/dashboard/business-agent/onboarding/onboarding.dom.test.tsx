import "@/lib/test-helpers/jsdom-setup";
// Business Agent 2.0, FASE 6 — pruebas de INTERFAZ reales (jsdom + Testing Library) de la configuración guiada y E2E
// 1–5: la pantalla habla con /api/business-agent/onboarding/* a través de un fetch en proceso que usa el MISMO servicio
// que las rutas (sesión→tenant, guardas, envelope, publicación NDJSON), con la base simulada del harness.

import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { OnboardingFlow } from "@/components/dashboard/business-agent/onboarding/OnboardingFlow";
import { HoursEditor } from "@/components/dashboard/business-agent/onboarding/HoursEditor";
import { StepProgress, stepState } from "@/components/dashboard/business-agent/onboarding/Progress";
import { defaultHours } from "@/lib/agent-compiler/onboarding/draft";
import { assembleDraft } from "@/lib/agent-compiler/onboarding/assemble";
import { saveOnboardingDraft, getOnboarding } from "@/lib/agent-compiler/onboarding/service";
import { createInProcessApi } from "@/lib/agent-compiler/onboarding/testing/in-process-api";
import { barberDraft, createWorld, depsFor, reading, storeDraft, TENANT_A, TENANT_B, type World } from "@/lib/agent-compiler/onboarding/testing/harness";

const SESSIONS = { "tok-a": TENANT_A, "tok-b": TENANT_B };
const FAST = { debounceMs: 5, validateDebounceMs: 0, storage: window.localStorage, storageKey: "test.onboarding" };

function mount(world: World, opts: { token?: string; readings?: Record<string, Record<string, unknown>>; storageKey?: string } = {}) {
  const api = createInProcessApi(world, SESSIONS, opts.readings);
  const r = render(<OnboardingFlow auth={{ accessToken: opts.token ?? "tok-a", fetchImpl: api.fetch }} options={{ ...FAST, storageKey: opts.storageKey ?? FAST.storageKey }} />);
  return { api, ...r };
}

const loaded = () => screen.findByRole("heading", { level: 2 });

async function waitSaved(container: HTMLElement = document.body) {
  await waitFor(() => assert.ok(within(container).getAllByText("Guardado").length > 0), { timeout: 3000 });
}

function goToStep(label: string, container: HTMLElement = document.body) {
  fireEvent.click(within(container).getByRole("button", { name: new RegExp(`^${label}`) }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/dashboard/business-agent/onboarding");
});
afterEach(() => cleanup());

describe("FASE 6 — UX de la configuración guiada", () => {
  it("AI 19. recargar conserva el borrador (autosave) y un corte de red no pierde cambios: se ofrece recuperarlos", async () => {
    const world = createWorld();
    const first = mount(world);
    await loaded();
    fireEvent.change(screen.getByLabelText(/¿Cómo se llama tu negocio\?/), { target: { value: "Barbería Norte" } });
    await waitSaved();
    first.unmount();
    mount(world);
    await loaded();
    assert.equal((screen.getByLabelText(/¿Cómo se llama tu negocio\?/) as HTMLInputElement).value, "Barbería Norte");
    cleanup();

    // Sin conexión: el cambio queda en pantalla y en el respaldo local; al volver se ofrece recuperarlo.
    const offline = mount(world);
    await loaded();
    offline.api.offline.value = true;
    fireEvent.change(screen.getByLabelText(/¿Cómo se llama tu negocio\?/), { target: { value: "Barbería Norte y Sur" } });
    await waitFor(() => assert.ok(screen.getByText("Sin conexión · reintentando")));
    offline.unmount();
    mount(world);
    await screen.findByText("Tienes cambios sin guardar de tu última visita.");
    fireEvent.click(screen.getByRole("button", { name: "Recuperarlos" }));
    assert.equal((screen.getByLabelText(/¿Cómo se llama tu negocio\?/) as HTMLInputElement).value, "Barbería Norte y Sur");
    await waitFor(async () => assert.equal((await getOnboarding(depsFor(world, TENANT_A))).draft.business.name, "Barbería Norte y Sur"));
    await waitSaved();
  });

  it("AI 20. los errores se muestran en el campo correcto (texto humano, aria-invalid) y en el paso del progreso", async () => {
    const world = createWorld();
    mount(world);
    await loaded();
    const name = screen.getByLabelText(/¿Cómo se llama tu negocio\?/);
    await waitFor(() => assert.equal(name.getAttribute("aria-invalid"), "true"));
    assert.ok(screen.getByText("Escribe el nombre de tu negocio."));
    // Horario: el lunes con cierre antes de la apertura.
    render(<HoursEditor hours={{ ...defaultHours(), week: { ...defaultHours().week, monday: { open: true, intervals: [{ start: "18:00", end: "09:00" }] } } }} onChange={() => {}} issues={assembleDraft({ ...barberDraft(), hours: { ...defaultHours(), week: { ...defaultHours().week, monday: { open: true, intervals: [{ start: "18:00", end: "09:00" }] } } } }).issues} />);
    assert.ok(screen.getByText(/El lunes: la hora de inicio debe ser antes que la de cierre/));
    assert.equal(screen.getByLabelText("Lunes, desde").getAttribute("aria-invalid"), "true");
    assert.equal(stepState("horario", "negocio", new Set(["horario"]), assembleDraft({ ...barberDraft(), hours: { ...defaultHours(), week: { ...defaultHours().week, monday: { open: true, intervals: [{ start: "18:00", end: "09:00" }] } } } }).issues), "error");
  });

  it("AI 21. navegación por pasos: Continuar/Atrás, el progreso marca el paso actual y se puede saltar a cualquiera", async () => {
    mount(createWorld());
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
    assert.equal(screen.getByRole("heading", { level: 2 }).textContent, "Lo que ofreces");
    assert.equal(screen.getByRole("button", { name: /^Lo que ofreces/ }).getAttribute("aria-current"), "step");
    fireEvent.click(screen.getByRole("button", { name: /Atrás/ }));
    assert.equal(screen.getByRole("heading", { level: 2 }).textContent, "Tu negocio");
    goToStep("Reglas");
    assert.equal(screen.getByRole("heading", { level: 2 }).textContent, "Reglas");
    assert.ok(window.location.search.includes("paso=reglas"), "el paso queda en la URL (recargar vuelve al mismo)");
    // Las opciones son un grupo con teclado.
    goToStep("Citas");
    const si = screen.getAllByRole("radio")[0]!;
    fireEvent.keyDown(si, { key: "ArrowRight" });
    assert.equal(screen.getAllByRole("radio")[1]!.getAttribute("aria-checked"), "true");
  });

  it("AI 22. configuración incompleta: 'Faltan datos', no se puede publicar ni activar", async () => {
    mount(createWorld());
    await loaded();
    goToStep("Publicar y activar");
    await screen.findByText("Antes de activar");
    assert.ok(screen.queryAllByText("Faltan datos").length + screen.queryAllByText("Sin empezar").length > 0);
    assert.equal((screen.getByRole("button", { name: /Publicar mi agente/ }) as HTMLButtonElement).disabled, true);
    assert.equal((screen.getByRole("button", { name: /Activar aquí/ }) as HTMLButtonElement).disabled, true);
  });

  it("AI 23. listo: 'Listo para publicar' y el botón de publicar habilitado", async () => {
    const world = createWorld();
    await saveOnboardingDraft(depsFor(world, TENANT_A), { expectedRevision: 0, draft: barberDraft() });
    mount(world);
    await loaded();
    goToStep("Publicar y activar");
    await screen.findByText("Antes de activar");
    assert.ok(screen.getAllByText("Listo para publicar").length > 0);
    assert.equal((screen.getByRole("button", { name: /Publicar mi agente/ }) as HTMLButtonElement).disabled, false);
  });

  it("AI 24. estado de activación: el número solo dice 'Activo' después de que el servidor lo activó", async () => {
    const world = createWorld();
    await saveOnboardingDraft(depsFor(world, TENANT_A), { expectedRevision: 0, draft: barberDraft() });
    mount(world);
    await loaded();
    goToStep("Publicar y activar");
    fireEvent.click(await screen.findByRole("button", { name: /Publicar mi agente/ }));
    await screen.findByText(/Tu agente quedó publicado/);
    assert.equal(world.bound.length, 0);
    assert.equal(screen.queryByText("Activo con este agente"), null);
    fireEvent.click(await screen.findByRole("button", { name: /Activar aquí/ }));
    await screen.findByText("Activo con este agente");
    assert.deepEqual(world.bound.map((b) => b.phoneNumberId), ["pn-a"]);
  });
});

describe("FASE 6 — E2E", () => {
  it("E2E 1. barbería desde la interfaz: servicios, horario, citas y handoff → guardar → validar → publicar → vista previa → activar", async () => {
    const world = createWorld();
    const { api } = mount(world, { readings: { Hola: reading("GREETING") } });
    await loaded();
    fireEvent.change(screen.getByLabelText(/¿Cómo se llama tu negocio\?/), { target: { value: "Barbería Norte" } });
    fireEvent.click(screen.getByRole("radio", { name: /Barbería \/ Peluquería/ }));
    goToStep("Lo que ofreces");
    assert.equal(screen.getByRole("radio", { name: /^Servicios/ }).getAttribute("aria-checked"), "true");
    goToStep("Citas");
    fireEvent.click(screen.getAllByRole("radio", { name: /^Sí/ })[0]!);
    fireEvent.click(screen.getByRole("radio", { name: /Google Calendar/ }));
    goToStep("Horario");
    assert.ok(screen.getByText("Tu agente solo ofrece y reserva citas dentro de este horario."));
    goToStep("Atención");
    assert.equal(screen.getAllByRole("radio", { name: /^Sí/ })[0]!.getAttribute("aria-checked"), "true", "handoff activo");
    await waitSaved();
    const draft = (await getOnboarding(depsFor(world, TENANT_A))).draft;
    assert.deepEqual([draft.business.name, draft.booking.enabled, draft.booking.agenda, draft.support.handoff], ["Barbería Norte", true, "calendar", true]);

    goToStep("Prueba");
    fireEvent.change(screen.getByLabelText("Mensaje de prueba"), { target: { value: "Hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje de prueba" }));
    await screen.findByText(/Soy el asistente de Barbería Norte/);

    goToStep("Publicar y activar");
    fireEvent.click(await screen.findByRole("button", { name: /Publicar mi agente/ }));
    await screen.findByText(/Tu agente quedó publicado/);
    for (const label of ["Revisando la información de tu negocio", "Validando servicios, horarios y reglas", "Publicando"]) assert.ok(screen.getByLabelText(`${label}: listo`));
    fireEvent.click(await screen.findByRole("button", { name: /Activar aquí/ }));
    await screen.findByText("Activo con este agente");
    assert.ok(api.calls.includes("POST /publish") && api.calls.includes("POST /activate"));
    assert.equal((await getOnboarding(depsFor(world, TENANT_A))).status, "ACTIVE");
  });

  it("E2E 2. tienda: catálogo de productos + handoff; pedir una cita se rechaza (sin acciones de agenda)", async () => {
    const world = createWorld();
    await saveOnboardingDraft(depsFor(world, TENANT_B), { expectedRevision: 0, draft: storeDraft() });
    mount(world, { token: "tok-b", readings: { "Quiero una cita": reading("BOOKING_REQUEST", [{ name: "date", raw: "mañana" }]) } });
    await loaded();
    goToStep("Prueba");
    fireEvent.change(screen.getByLabelText("Mensaje de prueba"), { target: { value: "Quiero una cita mañana" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje de prueba" }));
    await screen.findByText(/Por ahora no puedo gestionar eso por aquí/);
    fireEvent.click(screen.getByRole("button", { name: /Probar mi agente/ }));
    await screen.findByText("Pedir algo que tu negocio no hace por aquí");
    goToStep("Publicar y activar");
    fireEvent.click(await screen.findByRole("button", { name: /Publicar mi agente/ }));
    await screen.findByText(/Tu agente quedó publicado/);
    const served = await world.registry.resolvePublishedVersion(TENANT_B, world.registry._debug.flows.find((f) => f.tenantId === TENANT_B)!.id);
    assert.deepEqual([served!.spec.capabilities.scheduling, served!.spec.capabilities.catalog, served!.spec.catalog.useProducts, served!.spec.capabilities.humanHandoff], [false, true, true, true]);
  });

  it("E2E 3. configuración inválida: la interfaz no deja publicar y el servidor también lo bloquea", async () => {
    const world = createWorld();
    const bad = barberDraft();
    bad.booking.agenda = undefined;
    await saveOnboardingDraft(depsFor(world, TENANT_A), { expectedRevision: 0, draft: bad });
    const { api } = mount(world);
    await loaded();
    goToStep("Publicar y activar");
    await screen.findByText("Antes de activar");
    assert.equal((screen.getByRole("button", { name: /Publicar mi agente/ }) as HTMLButtonElement).disabled, true);
    assert.ok(screen.getByRole("button", { name: /^Citas, 1 por revisar/ }));
    // Aunque alguien llame a la API directamente, el servidor bloquea.
    const res = await api.fetch("/api/business-agent/onboarding/publish", { method: "POST", headers: { authorization: "Bearer tok-a", "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1 }) });
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    const result = lines.at(-1);
    assert.deepEqual([result.ok, result.code, result.stage], [false, "BA-PUB-001", "validate"]);
    assert.equal(world.fakes.rows.models.length, 0);
  });

  it("E2E 4. dos pestañas: la segunda que guarda ve 'cambió en otra sesión' y no pisa; publicar una revisión vieja da conflicto", async () => {
    const world = createWorld();
    await saveOnboardingDraft(depsFor(world, TENANT_A), { expectedRevision: 0, draft: barberDraft() });
    const tab1 = mount(world, { storageKey: "tab1" });
    const tab2 = mount(world, { storageKey: "tab2" });
    await waitFor(() => assert.equal(screen.getAllByRole("heading", { level: 2 }).length, 2));
    const [name1, name2] = screen.getAllByLabelText(/¿Cómo se llama tu negocio\?/) as HTMLInputElement[];
    fireEvent.change(name1!, { target: { value: "Barbería Pestaña 1" } });
    await waitSaved(tab1.container);
    fireEvent.change(name2!, { target: { value: "Barbería Pestaña 2" } });
    await within(tab2.container).findByText("Esta configuración cambió en otra sesión. Actualiza antes de continuar.");
    assert.equal((await getOnboarding(depsFor(world, TENANT_A))).draft.business.name, "Barbería Pestaña 1", "no se pisó");
    fireEvent.click(within(tab2.container).getByRole("button", { name: /Actualizar/ }));
    await waitFor(() => assert.equal((within(tab2.container).getByLabelText(/¿Cómo se llama tu negocio\?/) as HTMLInputElement).value, "Barbería Pestaña 1"));
    // Publicación con revisión vieja (la pestaña 1 guardó después): conflicto en el servidor.
    const stale = await tab2.api.fetch("/api/business-agent/onboarding/publish", { method: "POST", headers: { authorization: "Bearer tok-a", "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1 }) });
    const last = (await stale.text()).trim().split("\n").map((l) => JSON.parse(l)).at(-1);
    assert.deepEqual([last.ok, last.conflict, last.message], [false, true, "Esta configuración cambió en otra sesión. Actualiza antes de publicar."]);
  });

  it("E2E 5. simulación: reservar en la vista previa NO crea ninguna reserva real", async () => {
    const world = createWorld();
    await saveOnboardingDraft(depsFor(world, TENANT_A), { expectedRevision: 0, draft: barberDraft() });
    mount(world, {
      readings: {
        "Quiero un corte": reading("BOOKING_REQUEST", [{ name: "service", raw: "corte" }, { name: "date", raw: "el lunes" }, { name: "time", raw: "a las 10", value: "10:00" }, { name: "customer_name", raw: "Ana" }]),
        "Sí, reserva": reading("CONFIRMATION"),
      },
    });
    await loaded();
    goToStep("Prueba");
    const input = screen.getByLabelText("Mensaje de prueba");
    fireEvent.change(input, { target: { value: "Quiero un corte el lunes a las 10, soy Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje de prueba" }));
    await screen.findByText(/¿Lo reservo\?/);
    fireEvent.change(input, { target: { value: "Sí, reserva" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje de prueba" }));
    await screen.findByText(/Simulación: Aquí tu agente agendaría la cita/);
    assert.equal(screen.queryByText(/quedó agendada/i), null);
    assert.equal(world.fakes.rows.models.length, 0, "nada publicado ni ejecutado");
  });

  it("progreso accesible: cada paso anuncia su estado", () => {
    render(<StepProgress current="citas" visited={new Set(["negocio", "oferta", "citas"])} issues={[]} onSelect={() => {}} />);
    assert.ok(screen.getByRole("button", { name: "Tu negocio, completado" }));
    assert.ok(screen.getByRole("button", { name: "Citas, paso actual" }));
    assert.ok(screen.getByRole("button", { name: "Reglas, pendiente" }));
    assert.equal(screen.getByRole("progressbar").getAttribute("aria-valuenow"), "3");
  });
});

