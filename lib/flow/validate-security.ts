/**
 * Validación de seguridad para publicación de flows (Fase 2.7).
 * Análisis estático de caminos — sin I/O, sin regex sobre texto libre.
 */

import {
  buildVariableCapabilityMap,
  isWebhookSemanticTagAllowed,
  resolveActionCapabilitySpec,
} from "@/lib/flow/action-capabilities";
import { FLOW_EDGE_HANDLE, FLOW_VALIDATION_CODES } from "@/lib/flow/constants";
import { extractInterpolatedVariableKeys } from "@/lib/flow/message-interpolation";
import { detectExternalClaimsInMessageTemplate } from "@/lib/flow/external-claim-security";
import {
  failResult,
  flowValidationError,
  type FlowValidationError,
  type FlowValidationResult,
} from "@/lib/flow/errors";
import type {
  ActionNodeConfig,
  AssertionCapability,
  FlowDefinition,
  FlowEdge,
  FlowNode,
} from "@/lib/flow/types";

type CapabilitySet = Set<AssertionCapability>;

interface IncomingEdge {
  source: string;
  edge: FlowEdge;
}

function outgoingEdges(flow: FlowDefinition, nodeId: string): FlowEdge[] {
  return flow.edges.filter((e) => e.source === nodeId);
}

function incomingEdges(flow: FlowDefinition, nodeId: string): IncomingEdge[] {
  return flow.edges
    .filter((e) => e.target === nodeId)
    .map((edge) => ({ source: edge.source, edge }));
}

function isSuccessEdge(edge: FlowEdge): boolean {
  const h = edge.sourceHandle;
  return h === undefined || h === FLOW_EDGE_HANDLE.default || h === FLOW_EDGE_HANDLE.aiSuccess;
}

function intersectCapabilitySets(sets: CapabilitySet[]): CapabilitySet {
  if (sets.length === 0) return new Set();
  const [first, ...rest] = sets;
  const result = new Set(first);
  for (const cap of result) {
    if (!rest.every((s) => s.has(cap))) result.delete(cap);
  }
  return result;
}

function extendCapabilitiesFromEdge(
  predId: string,
  edge: FlowEdge,
  base: CapabilitySet,
  nodeById: Map<string, FlowNode>,
): CapabilitySet {
  const next = new Set(base);
  const pred = nodeById.get(predId);
  if (!pred || pred.type !== "action") return next;
  if (!isSuccessEdge(edge)) return next;

  const spec = resolveActionCapabilitySpec(pred.config);
  for (const cap of spec.verifiesOnSuccess ?? []) next.add(cap);
  return next;
}

/**
 * Calcula capabilities verificadas en TODOS los caminos start → nodeId.
 * En nodos de merge: intersección de capabilities de cada predecessor.
 */
export function computeVerifiedCapabilities(flow: FlowDefinition): Map<string, CapabilitySet> {
  const nodeById = new Map(flow.nodes.map((n) => [n.id, n]));
  const start = flow.nodes.find((n) => n.type === "start");
  const verifiedAt = new Map<string, CapabilitySet>();
  if (!start) return verifiedAt;

  verifiedAt.set(start.id, new Set());

  const reachable = new Set<string>();
  const queue = [start.id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const e of outgoingEdges(flow, id)) {
      if (!reachable.has(e.target)) queue.push(e.target);
    }
  }

  let changed = true;
  let iterations = 0;
  const maxIterations = flow.nodes.length * flow.edges.length + 1;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations += 1;

    for (const node of flow.nodes) {
      if (!reachable.has(node.id) || node.type === "start") continue;

      const incoming = incomingEdges(flow, node.id);
      if (incoming.length === 0) continue;

      const predSets: CapabilitySet[] = [];
      for (const { source, edge } of incoming) {
        if (!reachable.has(source)) continue;
        const predVerified = verifiedAt.get(source) ?? new Set();
        predSets.push(extendCapabilitiesFromEdge(source, edge, predVerified, nodeById));
      }

      if (predSets.length === 0) continue;

      const merged = intersectCapabilitySets(predSets);
      const prev = verifiedAt.get(node.id);
      const same =
        prev &&
        prev.size === merged.size &&
        [...merged].every((c) => prev.has(c));

      if (!same) {
        verifiedAt.set(node.id, merged);
        changed = true;
      }
    }
  }

  return verifiedAt;
}

function buildLinkedCapabilityMap(flow: FlowDefinition): Map<string, AssertionCapability> {
  const linked = new Map<string, AssertionCapability>();
  for (const v of flow.variables) {
    if (v.linkedCapability) linked.set(v.key, v.linkedCapability);
  }
  return buildVariableCapabilityMap(
    flow.nodes
      .filter((n): n is FlowNode & { type: "action" } => n.type === "action")
      .map((n) => resolveActionCapabilitySpec(n.config)),
    linked,
  );
}

function validateExternalAssertions(
  flow: FlowDefinition,
  verifiedAt: Map<string, CapabilitySet>,
): FlowValidationError[] {
  const errors: FlowValidationError[] = [];

  for (const node of flow.nodes) {
    if (node.type !== "message") continue;
    const role = node.config.messageRole ?? "informational";
    if (role !== "external_assertion") continue;

    const asserts = node.config.asserts ?? [];
    if (asserts.length === 0) {
      errors.push(
        flowValidationError(
          FLOW_VALIDATION_CODES.INVALID_ASSERTION_CONFIG,
          "external_assertion requiere asserts",
          { nodeId: node.id },
        ),
      );
      continue;
    }

    const verified = verifiedAt.get(node.id) ?? new Set();
    const missing = asserts.filter((cap) => !verified.has(cap));
    if (missing.length > 0) {
      errors.push(
        flowValidationError(
          FLOW_VALIDATION_CODES.UNVERIFIED_ASSERTION,
          `Mensaje afirma capabilities sin evidencia verificada en todos los caminos: ${missing.join(", ")}`,
          { nodeId: node.id },
        ),
      );
    }
  }

  return errors;
}

function validateConditionCapabilities(
  flow: FlowDefinition,
  verifiedAt: Map<string, CapabilitySet>,
  variableCapabilityMap: Map<string, AssertionCapability>,
): FlowValidationError[] {
  const errors: FlowValidationError[] = [];

  for (const node of flow.nodes) {
    if (node.type !== "condition") continue;

    const verified = verifiedAt.get(node.id) ?? new Set();
    for (const rule of node.config.rules) {
      const cap = variableCapabilityMap.get(rule.field);
      if (!cap) continue;
      if (!verified.has(cap)) {
        errors.push(
          flowValidationError(
            FLOW_VALIDATION_CODES.CONDITION_ON_UNVERIFIED,
            `Condición sobre "${rule.field}" (${cap}) sin acción verificadora previa en todos los caminos`,
            { nodeId: node.id, path: `config.rules.field=${rule.field}` },
          ),
        );
      }
    }
  }

  return errors;
}

function computeAiProducedVariables(flow: FlowDefinition): Set<string> {
  const produced = new Set<string>();
  for (const node of flow.nodes) {
    if (node.type !== "ai") continue;
    for (const key of node.config.outputVariables ?? []) {
      produced.add(key);
    }
  }
  return produced;
}

const CRITICAL_AI_VARIABLE_KEY = /confirm|reserved|available|cita|agend|lead|transfer|registr|pausado/i;

function validateMessageExternalClaims(
  flow: FlowDefinition,
  verifiedAt: Map<string, CapabilitySet>,
): FlowValidationError[] {
  const errors: FlowValidationError[] = [];

  for (const node of flow.nodes) {
    if (node.type !== "message") continue;
    const role = node.config.messageRole ?? "informational";
    if (role === "external_assertion") continue;

    const claims = detectExternalClaimsInMessageTemplate(node.config);
    if (claims.length === 0) continue;

    const verified = verifiedAt.get(node.id) ?? new Set();
    const missing = claims.filter((cap) => !verified.has(cap));
    if (missing.length > 0) {
      errors.push(
        flowValidationError(
          FLOW_VALIDATION_CODES.EXTERNAL_CLAIM_UNVERIFIED,
          `Mensaje contiene afirmación externa (${missing.join(", ")}) sin evidencia verificada en todos los caminos`,
          { nodeId: node.id },
        ),
      );
    }
  }

  return errors;
}

/** Defensa secundaria: variables IA con linkedCapability sin verificar en camino. */
function validateMessageAiCriticalBypass(
  flow: FlowDefinition,
  verifiedAt: Map<string, CapabilitySet>,
  variableCapabilityMap: Map<string, AssertionCapability>,
): FlowValidationError[] {
  const errors: FlowValidationError[] = [];
  const aiProduced = computeAiProducedVariables(flow);

  for (const node of flow.nodes) {
    if (node.type !== "message") continue;
    const role = node.config.messageRole ?? "informational";
    if (role !== "informational") continue;

    const keys = extractInterpolatedVariableKeys(node.config);
    const verified = verifiedAt.get(node.id) ?? new Set();

    for (const key of keys) {
      if (!aiProduced.has(key)) continue;
      if (variableCapabilityMap.has(key)) continue;

      if (CRITICAL_AI_VARIABLE_KEY.test(key)) {
        errors.push(
          flowValidationError(
            FLOW_VALIDATION_CODES.MESSAGE_AI_CRITICAL_UNVERIFIED,
            `Mensaje interpola variable IA crítica "${key}" sin evidencia verificable — posible afirmación externa sin acción`,
            { nodeId: node.id, path: `content=${key}` },
          ),
        );
        continue;
      }

      const linked = variableCapabilityMap.get(key);
      if (linked && !verified.has(linked)) {
        errors.push(
          flowValidationError(
            FLOW_VALIDATION_CODES.MESSAGE_ON_UNVERIFIED,
            `Mensaje interpola "${key}" (${linked}) sin acción verificadora previa`,
            { nodeId: node.id, path: `content=${key}` },
          ),
        );
      }
    }
  }

  return errors;
}

function validateMessageInterpolations(
  flow: FlowDefinition,
  verifiedAt: Map<string, CapabilitySet>,
  variableCapabilityMap: Map<string, AssertionCapability>,
): FlowValidationError[] {
  const errors: FlowValidationError[] = [];
  const aiProduced = computeAiProducedVariables(flow);

  for (const node of flow.nodes) {
    if (node.type !== "message") continue;
    const role = node.config.messageRole ?? "informational";
    const keys = extractInterpolatedVariableKeys(node.config);
    const verified = verifiedAt.get(node.id) ?? new Set();

    for (const key of keys) {
      const cap = variableCapabilityMap.get(key);
      if (cap && !verified.has(cap)) {
        errors.push(
          flowValidationError(
            FLOW_VALIDATION_CODES.MESSAGE_ON_UNVERIFIED,
            `Mensaje interpola "${key}" (${cap}) sin acción verificadora previa en todos los caminos`,
            { nodeId: node.id, path: `content=${key}` },
          ),
        );
      }

      if (role === "external_assertion" && aiProduced.has(key)) {
        const asserts = node.config.asserts ?? [];
        if (asserts.length === 0) {
          errors.push(
            flowValidationError(
              FLOW_VALIDATION_CODES.INVALID_ASSERTION_CONFIG,
              `external_assertion con variable IA "${key}" requiere asserts`,
              { nodeId: node.id },
            ),
          );
        }
      }
    }
  }

  return errors;
}

function validateAiAsSourceOfTruth(flow: FlowDefinition): FlowValidationError[] {
  const errors: FlowValidationError[] = [];
  const variableCapabilityMap = buildLinkedCapabilityMap(flow);

  for (const node of flow.nodes) {
    if (node.type !== "ai") continue;
    for (const key of node.config.outputVariables ?? []) {
      const cap = variableCapabilityMap.get(key);
      if (cap) {
        errors.push(
          flowValidationError(
            FLOW_VALIDATION_CODES.AI_AS_SOURCE_OF_TRUTH,
            `La IA no puede producir variable crítica "${key}" (${cap})`,
            { nodeId: node.id, path: `config.outputVariables=${key}` },
          ),
        );
      }
    }
  }

  return errors;
}

function hasFailureBranch(flow: FlowDefinition, nodeId: string): boolean {
  return outgoingEdges(flow, nodeId).some(
    (e) => e.sourceHandle === FLOW_EDGE_HANDLE.aiFailure,
  );
}

function validateCriticalActions(flow: FlowDefinition): FlowValidationError[] {
  const errors: FlowValidationError[] = [];

  for (const node of flow.nodes) {
    if (node.type !== "action") continue;
    const spec = resolveActionCapabilitySpec(node.config);

    if (spec.criticality === "critical" && spec.requiresFailureBranch !== false) {
      if (!hasFailureBranch(flow, node.id)) {
        errors.push(
          flowValidationError(
            FLOW_VALIDATION_CODES.CRITICAL_ACTION_NO_FAILURE,
            `Acción crítica "${node.config.actionType}" requiere rama failure`,
            { nodeId: node.id },
          ),
        );
      }
    }
  }

  return errors;
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "127.0.0.1" || h === "::1" || h === "[::1]") return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m = ipv4.exec(h);
  if (!m) return false;

  const octets = m.slice(1, 5).map(Number);
  if (octets.some((o) => o > 255)) return true;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

function validateWebhookUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "URL de webhook inválida";
  }

  if (parsed.protocol !== "https:") return "webhook_http debe usar HTTPS";
  if (isPrivateOrLocalHost(parsed.hostname)) {
    return "webhook_http no puede apuntar a localhost o IP privada";
  }
  return null;
}

function validateWebhooks(flow: FlowDefinition): FlowValidationError[] {
  const errors: FlowValidationError[] = [];

  for (const node of flow.nodes) {
    if (node.type !== "action") continue;
    const config = node.config as ActionNodeConfig;
    if (config.actionType !== "webhook_http") continue;

    const urlError = validateWebhookUrl(config.url);
    if (urlError) {
      errors.push(
        flowValidationError(FLOW_VALIDATION_CODES.WEBHOOK_INSECURE, urlError, { nodeId: node.id }),
      );
    }

    if (!config.semanticTag?.trim()) {
      errors.push(
        flowValidationError(
          FLOW_VALIDATION_CODES.WEBHOOK_NOT_ALLOWLISTED,
          "webhook_http requiere semanticTag para publicación",
          { nodeId: node.id },
        ),
      );
      continue;
    }

    if (!isWebhookSemanticTagAllowed(config.semanticTag)) {
      errors.push(
        flowValidationError(
          FLOW_VALIDATION_CODES.WEBHOOK_NOT_ALLOWLISTED,
          `semanticTag "${config.semanticTag}" no está en la allowlist de publicación`,
          { nodeId: node.id },
        ),
      );
    }
  }

  return errors;
}

/** Validación de seguridad empresarial antes de publicar. */
export function validateSecurityRules(flow: FlowDefinition): FlowValidationResult {
  const verifiedAt = computeVerifiedCapabilities(flow);
  const variableCapabilityMap = buildLinkedCapabilityMap(flow);

  const errors: FlowValidationError[] = [
    ...validateWebhooks(flow),
    ...validateCriticalActions(flow),
    ...validateAiAsSourceOfTruth(flow),
    ...validateExternalAssertions(flow, verifiedAt),
    ...validateMessageInterpolations(flow, verifiedAt, variableCapabilityMap),
    ...validateMessageExternalClaims(flow, verifiedAt),
    ...validateMessageAiCriticalBypass(flow, verifiedAt, variableCapabilityMap),
    ...validateConditionCapabilities(flow, verifiedAt, variableCapabilityMap),
  ];

  return failResult(errors);
}
