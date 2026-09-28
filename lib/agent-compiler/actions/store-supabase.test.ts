// Business Agent 2.0, FASE 4 — store de producción del Action Engine: forma exacta de las llamadas RPC (sin red).
// La semántica atómica de esas funciones se verifica contra PostgreSQL real: scripts/verify-ba-action-engine.sh.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseActionExecutionStore } from "@/lib/agent-compiler/actions/store-supabase";

function rpcClient(response: { data: unknown; error?: unknown }) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const client = { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return { data: response.data, error: response.error ?? null }; } };
  return { client: client as unknown as SupabaseClient, calls };
}

const CLAIM = { tenantId: "11111111-1111-4111-8111-111111111111", agentId: "flow-1", conversationId: "pn:57", action: "crear_cita_nylas_generico", contractVersion: "1.0.0", idempotencyKey: "a".repeat(32), argumentsHash: "b".repeat(64), leaseSeconds: 35, retakeable: false };

describe("FASE 4 — store Supabase del Action Engine", () => {
  it("claim llama a dulabs_ba_action_claim con TODOS los parámetros (tenant incluido) y traduce cada desenlace", async () => {
    const { client, calls } = rpcClient({ data: [{ outcome: "claimed", execution_id: "e1", attempt: 1, status: "RUNNING", result: null }] });
    assert.deepEqual(await createSupabaseActionExecutionStore(client).claim(CLAIM), { kind: "claimed", executionId: "e1", attempt: 1 });
    assert.deepEqual(calls[0], ["dulabs_ba_action_claim", { p_tenant: CLAIM.tenantId, p_agent: "flow-1", p_conversation: "pn:57", p_action: CLAIM.action, p_contract_version: "1.0.0", p_key: CLAIM.idempotencyKey, p_args_hash: CLAIM.argumentsHash, p_lease_seconds: 35, p_retakeable: false }]);
    for (const [outcome, kind] of [["completed", "completed"], ["in_progress", "in_progress"], ["mismatch", "mismatch"], ["unknown", "unknown"]] as const) {
      const c = rpcClient({ data: [{ outcome, execution_id: "e1", attempt: 1, status: "SUCCEEDED", result: { x: 1 } }] });
      assert.equal((await createSupabaseActionExecutionStore(c.client).claim(CLAIM)).kind, kind);
    }
  });

  it("respuestas inesperadas o errores de la base NO se interpretan como éxito", async () => {
    await assert.rejects(createSupabaseActionExecutionStore(rpcClient({ data: [] }).client).claim(CLAIM));
    await assert.rejects(createSupabaseActionExecutionStore(rpcClient({ data: [{ outcome: "raro", execution_id: "e" }] }).client).claim(CLAIM));
    await assert.rejects(createSupabaseActionExecutionStore(rpcClient({ data: null, error: { message: "down" } }).client).claim(CLAIM));
    assert.equal(await createSupabaseActionExecutionStore(rpcClient({ data: null }).client).complete({ tenantId: CLAIM.tenantId, executionId: "e1", attempt: 1, status: "SUCCEEDED", result: {}, errorCode: null, retryable: false }), false);
    assert.equal(await createSupabaseActionExecutionStore(rpcClient({ data: "true" }).client).acquireLock({ tenantId: CLAIM.tenantId, lockKey: "k", holder: "h", leaseSeconds: 30 }), false, "solo el booleano true cuenta");
  });

  it("complete y el candado pasan tenant, attempt (fencing) y holder", async () => {
    const { client, calls } = rpcClient({ data: true });
    const store = createSupabaseActionExecutionStore(client);
    await store.complete({ tenantId: CLAIM.tenantId, executionId: "e1", attempt: 2, status: "FAILED", result: { a: 1 }, errorCode: "TIMEOUT", retryable: true });
    await store.acquireLock({ tenantId: CLAIM.tenantId, lockKey: "booking:2026-09-27", holder: "e1:2", leaseSeconds: 35 });
    await store.releaseLock({ tenantId: CLAIM.tenantId, lockKey: "booking:2026-09-27", holder: "e1:2" });
    assert.deepEqual(calls.map((c) => c[0]), ["dulabs_ba_action_complete", "dulabs_ba_booking_lock_acquire", "dulabs_ba_booking_lock_release"]);
    assert.deepEqual(calls[0]![1], { p_tenant: CLAIM.tenantId, p_execution: "e1", p_attempt: 2, p_status: "FAILED", p_result: { a: 1 }, p_error_code: "TIMEOUT", p_retryable: true });
    assert.deepEqual(calls[2]![1], { p_tenant: CLAIM.tenantId, p_key: "booking:2026-09-27", p_holder: "e1:2" });
  });
});
