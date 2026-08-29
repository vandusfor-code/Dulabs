/**
 * Validación de AIActionProposal (Fase 4.3).
 */

import { isWebhookSemanticTagAllowed, resolveActionCapabilitySpec } from "@/lib/flow/action-capabilities";
import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import { PROHIBITED_EVIDENCE_FIELDS } from "@/lib/flow/claude/claude-types";
import type { AIActionProposal } from "@/lib/flow/claude/claude-types";
import {
  resolveActionSourceKey,
  sanitizeProposalArguments,
} from "@/lib/flow/ai-runtime/verified-results";
import type { ActionNodeConfig, AiNodeConfig, FlowDefinition, FlowNode } from "@/lib/flow/types";

export type ProposalValidationCode =
  | "SECURITY_REJECTED"
  | "VALIDATION_ERROR";

export type ProposalValidationResult =
  | {
      ok: true;
      actionNode: FlowNode & { type: "action" };
      actionConfig: ActionNodeConfig;
      sanitizedArguments: Record<string, string>;
    }
  | {
      ok: false;
      code: ProposalValidationCode;
      error: string;
    };

const PROHIBITED_SET = new Set<string>(PROHIBITED_EVIDENCE_FIELDS);

function isSuccessEdge(sourceHandle?: string): boolean {
  return (
    sourceHandle === undefined ||
    sourceHandle === FLOW_EDGE_HANDLE.default ||
    sourceHandle === FLOW_EDGE_HANDLE.aiSuccess
  );
}

function outgoingSuccessTargets(flow: FlowDefinition, nodeId: string): string[] {
  return flow.edges
    .filter((e) => e.source === nodeId && isSuccessEdge(e.sourceHandle))
    .map((e) => e.target);
}

export function resolveProposalActionNode(
  flow: FlowDefinition,
  aiNodeId: string,
  actionType: string,
): (FlowNode & { type: "action" }) | null {
  const nodeById = new Map(flow.nodes.map((n) => [n.id, n]));
  for (const targetId of outgoingSuccessTargets(flow, aiNodeId)) {
    const node = nodeById.get(targetId);
    if (node?.type !== "action") continue;
    if (resolveActionSourceKey(node.config) === actionType) {
      return node;
    }
  }
  return null;
}

function validateProposalArguments(args: Record<string, unknown> | undefined): string | null {
  if (!args) return null;
  for (const key of Object.keys(args)) {
    if (PROHIBITED_SET.has(key)) {
      return `prohibited_argument:${key}`;
    }
  }
  return null;
}

export function validateAiActionProposal(input: {
  flow: FlowDefinition;
  aiNodeId: string;
  aiConfig: AiNodeConfig;
  proposal: AIActionProposal;
  tenantId: string;
  executionTenantId: string;
}): ProposalValidationResult {
  if (input.tenantId !== input.executionTenantId) {
    return { ok: false, code: "SECURITY_REJECTED", error: "tenant_mismatch" };
  }

  const allowed = input.aiConfig.allowedTools ?? [];
  if (allowed.length === 0) {
    return { ok: false, code: "SECURITY_REJECTED", error: "action_proposals_disabled" };
  }

  if (!allowed.includes(input.proposal.actionType)) {
    return { ok: false, code: "SECURITY_REJECTED", error: "action_proposal_not_allowed" };
  }

  const argError = validateProposalArguments(input.proposal.arguments);
  if (argError) {
    return { ok: false, code: "VALIDATION_ERROR", error: argError };
  }

  const actionNode = resolveProposalActionNode(
    input.flow,
    input.aiNodeId,
    input.proposal.actionType,
  );
  if (!actionNode) {
    return { ok: false, code: "SECURITY_REJECTED", error: "no_authorized_action_node_in_flow" };
  }

  const actionConfig = actionNode.config;
  if (actionConfig.actionType === "webhook_http") {
    const tag = "semanticTag" in actionConfig ? actionConfig.semanticTag : undefined;
    if (!tag || !isWebhookSemanticTagAllowed(tag)) {
      return { ok: false, code: "SECURITY_REJECTED", error: "webhook_not_allowlisted" };
    }
    if (input.proposal.actionType !== tag) {
      return { ok: false, code: "SECURITY_REJECTED", error: "webhook_semantic_mismatch" };
    }
  }

  const spec = resolveActionCapabilitySpec(actionConfig);
  if (spec.criticality === "critical" && input.proposal.actionType === "webhook_http") {
    // webhook proposals already vetted by allowlist
  }

  return {
    ok: true,
    actionNode,
    actionConfig,
    sanitizedArguments: sanitizeProposalArguments(input.proposal.arguments),
  };
}
