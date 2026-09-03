/**
 * Professional Flow Editor UX (autorizado) — búsqueda de nodos dentro de un
 * FlowDefinition. Puro, sin React, sin acoplarse a @xyflow/react. Busca en
 * id, label, tipo (en español, igual que lo ve el usuario en la paleta) y en
 * la config completa del nodo -- cubre "texto de mensaje", "identificador"
 * y "contenido relevante" sin necesitar una función de extracción distinta
 * por cada uno de los 10 tipos de nodo.
 */

import type { FlowDefinition, FlowNode } from "@/lib/flow/types";
import { NODE_TYPE_LABEL } from "@/lib/flow-builder/node-factory";

function searchableText(node: FlowNode): string {
  return [node.id, node.label ?? "", NODE_TYPE_LABEL[node.type], JSON.stringify(node.config)].join(" ").toLowerCase();
}

/** Coincidencias en orden estable (el mismo orden que flow.nodes) -- cadena vacía o solo espacios devuelve []. */
export function searchNodes(flow: FlowDefinition, query: string): FlowNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return flow.nodes.filter((n) => searchableText(n).includes(q));
}
