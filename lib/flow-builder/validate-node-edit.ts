/**
 * Etapa 2 (Flow Builder, autorizado) — valida un nodo editado usando
 * EXCLUSIVAMENTE el schema Zod ya existente (flowNodeSchema, el mismo que
 * usa validateFlowForPublish por debajo). No se inventa ninguna regla
 * paralela: si el schema del runtime cambia, esta validación cambia con él.
 */

import { flowNodeSchema } from "@/lib/flow/schemas";
import type { FlowNode } from "@/lib/flow/types";

export interface NodeFieldError {
  /** Ruta Zod dentro del nodo, ej. "config.text" o "config.buttons.0.label". */
  path: string;
  message: string;
}

export function validateNodeEdit(node: FlowNode): NodeFieldError[] {
  const result = flowNodeSchema.safeParse(node);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/** true si algún error aplica a ese campo exacto o a un hijo suyo (ej. "config" cubre "config.text"). */
export function errorsForPath(errors: NodeFieldError[], path: string): NodeFieldError[] {
  return errors.filter((e) => e.path === path || e.path.startsWith(`${path}.`));
}
