// DuLabs Business — Business Agent 2.0, FASE 8 — selección EXPLÍCITA del motor de cada agente.
//
// Antes (FASE 4–7) el motor salía de una variable de entorno (lista de tenants). Ahora la fuente de verdad del
// producto es la VERSIÓN PUBLICADA del agente (`spec.runtime.engine`, inmutable y con rollback), con dos palancas
// operativas por encima:
//
//   1. KILL SWITCH (BUSINESS_AGENT_ENGINE_KILL_SWITCH): "all" o lista de tenants → graph_v1 sin importar lo publicado.
//      Para incidentes: el administrador de la plataforma apaga el motor nuevo sin republicar a nadie.
//   2. LISTA DE COMPATIBILIDAD (BUSINESS_AGENT_STATE_MACHINE_TENANTS, FASE 4): sigue funcionando igual durante la
//      transición (un tenant de la lista usa state_machine_v1 aunque su versión publicada no lo diga).
//   3. Versión publicada: `spec.runtime.engine`. Ausente = graph_v1.
//
// Nunca se "adivina": el resultado dice QUÉ motor y POR QUÉ (source). Ningún agente existente cambia de motor solo:
// solo una publicación con aceptación explícita del administrador escribe state_machine_v1.
//
// FASE 9 — DESPLIEGUE GRADUAL (BUSINESS_AGENT_ENGINE_ROLLOUT), por debajo del kill switch:
//   (sin valor) / "pilot"  comportamiento de FASE 8: solo los agentes que ELIGIERON el motor conversacional (pilotos).
//   "off"                  nadie usa el motor conversacional (ni pilotos ni la lista de compatibilidad).
//   "canary:N"             además, el N % de los tenants (hash estable del tenant) cuyos agentes NO eligieron motor.
//   "general"              todos los agentes que NO eligieron motor.
// Canary / general solo mueven un agente si el motor conversacional ejecuta TODAS sus capacidades encendidas y su
// versión publicada compila (`rolloutEligible`); si no, sigue en el grafo. Una elección explícita (engineChoice) nunca
// se pisa. Valor inválido = "pilot" (nunca amplía el despliegue por un error de escritura). Volver atrás = cambiar la
// variable: no se republica a nadie.

import { createHash } from "node:crypto";
import { AGENT_ENGINES, type AgentEngineId, type BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { isStateMachineRuntimeEnabled } from "@/lib/agent-compiler/runtime/production/conversation-runtime";
import { stateMachineSupportsSpec } from "@/lib/agent-compiler/lifecycle/capability-matrix";
import { compileLegacySpec } from "@/lib/agent-compiler/business-model/compile";

export const ENGINE_KILL_SWITCH_ENV = "BUSINESS_AGENT_ENGINE_KILL_SWITCH";
export const ENGINE_ROLLOUT_ENV = "BUSINESS_AGENT_ENGINE_ROLLOUT";
export const DEFAULT_AGENT_ENGINE: AgentEngineId = "graph_v1";

export type EngineSelectionSource = "kill_switch" | "rollout_off" | "env_allowlist" | "published" | "rollout" | "default";

export type RolloutStage = { stage: "off" } | { stage: "pilot" } | { stage: "canary"; percent: number } | { stage: "general" };

export function parseRollout(raw: string | undefined): RolloutStage {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "off") return { stage: "off" };
  if (v === "general") return { stage: "general" };
  const m = /^canary:(\d{1,3})$/.exec(v);
  if (m) {
    const percent = Number(m[1]);
    if (percent >= 1 && percent <= 100) return { stage: "canary", percent };
  }
  return { stage: "pilot" };
}

/** Balde estable 0–99 del tenant (el mismo tenant cae siempre en el mismo balde: sin parpadeo entre mensajes). */
export function rolloutBucket(tenantId: string): number {
  return createHash("sha256").update(`ba-rollout|${tenantId.toLowerCase()}`).digest().readUInt32BE(0) % 100;
}

export interface EngineSelection {
  engine: AgentEngineId;
  source: EngineSelectionSource;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** ¿El kill switch apaga el motor nuevo para este tenant? ("all" = todos; o lista de UUIDs). Valores inválidos se ignoran. */
export function isEngineKillSwitchOn(tenantId: string, env: Record<string, string | undefined> = process.env): boolean {
  const raw = (env[ENGINE_KILL_SWITCH_ENV] ?? "").trim().toLowerCase();
  if (!raw) return false;
  if (raw === "all") return true;
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => UUID.test(t))
    .includes(tenantId.toLowerCase());
}

/** Motor declarado por la versión publicada (valor desconocido = default: nunca se "adivina" un motor). */
export function publishedEngineOf(spec: Pick<BusinessAgentSpec, "runtime"> | undefined): AgentEngineId | null {
  const e = spec?.runtime?.engine;
  return e && (AGENT_ENGINES as readonly string[]).includes(e) ? e : null;
}

export function selectAgentEngine(input: {
  tenantId: string;
  spec: Pick<BusinessAgentSpec, "runtime"> | undefined;
  env?: Record<string, string | undefined>;
  /** FASE 9 — ¿el agente puede pasar al motor conversacional por despliegue gradual? Ausente = no. */
  rolloutEligible?: () => boolean;
}): EngineSelection {
  const env = input.env ?? process.env;
  if (isEngineKillSwitchOn(input.tenantId, env)) return { engine: "graph_v1", source: "kill_switch" };
  const rollout = parseRollout(env[ENGINE_ROLLOUT_ENV]);
  if (rollout.stage === "off") return { engine: "graph_v1", source: "rollout_off" };
  if (isStateMachineRuntimeEnabled(input.tenantId, env)) return { engine: "state_machine_v1", source: "env_allowlist" };
  const published = publishedEngineOf(input.spec);
  const explicit = input.spec?.runtime?.engineChoice === "explicit" || published === "state_machine_v1";
  if (published && explicit) return { engine: published, source: "published" };
  const inRollout = rollout.stage === "general" || (rollout.stage === "canary" && rolloutBucket(input.tenantId) < rollout.percent);
  if (inRollout && input.rolloutEligible?.() === true) return { engine: "state_machine_v1", source: "rollout" };
  if (published) return { engine: published, source: "published" };
  return { engine: DEFAULT_AGENT_ENGINE, source: "default" };
}

const eligibilityCache = new Map<string, boolean>();
const ELIGIBILITY_CACHE_MAX = 500;

/**
 * FASE 9 — elegibilidad de un agente SIN elección explícita para el despliegue gradual: el motor conversacional
 * ejecuta todas sus capacidades encendidas y su versión publicada compila. Cacheado por versión publicada (inmutable).
 */
export function specRolloutEligible(input: { tenantId: string; agentId: string; versionRef: string; spec: BusinessAgentSpec | undefined }): boolean {
  if (!input.spec) return false;
  const key = `${input.tenantId}|${input.agentId}|${input.versionRef}`;
  const hit = eligibilityCache.get(key);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    ok = stateMachineSupportsSpec(input.spec) && compileLegacySpec(input.spec, { tenantId: input.tenantId, agentId: input.agentId, versionRef: input.versionRef, publishedVersion: null }).ok;
  } catch {
    ok = false;
  }
  if (eligibilityCache.size >= ELIGIBILITY_CACHE_MAX) eligibilityCache.delete(eligibilityCache.keys().next().value!);
  eligibilityCache.set(key, ok);
  return ok;
}

/**
 * Descriptor del runtime que atiende un mensaje: QUÉ motor, por qué, con qué versión publicada y qué capacidades.
 * Se registra en la traza de cada mensaje (sin datos del cliente).
 */
export interface AgentRuntimeDescriptor {
  tenantId: string;
  agentId: string;
  engine: AgentEngineId;
  engineVersion: string;
  source: EngineSelectionSource;
  /** Versión publicada del registro (flow_version) que se está sirviendo. */
  publishedVersion: string;
  /** Capacidades encendidas en esa versión (claves del Spec publicado). */
  capabilities: string[];
}

export const ENGINE_VERSIONS: Readonly<Record<AgentEngineId, string>> = { graph_v1: "1", state_machine_v1: "1" };

export function describeAgentRuntime(input: {
  tenantId: string;
  agentId: string;
  publishedVersion: string;
  spec: Pick<BusinessAgentSpec, "runtime" | "capabilities"> | undefined;
  env?: Record<string, string | undefined>;
  rolloutEligible?: () => boolean;
}): AgentRuntimeDescriptor {
  const sel = selectAgentEngine({ tenantId: input.tenantId, spec: input.spec, env: input.env, rolloutEligible: input.rolloutEligible });
  return {
    tenantId: input.tenantId,
    agentId: input.agentId,
    engine: sel.engine,
    engineVersion: ENGINE_VERSIONS[sel.engine],
    source: sel.source,
    publishedVersion: input.publishedVersion,
    capabilities: Object.entries(input.spec?.capabilities ?? {})
      .filter(([, on]) => on)
      .map(([k]) => k)
      .sort(),
  };
}
