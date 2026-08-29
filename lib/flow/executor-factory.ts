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
import { ExecutorRegistry } from "@/lib/flow/executor-registry";
import { EffectExecutorFramework } from "@/lib/flow/executor-framework";
import {
  IntegrationResolver,
  type IntegrationResolverStore,
} from "@/lib/flow/integration-resolver";
import { createSupabaseInternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import { ClaudeExecutor } from "@/lib/flow/executors/claude-executor";
import { resolveAnthropicApiKeyFromEnv } from "@/lib/flow/claude/anthropic-client";
import {
  InternalActionExecutor,
  type InternalActionDeps,
} from "@/lib/flow/executors/internal-action-executor";
import { SendMessageExecutor } from "@/lib/flow/executors/send-message-executor";
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
  overrides?: Partial<{ internalActionDeps: Partial<InternalActionDeps> }>,
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
    ...overrides?.internalActionDeps,
  };
  registry.register(new InternalActionExecutor(internalDeps));
  registry.register(new SendMessageExecutor());
  registry.register(
    new ClaudeExecutor({
      resolveApiKey: async () => resolveAnthropicApiKeyFromEnv(),
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
