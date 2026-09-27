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

import { AGENT_ENGINES, type AgentEngineId, type BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { isStateMachineRuntimeEnabled } from "@/lib/agent-compiler/runtime/production/conversation-runtime";

export const ENGINE_KILL_SWITCH_ENV = "BUSINESS_AGENT_ENGINE_KILL_SWITCH";
export const DEFAULT_AGENT_ENGINE: AgentEngineId = "graph_v1";

export type EngineSelectionSource = "kill_switch" | "env_allowlist" | "published" | "default";

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

export function selectAgentEngine(input: { tenantId: string; spec: Pick<BusinessAgentSpec, "runtime"> | undefined; env?: Record<string, string | undefined> }): EngineSelection {
  const env = input.env ?? process.env;
  if (isEngineKillSwitchOn(input.tenantId, env)) return { engine: "graph_v1", source: "kill_switch" };
  if (isStateMachineRuntimeEnabled(input.tenantId, env)) return { engine: "state_machine_v1", source: "env_allowlist" };
  const published = publishedEngineOf(input.spec);
  if (published) return { engine: published, source: "published" };
  return { engine: DEFAULT_AGENT_ENGINE, source: "default" };
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
}): AgentRuntimeDescriptor {
  const sel = selectAgentEngine({ tenantId: input.tenantId, spec: input.spec, env: input.env });
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
