/**
 * Barrera runtime fail-closed para AI responseText y send_message (Fase 4.4.3).
 * Engine intacto: Orchestrator sanitiza/rechaza antes de effect_result.
 */

import {
  detectDomainCapabilities,
  extractClaimSecurityContextFromVariables,
  extractLogicalMessageText,
  extractVerifiedCapabilitiesFromVariables,
  type ClaimSecurityContext,
  validateTextClaimsAgainstVerified,
} from "@/lib/flow/external-claim-security";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchResult } from "@/lib/flow/executor-types";
import type { AssertionCapability, FlowMessageContent, MessageOrigin } from "@/lib/flow/types";

function cloneData(dispatchResult: EffectDispatchResult): Record<string, unknown> {
  const base = dispatchResult.appliedResult ?? dispatchResult.data ?? {};
  return { ...base };
}

function buildClaimContext(
  variables: Record<string, unknown>,
  source: ClaimSecurityContext["source"],
): ClaimSecurityContext {
  return extractClaimSecurityContextFromVariables(variables, source);
}

/**
 * Impide que responseText de IA afirme operaciones externas sin evidencia verificada.
 */
export function applyAiResponseClaimSecurity(input: {
  dispatchResult: EffectDispatchResult;
  variables: Record<string, unknown>;
}): EffectDispatchResult {
  if (!input.dispatchResult.success) return input.dispatchResult;

  const data = cloneData(input.dispatchResult);
  const responseText = data.responseText;
  if (typeof responseText !== "string" || !responseText.trim()) {
    return input.dispatchResult;
  }

  const verified = extractVerifiedCapabilitiesFromVariables(input.variables);
  const context = buildClaimContext(input.variables, "ai_response");
  const check = validateTextClaimsAgainstVerified(responseText, verified, context);
  if (check.ok) return input.dispatchResult;

  const sanitized = { ...data };
  delete sanitized.responseText;

  return {
    ...input.dispatchResult,
    success: false,
    classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED,
    error: `unverified_external_claim:${check.missing.join(",")}`,
    data: sanitized,
    appliedResult: sanitized,
    metadata: {
      ...input.dispatchResult.metadata,
      claimSecurityBlocked: true,
      blockedClaims: check.missing,
      blockedTextPreview: responseText.slice(0, 120),
    },
  };
}

function validateMessageContentClaims(
  content: FlowMessageContent,
  variables: Record<string, unknown>,
  source: ClaimSecurityContext["source"],
): { allowed: true } | { allowed: false; missing: string[] } {
  const resolved = extractLogicalMessageText(content, variables);
  if (!resolved.trim()) return { allowed: true };

  const verified = extractVerifiedCapabilitiesFromVariables(variables);
  const context = buildClaimContext(variables, source);
  const check = validateTextClaimsAgainstVerified(resolved, verified, context);
  if (check.ok) return { allowed: true };
  return { allowed: false, missing: check.missing };
}

// ---------------------------------------------------------------------------
// Corrección Claim Security, Fase 3 (autorizada) — matriz origin/messageRole.
//
// REGLA DE SEGURIDAD CRÍTICA: messageRole NUNCA es, por sí solo, una
// autorización para saltarse Claim Security. Lo único que cambia según
// origin/role es CUÁL verificación corre -- detectDomainCapabilities (el
// detector estructural de dominio de negocio: cita/pago/lead/soporte) SIEMPRE
// corre para contenido estático, sin excepción; lo que se omite para
// origin="flow_static" + role informational/intent_offer es el análisis
// morfológico de ambigüedad (completion_signal + fallback fail-closed a las
// 7 capabilities), que existe para lidiar con la variabilidad de texto
// generado en vivo (IA) -- no aplica a una plantilla fija, auditable en el
// Builder, y NUNCA determina esa condición nada que no sea el propio Engine
// (ver flow-engine.ts::staticMessageOrigin -- origin no es un input externo).
// ---------------------------------------------------------------------------

/** SOLO detección de dominio de negocio -- sin el análisis morfológico de ambigüedad. */
function checkDomainCapabilitiesOnly(
  resolvedText: string,
  verified: Set<AssertionCapability>,
): { allowed: true } | { allowed: false; missing: string[] } {
  const domainCaps = detectDomainCapabilities(resolvedText);
  if (domainCaps.length === 0) return { allowed: true };
  const missing = domainCaps.filter((cap) => !verified.has(cap));
  if (missing.length === 0) return { allowed: true };
  return { allowed: false, missing };
}

/**
 * external_assertion — el camino MÁS estricto, nunca un atajo. Exige que
 * TODAS las capabilities declaradas explícitamente (`content.asserts`) estén
 * verificadas, además de cualquier capability de dominio real detectada en
 * el propio texto (defensa en profundidad: un `asserts` incompleto no debe
 * dejar pasar un claim de dominio que el texto sí contiene). Sin ningún
 * `asserts` declarado y sin dominio detectable, fail-closed -- un mensaje
 * marcado external_assertion sin nada que verificar es una configuración
 * inválida, nunca se interpreta como "seguro por defecto".
 */
function checkExternalAssertion(
  resolvedText: string,
  asserts: AssertionCapability[] | undefined,
  verified: Set<AssertionCapability>,
): { allowed: true } | { allowed: false; missing: string[] } {
  const domainCaps = detectDomainCapabilities(resolvedText);
  const required = new Set<AssertionCapability>([...(asserts ?? []), ...domainCaps]);
  if (required.size === 0) return { allowed: false, missing: [] };
  const missing = [...required].filter((cap) => !verified.has(cap));
  if (missing.length === 0) return { allowed: true };
  return { allowed: false, missing };
}

/**
 * Punto único de la matriz origin/role (Fase 3). SOLO usada por
 * filterClaimSecuredEffects -- validateMessageContentClaims (arriba) y sus
 * wrappers (blockUnverifiedExternalClaimsInText/-InMessageContent) quedan
 * INTACTOS, sin relación con EngineEffect.origin, para no alterar ningún
 * llamador existente que no pasa por el pipeline del Engine.
 */
function validateMessageContentClaimsForOrigin(
  content: FlowMessageContent,
  variables: Record<string, unknown>,
  origin: MessageOrigin,
): { allowed: true } | { allowed: false; missing: string[] } {
  const resolved = extractLogicalMessageText(content, variables);
  if (!resolved.trim()) return { allowed: true };

  const verified = extractVerifiedCapabilitiesFromVariables(variables);

  // ai_generated / system / flow_static_interpolated -- SIEMPRE el pipeline
  // morfológico completo, exactamente igual que antes de esta fase. Una
  // variable interpolada NUNCA usa la ruta simplificada: podría cargar texto
  // de IA/no verificado, así que se trata con la misma máxima cautela.
  if (origin === "ai_generated" || origin === "system" || origin === "flow_static_interpolated") {
    const context = buildClaimContext(variables, "message_resolved");
    const check = validateTextClaimsAgainstVerified(resolved, verified, context);
    if (check.ok) return { allowed: true };
    return { allowed: false, missing: check.missing };
  }

  // origin === "flow_static" -- según messageRole (default: informational,
  // mismo criterio que validate-security.ts::validateMessageExternalClaims).
  const role = content.messageRole ?? "informational";

  if (role === "external_assertion") {
    return checkExternalAssertion(resolved, content.asserts, verified);
  }

  // informational | intent_offer -- SOLO detección de dominio real, nunca el
  // fallback fail-closed de completion_signal. Los claims de negocio siguen
  // protegidos exactamente igual (checkDomainCapabilitiesOnly nunca permite
  // un dominio detectado sin su capability verificada).
  return checkDomainCapabilitiesOnly(resolved, verified);
}

/** Filtra send_message con afirmaciones externas no verificadas (text, parts, media, template). */
export function filterClaimSecuredEffects(
  effects: import("@/lib/flow/engine-types").EngineEffect[],
  variables: Record<string, unknown>,
): import("@/lib/flow/engine-types").EngineEffect[] {
  return effects.filter((effect) => {
    if (effect.type !== "send_message") return true;
    const blocked = validateMessageContentClaimsForOrigin(effect.content, variables, effect.origin);
    return blocked.allowed;
  });
}

/** Valida texto plano contra claim security fail-closed. */
export function blockUnverifiedExternalClaimsInText(input: {
  text: string;
  variables: Record<string, unknown>;
  userMessage?: string;
  source?: ClaimSecurityContext["source"];
}): { allowed: true } | { allowed: false; missing: string[] } {
  const verified = extractVerifiedCapabilitiesFromVariables(input.variables);
  const context: ClaimSecurityContext = {
    ...extractClaimSecurityContextFromVariables(input.variables, input.source ?? "ai_response"),
    userMessage: input.userMessage ?? extractClaimSecurityContextFromVariables(input.variables).userMessage,
  };
  const check = validateTextClaimsAgainstVerified(input.text, verified, context);
  if (check.ok) return { allowed: true };
  return { allowed: false, missing: check.missing };
}

/** Valida FlowMessageContent completo (parts, media caption, template). */
export function blockUnverifiedExternalClaimsInMessageContent(input: {
  content: FlowMessageContent;
  variables: Record<string, unknown>;
  source?: ClaimSecurityContext["source"];
}): { allowed: true } | { allowed: false; missing: string[] } {
  return validateMessageContentClaims(
    input.content,
    input.variables,
    input.source ?? "message_resolved",
  );
}
