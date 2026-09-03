/**
 * Etapa 3 (Flow Builder, autorizado) — decide si una conexión que el usuario
 * intenta crear en el canvas es válida. Reutiliza sourceHandlesForNode del
 * canvas-adapter (misma fuente que ya usa FlowNodeCard para dibujar los
 * Handle reales) -- nunca inventa un sourceHandle por su cuenta.
 *
 * Deliberadamente NO reimplementa nada del validador de servidor
 * (validate-graph.ts): nada de ciclos peligrosos, ramas obligatorias,
 * variables no declaradas ni alcanzabilidad. Solo lo mínimo para no dejar
 * crear en el canvas algo que ni siquiera tiene sentido estructural --
 * sourceHandle inexistente, nodos que no existen, edge duplicado. Esa es
 * la única superposición intencional con validate-graph.ts (que también
 * detecta duplicados como red de seguridad del lado servidor).
 */

import type { FlowDefinition, FlowNode } from "@/lib/flow/types";
import { sourceHandlesForNode } from "@/lib/flow-builder/canvas-adapter";

export interface ConnectionLike {
  source: string;
  target: string;
  sourceHandle?: string | null;
}

/** Mismo criterio de "misma conexión" que edgeKey en lib/flow/validate-graph.ts (no exportada; formato trivial, sin lógica que duplicar de verdad). */
function connectionKey(source: string, sourceHandle: string | null | undefined, target: string): string {
  return `${source}|${sourceHandle ?? ""}|${target}`;
}

/**
 * true si la conexión es estructuralmente aceptable:
 * - source y target existen como nodos del flow,
 * - el sourceHandle es uno real de ese nodo (o ausente, para nodos de salida
 *   única), nunca inventado,
 * - un nodo `end` nunca es origen (sourceHandlesForNode ya le da [] y esta
 *   función lo hace explícito),
 * - no duplica un edge ya existente (mismo source+sourceHandle+target).
 */
export function isValidConnection(flow: FlowDefinition, connection: ConnectionLike): boolean {
  const { source, target, sourceHandle } = connection;
  if (!source || !target) return false;

  const sourceNode = flow.nodes.find((n) => n.id === source);
  const targetNode = flow.nodes.find((n) => n.id === target);
  if (!sourceNode || !targetNode) return false;

  if (sourceNode.type === "end") return false;

  const handles = sourceHandlesForNode(sourceNode);
  if (handles.length > 0) {
    if (!sourceHandle || !handles.some((h) => h.id === sourceHandle)) return false;
  } else if (sourceHandle) {
    // nodo de salida única/implícita: no debe traer un sourceHandle con nombre
    return false;
  }

  const key = connectionKey(source, sourceHandle, target);
  const duplicate = flow.edges.some((e) => connectionKey(e.source, e.sourceHandle, e.target) === key);
  if (duplicate) return false;

  return true;
}

/** Handles declarados por el nodo que todavía no tienen ningún edge saliente -- ayuda visual, no reemplaza al validador de servidor. */
export function orphanHandles(node: FlowNode, flow: FlowDefinition) {
  const handles = sourceHandlesForNode(node);
  if (handles.length === 0) return [];
  const connected = new Set(flow.edges.filter((e) => e.source === node.id).map((e) => e.sourceHandle));
  return handles.filter((h) => !connected.has(h.id));
}

export interface OrphanHandleWarning {
  nodeId: string;
  handleId: string;
  handleLabel: string;
}

/**
 * Professional Flow Editor UX (autorizado) — mismo orphanHandles de arriba,
 * pero para TODO el flow en vez de un nodo a la vez (ya lo usaba
 * FlowInfoPanel solo para el nodo seleccionado). Sirve para el panel de
 * validación (sección "Warnings"): son avisos estructurales del propio
 * Builder, nunca bloqueantes -- distintos de los FlowValidationError[] reales
 * que devuelve el servidor (esos sí pueden bloquear publicar). No se agrega
 * ningún campo de severidad al validador del Flow Engine para lograr esto.
 */
export function allOrphanHandles(flow: FlowDefinition): OrphanHandleWarning[] {
  return flow.nodes.flatMap((node) =>
    orphanHandles(node, flow).map((handle) => ({ nodeId: node.id, handleId: handle.id, handleLabel: handle.label })),
  );
}
