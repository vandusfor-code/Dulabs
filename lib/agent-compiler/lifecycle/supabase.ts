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
