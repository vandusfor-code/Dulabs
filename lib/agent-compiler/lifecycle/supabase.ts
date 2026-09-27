// DuLabs Business — Business Agent 2.0, FASE 1 — adaptadores de producción del gate de activación y del lifecycle.
//
// Solo lecturas tenant-scoped sobre las MISMAS fuentes que usa el runtime: el Registry, dulabs_clientes_config,
// el plan efectivo (lib/plan-limits.ts) y la configuración del agente conversacional (lib/agente/config.ts, solo
// lectura: es el motor que el webhook atiende ANTES que Business Agent).

import type { SupabaseClient } from "@supabase/supabase-js";
import { checksumOf } from "@/lib/agent-compiler/checksum";
import type { AgentVersionRow, BusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/types";
import type { AgentSummaryPublic } from "@/lib/agent-compiler/api/business-agent-api";
import { evaluateReadiness, type ReadinessReport } from "@/lib/business-agent-readiness";
import { loadReadinessFacts } from "@/lib/business-agent-readiness-facts";
import { planDelTenant } from "@/lib/plan-limits";
import { createSupabaseAgentConfigStore } from "@/lib/agente/config";
import type { ActivationGateDeps } from "@/lib/agent-compiler/lifecycle/activation-gate";
import { deriveAgentLifecycle, type AgentLifecycle } from "@/lib/agent-compiler/lifecycle/lifecycle";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { compileLegacySpec } from "@/lib/agent-compiler/business-model/compile";
import type { CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";
import { isEngineKillSwitchOn, selectAgentEngine } from "@/lib/agent-compiler/runtime/production/engine-selection";
import { understandingProviderConfigured } from "@/lib/agent-compiler/understanding/provider";
import { buildCapabilityMatrix, evaluateEngineReadiness, type CredentialFacts, type EngineReport, type IntegrationFacts } from "@/lib/agent-compiler/lifecycle/capability-matrix";

/** ¿Existe la tabla de recordatorios (migración 20261127000000 aplicada)? Solo lectura, sin datos. */
export async function remindersStoreAvailable(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from("dulabs_ba_reminders").select("id", { count: "exact", head: true }).limit(1);
  return !error;
}

/** Credenciales: SOLO presencia (nunca el valor). */
export async function credentialFacts(supabase: SupabaseClient, tenantId: string, env: Record<string, string | undefined> = process.env): Promise<CredentialFacts> {
  const { data } = await supabase.from("dulabs_clientes_config").select("meta_permanent_token").eq("id_tenant", tenantId).limit(5);
  const rows = (data ?? []) as Array<{ meta_permanent_token: string | null }>;
  return {
    geminiKey: understandingProviderConfigured(env),
    nylasApiKey: Boolean(env.NYLAS_API_KEY?.trim()),
    whatsappToken: rows.some((r) => Boolean(r.meta_permanent_token)) || Boolean(env.META_ACCESS_TOKEN?.trim()),
  };
}

/**
 * Matriz + readiness del motor para una versión (Spec publicado) con los hechos REALES del tenant. La MISMA función
 * alimenta el gate de activación y la pantalla (no hay dos verdades).
 */
export async function evaluateEngineReport(
  supabase: SupabaseClient,
  tenantId: string,
  flowId: string,
  input: { publishedSpec: BusinessAgentSpec | null; draftSpec?: BusinessAgentSpec | null; agentActive?: boolean; env?: Record<string, string | undefined> },
): Promise<EngineReport> {
  const env = input.env ?? process.env;
  // "Habilitada" = lo que la persona configuró (borrador); "publicada" y el motor = lo que sirve producción.
  const current = input.draftSpec ?? input.publishedSpec;
  const served = input.publishedSpec ?? current;
  if (!current || !served) throw new Error("engine_report_without_spec");
  const engine = selectAgentEngine({ tenantId, spec: served, env });
  let artifact: CompiledAgentArtifact | null = null;
  if (input.publishedSpec) {
    const compiled = compileLegacySpec(input.publishedSpec, { tenantId, agentId: flowId, versionRef: "activation-check", publishedVersion: null });
    if (compiled.ok) artifact = compiled.artifact;
  }
  const [facts, reminders, credentials, numbers] = await Promise.all([
    loadReadinessFacts(supabase, tenantId, current),
    current.runtime?.reminders?.enabled || served.runtime?.reminders?.enabled ? remindersStoreAvailable(supabase) : Promise.resolve(false),
    credentialFacts(supabase, tenantId, env),
    supabase.from("dulabs_clientes_config").select("phone_number_id", { count: "exact", head: true }).eq("id_tenant", tenantId),
  ]);
  const integration: IntegrationFacts = {
    calendarConnected: facts.calendarConnected,
    activeServices: facts.activeServices,
    activeProducts: facts.activeProducts,
    hasKnowledge: facts.hasKnowledge,
    whatsappConnected: (numbers.count ?? 0) > 0,
    remindersStore: reminders,
    // Un cron no se puede verificar desde la app: siempre "no verificado" hasta que operación lo confirme.
    remindersDispatchVerified: false,
  };
  const matrix = buildCapabilityMatrix({ spec: current, published: artifact, engine: engine.engine, facts: integration, agentActive: Boolean(input.agentActive) });
  const servedMatrix = served === current ? matrix : buildCapabilityMatrix({ spec: served, published: artifact, engine: engine.engine, facts: integration, agentActive: Boolean(input.agentActive) });
  const readiness = evaluateEngineReadiness({ spec: served, engine: engine.engine, artifactOk: input.publishedSpec ? Boolean(artifact) : true, credentials, killSwitchOn: isEngineKillSwitchOn(tenantId, env), matrix: servedMatrix });
  return { engine, matrix, readiness };
}

/** Readiness de una versión con los hechos reales del tenant: la MISMA evaluación en publicar, rollback y activar. */
export async function evaluateVersionReadiness(supabase: SupabaseClient, tenantId: string, version: AgentVersionRow): Promise<ReadinessReport> {
  const facts = await loadReadinessFacts(supabase, tenantId, version.spec, { gateRules: version.gateRules });
  return evaluateReadiness(version.spec, facts);
}

async function otroMotorEnNumero(supabase: SupabaseClient, phoneNumberId: string): Promise<"agente_conversacional" | null> {
  // Misma condición que el webhook: CUALQUIER fila (aunque esté apagada) hace que ese motor sea dueño del mensaje.
  const fila = await createSupabaseAgentConfigStore(supabase).getByPhoneNumber(phoneNumberId);
  return fila ? "agente_conversacional" : null;
}

export function createSupabaseActivationGateDeps(supabase: SupabaseClient, store: BusinessAgentRegistryStore): ActivationGateDeps {
  return {
    store,
    async numberBelongsToTenant(tenantId, phoneNumberId) {
      const { data, error } = await supabase
        .from("dulabs_clientes_config")
        .select("phone_number_id")
        .eq("id_tenant", tenantId)
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    evaluateReadiness: (tenantId, version) => evaluateVersionReadiness(supabase, tenantId, version),
    async hasActivePlan(tenantId) {
      return (await planDelTenant(supabase, tenantId)).id !== "sin_plan";
    },
    otherEngineOnNumber: (phoneNumberId) => otroMotorEnNumero(supabase, phoneNumberId),
    async engineReadiness(tenantId, version) {
      const report = await evaluateEngineReport(supabase, tenantId, version.flowId, { publishedSpec: version.spec });
      return report.readiness.blockers.map((b) => b.message);
    },
  };
}

/** Estado de producto del agente del tenant (ver lifecycle.ts). Solo lectura. */
export async function loadAgentLifecycle(
  supabase: SupabaseClient,
  store: BusinessAgentRegistryStore,
  tenantId: string,
  summary: Pick<AgentSummaryPublic, "flowId" | "recentVersions">,
): Promise<AgentLifecycle> {
  const publicada = await store.resolvePublishedVersion(tenantId, summary.flowId);
  const published = publicada
    ? { servable: publicada.tenantId === tenantId && publicada.validationStatus === "validated" && checksumOf(publicada.flow) === publicada.flowChecksum }
    : null;

  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, ia_pausada")
    .eq("id_tenant", tenantId)
    .eq("flow_id", summary.flowId)
    .eq("flow_activo", true);
  if (error) throw error;
  const filas = (data ?? []) as Array<{ phone_number_id: string; ia_pausada: boolean | null }>;

  const boundNumbers = await Promise.all(
    filas.map(async (f) => ({ phoneNumberId: f.phone_number_id, iaPausada: Boolean(f.ia_pausada), otherEngine: await otroMotorEnNumero(supabase, f.phone_number_id) })),
  );

  return deriveAgentLifecycle({ latestValidationStatus: summary.recentVersions[0]?.validationStatus ?? null, published, boundNumbers });
}
