// DuLabs Business — Business Agent 2.0, FASE 3 — persistencia del estado conversacional (contrato del store).
//
// Toda operación exige la clave COMPLETA (tenant + número del negocio + teléfono del cliente + agente): no existe
// "cargar por conversationId" sin tenant. La concurrencia es optimista, con el mismo patrón que el Flow Store
// (UPDATE ... WHERE state_version = esperado): quien pierde la carrera recibe `version_conflict` y reintenta sobre el
// estado ganador. Un estado persistido que no valida (manipulado, corrupto, de otro alcance) se reporta como
// `corrupted` y NO se usa.

import { parseConversationState, type ConversationState } from "@/lib/agent-compiler/conversation/model";

export interface ConversationStateKey {
  tenantId: string;
  phoneNumberId: string;
  telefonoCliente: string;
  /** flow_id del Business Agent. */
  agentId: string;
}

export function conversationIdOf(key: Pick<ConversationStateKey, "phoneNumberId" | "telefonoCliente">): string {
  return `${key.phoneNumberId}:${key.telefonoCliente}`;
}

export type ConversationStateLoad =
  | { kind: "found"; state: ConversationState; version: number }
  | { kind: "not_found" }
  | { kind: "corrupted"; issue: string };

export type ConversationStateWrite = { ok: true; version: number } | { ok: false; reason: "already_exists" | "version_conflict" };

export interface ConversationStateStore {
  load(key: ConversationStateKey): Promise<ConversationStateLoad>;
  /** Crea el estado con versión 1. Si otro proceso lo creó primero: `already_exists`. */
  create(key: ConversationStateKey, state: ConversationState): Promise<ConversationStateWrite>;
  /** Guarda solo si la versión actual es `expectedVersion`; la nueva versión es expectedVersion + 1. */
  save(key: ConversationStateKey, state: ConversationState, expectedVersion: number): Promise<ConversationStateWrite>;
}

/** Verificación común al cargar: el estado debe validar Y pertenecer exactamente a la clave pedida. */
export function validateLoadedState(key: ConversationStateKey, raw: unknown, rowTenantId: string): ConversationStateLoad | { kind: "valid"; state: ConversationState } {
  if (rowTenantId !== key.tenantId) return { kind: "corrupted", issue: "row_tenant_mismatch" };
  const parsed = parseConversationState(raw);
  if (!parsed.ok) return { kind: "corrupted", issue: parsed.issue };
  const s = parsed.state.scope;
  if (s.tenantId !== key.tenantId || s.agentId !== key.agentId || s.conversationId !== conversationIdOf(key) || s.contactId !== key.telefonoCliente) {
    return { kind: "corrupted", issue: "scope_mismatch" };
  }
  return { kind: "valid", state: parsed.state };
}
