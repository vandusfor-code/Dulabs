/**
 * Fase 0 (autorizado) — adaptador FlowOrchestratorStore sobre Supabase real.
 *
 * Puro wiring: cada método delega en la función ya existente y probada de
 * flow-store.ts (flow-store.test.ts, incluida su suite de integración
 * real), fijando el mismo `supabase` inyectado. No hay lógica nueva aquí —
 * solo se adapta la firma "función con supabase como primer argumento" a la
 * forma de objeto que espera ExecutionOrchestrator (FlowOrchestratorStore).
 * Sin este adaptador, el orchestrator no tenía ninguna implementación real
 * para producción — solo fakes en tests.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationKey, FlowOrchestratorStore } from "@/lib/flow/orchestrator-types";
import {
  getActiveExecutionByConversation,
  getExecutionById,
  getFlowById,
  getFlowVersion,
  createExecution,
  saveExecutionState,
  insertEventIdempotent,
  insertEffectIdempotent,
  getEffectByEffectId,
  resolveEffectResult,
  recordNodeTransition,
} from "@/lib/flow/flow-store";

export function createSupabaseFlowOrchestratorStore(supabase: SupabaseClient): FlowOrchestratorStore {
  return {
    async getActiveExecution(tenantId: string, conversation: ConversationKey) {
      return getActiveExecutionByConversation(supabase, {
        tenantId,
        phoneNumberId: conversation.phoneNumberId,
        telefonoCliente: conversation.telefonoCliente,
      });
    },

    async getExecutionById(tenantId, executionRowId) {
      return getExecutionById(supabase, tenantId, executionRowId);
    },

    async getFlow(tenantId, flowId) {
      return getFlowById(supabase, tenantId, flowId);
    },

    async getFlowVersion(tenantId, versionId) {
      return getFlowVersion(supabase, tenantId, versionId);
    },

    async createExecution(input) {
      return createExecution(supabase, input);
    },

    async saveExecutionState(tenantId, executionRowId, state, expectedStateVersion) {
      return saveExecutionState(supabase, tenantId, executionRowId, state, expectedStateVersion);
    },

    async insertEventIdempotent(input) {
      return insertEventIdempotent(supabase, input);
    },

    async insertEffectIdempotent(input) {
      return insertEffectIdempotent(supabase, input);
    },

    async getEffectByEffectId(tenantId, flowExecutionId, effectId) {
      return getEffectByEffectId(supabase, tenantId, flowExecutionId, effectId);
    },

    async resolveEffectResult(input) {
      return resolveEffectResult(supabase, input);
    },

    async recordNodeTransition(input) {
      await recordNodeTransition(supabase, input);
    },
  };
}
