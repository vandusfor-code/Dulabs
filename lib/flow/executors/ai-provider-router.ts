/**
 * AI Provider Router — Fase 6 (IA configurable, autorizado).
 *
 * Mismo patrón arquitectónico exacto que
 * createActionExecutorWithHttpIntegration (Fase 5, ver
 * lib/flow/executors/http-integration-executor.ts): un WRAPPER de
 * composición para el slot `kind:"ai"` del ExecutorRegistry, que NUNCA
 * reemplaza ni duplica la lógica de ClaudeExecutor/GeminiExecutor -- solo
 * decide, por dispatch, cuál instanciar (según `request.ai.provider`,
 * opcional y retrocompatible: ausente = "claude", igual que siempre) y les
 * inyecta -- vía sus MISMOS hooks ya existentes (resolveApiKey/
 * assertAgentOwnedByTenant, nunca un mecanismo nuevo) -- el perfil de
 * dulabs_agentes ya resuelto con aislamiento tenant explícito.
 *
 * Este router es el ÚNICO lugar nuevo de Fase 6 que decide proveedor; NO
 * se usa cuando el caller ya construye su propio registry con un
 * `aiExecutor` distinto (ver lib/whatsapp-qr-bot.ts::ejecutarBotWhatsAppQR,
 * el override real de AMORE, sin cambios) -- ese camino sigue exactamente
 * igual, este router ni siquiera se registra en ese caso.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ClaudeExecutor } from "@/lib/flow/executors/claude-executor";
import { GeminiExecutor } from "@/lib/flow/executors/gemini-executor";
import { mergeAgentInstructions, resolveAgentProfileForTenant } from "@/lib/flow/ai-runtime/agent-profile-resolver";
import { createSupabaseAiContactContextLoader } from "@/lib/flow/ai-runtime/contact-context";
import type { ClaudeExecutorDeps } from "@/lib/flow/claude/claude-types";
import type { GeminiExecutorDeps } from "@/lib/flow/gemini/gemini-types";
import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutionContext,
  type EffectExecutor,
  type EffectExecutorCapabilities,
} from "@/lib/flow/executor-types";

export interface AiProviderRouterDeps {
  supabase: SupabaseClient;
  /** Deps propias de cada proveedor, SIN resolveApiKey/assertAgentOwnedByTenant -- esos los inyecta el router en cada dispatch. */
  claudeDeps?: Omit<ClaudeExecutorDeps, "resolveApiKey" | "assertAgentOwnedByTenant">;
  geminiDeps?: Omit<GeminiExecutorDeps, "resolveApiKey" | "assertAgentOwnedByTenant">;
}

export function createAiProviderRouter(deps: AiProviderRouterDeps): EffectExecutor {
  const assertAgentOwnedByTenant = async (tenantId: string, agentId: string): Promise<boolean> =>
    (await resolveAgentProfileForTenant(deps.supabase, { tenantId, agentId })).ok;

  const capabilities: EffectExecutorCapabilities = { supportsIntegration: false, supportsAsync: true, operationClasses: [] };
  // FASE F7.3 (Contacto + Tags + IA, autorizado) -- mismo hook YA EXISTENTE
  // que resolveApiKey/assertAgentOwnedByTenant: el router es el ÚNICO lugar
  // que arma esta dependencia (tiene deps.supabase) e inyecta la MISMA
  // instancia en cualquiera de los dos providers, según cuál se use.
  const loadContactContext = createSupabaseAiContactContextLoader(deps.supabase);

  return {
    kind: "ai",
    version: "1.0.0",
    capabilities,

    async dispatch(
      request: EffectDispatchRequest,
      context: EffectExecutionContext,
      signal?: AbortSignal,
    ): Promise<EffectDispatchResult> {
      const providerRaw = request.ai?.provider;
      if (providerRaw !== undefined && providerRaw !== "claude" && providerRaw !== "gemini") {
        return {
          success: false,
          classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
          error: "invalid_ai_provider",
        };
      }
      // Retrocompatible: omitido -- TODO Flow existente hoy -- = "claude",
      // exactamente el executor que ya se usaba antes de esta fase.
      const provider = providerRaw ?? "claude";

      let effectiveRequest = request;
      let resolvedApiKey: string | null = null;

      if (request.ai?.agentId) {
        const result = await resolveAgentProfileForTenant(deps.supabase, {
          tenantId: request.tenantId,
          agentId: request.ai.agentId,
        });
        if (!result.ok) {
          return {
            success: false,
            classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED,
            error: result.reason,
          };
        }
        resolvedApiKey = result.profile.apiKey;
        effectiveRequest = {
          ...request,
          ai: { ...request.ai, instruction: mergeAgentInstructions(result.profile, request.ai.instruction) },
        };
      }

      // Mismo hook YA EXISTENTE (resolveApiKey?: (tenantId) => Promise<string|null>)
      // -- nunca un mecanismo nuevo. Si no hay agente/API key propia, resuelve
      // null y el executor cae a su fallback existente (env var de plataforma),
      // sin ningún cambio de comportamiento para quien nunca configuró un agente.
      const resolveApiKey = async (): Promise<string | null> => resolvedApiKey;

      const executor: EffectExecutor =
        provider === "gemini"
          ? new GeminiExecutor({ ...deps.geminiDeps, resolveApiKey, assertAgentOwnedByTenant, loadContactContext })
          : new ClaudeExecutor({ ...deps.claudeDeps, resolveApiKey, assertAgentOwnedByTenant, loadContactContext });

      return executor.dispatch(effectiveRequest, context, signal);
    },
  };
}
