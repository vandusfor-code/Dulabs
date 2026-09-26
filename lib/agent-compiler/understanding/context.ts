// DuLabs Business — Business Agent 2.0, FASE 2 — contexto del entendimiento, separado en cuatro capas.
//
//   CURRENT_MESSAGE       lo que el cliente escribió en ESTE turno (no confiable).
//   CONVERSATION_CONTEXT  estado de ESTA conversación: slots ya conocidos, confirmación pendiente, última pregunta
//                         (no confiable: lo originó el cliente).
//   BUSINESS_CONTEXT      configuración del negocio: nombre, oferta, slots propios, zona horaria (dato configurado).
//   SYSTEM_CONTEXT        lo que aporta el servidor: reloj, taxonomía, versión del contrato.
//
// Aislamiento: cada capa trae su propio alcance (tenant / conversación / contacto / agente) y se verifica contra el
// alcance del turno ANTES de construir nada. Una capa de otro tenant, otra conversación, otro contacto u otro agente
// no se mezcla: se rechaza con TENANT_ERROR / VALIDATION_ERROR (nunca se "corrige").

import { safeError, type BusinessAgentErrorCategory, type BusinessAgentSafeError } from "@/lib/agent-compiler/contracts/errors";
import { normalizeConfiguredText, type SlotDefinition } from "@/lib/agent-compiler/understanding/slots";

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_KNOWN_SLOTS = 20;
export const MAX_OFFERINGS = 30;
const MAX_CONTEXT_VALUE = 120;
const MAX_LAST_QUESTION = 200;

export interface UnderstandingScope {
  tenantId: string;
  conversationId: string;
  contactId: string;
  agentId?: string;
  flowVersionId?: string;
}

export interface ConversationContextInput {
  tenantId: string;
  conversationId: string;
  contactId: string;
  /** Valores ya capturados en ESTA conversación (texto de presentación, sin IDs internos). */
  knownSlots?: Record<string, string>;
  /** Confirmación que el SISTEMA dejó pendiente (p. ej. "resumen de la cita"). Sin esto, un "sí" no confirma nada. */
  pendingConfirmation?: { ref: string; summary: string };
  /** Última pregunta que hizo el agente (ayuda a interpretar respuestas cortas: "a las 5"). */
  lastAgentQuestion?: string;
}

export interface BusinessContextInput {
  tenantId: string;
  agentId?: string;
  businessName?: string;
  businessTimezone?: string;
  /** Nombres de servicios/productos (solo nombres, para reconocerlos; no son IDs ni precios). */
  offerings?: string[];
  businessSlots?: SlotDefinition[];
}

export interface UnderstandingInput {
  scope: UnderstandingScope;
  message: { text: string };
  conversation?: ConversationContextInput;
  business: BusinessContextInput;
}

export interface NormalizedMessage {
  text: string;
  normalization: {
    originalLength: number;
    normalizedLength: number;
    truncated: boolean;
    controlCharsRemoved: number;
  };
}

export interface PreparedContext {
  scope: UnderstandingScope;
  message: NormalizedMessage;
  conversation: {
    knownSlots: Record<string, string>;
    pendingConfirmation: { ref: string; summary: string } | null;
    lastAgentQuestion: string | null;
  };
  business: {
    businessName: string | null;
    businessTimezone: string | undefined;
    offerings: string[];
    businessSlots: SlotDefinition[];
  };
}

export type ContextError = BusinessAgentSafeError;

/** Caracteres de control (excepto salto de línea) e invisibles de formato (zero-width, bidi, BOM). */
const INVISIBLE_OR_CONTROL = new RegExp("[\\u0000-\\u0009\\u000b-\\u001f\\u007f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]", "g");

/** Normalización del mensaje: NFC, sin caracteres de control (salvo salto de línea), espacios colapsados, acotado. */
export function normalizeMessage(text: string): NormalizedMessage {
  const original = typeof text === "string" ? text : "";
  const nfc = original.normalize("NFC");
  const control = nfc.match(INVISIBLE_OR_CONTROL)?.length ?? 0;
  const cleaned = nfc
    .replace(INVISIBLE_OR_CONTROL, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const truncated = cleaned.length > MAX_MESSAGE_LENGTH;
  const out = truncated ? cleaned.slice(0, MAX_MESSAGE_LENGTH) : cleaned;
  return {
    text: out,
    normalization: { originalLength: original.length, normalizedLength: out.length, truncated, controlCharsRemoved: control },
  };
}

function err(category: BusinessAgentErrorCategory, code: string): { ok: false; error: ContextError } {
  return { ok: false, error: safeError(category, code) };
}

/**
 * Verifica el aislamiento entre capas y arma el contexto mínimo. No hace I/O: quien llama carga cada capa con SU
 * alcance (tenant-scoped) y esta función comprueba que todas pertenezcan al mismo turno.
 */
export function prepareUnderstandingContext(input: UnderstandingInput): { ok: true; context: PreparedContext } | { ok: false; error: ContextError } {
  const s = input.scope;
  if (!s?.tenantId || !s.conversationId || !s.contactId) return err("TENANT_ERROR", "understanding_scope_missing");

  const b = input.business;
  if (!b || b.tenantId !== s.tenantId) return err("TENANT_ERROR", "understanding_business_context_tenant_mismatch");
  if (s.agentId && b.agentId && b.agentId !== s.agentId) return err("TENANT_ERROR", "understanding_business_context_agent_mismatch");

  const c = input.conversation;
  if (c) {
    if (c.tenantId !== s.tenantId) return err("TENANT_ERROR", "understanding_conversation_context_tenant_mismatch");
    if (c.conversationId !== s.conversationId) return err("VALIDATION_ERROR", "understanding_conversation_context_mismatch");
    if (c.contactId !== s.contactId) return err("VALIDATION_ERROR", "understanding_conversation_contact_mismatch");
  }

  const message = normalizeMessage(input.message?.text ?? "");
  if (!message.text) return err("USER_ERROR", "understanding_empty_message");

  const knownSlots: Record<string, string> = {};
  for (const [k, v] of Object.entries(c?.knownSlots ?? {}).slice(0, MAX_KNOWN_SLOTS)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(k) || typeof v !== "string") continue;
    const value = normalizeConfiguredText(v, MAX_CONTEXT_VALUE);
    if (value) knownSlots[k] = value;
  }

  return {
    ok: true,
    context: {
      scope: { ...s },
      message,
      conversation: {
        knownSlots,
        pendingConfirmation: c?.pendingConfirmation?.ref
          ? { ref: normalizeConfiguredText(c.pendingConfirmation.ref, 80), summary: normalizeConfiguredText(c.pendingConfirmation.summary, MAX_LAST_QUESTION) }
          : null,
        lastAgentQuestion: normalizeConfiguredText(c?.lastAgentQuestion, MAX_LAST_QUESTION) || null,
      },
      business: {
        businessName: normalizeConfiguredText(b.businessName, 80) || null,
        businessTimezone: b.businessTimezone,
        offerings: (b.offerings ?? []).map((o) => normalizeConfiguredText(o, 80)).filter(Boolean).slice(0, MAX_OFFERINGS),
        businessSlots: b.businessSlots ?? [],
      },
    },
  };
}
