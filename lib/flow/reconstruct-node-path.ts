/**
 * Reconstrucción de camino por topología de grafo — módulo puro compartido
 * (Fase 1: Flow Simulator, Fase 2: Execution Inspector, ambos autorizados).
 *
 * Problema que resuelve: ni `runFlowEngine` (motor puro, lib/flow/flow-engine.ts)
 * ni `dulabs_flow_node_transitions` (auditoría real de producción,
 * lib/flow/flow-orchestrator.ts) exponen el camino NODO POR NODO cuando una
 * cadena de nodos automáticos/silenciosos (`start`/`message`/`condition`/
 * `save_data`, que nunca producen su propio efecto ni pausan la ejecución)
 * se atraviesa dentro de un mismo turno -- ambos solo dan el punto de
 * partida y el punto de llegada observables (ver flow-orchestrator.ts:590-600,
 * que registra UNA sola fila `from_node_id`/`to_node_id` por invocación,
 * nunca una por nodo intermedio, y nunca pasa `source_handle`).
 *
 * Esta función NUNCA reevalúa una condición ni reimplementa
 * `evaluateCondition`/`evaluateRule` (privadas, intencionalmente no
 * exportadas de flow-engine.ts) -- solo usa datos ya disponibles del propio
 * `FlowDefinition` (`flow.edges`) para buscar, por fuerza bruta acotada,
 * cuál camino de nodos silenciosos conecta dos puntos YA CONOCIDOS con
 * certeza (observados en un efecto real o en una fila de auditoría real).
 * Cuando el camino es único, la rama de cada `condition` intermedio se
 * DEDUCE de cuál edge (true/false) landea en el camino encontrado -- nunca
 * de evaluar la regla. Cuando hay más de un camino posible (grafo ambiguo),
 * se marca `ambiguous: true` en vez de adivinar.
 */

import type { FlowDefinition, FlowNode, FlowNodeType } from "@/lib/flow/types";

/** Nodos que el Engine real procesa sin pausar ni emitir su propio efecto (ver flow-engine.ts::processAutomaticNode). */
export const SILENT_NODE_TYPES: ReadonlySet<FlowNodeType> = new Set(["start", "message", "condition", "save_data"]);

export interface PathHop {
  fromNodeId: string;
  toNodeId: string;
  nodeType: FlowNodeType;
  /** sourceHandle del edge tomado ("true"/"false"/"button:x"/"class:x"/"success"/"failure"/undefined = default). */
  sourceHandle?: string;
}

export interface ReconstructedPath {
  hops: PathHop[];
  /** true si había más de un camino posible entre los dos puntos y no se pudo determinar cuál se usó -- nunca se adivina. */
  ambiguous: boolean;
}

/**
 * Busca el/los camino(s) de nodos SILENCIOSOS que conectan `fromNodeId` con
 * `toNodeId`. Acotado (profundidad y cantidad de resultados) porque los
 * grafos de un Flow Builder son pequeños por diseño -- nunca un análisis de
 * grafo genérico sin límites.
 */
export function reconstructNodePath(
  flow: FlowDefinition,
  nodeById: Map<string, FlowNode>,
  fromNodeId: string,
  toNodeId: string,
): ReconstructedPath {
  if (fromNodeId === toNodeId) return { hops: [], ambiguous: false };

  const MAX_DEPTH = 30;
  const MAX_RESULTS = 6;
  const results: PathHop[][] = [];

  function dfs(currentId: string, path: PathHop[], visited: Set<string>): void {
    if (results.length >= MAX_RESULTS || path.length > MAX_DEPTH) return;
    const edges = flow.edges.filter((e) => e.source === currentId);
    for (const edge of edges) {
      if (visited.has(edge.target)) continue;
      const targetNode = nodeById.get(edge.target);
      if (!targetNode) continue;
      const hop: PathHop = {
        fromNodeId: currentId,
        toNodeId: edge.target,
        nodeType: targetNode.type,
        sourceHandle: edge.sourceHandle,
      };
      if (edge.target === toNodeId) {
        results.push([...path, hop]);
        continue;
      }
      if (SILENT_NODE_TYPES.has(targetNode.type)) {
        dfs(edge.target, [...path, hop], new Set([...visited, edge.target]));
      }
    }
  }

  dfs(fromNodeId, [], new Set([fromNodeId]));

  if (results.length === 1) {
    return { hops: results[0]!, ambiguous: false };
  }

  // 0 resultados (no debería pasar si el punto de llegada es real, pero el
  // grafo pudo cambiar entre la ejecución real y la versión que se está
  // inspeccionando) o más de uno (ambiguo): nunca se inventa cuál fue --
  // se reporta un único salto directo marcado.
  const targetNode = nodeById.get(toNodeId);
  return {
    hops: [{ fromNodeId, toNodeId, nodeType: targetNode?.type ?? "message" }],
    ambiguous: true,
  };
}
