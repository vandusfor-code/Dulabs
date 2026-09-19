// DuLabs Business — Agent Compiler, Bloque 15A — store Supabase del calendario.
//
// service_role (las tablas no tienen política authenticated: grant_id/state son
// secretos). Cada query es tenant-scoped. Consumo de state ATÓMICO por UPDATE.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CalendarConnection,
  CalendarConnectionStatus,
  CalendarConnectionStore,
  CalendarProvider,
  ConsumeOAuthStateResult,
} from "@/lib/agent-compiler/calendar/types";

const CONNECTIONS = "dulabs_business_agent_calendar_connections";
const STATES = "dulabs_business_agent_calendar_oauth_states";

interface ConnectionRowDb {
  tenant_id: string;
  provider: CalendarProvider;
  grant_id: string | null;
  account_email: string | null;
  status: CalendarConnectionStatus;
  selected_calendar_id: string | null;
  selected_calendar_name: string | null;
  connected_at: string | null;
  updated_at: string;
}

function toConnection(r: ConnectionRowDb): CalendarConnection {
  return {
    tenantId: r.tenant_id,
    provider: r.provider,
    grantId: r.grant_id,
    accountEmail: r.account_email,
    status: r.status,
    selectedCalendarId: r.selected_calendar_id,
    selectedCalendarName: r.selected_calendar_name,
    connectedAt: r.connected_at,
    updatedAt: r.updated_at,
  };
}

export function createSupabaseCalendarStore(supabase: SupabaseClient): CalendarConnectionStore {
  return {
    async getConnection(tenantId) {
      const { data, error } = await supabase.from(CONNECTIONS).select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return data ? toConnection(data as ConnectionRowDb) : null;
    },

    async saveConnection(conn) {
      const { error } = await supabase.from(CONNECTIONS).upsert(
        {
          tenant_id: conn.tenantId,
          provider: conn.provider,
          grant_id: conn.grantId,
          account_email: conn.accountEmail,
          status: conn.status,
          selected_calendar_id: conn.selectedCalendarId,
          selected_calendar_name: conn.selectedCalendarName,
          connected_at: conn.connectedAt,
          updated_at: conn.updatedAt,
        },
        { onConflict: "tenant_id" },
      );
      if (error) throw error;
    },

    async deleteConnection(tenantId) {
      const { error } = await supabase.from(CONNECTIONS).delete().eq("tenant_id", tenantId);
      if (error) throw error; // idempotente: borrar 0 filas no es error
    },

    async createOAuthState({ state, tenantId, expiresAt }) {
      const { error } = await supabase.from(STATES).insert({ state, tenant_id: tenantId, expires_at: expiresAt });
      if (error) throw error;
    },

    async consumeOAuthState(state, nowIso): Promise<ConsumeOAuthStateResult> {
      // Consumo ATÓMICO: solo el primer request con este state y no expirado gana.
      const { data, error } = await supabase
        .from(STATES)
        .update({ consumed_at: nowIso })
        .eq("state", state)
        .is("consumed_at", null)
        .gt("expires_at", nowIso)
        .select("tenant_id")
        .maybeSingle();
      if (error) throw error;
      if (data) return { ok: true, tenantId: (data as { tenant_id: string }).tenant_id };

      // No se pudo consumir: clasificar el motivo (diagnóstico, no autoridad).
      const { data: existing } = await supabase
        .from(STATES)
        .select("consumed_at, expires_at")
        .eq("state", state)
        .maybeSingle();
      if (!existing) return { ok: false, reason: "not_found" };
      const row = existing as { consumed_at: string | null; expires_at: string };
      if (row.consumed_at !== null) return { ok: false, reason: "already_consumed" };
      return { ok: false, reason: "expired" };
    },
  };
}
