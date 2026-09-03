/**
 * Tipos de filas del Flow Store (Supabase) — Fase 3.
 * Mapeo bidireccional con FlowEngineState sin modificar el engine.
 */

import type {
  FlowEngineState,
  FlowEngineStatus,
  FlowExportBucket,
  PendingEffect,
} from "@/lib/flow/engine-types";

export type FlowRecordStatus = "draft" | "published" | "archived";
export type FlowIntegrationStatus = "pending" | "approved" | "revoked";
export type FlowEffectStatus = "pending" | "succeeded" | "failed" | "expired";

export interface FlowRow {
  tenant_id: string;
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: FlowRecordStatus;
  published_version_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FlowVersionRow {
  tenant_id: string;
  id: string;
  flow_id: string;
  version_number: number;
  definition_json: Record<string, unknown>;
  published_at: string | null;
  retired_at: string | null;
  created_by: string | null;
  created_at: string;
}

/** Fase 3 (Triggers + Event Routing, autorizado) — fila cruda de dulabs_flow_triggers. `type`/`config` se reconstruyen a un TriggerConfig tipado vía buildTriggerConfig (lib/flow-triggers/types.ts), nunca acá. */
export interface FlowTriggerRow {
  tenant_id: string;
  id: string;
  flow_id: string;
  type: string;
  enabled: boolean;
  priority: number;
  config: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FlowIntegrationRow {
  tenant_id: string;
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  capability: string;
  criticality: string;
  requires_failure_branch: boolean;
  url: string;
  http_method: string;
  input_contract: Record<string, unknown>;
  output_contract: Record<string, unknown>;
  headers_template: Record<string, unknown>;
  status: FlowIntegrationStatus;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FlowCredentialRow {
  tenant_id: string;
  id: string;
  integration_id: string;
  credential_key: string;
  encrypted_value: string;
  rotated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FlowExecutionRow {
  tenant_id: string;
  id: string;
  flow_id: string;
  flow_version_id: string;
  execution_id: string;
  phone_number_id: string;
  telefono_cliente: string;
  status: FlowEngineStatus;
  current_node_id: string | null;
  variables: Record<string, unknown>;
  expected_input: "text" | "button" | null;
  pending_effect: PendingEffect | null;
  exports: FlowExportBucket;
  metadata: Record<string, unknown>;
  state_version: number;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

export interface FlowEventRow {
  id: number;
  tenant_id: string;
  flow_execution_id: string;
  event_id: string;
  event_type: string;
  raw_payload: Record<string, unknown>;
  processed_at: string | null;
  created_at: string;
}

export interface FlowEffectRow {
  id: number;
  tenant_id: string;
  flow_execution_id: string;
  effect_id: string;
  node_id: string;
  kind: string;
  integration_id: string | null;
  status: FlowEffectStatus;
  requested_at: string;
  resolved_at: string | null;
  result_payload_raw: Record<string, unknown> | null;
  result_payload_applied: Record<string, unknown> | null;
  provider: string | null;
  provider_model: string | null;
  created_at: string;
}

export interface FlowNodeTransitionRow {
  id: number;
  tenant_id: string;
  flow_execution_id: string;
  event_id: string | null;
  from_node_id: string | null;
  to_node_id: string;
  source_handle: string | null;
  occurred_at: string;
}

const EMPTY_EXPORTS: FlowExportBucket = {
  lead: {},
  custom_fields: {},
  webhook_body: {},
};

export function executionRowToEngineState(row: FlowExecutionRow): FlowEngineState {
  return {
    flowId: row.flow_id,
    flowVersionId: row.flow_version_id,
    executionId: row.execution_id,
    lastEventId: typeof row.metadata.lastEventId === "string" ? row.metadata.lastEventId : undefined,
    currentNodeId: row.current_node_id,
    variables: row.variables ?? {},
    status: row.status,
    expectedInput: row.expected_input ?? undefined,
    pendingEffect: row.pending_effect ?? undefined,
    exports: row.exports ?? EMPTY_EXPORTS,
    metadata: row.metadata ?? {},
  };
}

export function engineStateToExecutionUpdate(
  state: FlowEngineState,
): Pick<
  FlowExecutionRow,
  | "status"
  | "current_node_id"
  | "variables"
  | "expected_input"
  | "pending_effect"
  | "exports"
  | "metadata"
  | "last_activity_at"
> {
  return {
    status: state.status,
    current_node_id: state.currentNodeId,
    variables: state.variables,
    expected_input: state.expectedInput ?? null,
    pending_effect: state.pendingEffect ?? null,
    exports: state.exports,
    metadata: {
      ...state.metadata,
      ...(state.lastEventId ? { lastEventId: state.lastEventId } : {}),
    },
    last_activity_at: new Date().toISOString(),
  };
}

export { definitionContainsEmbeddedSecrets } from "@/lib/flow/detect-embedded-secrets";
