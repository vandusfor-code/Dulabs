import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearConnectState, consumirConnectState } from "@/lib/developer/github/github-connect-state-store";

// Fake mínimo con el patrón de cadena que usan los stores. Cada terminal
// (single/maybeSingle) resuelve a `resultado`; se registran tabla y filtros.
function fakeSupabase(resultado: { data: unknown; error: { code?: string; message: string } | null }) {
  const registro: { tabla: string; insert?: Record<string, unknown>; filtros: Record<string, string> } = { tabla: "", filtros: {} };
  const chain: Record<string, unknown> = {
    insert: (row: Record<string, unknown>) => {
      registro.insert = row;
      return chain;
    },
    delete: () => chain,
    select: () => chain,
    eq: (col: string, val: string) => {
      registro.filtros[col] = val;
      return chain;
    },
    lt: () => chain,
    single: async () => resultado,
    maybeSingle: async () => resultado,
  };
  const supabase = { from: (t: string) => ((registro.tabla = t), chain), _registro: () => registro };
  return supabase as unknown as SupabaseClient & { _registro: () => typeof registro };
}

describe("crearConnectState", () => {
  it("inserta workspace/usuario/expiry y devuelve el state", async () => {
    const supabase = fakeSupabase({ data: { state: "state-uuid-123" }, error: null });
    const state = await crearConnectState(supabase, { workspaceId: "ws-1", userId: "user-1", ahoraMs: 1_000_000 });
    assert.equal(state, "state-uuid-123");
    const reg = supabase._registro();
    assert.equal(reg.tabla, "dulabs_dev_github_connect_states");
    assert.equal(reg.insert?.workspace_id, "ws-1");
    assert.equal(reg.insert?.user_id, "user-1");
    assert.ok(typeof reg.insert?.expires_at === "string");
  });
});

describe("consumirConnectState", () => {
  const UUID = "11111111-1111-1111-1111-111111111111";

  it("devuelve workspace/usuario si el state existe y no expiró", async () => {
    const futuro = new Date(Date.now() + 60_000).toISOString();
    const supabase = fakeSupabase({ data: { workspace_id: "ws-9", user_id: "u-9", expires_at: futuro }, error: null });
    const r = await consumirConnectState(supabase, { state: UUID });
    assert.deepEqual(r, { workspaceId: "ws-9", userId: "u-9" });
    assert.equal(supabase._registro().filtros.state, UUID);
  });

  it("devuelve null si el state expiró (aunque exista la fila)", async () => {
    const pasado = new Date(Date.now() - 60_000).toISOString();
    const supabase = fakeSupabase({ data: { workspace_id: "ws-9", user_id: "u-9", expires_at: pasado }, error: null });
    assert.equal(await consumirConnectState(supabase, { state: UUID }), null);
  });

  it("devuelve null si no existe la fila (ya usado / inválido)", async () => {
    const supabase = fakeSupabase({ data: null, error: null });
    assert.equal(await consumirConnectState(supabase, { state: UUID }), null);
  });

  it("no toca la tabla si el state no tiene forma de uuid", async () => {
    const supabase = fakeSupabase({ data: null, error: null });
    assert.equal(await consumirConnectState(supabase, { state: "no-uuid" }), null);
    assert.equal(supabase._registro().tabla, ""); // nunca llamó from()
  });
});
