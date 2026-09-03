/**
 * Etapa 2 (Flow Builder, autorizado) — actualizaciones PURAS de un
 * FlowDefinition local. FlowDefinition sigue siendo la única fuente de
 * verdad; estas funciones nunca mutan el objeto recibido y nunca tocan
 * `id`/`type` de un nodo ni el arreglo `edges` -- eso es justamente lo que
 * garantiza que editar propiedades no pueda romper la estructura del grafo.
 *
 * Etapa 3 (autorizado) agrega addNode/deleteNode/addEdge/deleteEdge -- las
 * únicas funciones de este archivo que SÍ tocan la estructura del grafo
 * (agregar/quitar nodos y edges). Siguen siendo puras y deliberadamente
 * "tontas": no generan ids (eso es lib/flow-builder/node-factory.ts) ni
 * deciden si una conexión es válida (eso es lib/flow-builder/connection-rules.ts)
 * -- cada función hace una sola cosa, igual que el resto del archivo.
 */

import type { FlowDefinition, FlowEdge, FlowNode, NodePosition } from "@/lib/flow/types";

export function updateNodeLabel(flow: FlowDefinition, nodeId: string, label: string): FlowDefinition {
  return {
    ...flow,
    nodes: flow.nodes.map((n) => (n.id === nodeId ? { ...n, label } : n)),
  };
}

/**
 * Reemplaza `config` de un nodo. El caller (el panel de propiedades, que ya
 * narrowed `node.type` antes de llamar) es responsable de construir un
 * config con la forma correcta para ESE tipo -- por eso esta función es
 * deliberadamente genérica (el mismo mecanismo sirve para los 10 tipos) en
 * vez de tener 10 funciones casi idénticas. El cast es un límite acotado a
 * esta línea: la seguridad de tipos real ocurre en el call site.
 */
export function updateNodeConfig(flow: FlowDefinition, nodeId: string, config: FlowNode["config"]): FlowDefinition {
  return {
    ...flow,
    nodes: flow.nodes.map((n) => (n.id === nodeId ? ({ ...n, config } as FlowNode) : n)),
  };
}

/** Usado al soltar un nodo arrastrado -- nunca toca config ni edges. */
export function updateNodePosition(flow: FlowDefinition, nodeId: string, position: NodePosition): FlowDefinition {
  return {
    ...flow,
    nodes: flow.nodes.map((n) => (n.id === nodeId ? { ...n, position } : n)),
  };
}

/** Agrega un nodo ya construido (ver createDefaultNode en node-factory.ts) -- no genera id, no valida. */
export function addNode(flow: FlowDefinition, node: FlowNode): FlowDefinition {
  return { ...flow, nodes: [...flow.nodes, node] };
}

/**
 * Elimina un nodo y TODOS los edges donde participa, como source o como
 * target -- nunca deja una referencia colgante (lo que validate-graph.ts
 * reportaría como EDGE_SOURCE_NOT_FOUND/EDGE_TARGET_NOT_FOUND).
 */
export function deleteNode(flow: FlowDefinition, nodeId: string): FlowDefinition {
  return deleteNodes(flow, [nodeId]);
}

/**
 * Professional Flow Editor UX (autorizado) — versión en LOTE de deleteNode,
 * para selección múltiple. Un solo recorrido de `nodes`/`edges` (O(n)) en
 * vez de un `deleteNode` por id (O(n) cada uno, O(n·k) en total) -- importa
 * para flows grandes (cientos/miles de nodos), y además dp que borrar 5
 * nodos sea UNA sola edición (un solo paso de undo), no cinco.
 */
export function deleteNodes(flow: FlowDefinition, nodeIds: readonly string[]): FlowDefinition {
  if (nodeIds.length === 0) return flow;
  const toDelete = new Set(nodeIds);
  return {
    ...flow,
    nodes: flow.nodes.filter((n) => !toDelete.has(n.id)),
    edges: flow.edges.filter((e) => !toDelete.has(e.source) && !toDelete.has(e.target)),
  };
}

/** Agrega un edge ya construido (ver generateEdgeId en node-factory.ts) -- no valida si la conexión tiene sentido, eso es connection-rules.ts. */
export function addEdge(flow: FlowDefinition, edge: FlowEdge): FlowDefinition {
  return { ...flow, edges: [...flow.edges, edge] };
}

/** Elimina un edge por id -- nunca toca nodos. */
export function deleteEdge(flow: FlowDefinition, edgeId: string): FlowDefinition {
  return deleteEdges(flow, [edgeId]);
}

/** Versión en LOTE de deleteEdge -- mismo motivo que deleteNodes (rendimiento + un solo paso de undo). */
export function deleteEdges(flow: FlowDefinition, edgeIds: readonly string[]): FlowDefinition {
  if (edgeIds.length === 0) return flow;
  const toDelete = new Set(edgeIds);
  return { ...flow, edges: flow.edges.filter((e) => !toDelete.has(e.id)) };
}
