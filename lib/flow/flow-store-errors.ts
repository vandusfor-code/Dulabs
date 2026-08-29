/**
 * Errores estructurados del Flow Store (Fase 3.1).
 */

export const FLOW_STORE_ERROR_CODES = {
  EXECUTION_CONCURRENCY_CONFLICT: "FLOW_EXECUTION_CONCURRENCY_CONFLICT",
  ACTIVE_EXECUTION_EXISTS: "FLOW_ACTIVE_EXECUTION_EXISTS",
  PUBLISH_VERSION_NOT_FOUND: "FLOW_PUBLISH_VERSION_NOT_FOUND",
  PUBLISH_TENANT_MISMATCH: "FLOW_PUBLISH_TENANT_MISMATCH",
  EMBEDDED_SECRETS: "FLOW_EMBEDDED_SECRETS",
} as const;

export type FlowStoreErrorCode = (typeof FLOW_STORE_ERROR_CODES)[keyof typeof FLOW_STORE_ERROR_CODES];

export class FlowStoreError extends Error {
  readonly code: FlowStoreErrorCode;

  constructor(code: FlowStoreErrorCode, message: string) {
    super(message);
    this.name = "FlowStoreError";
    this.code = code;
  }
}

export class FlowExecutionConcurrencyConflictError extends FlowStoreError {
  readonly tenantId: string;
  readonly executionRowId: string;
  readonly expectedStateVersion: number;

  constructor(input: {
    tenantId: string;
    executionRowId: string;
    expectedStateVersion: number;
  }) {
    super(
      FLOW_STORE_ERROR_CODES.EXECUTION_CONCURRENCY_CONFLICT,
      `Conflicto de concurrencia en ejecución ${input.executionRowId}: state_version esperado ${input.expectedStateVersion}`,
    );
    this.name = "FlowExecutionConcurrencyConflictError";
    this.tenantId = input.tenantId;
    this.executionRowId = input.executionRowId;
    this.expectedStateVersion = input.expectedStateVersion;
  }
}

export class FlowActiveExecutionExistsError extends FlowStoreError {
  readonly existingExecutionId: string;

  constructor(existingExecutionId: string) {
    super(
      FLOW_STORE_ERROR_CODES.ACTIVE_EXECUTION_EXISTS,
      `Ya existe una ejecución activa para esta conversación (${existingExecutionId})`,
    );
    this.name = "FlowActiveExecutionExistsError";
    this.existingExecutionId = existingExecutionId;
  }
}

export class FlowEmbeddedSecretsError extends FlowStoreError {
  constructor(detail?: string) {
    super(
      FLOW_STORE_ERROR_CODES.EMBEDDED_SECRETS,
      detail ?? "FlowDefinition no puede contener secretos embebidos",
    );
    this.name = "FlowEmbeddedSecretsError";
  }
}
