// Business Agent 2.0, FASE 6 — utilidades de test del onboarding (sin red).
//
// Piezas REALES: borrador, ensamblado, validación UBM, compilador, Spec del runtime, registro en memoria con sus
// invariantes, readiness, simulación (Gate + state machine + Action Engine + renderer). Dobles: stores con la semántica
// de las migraciones (la SQL real: scripts/verify-ba-onboarding.sh), hechos del negocio, plan, números, el catálogo
// de servicios del negocio y el TRANSPORTE del modelo de lenguaje (salida del modelo con guion por mensaje: lo que se
// prueba es todo lo que el backend hace con esa salida — validación, entidades, estado, acciones, respuesta).

import type { ArtifactLink } from "@/lib/agent-compiler/lifecycle/drift";
import type { ReadinessFacts } from "@/lib/business-agent-readiness";
import { createInMemoryBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/testing/in-memory-registry-store";
import type { BusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/types";
import type { AgentLifecycleState } from "@/lib/agent-compiler/lifecycle/lifecycle";
import { defaultHours, emptyDraft, type OnboardingDraft } from "@/lib/agent-compiler/onboarding/draft";
import type { OnboardingDeps, OnboardingEvent } from "@/lib/agent-compiler/onboarding/service";
import type { WhatsAppNumberInfo } from "@/lib/agent-compiler/onboarding/status";
import { createOnboardingFakes } from "@/lib/agent-compiler/onboarding/testing/in-memory";
import { understandMessage } from "@/lib/agent-compiler/understanding/engine";
import type { UnderstandingProvider } from "@/lib/agent-compiler/understanding/provider";
import type { SimulationDeps } from "@/lib/agent-compiler/onboarding/simulation";
import type { EffectDispatchRequest, EffectDispatchResult } from "@/lib/flow/executor-types";
import { selectAgentEngine } from "@/lib/agent-compiler/runtime/production/engine-selection";
import { compileLegacySpec } from "@/lib/agent-compiler/business-model/compile";
import { buildCapabilityMatrix, evaluateEngineReadiness, type CredentialFacts } from "@/lib/agent-compiler/lifecycle/capability-matrix";

export const TENANT_A = "11111111-1111-4111-8111-111111111111";
export const TENANT_B = "22222222-2222-4222-8222-222222222222";
export const NOW = new Date("2026-09-26T15:00:00Z");

export interface World {
  registry: BusinessAgentRegistryStore & { _debug: { flows: Array<{ tenantId: string; id: string; publishedVersionId: string | null }>; versions: unknown[] } };
  fakes: ReturnType<typeof createOnboardingFakes>;
  facts: ReadinessFacts;
  plan: boolean;
  numbers: Map<string, WhatsAppNumberInfo[]>;
  bound: Array<{ tenantId: string; flowId: string; phoneNumberId: string }>;
  lifecycle: AgentLifecycleState | null;
  events: OnboardingEvent[];
  /** FASE 8 — credenciales del servidor (solo presencia). */
  credentials: CredentialFacts;
  /** FASE 9 — vínculo del artefacto activo (deriva de configuración). Ausente = sin dato (no se inventa deriva). */
  artifactLink?: ArtifactLink | null;
  /** FASE 10 — entorno de despliegue (qué tenants admitió DuLabs). Por defecto: A y B son pilotos seleccionados. */
  engineEnv: Record<string, string | undefined>;
}

/** Un "mundo" compartido (misma base) para varios tenants. */
export function createWorld(): World {
  const registry = createInMemoryBusinessAgentRegistryStore() as World["registry"];
  return {
    registry,
    fakes: createOnboardingFakes(registry),
    facts: { activeServices: 2, activeProducts: 3, hasKnowledge: true, calendarConnected: true },
    plan: true,
    numbers: new Map([
      [TENANT_A, [{ phoneNumberId: "pn-a", label: "Barbería · •••• 2233", status: "available" }]],
      [TENANT_B, [{ phoneNumberId: "pn-b", label: "Tienda · •••• 9988", status: "available" }]],
    ]),
    bound: [],
    lifecycle: null,
    events: [],
    credentials: { geminiKey: true, nylasApiKey: true, whatsappToken: true },
    engineEnv: { BUSINESS_AGENT_PILOT_TENANTS: `${TENANT_A},${TENANT_B}` },
  };
}

export function depsFor(world: World, tenantId: string, over: Partial<OnboardingDeps> = {}): OnboardingDeps {
  return {
    tenantId,
    userId: undefined,
    drafts: world.fakes.drafts,
    registry: world.registry,
    publisher: world.fakes.publisher,
    loadFacts: async () => world.facts,
    hasActivePlan: async () => world.plan,
    listNumbers: async (flowId) =>
      (world.numbers.get(tenantId) ?? []).map((n) => (world.bound.some((b) => b.tenantId === tenantId && b.flowId === flowId && b.phoneNumberId === n.phoneNumberId) ? { ...n, status: "active" } : n)),
    lifecycle: async (flowId) => (world.bound.some((b) => b.tenantId === tenantId && b.flowId === flowId) ? "ACTIVE" : world.lifecycle),
    activation: {
      async evaluate(flowId, phoneNumberId) {
        if (!(world.numbers.get(tenantId) ?? []).some((n) => n.phoneNumberId === phoneNumberId)) return { kind: "blocked", blockers: [{ code: "NUMBER_NOT_FOUND", category: "TENANT_ERROR", message: "Número no encontrado." }] };
        const published = await world.registry.resolvePublishedVersion(tenantId, flowId);
        if (!published) return { kind: "blocked", blockers: [{ code: "NOT_PUBLISHED", category: "BUSINESS_RULE_ERROR", message: "Publica tu agente antes de activarlo en un número." }] };
        if (!world.plan) return { kind: "blocked", blockers: [{ code: "BILLING_REQUIRED", category: "BUSINESS_RULE_ERROR", message: "Necesitas un plan activo para que tu agente responda en WhatsApp." }] };
        return { kind: "allowed", flowVersionId: published.flowVersionId };
      },
      async bind(flowId, phoneNumberId) {
        world.bound.push({ tenantId, flowId, phoneNumberId });
        return true;
      },
    },
    // FASE 8 — la MISMA lógica pura que producción (lifecycle/supabase.ts::evaluateEngineReport) con los hechos del mundo.
    async engineReport(flowId, input) {
      const current = input.draftSpec ?? input.publishedSpec!;
      const served = input.publishedSpec ?? current;
      const engine = selectAgentEngine({ tenantId, spec: served, env: world.engineEnv });
      const compiled = input.publishedSpec ? compileLegacySpec(input.publishedSpec, { tenantId, agentId: flowId, versionRef: "check", publishedVersion: null }) : null;
      const artifact = compiled?.ok ? compiled.artifact : null;
      const facts = { ...world.facts, whatsappConnected: (world.numbers.get(tenantId) ?? []).length > 0, remindersStore: true, remindersDispatchVerified: false };
      const matrix = buildCapabilityMatrix({ spec: current, published: artifact, engine: engine.engine, facts, agentActive: input.agentActive });
      const servedMatrix = buildCapabilityMatrix({ spec: served, published: artifact, engine: engine.engine, facts, agentActive: input.agentActive });
      const readiness = evaluateEngineReadiness({ spec: served, engine: engine.engine, artifactOk: input.publishedSpec ? Boolean(artifact) : true, credentials: world.credentials, killSwitchOn: false, matrix: servedMatrix });
      return { engine, matrix, readiness };
    },
    ...(world.artifactLink !== undefined ? { artifactLink: async () => world.artifactLink ?? null } : {}),
    now: () => NOW,
    log: (e) => world.events.push(e),
    ...over,
  };
}

export function barberDraft(): OnboardingDraft {
  const d = emptyDraft();
  d.business = { name: "Barbería Norte", description: "Cortes y barba en el centro.", category: "Barbería / Peluquería", timezone: "America/Bogota" };
  d.offer = { services: true, products: false, showCatalog: true, quotes: true };
  d.booking = { enabled: true, agenda: "calendar", minimumNoticeMinutes: 60, allowChanges: true, changesNoticeHours: 4 };
  // El negocio DECLARA su horario (el borrador vacío no trae ninguno).
  d.hours = defaultHours();
  d.support = { handoff: true, pauseHours: 12, answerQuestions: true, whenUnknown: "say_so", whenCannotHelp: "offer_person" };
  d.customerData = { askName: true, askEmail: false, askNotes: false, extra: [] };
  d.restrictedTopics = [{ words: ["política"], reply: "De eso no hablamos por aquí." }];
  return d;
}

export function storeDraft(): OnboardingDraft {
  const d = emptyDraft();
  d.business = { name: "Tienda Centro", category: "Tienda / Retail", timezone: "America/Bogota" };
  d.offer = { services: false, products: true, showCatalog: true, quotes: true };
  d.booking = { enabled: false, minimumNoticeMinutes: 60, allowChanges: false, changesNoticeHours: 4 };
  d.support = { handoff: true, pauseHours: 24, answerQuestions: true, whenUnknown: "say_so", whenCannotHelp: "offer_person" };
  d.customerData = { askName: true, askEmail: false, askNotes: false, extra: [] };
  return d;
}

type Reading = Record<string, unknown>;
export const reading = (intent: string, slots: Array<{ name: string; raw: string; value?: string }> = [], confidence = 0.95): Reading => ({ primaryIntent: { intent, confidence }, secondaryIntents: [], slots, ambiguities: [], language: "es" });

/** Servicios activos del negocio de prueba (lo que devolvería dulabs_servicios del tenant). */
export const BARBER_SERVICES = ["Corte clásico", "Corte + barba", "Barba"];

/**
 * Simulación con salida del modelo con guion por mensaje y un handler de lecturas espía. `services` = catálogo del negocio
 * (vacío por defecto: sin catálogo el servicio queda como lo dijo el cliente, como en FASE 6).
 */
export function simulationDeps(readings: Record<string, Reading>, seen: EffectDispatchRequest[] = [], services: readonly string[] = []): SimulationDeps & { seen: EffectDispatchRequest[] } {
  const provider: UnderstandingProvider = {
    name: "test",
    async understand(req) {
      // Mensaje exacto primero (CURRENT_MESSAGE viaja como JSON); luego, por contenido.
      const current = req.userContent.split("CURRENT_MESSAGE:\n")[1] ?? "";
      for (const [text, out] of Object.entries(readings)) if (current === JSON.stringify(text)) return { ok: true, output: out, provider: "test" };
      for (const [text, out] of Object.entries(readings)) if (current.includes(text)) return { ok: true, output: out, provider: "test" };
      return { ok: true, output: reading("UNKNOWN", [], 0.4), provider: "test" };
    },
  };
  return {
    seen,
    understand: (input) => understandMessage({ provider, clock: () => NOW, log: () => {} }, input),
    readServices: async () => services.map((name) => ({ name, durationMinutes: 30 })),
    readHandler: async (req): Promise<EffectDispatchResult> => {
      seen.push(req);
      return { success: true, classification: "SUCCESS", data: { conocimientoEncontrado: true, respuestaDirecta: "Atendemos de lunes a sábado.", catalogoTexto: "- Corte clásico $30.000", cantidadCatalogo: 1 } };
    },
    trace: () => {},
    now: () => NOW,
  };
}

/** Salidas con guion para las conversaciones de ejemplo de "Prueba tu agente" con barberDraft(). */
export function barberScenarioReadings(): Record<string, Reading> {
  return {
    "Hola, buenas": reading("GREETING"),
    "Quiero agendar un Corte clásico para el lunes a las 10 de la mañana": reading("BOOKING_REQUEST", [
      { name: "service", raw: "Corte clásico" },
      { name: "date", raw: "el lunes" },
      { name: "time", raw: "a las 10 de la mañana", value: "10:00" },
    ]),
    "Mis datos: Ana Prueba": reading("BOOKING_REQUEST", [{ name: "customer_name", raw: "Ana Prueba" }], 0.8),
    "Sí, confírmala": reading("CONFIRMATION"),
    "Quiero hablar con una persona": reading("HUMAN_HANDOFF"),
    "¿Qué opinas de política?": reading("INFORMATION_REQUEST"),
    "¿Qué horario tienen?": reading("INFORMATION_REQUEST"),
    "Quiero agendar una cita para mañana": reading("BOOKING_REQUEST", [{ name: "date", raw: "mañana" }]),
  };
}
