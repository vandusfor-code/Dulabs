// DuLabs Business — Business Agent 2.0, FASE 3 — store de producción del estado conversacional (Postgres/Supabase).
//
// Tabla: dulabs_ba_conversation_states (migración 20261123000000). Mismo patrón que lib/flow/flow-store.ts:
//   - toda consulta filtra por id_tenant + phone_number_id + telefono_cliente + agent_id (nunca por un id suelto);
//   - concurrencia optimista: UPDATE ... WHERE state_version = esperado (0 filas = conflicto);
//   - creación única por clave: 23505 = otro proceso la creó primero.
// La base además exige (trigger) que la versión avance de a 1 y que la clave de una fila no cambie.

import type { SupabaseClient } from "@supabase/supabase-js";
import { chatEnPausaHumana } from "@/lib/pausas-chat";
import type { HumanControlPort } from "@/lib/agent-compiler/conversation/service";
import type { ConversationState } from "@/lib/agent-compiler/conversation/model";
import {
  validateLoadedState,
  type ConversationStateLoad,
  type ConversationStateStore,
  type ConversationStateWrite,
} from "@/lib/agent-compiler/conversation/store";

export const CONVERSATION_STATES_TABLE = "dulabs_ba_conversation_states";

function rowFields(state: ConversationState) {
  return {
    agent_version: state.scope.agentVersion,
    status: state.status,
    schema_version: state.schemaVersion,
    state,
    last_message_at: state.lastMessageAt,
  };
}

export function createSupabaseConversationStateStore(supabase: SupabaseClient): ConversationStateStore {
  return {
    async load(key): Promise<ConversationStateLoad> {
      const { data, error } = await supabase
        .from(CONVERSATION_STATES_TABLE)
        .select("id_tenant, state, state_version")
        .eq("id_tenant", key.tenantId)
        .eq("phone_number_id", key.phoneNumberId)
        .eq("telefono_cliente", key.telefonoCliente)
        .eq("agent_id", key.agentId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return { kind: "not_found" };
      const row = data as { id_tenant: string; state: unknown; state_version: number };
      const v = validateLoadedState(key, row.state, row.id_tenant);
      return v.kind === "valid" ? { kind: "found", state: v.state, version: row.state_version } : v;
    },

    async create(key, state): Promise<ConversationStateWrite> {
      const { error } = await supabase.from(CONVERSATION_STATES_TABLE).insert({
        id_tenant: key.tenantId,
        phone_number_id: key.phoneNumberId,
        telefono_cliente: key.telefonoCliente,
        agent_id: key.agentId,
        state_version: 1,
        ...rowFields(state),
      });
      if (error) {
        if ((error as { code?: string }).code === "23505") return { ok: false, reason: "already_exists" };
        throw error;
      }
      return { ok: true, version: 1 };
    },

    async save(key, state, expectedVersion): Promise<ConversationStateWrite> {
      const { data, error } = await supabase
        .from(CONVERSATION_STATES_TABLE)
        .update({ ...rowFields(state), state_version: expectedVersion + 1 })
        .eq("id_tenant", key.tenantId)
        .eq("phone_number_id", key.phoneNumberId)
        .eq("telefono_cliente", key.telefonoCliente)
        .eq("agent_id", key.agentId)
        .eq("state_version", expectedVersion)
        .select("state_version")
        .maybeSingle();
      if (error) throw error;
      if (!data) return { ok: false, reason: "version_conflict" };
      return { ok: true, version: (data as { state_version: number }).state_version };
    },
  };
}

/**
 * Pausa humana con la MISMA fuente y reglas que ya usa el runtime (dulabs_pausas_chat vía chatEnPausaHumana, solo
 * lectura). Esa función es fail-open ante un error de lectura (decisión existente del proyecto): no se cambia aquí.
 */
export function createPausaChatHumanControl(supabase: SupabaseClient): HumanControlPort {
  return { isActive: (key) => chatEnPausaHumana(supabase, key.phoneNumberId, key.telefonoCliente) };
}
