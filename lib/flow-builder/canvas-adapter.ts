/**
 * Etapa 0 (spike del Flow Builder, autorizado) — capa de traducción PURA
 * entre FlowDefinition y el modelo de nodos/edges de @xyflow/react.
 *
 * No duplica ninguna regla de flow-engine.ts ni de validate-security.ts: los
 * handles se derivan de la MISMA convención de lib/flow/constants.ts que ya
 * usa el motor, nunca se inventan. No es un editor -- no valida, no muta
 * config, no decide transiciones.
 */

import type { Edge, Node } from "@xyflow/react";
import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import type { FlowDefinition, FlowNode, FlowNodeType, NodePosition } from "@/lib/flow/types";

export interface CanvasHandle {
  id: string;
  label: string;
}

export interface CanvasNodeData extends Record<string, unknown> {
  nodeType: FlowNodeType;
  nodeId: string;
  label: string;
  summary: string;
  sourceHandles: CanvasHandle[];
  hasTargetHandle: boolean;
}

export type CanvasNode = Node<CanvasNodeData>;
export type CanvasEdge = Edge;

const FALLBACK_COLUMNS = 5;
const FALLBACK_COLUMN_WIDTH = 260;
const FALLBACK_ROW_HEIGHT = 170;

/**
 * Posición determinística de respaldo, únicamente para el canvas del spike.
 * Nunca escribe en el FlowDefinition original -- ver applyCanvasPositions
 * para el único punto donde position se persiste de vuelta.
 */
function fallbackPosition(index: number): NodePosition {
  return {
    x: (index % FALLBACK_COLUMNS) * FALLBACK_COLUMN_WIDTH,
    y: Math.floor(index / FALLBACK_COLUMNS) * FALLBACK_ROW_HEIGHT,
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Handles de salida por tipo de nodo. Refleja EXACTAMENTE las convenciones
 * de sourceHandle de lib/flow/constants.ts -- buttons/condition/ai-classify
 * se derivan de la config real del nodo (número de botones, clasificaciones
 * declaradas); ai (no-classify) y action usan el par fijo success/failure
 * del modelo; el resto no declara sourceHandle en ningún FlowEdge real, así
 * que usan el handle único implícito de React Flow (sin id).
 */
export function sourceHandlesForNode(node: FlowNode): CanvasHandle[] {
  switch (node.type) {
    case "buttons": {
      const handles: CanvasHandle[] = node.config.buttons.map((btn) => ({
        id: FLOW_EDGE_HANDLE.button(btn.id),
        label: btn.label,
      }));
      handles.push({ id: FLOW_EDGE_HANDLE.text, label: "texto libre" });
      return handles;
    }
    case "condition":
      return [
        { id: FLOW_EDGE_HANDLE.conditionTrue, label: "true" },
        { id: FLOW_EDGE_HANDLE.conditionFalse, label: "false" },
      ];
    case "ai": {
      if (node.config.mode === "classify") {
        const handles: CanvasHandle[] = (node.config.classifications ?? []).map((value) => ({
          id: FLOW_EDGE_HANDLE.aiClass(value),
          label: value,
        }));
        handles.push({ id: FLOW_EDGE_HANDLE.aiDefault, label: "default" });
        return handles;
      }
      return [
        { id: FLOW_EDGE_HANDLE.aiSuccess, label: "success" },
        { id: FLOW_EDGE_HANDLE.aiFailure, label: "failure" },
      ];
    }
    case "action":
      return [
        { id: FLOW_EDGE_HANDLE.aiSuccess, label: "success" },
        { id: FLOW_EDGE_HANDLE.aiFailure, label: "failure" },
      ];
    case "end":
      return [];
    case "start":
    case "message":
    case "question":
    case "save_data":
    case "human":
      return [];
  }
}

function summaryForNode(node: FlowNode): string {
  switch (node.type) {
    case "start":
      return `trigger: ${node.config.triggerType}`;
    case "message":
      if (node.config.text) return truncate(node.config.text, 60);
      if (node.config.parts) return `${node.config.parts.length} parte(s)`;
      if (node.config.template) return "plantilla";
      if (node.config.media) return `media: ${node.config.media.type}`;
      return "(sin contenido)";
    case "question":
      return `${truncate(node.config.text, 40)} → {{${node.config.variableKey}}}`;
    case "buttons":
      return `${node.config.buttons.length} botón(es)`;
    case "condition":
      return `${node.config.rules.length} regla(s) · match=${node.config.match}`;
    case "ai":
      return `${node.config.mode} · ${truncate(node.config.instruction, 40)}`;
    case "save_data":
      return `${node.config.mappings.length} mapeo(s)`;
    case "action":
      return `actionType: ${node.config.actionType}`;
    case "human":
      return `pausa ${node.config.pauseDurationHours}h${node.config.assignTo ? ` → ${node.config.assignTo}` : ""}`;
    case "end":
      return node.config.tags?.length ? `tags: ${node.config.tags.join(", ")}` : "(fin)";
  }
}

/** FlowDefinition -> nodos/edges de React Flow. Función pura, sin efectos. */
export function flowDefinitionToCanvas(flow: FlowDefinition): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = flow.nodes.map((node, index) => ({
    id: node.id,
    type: "flowNode",
    position: node.position ?? fallbackPosition(index),
    data: {
      nodeType: node.type,
      nodeId: node.id,
      label: node.label ?? node.id,
      summary: summaryForNode(node),
      sourceHandles: sourceHandlesForNode(node),
      hasTargetHandle: node.type !== "start",
    },
  }));

  const edges: CanvasEdge[] = flow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    label: edge.sourceHandle,
    type: "smoothstep",
  }));

  return { nodes, edges };
}

/**
 * Aplica posiciones actualizadas del canvas de vuelta al FlowDefinition
 * original -- únicamente `position`, nunca toca config/edges/variables. No
 * es un editor: existe para no perder el layout si el spike mueve tarjetas.
 *
 * Professional Flow Editor UX (autorizado) — el parámetro se ensanchó de
 * `CanvasNode[]` a `{id, position}[]` (todo lo que esta función realmente
 * lee) para poder reutilizarla también en el drag-stop de selección
 * múltiple del Builder (donde React Flow entrega sus propios `Node[]`, que
 * ya cumplen esta forma) sin necesitar una segunda función casi idéntica.
 */
export function applyCanvasPositions(
  flow: FlowDefinition,
  nodes: readonly { id: string; position: NodePosition }[],
): FlowDefinition {
  const positionById = new Map(nodes.map((n) => [n.id, n.position]));
  return {
    ...flow,
    nodes: flow.nodes.map((node) => {
      const position = positionById.get(node.id);
      return position ? { ...node, position } : node;
    }),
  };
}
