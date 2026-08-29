/**
 * Errores estructurados del validador de flows.
 */

import type { FlowValidationErrorCode } from "@/lib/flow/constants";

export interface FlowValidationError {
  code: FlowValidationErrorCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
  /** Ruta JSON (ej. nodes[2].config) para errores de schema. */
  path?: string;
}

export interface FlowValidationResult {
  valid: boolean;
  errors: FlowValidationError[];
}

export function flowValidationError(
  code: FlowValidationErrorCode,
  message: string,
  extra?: Pick<FlowValidationError, "nodeId" | "edgeId" | "path">,
): FlowValidationError {
  return { code, message, ...extra };
}

export function mergeValidationResults(...results: FlowValidationResult[]): FlowValidationResult {
  const errors = results.flatMap((r) => r.errors);
  return { valid: errors.length === 0, errors };
}

export function okResult(): FlowValidationResult {
  return { valid: true, errors: [] };
}

export function failResult(errors: FlowValidationError[]): FlowValidationResult {
  return { valid: errors.length === 0, errors };
}
