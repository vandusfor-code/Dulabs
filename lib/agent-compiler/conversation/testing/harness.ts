// Business Agent 2.0, FASE 3 — harness de tests de la máquina de estados (sin red).
//
// Usa piezas REALES: Spec → adaptador legacy → UBM → artefacto publicado (FASE 5) → requisitos, Understanding Engine de FASE 2 (understandMessage con
// su validador y normalizador), reducer, servicio y store con la semántica de Postgres. Lo único con guion es la salida
// del MODELO para cada mensaje (scriptedProvider), igual que en FASE 2: no hay GEMINI_KEY ni red en este entorno.

import { understandMessage } from "@/lib/agent-compiler/understanding/engine";
import type { UnderstandingInput } from "@/lib/agent-compiler/understanding/context";
import { scriptedProvider } from "@/lib/agent-compiler/understanding/testing/harness";
import { slotDisplayValue } from "@/lib/agent-compiler/understanding/validate";
import { photographySpec, retailSpec, salonSpec } from "@/lib/agent-compiler/runtime/fixtures";
import type { BusinessAgentSpec, CustomerField } from "@/lib/agent-compiler/spec/types";
import { compileLegacySpec } from "@/lib/agent-compiler/business-model/compile";
import { artifactRequirements, businessContextFromArtifact, type CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";
import { createInMemoryConversationStore, type InMemoryConversationStore } from "@/lib/agent-compiler/conversation/testing/in-memory-conversation-store";
import {
  applySystemEvent,
  processConversationTurn,
  type ConversationServiceDeps,
  type ConversationTransitionLog,
  type ConversationTurnResult,
  type HumanControlPort,
} from "@/lib/agent-compiler/conversation/service";
import type { ConversationInputEvent } from "@/lib/agent-compiler/conversation/transitions";
import type { ConversationStateKey } from "@/lib/agent-compiler/conversation/store";

export const TENANT = "11111111-1111-4111-8111-111111111111";
export const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
export const KEY: ConversationStateKey = { tenantId: TENANT, phoneNumberId: "pn-a", telefonoCliente: "573001112233", agentId: "flow-1" };

const field = (key: string, label: string, type: CustomerField["type"], required: boolean, scope: CustomerField["scope"], options?: string[]): CustomerField => ({
  key,
  label,
  type,
  required,
  enabled: true,
  scope,
  ...(options ? { options } : {}),
});

/** Horario real de atención: todos los días 08:00–20:00 (necesario para compilar agendamiento Nylas). */
const OPEN_EVERY_DAY = { week: Array.from({ length: 7 }, () => ({ closed: false, intervals: [{ open: "08:00", close: "20:00" }] })), exceptions: [] };

const NYLAS_SCHEDULING: BusinessAgentSpec["scheduling"] = {
  enabled: true,
  provider: "nylas",
  timezone: "America/Bogota",
  minNoticeMinutes: 60,
  cancellation: { allowed: true, minNoticeHours: 4 },
  confirmation: { required: false, hoursBefore: 2 },
  resources: [],
  businessHours: OPEN_EVERY_DAY,
};

/** Barbería: agenda Nylas (con consulta de disponibilidad y gestión de citas), cotiza, pide el nombre. */
export function barberSpec(): BusinessAgentSpec {
  const s = salonSpec();
  s.identity.businessName = "Barbería Norte";
  s.capabilities = { ...s.capabilities, sales: true, catalog: true, faq: true, humanHandoff: true };
  s.scheduling = NYLAS_SCHEDULING;
  s.customerData = { fields: [field("nombreCliente", "Nombre", "text", true, "customer")] };
  return s;
}

/**
 * Tienda: cotiza productos (no toma pedidos: no existe acción de pedidos), con talla y color como datos del negocio.
 * FASE 5: los campos eran scope "booking" en un negocio SIN agenda, configuración que el validador de publicación (legacy
 * y UBM) rechaza; ahora son del cliente para que la fixture sea publicable.
 */
export function storeSpec(): BusinessAgentSpec {
  const s = retailSpec();
  s.customerData = { fields: [field("color", "Color", "text", false, "customer"), field("talla", "Talla", "select", false, "customer", ["S", "M", "L"])] };
  return s;
}

/** Restaurante: reserva de mesa SIN servicio (useServices = false) y con número de personas obligatorio. */
export function restaurantSpec(): BusinessAgentSpec {
  const s = salonSpec();
  s.identity.businessName = "Restaurante Mar";
  s.catalog = { ...s.catalog, useServices: false };
  s.scheduling = { ...NYLAS_SCHEDULING, cancellation: { allowed: false, minNoticeHours: 0 } };
  s.customerData = { fields: [field("nombreCliente", "Nombre", "text", true, "customer"), field("personas", "Número de personas", "number", true, "booking")] };
  return s;
}

/** Estudio de fotos: agenda con el proveedor interno (sin consulta de disponibilidad Nylas). */
export function studioSpec(): BusinessAgentSpec {
  const s = photographySpec();
  s.capabilities = { ...s.capabilities, scheduling: true };
  s.scheduling = { ...NYLAS_SCHEDULING, provider: "internal", cancellation: { allowed: false, minNoticeHours: 0 } };
  s.customerData = { fields: [field("nombreCliente", "Nombre", "text", true, "customer")] };
  return s;
}

export type ModelOutput = Record<string, unknown>;

/** Salida del modelo con valores por defecto válidos (misma forma que FASE 2). */
export function llm(over: ModelOutput = {}): ModelOutput {
  return { primaryIntent: { intent: "UNKNOWN", confidence: 0.5 }, secondaryIntents: [], slots: [], ambiguities: [], language: "es", ...over };
}
export const intent = (name: string, confidence = 0.9) => ({ intent: name, confidence });

export interface Harness {
  artifact: CompiledAgentArtifact;
  deps: ConversationServiceDeps;
  store: InMemoryConversationStore;
  logs: ConversationTransitionLog[];
  modelCalls: string[];
  human: { active: boolean };
  /** Minutos transcurridos del reloj simulado. */
  advance(minutes: number): void;
  /** Deja listo el guion del modelo para un texto (para quien procese el turno por otra vía, p. ej. el runtime). */
  script(text: string, output: ModelOutput | null): void;
  /** Reloj simulado actual. */
  now(): Date;
  say(text: string, output: ModelOutput | null, opts?: { eventId?: string; sentAt?: string; key?: ConversationStateKey }): Promise<ConversationTurnResult>;
  system(event: Exclude<ConversationInputEvent, { type: "MESSAGE_UNDERSTOOD" | "UNDERSTANDING_FAILED" }>, key?: ConversationStateKey): Promise<ConversationTurnResult>;
}

/** Sábado 26-09-2026 10:00 en Bogotá. */
export const START = Date.parse("2026-09-26T15:00:00Z");

/** Artefacto publicado de una fixture (Spec legacy → UBM → compilador), o el artefacto tal cual. Falla si no es publicable. */
export function artifactFor(source: BusinessAgentSpec | CompiledAgentArtifact, opts: { tenantId?: string; versionRef?: string; agentId?: string } = {}): CompiledAgentArtifact {
  if ("artifactSchema" in source) return source;
  const r = compileLegacySpec(source, { tenantId: opts.tenantId ?? TENANT, agentId: opts.agentId ?? KEY.agentId, versionRef: opts.versionRef ?? "v1", publishedVersion: null });
  if (!r.ok) throw new Error(`fixture no publicable: ${JSON.stringify(r.errors)}`);
  return r.artifact;
}

export function createHarness(source: BusinessAgentSpec | CompiledAgentArtifact, opts: { humanControl?: boolean; store?: InMemoryConversationStore; tenantId?: string } = {}): Harness {
  const artifact = artifactFor(source, { tenantId: opts.tenantId });
  let now = START;
  let seq = 0;
  const logs: ConversationTransitionLog[] = [];
  const modelCalls: string[] = [];
  const human = { active: false };
  const store = opts.store ?? createInMemoryConversationStore();
  const pending = new Map<string, ModelOutput | null>();
  const clock = () => new Date(now);

  const humanControl: HumanControlPort | undefined = opts.humanControl ? { isActive: async () => human.active } : undefined;
  const deps: ConversationServiceDeps = {
    store,
    requirements: artifactRequirements(artifact),
    business: businessContextFromArtifact(artifact),
    understand: async (input: UnderstandingInput) => {
      modelCalls.push(input.message.text);
      const out = pending.get(input.message.text);
      if (out === undefined) throw new Error(`sin guion para: ${input.message.text}`);
      return understandMessage({ provider: scriptedProvider(out), clock, log: () => {} }, input);
    },
    humanControl,
    clock,
    log: (e) => logs.push(e),
  };

  return {
    artifact,
    deps,
    store,
    logs,
    modelCalls,
    human,
    advance(minutes) {
      now += minutes * 60_000;
    },
    script(text, output) {
      pending.set(text, output);
    },
    now: () => new Date(now),
    async say(text, output, o = {}) {
      pending.set(text, output);
      now += 60_000;
      seq += 1;
      return processConversationTurn(deps, { key: o.key ?? KEY, agentVersion: "v1", eventId: o.eventId ?? `wamid.${seq}`, text, sentAt: o.sentAt ?? new Date(now).toISOString() });
    },
    async system(event, key = KEY) {
      now += 1_000;
      return applySystemEvent(deps, key, event);
    },
  };
}

/** Resultado no rechazado (processed / duplicate / human_control). `transition`/`domainEvents` solo existen en processed. */
export function processed(r: ConversationTurnResult): Extract<ConversationTurnResult, { outcome: "processed" }> {
  if (r.outcome === "rejected") throw new Error(`rechazado: ${r.error.category} ${r.error.code}`);
  return r as Extract<ConversationTurnResult, { outcome: "processed" }>;
}

export function values(r: ConversationTurnResult): Record<string, unknown> {
  const p = processed(r);
  return Object.fromEntries(Object.entries(p.state.slots).map(([k, s]) => [k, s.value ? slotDisplayValue(s.value) : null]));
}
