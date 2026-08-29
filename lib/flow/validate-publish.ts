/**
 * Validación completa para publicación de un flow.
 */

import { FLOW_VALIDATION_CODES } from "@/lib/flow/constants";
import { failResult, flowValidationError, mergeValidationResults, type FlowValidationResult } from "@/lib/flow/errors";
import { safeParseFlowDefinition } from "@/lib/flow/schemas";
import type { FlowDefinition } from "@/lib/flow/types";
import { validateFlowGraph, validateFlowPublishRules } from "@/lib/flow/validate-graph";
import { validateSecurityRules } from "@/lib/flow/validate-security";

function schemaToValidationResult(parse: ReturnType<typeof safeParseFlowDefinition>): FlowValidationResult {
  if (parse.success) return { valid: true, errors: [] };
  const errors = parse.error.issues.map((issue) =>
    flowValidationError(
      FLOW_VALIDATION_CODES.SCHEMA_INVALID,
      issue.message,
      { path: issue.path.join(".") || undefined },
    ),
  );
  return failResult(errors);
}

/** Valida JSON/schema + grafo (sin reglas de publicación). */
export function validateFlowDefinitionInput(input: unknown): FlowValidationResult {
  const parsed = safeParseFlowDefinition(input);
  const schemaResult = schemaToValidationResult(parsed);
  if (!parsed.success) return schemaResult;
  return mergeValidationResults(schemaResult, validateFlowGraph(parsed.data as FlowDefinition));
}

/**
 * Validación estricta antes de publicar una versión.
 * Requiere schema válido, grafo coherente y al menos un camino start → end.
 */
export function validateFlowForPublish(input: unknown): FlowValidationResult {
  const parsed = safeParseFlowDefinition(input);
  const schemaResult = schemaToValidationResult(parsed);
  if (!parsed.success) return schemaResult;

  const flow = parsed.data as FlowDefinition;
  return mergeValidationResults(
    schemaResult,
    validateFlowGraph(flow),
    validateFlowPublishRules(flow),
    validateSecurityRules(flow),
  );
}

export { validateFlowGraph, validateFlowPublishRules };
