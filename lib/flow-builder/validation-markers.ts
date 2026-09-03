/**
 * Etapa 4 (Flow Builder, autorizado) — agrupa FlowValidationError[] (la
 * respuesta cruda de POST /api/flows/[id]/validate, sin tocar) por nodeId /
 * edgeId / global. Funciones puras, sin I/O.
 *
 * Deliberadamente NO interpreta ningún `code` ni reimplementa ninguna regla
 * de validate-graph.ts/validate-security.ts/validate-publish.ts -- solo
 * pregunta "¿este error trae nodeId?" / "¿trae edgeId?" / "¿no trae
 * ninguno?". Tampoco intenta inferir un nodeId a partir de `path` (ej. los
 * SCHEMA_INVALID de Zod, que solo traen `path` como "nodes.3.config.text",
 * nunca nodeId) -- esos quedan como error global a propósito (decisión
 * aprobada de la auditoría de Etapa 4): parsear ese path acoplaría el
 * Builder al formato interno del validador.
 */

import type { FlowValidationError } from "@/lib/flow/errors";

export function errorsForNode(errors: FlowValidationError[], nodeId: string): FlowValidationError[] {
  return errors.filter((e) => e.nodeId === nodeId);
}

export function errorsForEdge(errors: FlowValidationError[], edgeId: string): FlowValidationError[] {
  return errors.filter((e) => e.edgeId === edgeId);
}

/** Errores sin nodeId NI edgeId -- no hay dónde marcarlos en el canvas, van en un panel aparte. */
export function globalErrors(errors: FlowValidationError[]): FlowValidationError[] {
  return errors.filter((e) => e.nodeId === undefined && e.edgeId === undefined);
}
