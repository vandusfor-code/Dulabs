/**
 * AI Runtime Bridge — traduce actionProposal al Flow autorizado (Fase 4.3).
 * PROPOSED ≠ EXECUTED. Nunca llama InternalActionExecutor directamente.
 */

import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchResult } from "@/lib/flow/executor-types";
import { validateAiActionProposal } from "@/lib/flow/ai-runtime/ai-proposal-validator";
import {
  sanitizeProposalArguments,
  sanitizeProposalArgumentsDetailed,
  stripAiProposalFromEngineData,
} from "@/lib/flow/ai-runtime/verified-results";
import type { AiNodeConfig } from "@/lib/flow/types";
import type { FlowDefinition } from "@/lib/flow/types";
import type { AiBudgetState } from "@/lib/flow/claude/claude-types";

/**
 * Business Agent 2.0, FASE 1 — política de argumentos por acción (contrato), inyectable. El Flow Engine no
 * conoce los contratos concretos (viven en lib/agent-compiler/contracts); solo sabe aplicar una política si
 * el runtime que lo invoca la provee. Sin política (Flow Studio, flows ajenos) el comportamiento es el previo.
 */
export interface ProposalArgumentPolicyInput {
  tenantId: string;
  actionType: string;
  /** Argumentos ya saneados (sin evidencia ni claves internas). */
  arguments: Record<string, string>;
  flow: FlowDefinition;
  aiNodeId: string;
  context?: ProposalBridgeContext;
}

export type ProposalArgumentPolicyResult =
  | {
      ok: true;
      arguments: Record<string, string>;
      dropped: Array<{ key: string; reason: string }>;
      contract: { action: string; version: string };
    }
  | {
      ok: false;
      code: "SECURITY_REJECTED" | "VALIDATION_ERROR";
      error: string;
      dropped: Array<{ key: string; reason: string }>;
      contract?: { action: string; version: string };
    };

export interface ProposalArgumentPolicy {
  apply(input: ProposalArgumentPolicyInput): ProposalArgumentPolicyResult;
}

/** Identificadores de la ejecución para trazabilidad (nunca los propone la IA). */
export interface ProposalBridgeContext {
  executionRowId?: string;
  flowId?: string;
  flowVersionId?: string;
}

export interface AiProposalBridgeInput {
  flow: FlowDefinition;
  aiNodeId: string;
  aiConfig?: AiNodeConfig;
  dispatchResult: EffectDispatchResult;
  tenantId: string;
  /** FASE 1 — contrato de argumentos por acción (Business Agent). Ausente = comportamiento previo. */
  argumentPolicy?: ProposalArgumentPolicy;
  context?: ProposalBridgeContext;
}

export interface AiProposalBridgeOutput {
  dispatchResult: EffectDispatchResult;
  variablesPatch?: Record<string, unknown>;
  aiBudgetAfter?: AiBudgetState;
  bridged: boolean;
}

function extractActionProposal(data: Record<string, unknown> | undefined): {
  actionType: string;
  arguments?: Record<string, unknown>;
} | null {
  const proposal = data?.actionProposal;
  if (!proposal || typeof proposal !== "object") return null;
  const p = proposal as Record<string, unknown>;
  if (typeof p.actionType !== "string") return null;
  return {
    actionType: p.actionType,
    arguments:
      p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments)
        ? (p.arguments as Record<string, unknown>)
        : undefined,
  };
}

function classificationFromCode(code: "SECURITY_REJECTED" | "VALIDATION_ERROR") {
  return code === "SECURITY_REJECTED"
    ? EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED
    : EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR;
}

/**
 * Procesa resultado AI antes de persistir/continuar Engine.
 * - Valida actionProposal contra Flow + allowedTools
 * - Separa argumentos extraídos de evidencia verificada
 * - Prepara variablesPatch para el ACTION node downstream
 */
export function bridgeAiDispatchResult(input: AiProposalBridgeInput): AiProposalBridgeOutput {
  const applied = input.dispatchResult.appliedResult ?? input.dispatchResult.data ?? {};
  const metadata = input.dispatchResult.metadata ?? {};
  const aiBudgetAfter = metadata.budgetAfter as AiBudgetState | undefined;

  if (!input.dispatchResult.success) {
    return { dispatchResult: input.dispatchResult, aiBudgetAfter, bridged: false };
  }

  const proposal = extractActionProposal(applied);
  if (!proposal) {
    const cleaned: EffectDispatchResult = {
      ...input.dispatchResult,
      data: stripAiProposalFromEngineData(applied),
      appliedResult: stripAiProposalFromEngineData(applied),
    };
    return { dispatchResult: cleaned, aiBudgetAfter, bridged: false };
  }

  if (!input.aiConfig) {
    return {
      dispatchResult: {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "ai_config_missing_for_proposal",
      },
      bridged: true,
    };
  }

  const validation = validateAiActionProposal({
    flow: input.flow,
    aiNodeId: input.aiNodeId,
    aiConfig: input.aiConfig,
    proposal,
    tenantId: input.tenantId,
    executionTenantId: input.tenantId,
  });

  if (!validation.ok) {
    return {
      dispatchResult: {
        success: false,
        classification: classificationFromCode(validation.code),
        error: validation.error,
        metadata: { bridgedProposal: proposal.actionType, rejected: true },
      },
      aiBudgetAfter,
      bridged: true,
    };
  }

  // FASE 1 — qué se descartó de lo que propuso la IA (solo nombres de clave, nunca valores).
  const sanitized = sanitizeProposalArgumentsDetailed(proposal.arguments);
  let bridgedArguments: Record<string, string> = validation.sanitizedArguments;
  let argumentPolicyTrace: Record<string, unknown> | undefined =
    sanitized.dropped.length > 0 ? { dropped: sanitized.dropped } : undefined;

  if (input.argumentPolicy) {
    const policy = input.argumentPolicy.apply({
      tenantId: input.tenantId,
      actionType: proposal.actionType,
      arguments: validation.sanitizedArguments,
      flow: input.flow,
      aiNodeId: input.aiNodeId,
      context: input.context,
    });
    const dropped = [...sanitized.dropped, ...policy.dropped];
    argumentPolicyTrace = {
      action: policy.contract?.action ?? proposal.actionType,
      contractVersion: policy.contract?.version ?? null,
      outcome: policy.ok ? (dropped.length > 0 ? "accepted_with_drops" : "accepted") : "rejected",
      dropped,
      ...(policy.ok ? {} : { error: policy.error }),
    };
    if (!policy.ok) {
      return {
        dispatchResult: {
          success: false,
          classification: classificationFromCode(policy.code),
          error: policy.error,
          metadata: { bridgedProposal: proposal.actionType, rejected: true, argumentPolicy: argumentPolicyTrace },
          rawResult: { argumentPolicy: argumentPolicyTrace },
        },
        aiBudgetAfter,
        bridged: true,
      };
    }
    bridgedArguments = policy.arguments;
  }

  const engineData = stripAiProposalFromEngineData(applied);
  const variablesPatch: Record<string, unknown> = {
    ...bridgedArguments,
    __proposalBridged: {
      actionType: proposal.actionType,
      targetNodeId: validation.actionNode.id,
      sanitized: true,
    },
  };

  return {
    dispatchResult: {
      ...input.dispatchResult,
      data: engineData,
      appliedResult: engineData,
      metadata: {
        ...metadata,
        proposalBridged: proposal.actionType,
        proposalTargetNodeId: validation.actionNode.id,
        ...(argumentPolicyTrace ? { argumentPolicy: argumentPolicyTrace } : {}),
      },
      // rawResult es lo que se persiste en dulabs_flow_effects: la traza del contrato queda auditable.
      ...(argumentPolicyTrace
        ? { rawResult: { ...(input.dispatchResult.rawResult ?? {}), argumentPolicy: argumentPolicyTrace } }
        : {}),
    },
    variablesPatch,
    aiBudgetAfter,
    bridged: true,
  };
}

/** Enriquece resultado de acción con provenance antes de effect_result al Engine. */
export function bridgeActionDispatchResult(input: {
  dispatchResult: EffectDispatchResult;
  verifiedData: Record<string, unknown>;
}): EffectDispatchResult {
  if (!input.dispatchResult.success) return input.dispatchResult;
  return {
    ...input.dispatchResult,
    data: input.verifiedData,
    appliedResult: input.verifiedData,
  };
}

/** Rechaza datos de IA que intenten fabricar evidencia crítica. */
export function rejectFabricatedAiEvidence(
  data: Record<string, unknown>,
): EffectDispatchResult | null {
  for (const key of ["available", "appointmentId", "leadId", "pausadoHasta", "leadCreated", "appointmentConfirmed", "transferred"]) {
    if (data[key] !== undefined) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: `fabricated_evidence:${key}`,
      };
    }
  }
  if (data.verified === true) {
    return {
      success: false,
      classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
      error: "fabricated_verified_flag",
    };
  }
  return null;
}

export { sanitizeProposalArguments };
