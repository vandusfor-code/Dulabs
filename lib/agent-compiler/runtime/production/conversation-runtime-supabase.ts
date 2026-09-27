// DuLabs Business — Business Agent 2.0, FASE 4 — piezas de PRODUCCIÓN del runtime conversacional.
//
// Nada nuevo ni simulado: stores de Postgres (migraciones 20261123000000 y 20261124000000), entendimiento con Gemini
// (FASE 2), pausa humana existente (dulabs_pausas_chat), handlers reales de InternalActionExecutor (Nylas, agenda interna,
// cotización, conocimiento, catálogo, transferencia) y el envío de WhatsApp existente del Gate.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import type { FlowDefinition } from "@/lib/flow/types";
import { createDefaultExecutorRegistry } from "@/lib/flow/executor-factory";
import type { GateActionSink } from "@/lib/agent-compiler/runtime/agent-runtime";
import { businessContextFromSpec, understandMessage } from "@/lib/agent-compiler/understanding/engine";
import { createExecutorUnderstandingProvider } from "@/lib/agent-compiler/understanding/provider";
import { buildAgentRequirements } from "@/lib/agent-compiler/conversation/requirements";
import { createPausaChatHumanControl, createSupabaseConversationStateStore } from "@/lib/agent-compiler/conversation/store-supabase";
import { createActionEngine } from "@/lib/agent-compiler/actions/engine";
import { createSupabaseActionExecutionStore } from "@/lib/agent-compiler/actions/store-supabase";
import { businessConfigFromFlow, createConversationRuntime, type ConversationRuntime } from "@/lib/agent-compiler/runtime/production/conversation-runtime";

export function createProductionConversationRuntime(input: {
  supabase: SupabaseClient;
  tenantId: string;
  flowId: string;
  phoneNumberId: string;
  telefonoCliente: string;
  wamid: string;
  spec: BusinessAgentSpec;
  flow: FlowDefinition | undefined;
  gateSink: GateActionSink;
}): ConversationRuntime {
  const provider = createExecutorUnderstandingProvider();
  const actionExecutor = createDefaultExecutorRegistry(input.supabase).resolve("action");
  return createConversationRuntime({
    service: {
      store: createSupabaseConversationStateStore(input.supabase),
      requirements: buildAgentRequirements(input.spec),
      business: businessContextFromSpec(input.spec, { tenantId: input.tenantId, agentId: input.flowId }),
      understand: (u) => understandMessage({ provider }, u),
      humanControl: createPausaChatHumanControl(input.supabase),
    },
    engine: createActionEngine({
      store: createSupabaseActionExecutionStore(input.supabase),
      handler: (request, signal) => actionExecutor.dispatch(request, { tenantId: request.tenantId, internal: true }, signal),
    }),
    spec: input.spec,
    businessConfig: businessConfigFromFlow(input.flow),
    send: (text) =>
      input.gateSink.sendMessage({ tenantId: input.tenantId, conversation: { phoneNumberId: input.phoneNumberId, telefonoCliente: input.telefonoCliente }, wamid: input.wamid, text }),
  });
}
