// DuLabs Business — Business Agent 2.0, FASE 4 — store de producción del Action Engine (RPC a Postgres).
//
// Toda la atomicidad está en las funciones de la migración 20261124000000; aquí solo se llaman y se valida la forma de
// la respuesta. Un error de la base se propaga (el motor lo convierte en INTERNAL_ERROR, fail-closed: sin ejecutar).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionExecutionStore, ClaimOutcome } from "@/lib/agent-compiler/actions/store";

interface ClaimRow {
  outcome: string;
  execution_id: string;
  attempt: number;
  status: string;
  result: unknown;
}

export function createSupabaseActionExecutionStore(supabase: SupabaseClient): ActionExecutionStore {
  return {
    async claim(input): Promise<ClaimOutcome> {
      const { data, error } = await supabase.rpc("dulabs_ba_action_claim", {
        p_tenant: input.tenantId,
        p_agent: input.agentId,
        p_conversation: input.conversationId,
        p_action: input.action,
        p_contract_version: input.contractVersion,
        p_key: input.idempotencyKey,
        p_args_hash: input.argumentsHash,
        p_lease_seconds: input.leaseSeconds,
        p_retakeable: input.retakeable,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as ClaimRow | undefined;
      if (!row || typeof row.execution_id !== "string") throw new Error("action_claim_empty_response");
      switch (row.outcome) {
        case "claimed":
          return { kind: "claimed", executionId: row.execution_id, attempt: row.attempt };
        case "completed":
          return { kind: "completed", executionId: row.execution_id, attempt: row.attempt, status: row.status, result: row.result };
        case "in_progress":
          return { kind: "in_progress", executionId: row.execution_id, attempt: row.attempt };
        case "mismatch":
          return { kind: "mismatch", executionId: row.execution_id };
        case "unknown":
          return { kind: "unknown", executionId: row.execution_id, attempt: row.attempt, result: row.result };
        default:
          throw new Error(`action_claim_unexpected_outcome:${row.outcome}`);
      }
    },

    async complete(input) {
      const { data, error } = await supabase.rpc("dulabs_ba_action_complete", {
        p_tenant: input.tenantId,
        p_execution: input.executionId,
        p_attempt: input.attempt,
        p_status: input.status,
        p_result: input.result,
        p_error_code: input.errorCode,
        p_retryable: input.retryable,
      });
      if (error) throw error;
      return data === true;
    },

    async acquireLock(input) {
      const { data, error } = await supabase.rpc("dulabs_ba_booking_lock_acquire", {
        p_tenant: input.tenantId,
        p_key: input.lockKey,
        p_holder: input.holder,
        p_seconds: input.leaseSeconds,
      });
      if (error) throw error;
      return data === true;
    },

    async releaseLock(input) {
      const { error } = await supabase.rpc("dulabs_ba_booking_lock_release", { p_tenant: input.tenantId, p_key: input.lockKey, p_holder: input.holder });
      if (error) throw error;
    },
  };
}
