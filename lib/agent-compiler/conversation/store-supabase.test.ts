// Business Agent 2.0, FASE 3 — store de Supabase: forma exacta de las consultas (sin red).
//
// Un cliente Supabase grabador verifica que TODA lectura/escritura lleva la clave completa con tenant y que la escritura
// es condicional a la versión esperada. La semántica en la base (CAS real, unicidad, triggers, RLS, dos sesiones
// concurrentes) se verifica contra PostgreSQL real con scripts/verify-ba-conversation-states.sh.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseConversationStateStore, CONVERSATION_STATES_TABLE } from "@/lib/agent-compiler/conversation/store-supabase";
import { initialConversationState } from "@/lib/agent-compiler/conversation/model";
import { KEY, TENANT, OTHER_TENANT } from "@/lib/agent-compiler/conversation/testing/harness";

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> };

function recordingClient(result: { data?: unknown; error?: unknown }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: "", filters: [] };
      calls.push(call);
      const q = {
        select() { if (!call.op) call.op = "select"; return q; },
        insert(payload: unknown) { call.op = "insert"; call.payload = payload; return Promise.resolve({ error: result.error ?? null }); },
        update(payload: unknown) { call.op = "update"; call.payload = payload; return q; },
        eq(col: string, v: unknown) { call.filters.push([col, v]); return q; },
        maybeSingle() { return Promise.resolve({ data: result.data ?? null, error: result.error ?? null }); },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const state = () => initialConversationState({ tenantId: TENANT, conversationId: "pn-a:573001112233", contactId: "573001112233", agentId: "flow-1", agentVersion: "v1" }, "2026-09-26T15:00:00.000Z", "America/Bogota");
const KEY_FILTERS: Array<[string, unknown]> = [["id_tenant", TENANT], ["phone_number_id", "pn-a"], ["telefono_cliente", "573001112233"], ["agent_id", "flow-1"]];

describe("FASE 3 — store Supabase del estado conversacional", () => {
  it("load filtra por la clave completa (tenant incluido) y valida el estado", async () => {
    const { client, calls } = recordingClient({ data: { id_tenant: TENANT, state: state(), state_version: 4 } });
    const r = await createSupabaseConversationStateStore(client).load(KEY);
    assert.equal(r.kind, "found");
    assert.equal(r.kind === "found" && r.version, 4);
    assert.deepEqual([calls[0]!.table, calls[0]!.op, calls[0]!.filters], [CONVERSATION_STATES_TABLE, "select", KEY_FILTERS]);
  });

  it("load rechaza una fila de otro tenant o con estado inválido (no se usa)", async () => {
    const otra = recordingClient({ data: { id_tenant: OTHER_TENANT, state: state(), state_version: 1 } });
    assert.deepEqual(await createSupabaseConversationStateStore(otra.client).load(KEY), { kind: "corrupted", issue: "row_tenant_mismatch" });
    const mala = recordingClient({ data: { id_tenant: TENANT, state: { ...state(), status: "HACKED" }, state_version: 1 } });
    assert.equal((await createSupabaseConversationStateStore(mala.client).load(KEY)).kind, "corrupted");
  });

  it("save es condicional a la versión esperada y la avanza en 1; 0 filas = conflicto", async () => {
    const ok = recordingClient({ data: { state_version: 6 } });
    assert.deepEqual(await createSupabaseConversationStateStore(ok.client).save(KEY, state(), 5), { ok: true, version: 6 });
    assert.deepEqual(ok.calls[0]!.filters, [...KEY_FILTERS, ["state_version", 5]]);
    const payload = ok.calls[0]!.payload as Record<string, unknown>;
    assert.deepEqual([payload.state_version, payload.status, payload.schema_version], [6, "NEW", "business-agent.conversation-state/1.0.0"]);
    assert.equal("id_tenant" in payload, false, "un update nunca reescribe la clave");
    const conflicto = recordingClient({ data: null });
    assert.deepEqual(await createSupabaseConversationStateStore(conflicto.client).save(KEY, state(), 5), { ok: false, reason: "version_conflict" });
  });

  it("create inserta con la clave del servidor; 23505 = ya existe", async () => {
    const ok = recordingClient({});
    assert.deepEqual(await createSupabaseConversationStateStore(ok.client).create(KEY, state()), { ok: true, version: 1 });
    const p = ok.calls[0]!.payload as Record<string, unknown>;
    assert.deepEqual([p.id_tenant, p.phone_number_id, p.telefono_cliente, p.agent_id, p.state_version], [TENANT, "pn-a", "573001112233", "flow-1", 1]);
    const dup = recordingClient({ error: { code: "23505", message: "duplicate key" } });
    assert.deepEqual(await createSupabaseConversationStateStore(dup.client).create(KEY, state()), { ok: false, reason: "already_exists" });
  });
});
