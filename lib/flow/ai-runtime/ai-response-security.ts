/**
 * Barrera runtime fail-closed para AI responseText y send_message (Fase 4.4.3).
 * Engine intacto: Orchestrator sanitiza/rechaza antes de effect_result.
 */

import {
  extractClaimSecurityContextFromVariables,
  extractLogicalMessageText,
  extractVerifiedCapabilitiesFromVariables,
  type ClaimSecurityContext,
  validateTextClaimsAgainstVerified,
} from "@/lib/flow/external-claim-security";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchResult } from "@/lib/flow/executor-types";
import type { FlowMessageContent } from "@/lib/flow/types";

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

/** Filtra send_message con afirmaciones externas no verificadas (text, parts, media, template). */
export function filterClaimSecuredEffects(
  effects: import("@/lib/flow/engine-types").EngineEffect[],
  variables: Record<string, unknown>,
): import("@/lib/flow/engine-types").EngineEffect[] {
  return effects.filter((effect) => {
    if (effect.type !== "send_message") return true;
    const blocked = validateMessageContentClaims(effect.content, variables, "message_resolved");
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
