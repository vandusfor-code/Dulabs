// DuLabs Business — Business Agent 2.0, FASE 6 — dependencias de PRODUCCIÓN del onboarding.
//
// Solo se arma desde una ruta autenticada: el tenant llega de la sesión (requireFlowAccess). Reutiliza sin modificar:
// el Registro (versiones del agente), la verificación con datos reales (readiness), el plan efectivo, el lifecycle y el
// gate de activación de FASE 1, la activación por número existente y los ejecutores reales SOLO para lecturas.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/registry-store-supabase";
import { loadReadinessFacts } from "@/lib/business-agent-readiness-facts";
import { planDelTenant } from "@/lib/plan-limits";
import { createSupabaseAgentConfigStore } from "@/lib/agente/config";
import { loadAgentLifecycle, createSupabaseActivationGateDeps, evaluateEngineReport } from "@/lib/agent-compiler/lifecycle/supabase";
import { evaluateBusinessAgentActivation } from "@/lib/agent-compiler/lifecycle/activation-gate";
import { activarFlowParaNumero } from "@/lib/flow/flow-activation";
import { createDefaultExecutorRegistry } from "@/lib/flow/executor-factory";
import { understandMessage } from "@/lib/agent-compiler/understanding/engine";
import { productionUnderstandingProvider } from "@/lib/agent-compiler/understanding/resilience";
import { understandingProviderConfigured } from "@/lib/agent-compiler/understanding/provider";
import { createGeminiSemanticClassifier } from "@/lib/agent-compiler/runtime/production/ports";
import { createNativeActionHandler } from "@/lib/agent-compiler/actions/native/handler";
import { createSupabaseProductInventory } from "@/lib/agent-compiler/runtime/production/conversation-runtime-supabase";
import { createSupabaseServiceTableReader } from "@/lib/agent-compiler/runtime/production/catalog-supabase";
import type { ActionHandler } from "@/lib/agent-compiler/actions/engine";
import { createSupabaseOnboardingDraftStore, createSupabaseOnboardingPublisher } from "@/lib/agent-compiler/onboarding/store-supabase";
import type { OnboardingDeps } from "@/lib/agent-compiler/onboarding/service";
import type { SimulationDeps } from "@/lib/agent-compiler/onboarding/simulation";
import type { WhatsAppNumberInfo } from "@/lib/agent-compiler/onboarding/status";

function maskPhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "";
}

export function createSupabaseOnboardingDeps(supabase: SupabaseClient, session: { tenantId: string; userId?: string }): OnboardingDeps {
  const registry = createSupabaseBusinessAgentRegistryStore(supabase);
  const tenantId = session.tenantId;
  return {
    tenantId,
    userId: session.userId,
    drafts: createSupabaseOnboardingDraftStore(supabase),
    registry,
    publisher: createSupabaseOnboardingPublisher(supabase),
    loadFacts: (spec, gateRules) => loadReadinessFacts(supabase, tenantId, spec, gateRules ? { gateRules } : {}),
    hasActivePlan: async () => (await planDelTenant(supabase, tenantId)).id !== "sin_plan",
    async listNumbers(flowId): Promise<WhatsAppNumberInfo[]> {
      const { data, error } = await supabase
        .from("dulabs_clientes_config")
        .select("phone_number_id, nombre_negocio, telefono_negocio, conectado, flow_id, flow_activo, ia_pausada")
        .eq("id_tenant", tenantId);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ phone_number_id: string; nombre_negocio: string | null; telefono_negocio: string | null; conectado: boolean | null; flow_id: string | null; flow_activo: boolean | null; ia_pausada: boolean | null }>;
      const agentConfig = createSupabaseAgentConfigStore(supabase);
      return Promise.all(
        rows.map(async (r) => {
          const label = [r.nombre_negocio?.trim(), maskPhone(r.telefono_negocio)].filter(Boolean).join(" · ") || "Número de WhatsApp";
          const otherEngine = Boolean(await agentConfig.getByPhoneNumber(r.phone_number_id));
          const status: WhatsAppNumberInfo["status"] = !r.conectado
            ? "disconnected"
            : otherEngine
              ? "other_engine"
              : r.flow_activo && r.flow_id === flowId
                ? r.ia_pausada
                  ? "paused"
                  : "active"
                : r.flow_activo
                  ? "other_agent"
                  : "available";
          return { phoneNumberId: r.phone_number_id, label, status };
        }),
      );
    },
    async lifecycle(flowId) {
      const versions = await registry.listVersions(tenantId, flowId);
      return (await loadAgentLifecycle(supabase, registry, tenantId, { flowId, recentVersions: versions })).state;
    },
    activation: {
      evaluate: (flowId, phoneNumberId) => evaluateBusinessAgentActivation(createSupabaseActivationGateDeps(supabase, registry), { tenantId, flowId, phoneNumberId }),
      bind: async (flowId, phoneNumberId) => (await activarFlowParaNumero(supabase, { tenantId, flowId, phoneNumberId })).ok,
    },
    // FASE 8 — matriz de capacidades + motor + readiness con los hechos reales (misma función que el gate).
    engineReport: (flowId, input) => evaluateEngineReport(supabase, tenantId, flowId, input),
  };
}

/** Lecturas reales del negocio (conocimiento, catálogo, cotización, disponibilidad). Las escrituras nunca llegan aquí. */
export function createSupabaseReadHandler(supabase: SupabaseClient): ActionHandler {
  const executor = createDefaultExecutorRegistry(supabase).resolve("action");
  return (request, signal) => executor.dispatch(request, { tenantId: request.tenantId, internal: true }, signal);
}

/** Vista previa con el entendimiento REAL (Gemini) y el Gate semántico real; efectos siempre simulados. */
export function createSupabaseSimulationDeps(supabase: SupabaseClient, tenantId: string): SimulationDeps {
  const provider = productionUnderstandingProvider();
  return {
    available: understandingProviderConfigured(),
    understand: (input) => understandMessage({ provider }, input),
    classifier: createGeminiSemanticClassifier({ tenantId }),
    readHandler: createSupabaseReadHandler(supabase),
    readServices: createSupabaseServiceTableReader(supabase),
    // FASE 8 — la vista previa consulta el inventario REAL (lectura); guardar interesados o recordatorios se simula.
    nativeReadHandler: createNativeActionHandler({ products: createSupabaseProductInventory(supabase) }),
  };
}
