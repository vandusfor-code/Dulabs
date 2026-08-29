/**
 * Convenciones de handles, códigos de error y nodos que rompen ciclos automáticos.
 */

import type { FlowNodeType } from "@/lib/flow/types";

/** Prefijos de sourceHandle para edges salientes. */
export const FLOW_EDGE_HANDLE = {
  button: (buttonId: string) => `button:${buttonId}` as const,
  conditionTrue: "true" as const,
  conditionFalse: "false" as const,
  aiClass: (value: string) => `class:${value}` as const,
  aiDefault: "default" as const,
  aiSuccess: "success" as const,
  aiFailure: "failure" as const,
  default: "default" as const,
} as const;

/** Nodos que esperan input externo y pueden romper ciclos automáticos peligrosos. */
export const INPUT_WAIT_NODE_TYPES: ReadonlySet<FlowNodeType> = new Set([
  "question",
  "buttons",
  "ai",
]);

/** Nodos que avanzan sin esperar respuesta del usuario en el mismo turno. */
export const AUTOMATIC_NODE_TYPES: ReadonlySet<FlowNodeType> = new Set([
  "start",
  "message",
  "condition",
  "save_data",
  "action",
  "human",
  "end",
]);

export const FLOW_VALIDATION_CODES = {
  DUPLICATE_NODE_ID: "DUPLICATE_NODE_ID",
  DUPLICATE_EDGE_ID: "DUPLICATE_EDGE_ID",
  MISSING_NODE_ID: "MISSING_NODE_ID",
  EDGE_SOURCE_NOT_FOUND: "EDGE_SOURCE_NOT_FOUND",
  EDGE_TARGET_NOT_FOUND: "EDGE_TARGET_NOT_FOUND",
  MULTIPLE_START_NODES: "MULTIPLE_START_NODES",
  MISSING_START_NODE: "MISSING_START_NODE",
  MISSING_END_NODE: "MISSING_END_NODE",
  DISCONNECTED_NODE: "DISCONNECTED_NODE",
  DUPLICATE_EDGE: "DUPLICATE_EDGE",
  INVALID_SELF_LOOP: "INVALID_SELF_LOOP",
  DANGEROUS_CYCLE: "DANGEROUS_CYCLE",
  BUTTON_MISSING_EDGE: "BUTTON_MISSING_EDGE",
  CONDITION_MISSING_BRANCH: "CONDITION_MISSING_BRANCH",
  AI_MISSING_BRANCH: "AI_MISSING_BRANCH",
  UNDEFINED_VARIABLE: "UNDEFINED_VARIABLE",
  INVALID_NODE_CONFIG: "INVALID_NODE_CONFIG",
  SCHEMA_INVALID: "SCHEMA_INVALID",
  NO_PATH_TO_END: "NO_PATH_TO_END",
  UNVERIFIED_ASSERTION: "UNVERIFIED_ASSERTION",
  AI_AS_SOURCE_OF_TRUTH: "AI_AS_SOURCE_OF_TRUTH",
  CONDITION_ON_UNVERIFIED: "CONDITION_ON_UNVERIFIED",
  CRITICAL_ACTION_NO_FAILURE: "CRITICAL_ACTION_NO_FAILURE",
  CRITICAL_ACTION_NO_OUTPUT: "CRITICAL_ACTION_NO_OUTPUT",
  WEBHOOK_NOT_ALLOWLISTED: "WEBHOOK_NOT_ALLOWLISTED",
  WEBHOOK_INSECURE: "WEBHOOK_INSECURE",
  INVALID_ASSERTION_CONFIG: "INVALID_ASSERTION_CONFIG",
  MESSAGE_ON_UNVERIFIED: "MESSAGE_ON_UNVERIFIED",
  MESSAGE_AI_CRITICAL_UNVERIFIED: "MESSAGE_AI_CRITICAL_UNVERIFIED",
  EXTERNAL_CLAIM_UNVERIFIED: "EXTERNAL_CLAIM_UNVERIFIED",
} as const;

export type FlowValidationErrorCode =
  (typeof FLOW_VALIDATION_CODES)[keyof typeof FLOW_VALIDATION_CODES];
