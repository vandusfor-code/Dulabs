/**
 * Professional Flow Editor UX (autorizado) — copiar/pegar/duplicar nodos.
 *
 * Formato interno serializable (ClipboardPayload), NO el portapapeles del
 * sistema operativo: evita permisos async del navegador y mantiene la
 * estructura bajo control propio (decisión explícita, ver informe de fase).
 * Puro: nunca muta `flow` ni los nodos originales -- cada función devuelve
 * un FlowDefinition nuevo.
 *
 * Reutiliza generateNodeId/generateEdgeId de node-factory.ts para los IDs
 * nuevos -- nunca reinventa generación de ids ni reutiliza uno original
 * (requisito explícito: "nunca confiar en IDs externos").
 *
 * El nodo `start` se excluye siempre de copiar/duplicar: un FlowDefinition
 * solo admite uno (ver MULTIPLE_START_NODES en lib/flow/validate-graph.ts)
 * y pegar/duplicar uno nuevo garantizadamente lo rompería -- se evita en la
 * fuente en vez de dejar que el usuario choque con un error de validación.
 */

import type { FlowDefinition, FlowEdge, FlowNode, NodePosition } from "@/lib/flow/types";
import { generateEdgeId, generateNodeId } from "@/lib/flow-builder/node-factory";

export interface ClipboardPayload {
  nodes: FlowNode[];
  /** Solo edges INTERNOS a los nodos copiados (ambos extremos dentro de la selección) -- nunca uno que apunte afuera. */
  edges: FlowEdge[];
  metadata: {
    sourceFlowId?: string;
    copiedAt: string;
  };
}

const DEFAULT_PASTE_OFFSET: NodePosition = { x: 48, y: 48 };

function copiableNodeIds(flow: FlowDefinition, nodeIds: ReadonlySet<string>): Set<string> {
  return new Set(flow.nodes.filter((n) => nodeIds.has(n.id) && n.type !== "start").map((n) => n.id));
}

/** Extrae una selección de nodos + sus edges internos como un payload independiente de `flow`. Nunca muta `flow`. */
export function copySelection(
  flow: FlowDefinition,
  nodeIds: ReadonlySet<string>,
  sourceFlowId?: string,
): ClipboardPayload {
  const ids = copiableNodeIds(flow, nodeIds);
  const nodes = flow.nodes.filter((n) => ids.has(n.id));
  const edges = flow.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  return { nodes, edges, metadata: { sourceFlowId, copiedAt: new Date().toISOString() } };
}

/**
 * Inserta `payload` en `flow` con IDs completamente nuevos (nodos y edges) y
 * las posiciones desplazadas por `offset` -- nunca reutiliza un id del
 * payload, nunca superpone visualmente el resultado sobre el original.
 * Devuelve también `newNodeIds` para que el caller pueda seleccionar
 * inmediatamente lo recién pegado.
 */
export function pasteIntoFlow(
  flow: FlowDefinition,
  payload: ClipboardPayload,
  offset: NodePosition = DEFAULT_PASTE_OFFSET,
): { flow: FlowDefinition; newNodeIds: string[] } {
  if (payload.nodes.length === 0) return { flow, newNodeIds: [] };

  const existingNodeIds = new Set(flow.nodes.map((n) => n.id));
  const idMap = new Map<string, string>();
  for (const node of payload.nodes) {
    const newId = generateNodeId(existingNodeIds);
    existingNodeIds.add(newId);
    idMap.set(node.id, newId);
  }

  const newNodes: FlowNode[] = payload.nodes.map(
    (node) =>
      ({
        ...node,
        id: idMap.get(node.id)!,
        position: { x: (node.position?.x ?? 0) + offset.x, y: (node.position?.y ?? 0) + offset.y },
      }) as FlowNode,
  );

  const existingEdgeIds = new Set(flow.edges.map((e) => e.id));
  const newEdges: FlowEdge[] = payload.edges.map((edge) => {
    const newId = generateEdgeId(existingEdgeIds);
    existingEdgeIds.add(newId);
    return { ...edge, id: newId, source: idMap.get(edge.source)!, target: idMap.get(edge.target)! };
  });

  return {
    flow: { ...flow, nodes: [...flow.nodes, ...newNodes], edges: [...flow.edges, ...newEdges] },
    newNodeIds: newNodes.map((n) => n.id),
  };
}

/** Duplicar = copiar + pegar en el mismo flow, en un solo paso. Mismas garantías que ambas por separado. */
export function duplicateSelection(
  flow: FlowDefinition,
  nodeIds: ReadonlySet<string>,
  offset: NodePosition = DEFAULT_PASTE_OFFSET,
): { flow: FlowDefinition; newNodeIds: string[] } {
  const payload = copySelection(flow, nodeIds);
  return pasteIntoFlow(flow, payload, offset);
}
