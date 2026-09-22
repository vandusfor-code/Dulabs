import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarDeliveryGithub } from "@/lib/developer/github/github-webhook-idempotency";

function fakeSupabase(insertError: { code?: string; message: string } | null) {
  let insertado: Record<string, unknown> | null = null;
  const supabase = {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        insertado = row;
        return { error: insertError };
      },
    }),
    _insertado: () => insertado,
  };
  return supabase as unknown as SupabaseClient & { _insertado: () => Record<string, unknown> | null };
}

describe("registrarDeliveryGithub", () => {
  it("delivery nuevo -> true (procesar)", async () => {
    const supabase = fakeSupabase(null);
    assert.equal(await registrarDeliveryGithub(supabase, { deliveryId: "d-1", evento: "installation" }), true);
    assert.equal(supabase._insertado()?.delivery_id, "d-1");
  });

  it("delivery duplicado (23505) -> false (ignorar)", async () => {
    const supabase = fakeSupabase({ code: "23505", message: "duplicate key" });
    assert.equal(await registrarDeliveryGithub(supabase, { deliveryId: "d-1", evento: "installation" }), false);
  });

  it("sin deliveryId -> true (no se puede deduplicar)", async () => {
    const supabase = fakeSupabase(null);
    assert.equal(await registrarDeliveryGithub(supabase, { deliveryId: null, evento: null }), true);
  });

  it("otro error de DB -> lanza (no traga fallos reales)", async () => {
    const supabase = fakeSupabase({ code: "XXXXX", message: "boom" });
    await assert.rejects(() => registrarDeliveryGithub(supabase, { deliveryId: "d-2", evento: "x" }));
  });
});
