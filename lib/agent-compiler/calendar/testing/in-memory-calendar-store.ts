// DuLabs Business — Agent Compiler, Bloque 15A — store en memoria (SOLO tests).
//
// Reproduce las invariantes reales del store Supabase (tenant scoping, una
// conexión por tenant, state OAuth de un solo uso con expiry) sin DB.

import type {
  CalendarConnection,
  CalendarConnectionStore,
  ConsumeOAuthStateResult,
} from "@/lib/agent-compiler/calendar/types";

interface OAuthStateRecord {
  tenantId: string;
  expiresAt: string;
  consumedAt: string | null;
}

export function createInMemoryCalendarStore(): CalendarConnectionStore & {
  _debug: { connections: Map<string, CalendarConnection>; states: Map<string, OAuthStateRecord> };
} {
  const connections = new Map<string, CalendarConnection>();
  const states = new Map<string, OAuthStateRecord>();

  return {
    _debug: { connections, states },

    async getConnection(tenantId) {
      return connections.get(tenantId) ?? null;
    },

    async saveConnection(conn) {
      connections.set(conn.tenantId, { ...conn });
    },

    async deleteConnection(tenantId) {
      connections.delete(tenantId); // idempotente
    },

    async createOAuthState({ state, tenantId, expiresAt }) {
      states.set(state, { tenantId, expiresAt, consumedAt: null });
    },

    async consumeOAuthState(state, nowIso): Promise<ConsumeOAuthStateResult> {
      // Atómico en JS (sin await entre check y set): el primer consumidor gana,
      // los reintentos (replay) ven consumedAt != null.
      const rec = states.get(state);
      if (!rec) return { ok: false, reason: "not_found" };
      if (rec.consumedAt !== null) return { ok: false, reason: "already_consumed" };
      if (rec.expiresAt <= nowIso) return { ok: false, reason: "expired" };
      rec.consumedAt = nowIso;
      return { ok: true, tenantId: rec.tenantId };
    },
  };
}
