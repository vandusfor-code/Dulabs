/**
 * Tests de resolveEffectResult (Fase 4.0.1).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEffectResult } from "@/lib/flow/flow-store";
import type { FlowEffectRow } from "@/lib/flow/flow-store-types";

function baseEffect(overrides: Partial<FlowEffectRow> = {}): FlowEffectRow {
  return {
    id: 1,
    tenant_id: "tenant-1",
    flow_execution_id: "exec-row-1",
    effect_id: "fx-1",
    node_id: "act",
    kind: "action",
    integration_id: null,
    status: "pending",
    requested_at: "2026-01-01T00:00:00.000Z",
    resolved_at: null,
    result_payload_raw: null,
    result_payload_applied: null,
    provider: null,
    provider_model: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Fake Supabase mínimo para probar resolveEffectResult sin PostgreSQL. */
function createFakeSupabase(initial: FlowEffectRow[]) {
  const rows = new Map(initial.map((r) => [r.effect_id, { ...r }]));

  function allRows(): FlowEffectRow[] {
    return [...rows.values()];
  }

  function findMatching(filters: Record<string, string>): FlowEffectRow | null {
    const matches = allRows().filter((row) =>
      Object.entries(filters).every(([key, value]) => String(row[key as keyof FlowEffectRow]) === value),
    );
    return matches[0] ?? null;
  }

  type Chain = {
    eq: (col: string, val: string) => Chain;
    select: (cols?: string) => Chain;
    maybeSingle: () => Promise<{ data: FlowEffectRow | null; error: null }>;
  };

  const client = {
    from(table: string) {
      if (table !== "dulabs_flow_effects") throw new Error(`unexpected table ${table}`);

      return {
        select(_cols?: string) {
          const filters: Record<string, string> = {};
          const chain: Chain = {
            eq(col, val) {
              filters[col] = val;
              return chain;
            },
            select() {
              return chain;
            },
            async maybeSingle() {
              return { data: findMatching(filters), error: null };
            },
          };
          return chain;
        },
        update(patch: Partial<FlowEffectRow>) {
          const filters: Record<string, string> = {};
          const chain: Chain = {
            eq(col, val) {
              filters[col] = val;
              return chain;
            },
            select() {
              return chain;
            },
            async maybeSingle() {
              const row = findMatching(filters);
              if (!row || row.status !== "pending") {
                return { data: null, error: null };
              }
              Object.assign(row, patch);
              return { data: row, error: null };
            },
          };
          return chain;
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, rows };
}

describe("resolveEffectResult — Fase 4.0.1", () => {
  it("1. PENDING → SUCCEEDED", async () => {
    const { client } = createFakeSupabase([baseEffect()]);
    const result = await resolveEffectResult(client, {
      tenantId: "tenant-1",
      flowExecutionId: "exec-row-1",
      effectId: "fx-1",
      status: "succeeded",
      resultPayloadRaw: { ok: true },
      resolvedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.row.status, "succeeded");
      assert.equal(result.alreadyResolved, false);
      assert.deepEqual(result.row.result_payload_raw, { ok: true });
      assert.equal(result.row.resolved_at, "2026-01-02T00:00:00.000Z");
    }
  });

  it("2. PENDING → FAILED", async () => {
    const { client } = createFakeSupabase([baseEffect()]);
    const result = await resolveEffectResult(client, {
      tenantId: "tenant-1",
      flowExecutionId: "exec-row-1",
      effectId: "fx-1",
      status: "failed",
      resultPayloadRaw: { error: "timeout" },
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.row.status, "failed");
  });

  it("3. SUCCEEDED no vuelve a PENDING", async () => {
    const { client } = createFakeSupabase([
      baseEffect({ status: "succeeded", resolved_at: "2026-01-01T00:00:00.000Z" }),
    ]);
    const result = await resolveEffectResult(client, {
      tenantId: "tenant-1",
      flowExecutionId: "exec-row-1",
      effectId: "fx-1",
      status: "failed",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_transition");
  });

  it("4. resultado persistido correctamente", async () => {
    const { client, rows } = createFakeSupabase([baseEffect()]);
    await resolveEffectResult(client, {
      tenantId: "tenant-1",
      flowExecutionId: "exec-row-1",
      effectId: "fx-1",
      status: "succeeded",
      resultPayloadRaw: { raw: 1 },
      resultPayloadApplied: { applied: 2 },
    });
    const stored = rows.get("fx-1");
    assert.deepEqual(stored?.result_payload_raw, { raw: 1 });
    assert.deepEqual(stored?.result_payload_applied, { applied: 2 });
  });

  it("5. resolved_at", async () => {
    const { client } = createFakeSupabase([baseEffect()]);
    const result = await resolveEffectResult(client, {
      tenantId: "tenant-1",
      flowExecutionId: "exec-row-1",
      effectId: "fx-1",
      status: "succeeded",
      resolvedAt: "2026-03-01T12:00:00.000Z",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.row.resolved_at, "2026-03-01T12:00:00.000Z");
  });

  it("6. duplicate effect result — idempotente", async () => {
    const { client } = createFakeSupabase([
      baseEffect({
        status: "succeeded",
        resolved_at: "2026-01-01T00:00:00.000Z",
        result_payload_raw: { ok: true },
      }),
    ]);
    const result = await resolveEffectResult(client, {
      tenantId: "tenant-1",
      flowExecutionId: "exec-row-1",
      effectId: "fx-1",
      status: "succeeded",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.alreadyResolved, true);
  });

  it("7. tenant mismatch", async () => {
    const { client } = createFakeSupabase([baseEffect({ tenant_id: "other-tenant" })]);
    const result = await resolveEffectResult(client, {
      tenantId: "tenant-1",
      flowExecutionId: "exec-row-1",
      effectId: "fx-1",
      status: "succeeded",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "tenant_mismatch");
  });

  it("8. effect mismatch — flow_execution_id incorrecto", async () => {
    const { client } = createFakeSupabase([baseEffect({ flow_execution_id: "other-exec" })]);
    const result = await resolveEffectResult(client, {
      tenantId: "tenant-1",
      flowExecutionId: "exec-row-1",
      effectId: "fx-1",
      status: "succeeded",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "effect_mismatch");
  });

  it("9. not_found", async () => {
    const { client } = createFakeSupabase([]);
    const result = await resolveEffectResult(client, {
      tenantId: "tenant-1",
      flowExecutionId: "exec-row-1",
      effectId: "fx-missing",
      status: "succeeded",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "not_found");
  });

  it("10. sanitiza secretos en payloads persistidos", async () => {
    const { client, rows } = createFakeSupabase([baseEffect()]);
    await resolveEffectResult(client, {
      tenantId: "tenant-1",
      flowExecutionId: "exec-row-1",
      effectId: "fx-1",
      status: "succeeded",
      resultPayloadRaw: { api_key: "sk-live-abc1234567890" },
    });
    assert.deepEqual(rows.get("fx-1")?.result_payload_raw, { api_key: "[REDACTED]" });
  });
});
