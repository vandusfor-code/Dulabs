/**
 * Validaciones puras de grafo para FlowDefinition.
 * Sin I/O — usable desde tests, API y flow-engine.
 */

import {
  AUTOMATIC_NODE_TYPES,
  FLOW_EDGE_HANDLE,
  FLOW_VALIDATION_CODES,
  INPUT_WAIT_NODE_TYPES,
} from "@/lib/flow/constants";
import {
  failResult,
  flowValidationError,
  mergeValidationResults,
  type FlowValidationError,
  type FlowValidationResult,
} from "@/lib/flow/errors";
import type { FlowDefinition, FlowEdge } from "@/lib/flow/types";

function edgeKey(edge: Pick<FlowEdge, "source" | "target" | "sourceHandle">): string {
  return `${edge.source}|${edge.sourceHandle ?? ""}|${edge.target}`;
}

function collectVariableKeys(flow: FlowDefinition): Set<string> {
  const keys = new Set(flow.variables.map((v) => v.key));
  for (const node of flow.nodes) {
    if (node.type === "question") keys.add(node.config.variableKey);
    if (node.type === "buttons" && node.config.variableKey) keys.add(node.config.variableKey);
    if (node.type === "ai") {
      for (const k of node.config.outputVariables ?? []) keys.add(k);
    }
  }
  return keys;
}

function validateStructure(flow: FlowDefinition): FlowValidationResult {
  const errors: FlowValidationError[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const edgeKeys = new Set<string>();

  for (const node of flow.nodes) {
    if (!node.id?.trim()) {
      errors.push(
        flowValidationError(FLOW_VALIDATION_CODES.MISSING_NODE_ID, "Nodo sin id", {
          nodeId: node.id,
        }),
      );
      continue;
    }
    if (nodeIds.has(node.id)) {
      errors.push(
        flowValidationError(
          FLOW_VALIDATION_CODES.DUPLICATE_NODE_ID,
          `ID de nodo duplicado: ${node.id}`,
          { nodeId: node.id },
        ),
      );
    }
    nodeIds.add(node.id);
  }

  const nodeById = new Map(flow.nodes.map((n) => [n.id, n]));

  for (const edge of flow.edges) {
    if (edgeIds.has(edge.id)) {
      errors.push(
        flowValidationError(
          FLOW_VALIDATION_CODES.DUPLICATE_EDGE_ID,
          `ID de edge duplicado: ${edge.id}`,
          { edgeId: edge.id },
        ),
      );
    }
    edgeIds.add(edge.id);

    const key = edgeKey(edge);
    if (edgeKeys.has(key)) {
      errors.push(
        flowValidationError(
          FLOW_VALIDATION_CODES.DUPLICATE_EDGE,
          `Edge duplicado: ${edge.source} → ${edge.target} (${edge.sourceHandle ?? "default"})`,
          { edgeId: edge.id },
        ),
      );
    }
    edgeKeys.add(key);

    if (!nodeById.has(edge.source)) {
      errors.push(
        flowValidationError(
          FLOW_VALIDATION_CODES.EDGE_SOURCE_NOT_FOUND,
          `Edge referencia source inexistente: ${edge.source}`,
          { edgeId: edge.id },
        ),
      );
    }
    if (!nodeById.has(edge.target)) {
      errors.push(
        flowValidationError(
          FLOW_VALIDATION_CODES.EDGE_TARGET_NOT_FOUND,
          `Edge referencia target inexistente: ${edge.target}`,
          { edgeId: edge.id },
        ),
      );
    }

    if (edge.source === edge.target) {
      const sourceNode = nodeById.get(edge.source);
      if (sourceNode && !INPUT_WAIT_NODE_TYPES.has(sourceNode.type)) {
        errors.push(
          flowValidationError(
            FLOW_VALIDATION_CODES.INVALID_SELF_LOOP,
            `Self-loop no permitido en nodo ${edge.source} (${sourceNode.type})`,
            { nodeId: edge.source, edgeId: edge.id },
          ),
        );
      }
    }
  }

  const starts = flow.nodes.filter((n) => n.type === "start");
  if (starts.length === 0) {
    errors.push(
      flowValidationError(FLOW_VALIDATION_CODES.MISSING_START_NODE, "El flow debe tener un nodo start"),
    );
  }
  if (starts.length > 1) {
    for (const s of starts) {
      errors.push(
        flowValidationError(
          FLOW_VALIDATION_CODES.MULTIPLE_START_NODES,
          "Solo puede existir un nodo start",
          { nodeId: s.id },
        ),
      );
    }
  }

  return failResult(errors);
}

function outgoingEdges(flow: FlowDefinition, nodeId: string): FlowEdge[] {
  return flow.edges.filter((e) => e.source === nodeId);
}

function reachableFromStart(flow: FlowDefinition): Set<string> {
  const start = flow.nodes.find((n) => n.type === "start");
  if (!start) return new Set();

  const visited = new Set<string>();
  const queue = [start.id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of outgoingEdges(flow, id)) {
      if (!visited.has(edge.target)) queue.push(edge.target);
    }
  }
  return visited;
}

function validateConnectivity(flow: FlowDefinition): FlowValidationResult {
  const errors: FlowValidationError[] = [];
  const reachable = reachableFromStart(flow);
  const start = flow.nodes.find((n) => n.type === "start");

  if (start && !reachable.has(start.id)) {
    errors.push(
      flowValidationError(FLOW_VALIDATION_CODES.DISCONNECTED_NODE, "Nodo start inalcanzable", {
        nodeId: start.id,
      }),
    );
  }

  for (const node of flow.nodes) {
    if (node.type === "start") continue;
    if (!reachable.has(node.id)) {
      errors.push(
        flowValidationError(
          FLOW_VALIDATION_CODES.DISCONNECTED_NODE,
          `Nodo desconectado del start: ${node.id}`,
          { nodeId: node.id },
        ),
      );
    }
  }

  return failResult(errors);
}

function findDangerousCycles(flow: FlowDefinition): FlowValidationError[] {
  const errors: FlowValidationError[] = [];
  const nodeById = new Map(flow.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const node of flow.nodes) adj.set(node.id, []);
  for (const edge of flow.edges) {
    adj.get(edge.source)?.push(edge.target);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  const dfs = (nodeId: string): boolean => {
    visited.add(nodeId);
    stack.add(nodeId);
    path.push(nodeId);

    for (const next of adj.get(nodeId) ?? []) {
      if (!visited.has(next)) {
        if (dfs(next)) return true;
      } else if (stack.has(next)) {
        const cycleStart = path.indexOf(next);
        const cycle = path.slice(cycleStart).concat(next);
        const hasInputWait = cycle.some((id) => {
          const n = nodeById.get(id);
          return n && INPUT_WAIT_NODE_TYPES.has(n.type);
        });
        const allAutomatic = cycle.every((id) => {
          const n = nodeById.get(id);
          return n && AUTOMATIC_NODE_TYPES.has(n.type);
        });
        if (allAutomatic || !hasInputWait) {
          errors.push(
            flowValidationError(
              FLOW_VALIDATION_CODES.DANGEROUS_CYCLE,
              `Ciclo peligroso detectado: ${cycle.join(" → ")}. ` +
                "Los ciclos deben incluir al menos un nodo que espere input (question, buttons, ai).",
              { nodeId: next },
            ),
          );
          return true;
        }
      }
    }

    path.pop();
    stack.delete(nodeId);
    return false;
  };

  for (const node of flow.nodes) {
    if (!visited.has(node.id)) dfs(node.id);
  }

  return errors;
}

function validateNodeBranches(flow: FlowDefinition): FlowValidationResult {
  const errors: FlowValidationError[] = [];

  for (const node of flow.nodes) {
    const out = outgoingEdges(flow, node.id);

    if (node.type === "buttons") {
      const buttonIds = new Set(node.config.buttons.map((b) => b.id));
      if (buttonIds.size !== node.config.buttons.length) {
        errors.push(
          flowValidationError(
            FLOW_VALIDATION_CODES.INVALID_NODE_CONFIG,
            "IDs de botones duplicados en el mismo nodo",
            { nodeId: node.id },
          ),
        );
      }
      for (const button of node.config.buttons) {
        const handle = FLOW_EDGE_HANDLE.button(button.id);
        const hasEdge = out.some((e) => e.sourceHandle === handle);
        if (!hasEdge) {
          errors.push(
            flowValidationError(
              FLOW_VALIDATION_CODES.BUTTON_MISSING_EDGE,
              `Botón "${button.label}" (${button.id}) sin edge de salida (${handle})`,
              { nodeId: node.id },
            ),
          );
        }
      }
    }

    if (node.type === "condition") {
      const hasTrue = out.some((e) => e.sourceHandle === FLOW_EDGE_HANDLE.conditionTrue);
      const hasFalse = out.some((e) => e.sourceHandle === FLOW_EDGE_HANDLE.conditionFalse);
      if (!hasTrue || !hasFalse) {
        errors.push(
          flowValidationError(
            FLOW_VALIDATION_CODES.CONDITION_MISSING_BRANCH,
            "Nodo condition requiere edges true y false",
            { nodeId: node.id },
          ),
        );
      }
    }

    if (node.type === "ai" && node.config.mode === "classify") {
      const classes = node.config.classifications ?? [];
      if (classes.length === 0) {
        errors.push(
          flowValidationError(
            FLOW_VALIDATION_CODES.INVALID_NODE_CONFIG,
            "Nodo ai en modo classify requiere classifications",
            { nodeId: node.id },
          ),
        );
      }
      for (const cls of classes) {
        const handle = FLOW_EDGE_HANDLE.aiClass(cls);
        const hasEdge = out.some((e) => e.sourceHandle === handle);
        if (!hasEdge) {
          errors.push(
            flowValidationError(
              FLOW_VALIDATION_CODES.AI_MISSING_BRANCH,
              `Clasificación "${cls}" sin edge (${handle})`,
              { nodeId: node.id },
            ),
          );
        }
      }
    }

    if (node.type === "end" && out.length > 0) {
      errors.push(
        flowValidationError(
          FLOW_VALIDATION_CODES.INVALID_NODE_CONFIG,
          "Nodo end no debe tener edges salientes",
          { nodeId: node.id },
        ),
      );
    }

    if (node.type === "start" && node.config.triggerType === "keyword") {
      if (!node.config.keywords?.length) {
        errors.push(
          flowValidationError(
            FLOW_VALIDATION_CODES.INVALID_NODE_CONFIG,
            "Start con trigger keyword requiere keywords",
            { nodeId: node.id },
          ),
        );
      }
    }
  }

  return failResult(errors);
}

function validateVariables(flow: FlowDefinition): FlowValidationResult {
  const errors: FlowValidationError[] = [];
  const known = collectVariableKeys(flow);

  for (const node of flow.nodes) {
    if (node.type === "condition") {
      for (const rule of node.config.rules) {
        if (!known.has(rule.field)) {
          errors.push(
            flowValidationError(
              FLOW_VALIDATION_CODES.UNDEFINED_VARIABLE,
              `Variable no declarada en condición: ${rule.field}`,
              { nodeId: node.id, path: `config.rules.field=${rule.field}` },
            ),
          );
        }
      }
    }
    if (node.type === "save_data") {
      for (const mapping of node.config.mappings) {
        if (!known.has(mapping.variable)) {
          errors.push(
            flowValidationError(
              FLOW_VALIDATION_CODES.UNDEFINED_VARIABLE,
              `Variable no declarada en save_data: ${mapping.variable}`,
              { nodeId: node.id },
            ),
          );
        }
      }
    }
  }

  for (const v of flow.variables) {
    if (v.required && v.defaultValue === undefined) {
      const producer = flow.nodes.some(
        (n) =>
          (n.type === "question" && n.config.variableKey === v.key) ||
          (n.type === "buttons" && n.config.variableKey === v.key) ||
          (n.type === "ai" && (n.config.outputVariables ?? []).includes(v.key)),
      );
      if (!producer) {
        errors.push(
          flowValidationError(
            FLOW_VALIDATION_CODES.UNDEFINED_VARIABLE,
            `Variable requerida "${v.key}" no tiene nodo productor en el grafo`,
            { path: `variables.${v.key}` },
          ),
        );
      }
    }
  }

  return failResult(errors);
}

function hasPathToEnd(flow: FlowDefinition): boolean {
  const endIds = new Set(flow.nodes.filter((n) => n.type === "end").map((n) => n.id));
  if (endIds.size === 0) return false;

  const reachable = reachableFromStart(flow);
  const canReachEnd = new Set<string>();

  const reverseAdj = new Map<string, string[]>();
  for (const node of flow.nodes) reverseAdj.set(node.id, []);
  for (const edge of flow.edges) {
    reverseAdj.get(edge.target)?.push(edge.source);
  }

  const queue = [...endIds].filter((id) => reachable.has(id));
  for (const id of queue) canReachEnd.add(id);

  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const prev of reverseAdj.get(id) ?? []) {
      if (reachable.has(prev) && !canReachEnd.has(prev)) {
        canReachEnd.add(prev);
        queue.push(prev);
      }
    }
  }

  const start = flow.nodes.find((n) => n.type === "start");
  return start ? canReachEnd.has(start.id) : false;
}

/** Validación estructural del grafo (draft o publish). */
export function validateFlowGraph(flow: FlowDefinition): FlowValidationResult {
  return mergeValidationResults(
    validateStructure(flow),
    validateConnectivity(flow),
    validateNodeBranches(flow),
    validateVariables(flow),
    failResult(findDangerousCycles(flow)),
  );
}

/** Reglas adicionales para publicación. */
export function validateFlowPublishRules(flow: FlowDefinition): FlowValidationResult {
  const errors: FlowValidationError[] = [];

  const ends = flow.nodes.filter((n) => n.type === "end");
  if (ends.length === 0) {
    errors.push(
      flowValidationError(
        FLOW_VALIDATION_CODES.MISSING_END_NODE,
        "Un flow publicable debe tener al menos un nodo end",
      ),
    );
  }

  if (!hasPathToEnd(flow)) {
    errors.push(
      flowValidationError(
        FLOW_VALIDATION_CODES.NO_PATH_TO_END,
        "No existe camino desde start hasta un nodo end",
      ),
    );
  }

  return failResult(errors);
}

export function validateFlowDefinition(flow: FlowDefinition): FlowValidationResult {
  return validateFlowGraph(flow);
}
