/**
 * Factory del registry de executors por defecto (Fase 4.1 / 4.1.2).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { guardarLeadEnterprise } from "@/lib/enterprise-leads";
import { activarPausaChat } from "@/lib/pausas-chat";
import {
  crearCita,
  sugerirHorariosLibres,
  verificarDisponibilidad,
} from "@/lib/marketplace-citas";
import {
  consultarDisponibilidadEspecialista,
  validarServicioEspecialista,
  agendarCitaEspecialista,
  cancelarCitaEspecialista,
  consultarCitasActivasEspecialista,
  moverCitaEspecialista,
  listarHorariosDisponiblesEspecialista,
} from "@/lib/especialistas-flow-adaptador";
import {
  listarCatalogoServiciosReal,
  consultarDisponibilidadCatalogoReal,
} from "@/lib/catalogo-servicios-flow-adaptador";
import { ExecutorRegistry } from "@/lib/flow/executor-registry";
import { EffectExecutorFramework } from "@/lib/flow/executor-framework";
import {
  IntegrationResolver,
  type IntegrationResolverStore,
} from "@/lib/flow/integration-resolver";
import { createSupabaseInternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import {
  InternalActionExecutor,
  type InternalActionDeps,
} from "@/lib/flow/executors/internal-action-executor";
import { SendMessageExecutor, type SendMessageDeps } from "@/lib/flow/executors/send-message-executor";
import {
  createActionExecutorWithHttpIntegration,
  type HttpIntegrationDeps,
} from "@/lib/flow/executors/http-integration-executor";
import { createAiProviderRouter, type AiProviderRouterDeps } from "@/lib/flow/executors/ai-provider-router";
import type { EffectExecutor } from "@/lib/flow/executor-types";

async function readPausaUntil(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("dulabs_pausas_chat")
    .select("pausado_hasta")
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente)
    .maybeSingle();
  return (data?.pausado_hasta as string | undefined) ?? null;
}

export function createDefaultExecutorRegistry(
  supabase: SupabaseClient,
  overrides?: Partial<{
    internalActionDeps: Partial<InternalActionDeps>;
    sendMessageDeps: Partial<SendMessageDeps>;
    /**
     * FASE B (autorizado) — reemplazo ADITIVO del único executor kind="ai"
     * (ExecutorRegistry.register sobre el mismo kind SIEMPRE reemplaza al
     * anterior para TODOS los tenants que compartan este registry, ver
     * lib/flow/executor-registry.ts). Por eso este override nunca se activa
     * por defecto: solo el caller (hoy, únicamente
     * lib/whatsapp-qr-bot.ts::ejecutarBotWhatsAppQR, gateado por tenant_id
     * real de AMORE) puede pasar un executor distinto -- Daniela/Solo
     * Talento, que nunca llaman esa función, siguen recibiendo exactamente
     * ClaudeExecutor sin ningún cambio.
     */
    aiExecutor: EffectExecutor;
    /** Fase 5 (Actions + Integrations, autorizado) -- solo para tests (fetchImpl inyectable). */
    httpIntegrationDeps: HttpIntegrationDeps;
    /** Fase 6 (IA configurable, autorizado) -- deps propias de Claude/Gemini (ej. clientes inyectados en tests); resolveApiKey/assertAgentOwnedByTenant los pone SIEMPRE el router, nunca aquí. */
    aiProviderRouterDeps: Pick<AiProviderRouterDeps, "claudeDeps" | "geminiDeps">;
  }>,
): ExecutorRegistry {
  const registry = new ExecutorRegistry();
  const internalDeps: InternalActionDeps = {
    supabase,
    authorizer: createSupabaseInternalActionAuthorizer(supabase),
    guardarLeadEnterprise,
    activarPausaChat,
    verificarDisponibilidad,
    sugerirHorariosLibres,
    crearCita,
    readPausaUntil,
  consultarDisponibilidadEspecialista,
  validarServicioEspecialista,
  agendarCitaEspecialista,
    cancelarCitaEspecialista,
    consultarCitasActivasEspecialista,
    moverCitaEspecialista,
    listarHorariosDisponiblesEspecialista,
    listarCatalogoServiciosReal,
    consultarDisponibilidadCatalogoReal,
    ...overrides?.internalActionDeps,
  };
  const sendMessageDeps: SendMessageDeps = { supabase, ...overrides?.sendMessageDeps };
  // Fase 5 (Actions + Integrations, autorizado) -- InternalActionExecutor
  // NUNCA se modifica; se envuelve tal cual dentro del router de
  // composición, que solo intercepta el caso puntual de webhook_http
  // externo (antes un callejón sin salida: "external_action_not_routed").
  registry.register(
    createActionExecutorWithHttpIntegration(new InternalActionExecutor(internalDeps), overrides?.httpIntegrationDeps),
  );
  registry.register(new SendMessageExecutor(sendMessageDeps));
  // Fase 6 (IA configurable, autorizado) -- ClaudeExecutor/GeminiExecutor
  // NUNCA se modifican; el router elige entre ambos por dispatch (según
  // ai.provider, opcional/retrocompatible) e inyecta el perfil de
  // dulabs_agentes ya resuelto con aislamiento tenant. `overrides.aiExecutor`
  // sigue teniendo prioridad absoluta -- AMORE (whatsapp-qr-bot.ts) sigue
  // construyendo su propio registry con GeminiExecutor directo, sin pasar
  // NUNCA por este router.
  registry.register(
    overrides?.aiExecutor ??
      createAiProviderRouter({
        supabase,
        claudeDeps: overrides?.aiProviderRouterDeps?.claudeDeps,
        geminiDeps: overrides?.aiProviderRouterDeps?.geminiDeps,
      }),
  );
  return registry;
}

export function createDefaultEffectExecutorFramework(input: {
  supabase: SupabaseClient;
  store: IntegrationResolverStore;
  overallTimeoutMs?: number;
  registryOverrides?: Parameters<typeof createDefaultExecutorRegistry>[1];
}): EffectExecutorFramework {
  const registry = createDefaultExecutorRegistry(input.supabase, input.registryOverrides);
  const integrationResolver = new IntegrationResolver(input.store);
  return new EffectExecutorFramework({
    registry,
    integrationResolver,
    overallTimeoutMs: input.overallTimeoutMs,
  });
}

/** Helper para tests — registry con executors inyectados. */
export function createTestEffectExecutorFramework(input: {
  executors: EffectExecutor[];
  integrationResolver?: IntegrationResolver;
  overallTimeoutMs?: number;
}): EffectExecutorFramework {
  const registry = new ExecutorRegistry();
  for (const executor of input.executors) {
    registry.register(executor);
  }
  return new EffectExecutorFramework({
    registry,
    integrationResolver:
      input.integrationResolver ??
      new IntegrationResolver({
        getIntegrationById: async () => null,
        getIntegrationCredentials: async () => [],
      }),
    overallTimeoutMs: input.overallTimeoutMs,
  });
}
