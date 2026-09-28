/**
 * Transporte de resultados verificados con provenance (Fase 4.3).
 * Claude NO puede marcar verified=true — solo Action Executors.
 */

import { PROHIBITED_EVIDENCE_FIELDS } from "@/lib/flow/claude/claude-types";
import type { VerifiedActionResult } from "@/lib/flow/claude/claude-types";
import type { ActionNodeConfig } from "@/lib/flow/types";
import { resolveActionCapabilitySpec } from "@/lib/flow/action-capabilities";
import { isSystemInternalVariableKey } from "@/lib/flow/ai-runtime/protected-variables";

const PROHIBITED_SET = new Set<string>(PROHIBITED_EVIDENCE_FIELDS);

export const VERIFIED_RESULTS_VARIABLE_KEY = "__verifiedResults" as const;

export function resolveActionSourceKey(config: ActionNodeConfig): string {
  if (config.actionType === "webhook_http") {
    const tag = "semanticTag" in config ? config.semanticTag : undefined;
    return tag ?? "webhook_http";
  }
  return config.actionType;
}

/** Motivo por el que un argumento propuesto por la IA no llegó a las variables de la ejecución. */
export type DroppedArgumentReason = "evidence_field" | "system_internal" | "non_scalar";

export interface SanitizedProposalArguments {
  arguments: Record<string, string>;
  /** Solo nombres de clave (nunca valores): apto para trazas y metadata persistida. */
  dropped: Array<{ key: string; reason: DroppedArgumentReason }>;
}

/**
 * Elimina de los argumentos propuestos por la IA: campos de evidencia, claves internas del runtime
 * (FASE 1: `__*`, tenant/flow/versión/ejecución... ver protected-variables.ts) y valores no escalares.
 * Devuelve además qué se descartó y por qué.
 */
export function sanitizeProposalArgumentsDetailed(args: Record<string, unknown> | undefined): SanitizedProposalArguments {
  const out: Record<string, string> = {};
  const dropped: SanitizedProposalArguments["dropped"] = [];
  if (!args) return { arguments: out, dropped };
  for (const [key, value] of Object.entries(args)) {
    if (PROHIBITED_SET.has(key)) {
      dropped.push({ key, reason: "evidence_field" });
      continue;
    }
    if (isSystemInternalVariableKey(key)) {
      dropped.push({ key, reason: "system_internal" });
      continue;
    }
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
    } else {
      dropped.push({ key, reason: "non_scalar" });
    }
  }
  return { arguments: out, dropped };
}

/** Elimina campos de evidencia y claves internas de argumentos propuestos por IA. */
export function sanitizeProposalArguments(
  args: Record<string, unknown> | undefined,
): Record<string, string> {
  return sanitizeProposalArgumentsDetailed(args).arguments;
}

export function wrapVerifiedActionResult(input: {
  source: string;
  effectId: string;
  executionId: string;
  data: Record<string, unknown>;
  timestamp?: string;
}): VerifiedActionResult {
  return {
    verified: true,
    source: input.source,
    data: {
      ...input.data,
      verified: true,
      source: input.source,
      effectId: input.effectId,
      executionId: input.executionId,
      timestamp: input.timestamp ?? new Date().toISOString(),
    },
  };
}

export function appendVerifiedResultsToVariables(
  variables: Record<string, unknown>,
  entry: VerifiedActionResult,
): Record<string, unknown> {
  const existing = variables[VERIFIED_RESULTS_VARIABLE_KEY];
  const list = Array.isArray(existing) ? [...existing] : [];
  list.push(entry);
  return { ...variables, [VERIFIED_RESULTS_VARIABLE_KEY]: list };
}

/** Enriquece effect_result de acción con provenance verificada para el Engine/Runtime. */
export function buildVerifiedActionEffectData(input: {
  action: ActionNodeConfig;
  effectId: string;
  executionId: string;
  rawData: Record<string, unknown>;
}): Record<string, unknown> {
  const source = resolveActionSourceKey(input.action);
  const verified = wrapVerifiedActionResult({
    source,
    effectId: input.effectId,
    executionId: input.executionId,
    data: input.rawData,
  });

  const spec = resolveActionCapabilitySpec(input.action);
  const data: Record<string, unknown> = { ...input.rawData };

  for (const key of spec.outputVariables ?? []) {
    if (input.rawData[key] !== undefined) {
      data[key] = input.rawData[key];
    }
  }

  return {
    ...data,
    [VERIFIED_RESULTS_VARIABLE_KEY]: [
      ...(Array.isArray(data[VERIFIED_RESULTS_VARIABLE_KEY])
        ? (data[VERIFIED_RESULTS_VARIABLE_KEY] as unknown[])
        : []),
      verified,
    ],
  };
}

export function stripAiProposalFromEngineData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const { actionProposal: _removed, ...rest } = data;
  return rest;
}
