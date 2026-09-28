// Business Agent 2.0, FASE 3 — store en memoria con la MISMA semántica que el de Postgres (clave compuesta con tenant,
// versión optimista, creación única, validación al cargar). Para tests; no se usa en producción.

import {
  conversationIdOf,
  validateLoadedState,
  type ConversationStateKey,
  type ConversationStateLoad,
  type ConversationStateStore,
  type ConversationStateWrite,
} from "@/lib/agent-compiler/conversation/store";
import type { ConversationState } from "@/lib/agent-compiler/conversation/model";

interface Row {
  tenantId: string;
  state: unknown;
  version: number;
}

export interface InMemoryConversationStore extends ConversationStateStore {
  /** Acceso directo para tests (simular manipulación o inspeccionar la fila). */
  rows: Map<string, Row>;
  keyOf(key: ConversationStateKey): string;
  writes: number;
}

export function createInMemoryConversationStore(): InMemoryConversationStore {
  const rows = new Map<string, Row>();
  const keyOf = (k: ConversationStateKey) => JSON.stringify([k.tenantId, k.phoneNumberId, k.telefonoCliente, k.agentId]);
  const store: InMemoryConversationStore = {
    rows,
    keyOf,
    writes: 0,
    async load(key): Promise<ConversationStateLoad> {
      const row = rows.get(keyOf(key));
      if (!row) return { kind: "not_found" };
      const v = validateLoadedState(key, structuredClone(row.state), row.tenantId);
      return v.kind === "valid" ? { kind: "found", state: v.state, version: row.version } : v;
    },
    async create(key, state: ConversationState): Promise<ConversationStateWrite> {
      if (rows.has(keyOf(key))) return { ok: false, reason: "already_exists" };
      if (state.scope.tenantId !== key.tenantId || state.scope.conversationId !== conversationIdOf(key)) throw new Error("scope_mismatch_on_create");
      rows.set(keyOf(key), { tenantId: key.tenantId, state: structuredClone(state), version: 1 });
      store.writes++;
      return { ok: true, version: 1 };
    },
    async save(key, state, expectedVersion): Promise<ConversationStateWrite> {
      const row = rows.get(keyOf(key));
      if (!row || row.version !== expectedVersion) return { ok: false, reason: "version_conflict" };
      if (state.scope.tenantId !== key.tenantId || state.scope.conversationId !== conversationIdOf(key)) throw new Error("scope_mismatch_on_save");
      row.state = structuredClone(state);
      row.version = expectedVersion + 1;
      store.writes++;
      return { ok: true, version: row.version };
    },
  };
  return store;
}
