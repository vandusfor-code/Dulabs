/**
 * Flow Store — persistencia Supabase (Fase 3 / 3.1).
 * Solo I/O; sin lógica de engine ni runtime.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { cifrarSecreto } from "@/lib/crypto";
import type { FlowDefinition } from "@/lib/flow/types";
import type { FlowEngineState } from "@/lib/flow/engine-types";
import { definitionContainsEmbeddedSecrets } from "@/lib/flow/detect-embedded-secrets";
import { sanitizePayloadForObservability } from "@/lib/flow/sanitize-observability-payload";
import {
  FlowActiveExecutionExistsError,
  FlowEmbeddedSecretsError,
  FlowExecutionConcurrencyConflictError,
  FlowStoreError,
  FLOW_STORE_ERROR_CODES,
} from "@/lib/flow/flow-store-errors";
import {
  engineStateToExecutionUpdate,
  executionRowToEngineState,
  type FlowEffectRow,
  type FlowEventRow,
  type FlowExecutionRow,
  type FlowIntegrationRow,
  type FlowCredentialRow,
  type FlowRow,
  type FlowVersionRow,
} from "@/lib/flow/flow-store-types";

export type InsertEventResult = { inserted: boolean; row: FlowEventRow | null };

export type InsertEffectResult = { inserted: boolean; row: FlowEffectRow | null };

export type ResolveEffectResultOutcome =
  | { ok: true; row: FlowEffectRow; alreadyResolved: boolean }
  | {
      ok: false;
      reason: "not_found" | "invalid_transition" | "tenant_mismatch" | "effect_mismatch";
    };

export type CreateExecutionResult =
  | { created: true; row: FlowExecutionRow }
  | { created: false; reason: "active_execution_exists"; existing: FlowExecutionRow };

export type SaveExecutionStateResult = { stateVersion: number };

const ACTIVE_EXECUTION_STATUSES = ["running", "waiting_input", "waiting_effect"] as const;


const EXECUTION_ID_UNIQUE = "dulabs_flow_executions_tenant_execution_id_key";

function assertNoEmbeddedSecrets(definition: FlowDefinition): void {
  if (definitionContainsEmbeddedSecrets(definition as unknown as Record<string, unknown>)) {
    throw new FlowEmbeddedSecretsError();
  }
}

function isDuplicateExecutionId(error: { code?: string; message?: string }): boolean {
  return error.code === "23505" && Boolean(error.message?.includes(EXECUTION_ID_UNIQUE));
}

function isActiveConversationConflict(error: { code?: string; message?: string }): boolean {
  return error.code === "23505" && !isDuplicateExecutionId(error);
}

// ---------------------------------------------------------------------------
// Flows & versions
// ---------------------------------------------------------------------------

export async function createFlow(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    slug: string;
    name: string;
    description?: string;
    createdBy?: string;
  },
): Promise<FlowRow> {
  const { data, error } = await supabase
    .from("dulabs_flows")
    .insert({
      tenant_id: input.tenantId,
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      created_by: input.createdBy ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as FlowRow;
}

export async function createFlowVersion(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    flowId: string;
    versionNumber: number;
    definition: FlowDefinition;
    createdBy?: string;
    publish?: boolean;
  },
): Promise<FlowVersionRow> {
  assertNoEmbeddedSecrets(input.definition);

  const { data, error } = await supabase
    .from("dulabs_flow_versions")
    .insert({
      tenant_id: input.tenantId,
      flow_id: input.flowId,
      version_number: input.versionNumber,
      definition_json: input.definition,
      created_by: input.createdBy ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;

  const version = data as FlowVersionRow;

  if (input.publish) {
    await publishFlowVersion(supabase, input.tenantId, input.flowId, version.id);
    return (await getFlowVersion(supabase, input.tenantId, version.id)) ?? version;
  }

  return version;
}

export async function publishFlowVersion(
  supabase: SupabaseClient,
  tenantId: string,
  flowId: string,
  versionId: string,
): Promise<void> {
  const { error } = await supabase.rpc("dulabs_flow_publish_version", {
    p_tenant_id: tenantId,
    p_flow_id: flowId,
    p_version_id: versionId,
  });

  if (error) {
    if (error.message?.includes("FLOW_PUBLISH_VERSION_NOT_FOUND")) {
      throw new FlowStoreError(
        FLOW_STORE_ERROR_CODES.PUBLISH_VERSION_NOT_FOUND,
        "Versión no encontrada para el tenant/flow indicado",
      );
    }
    if (error.message?.includes("FLOW_PUBLISH_TENANT_MISMATCH")) {
      throw new FlowStoreError(
        FLOW_STORE_ERROR_CODES.PUBLISH_TENANT_MISMATCH,
        "La versión no pertenece al flow del tenant",
      );
    }
    throw error;
  }
}

export async function getFlowVersion(
  supabase: SupabaseClient,
  tenantId: string,
  versionId: string,
): Promise<FlowVersionRow | null> {
  const { data, error } = await supabase
    .from("dulabs_flow_versions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw error;
  return (data as FlowVersionRow | null) ?? null;
}

export async function getFlowById(
  supabase: SupabaseClient,
  tenantId: string,
  flowId: string,
): Promise<FlowRow | null> {
  const { data, error } = await supabase
    .from("dulabs_flows")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", flowId)
    .maybeSingle();
  if (error) throw error;
  return (data as FlowRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// Integrations & credentials
// ---------------------------------------------------------------------------

export async function createIntegration(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    slug: string;
    displayName: string;
    capability: string;
    url: string;
    criticality?: string;
    createdBy?: string;
    approve?: boolean;
  },
): Promise<FlowIntegrationRow> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("dulabs_flow_integrations")
    .insert({
      tenant_id: input.tenantId,
      slug: input.slug,
      display_name: input.displayName,
      capability: input.capability,
      url: input.url,
      criticality: input.criticality ?? "critical",
      status: input.approve ? "approved" : "pending",
      approved_at: input.approve ? now : null,
      approved_by: input.approve ? input.createdBy ?? null : null,
      created_by: input.createdBy ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as FlowIntegrationRow;
}

export async function upsertCredential(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    integrationId: string;
    credentialKey: string;
    plaintext: string;
  },
): Promise<void> {
  const encrypted = cifrarSecreto(input.plaintext);
  const { error } = await supabase.from("dulabs_flow_credentials").upsert(
    {
      tenant_id: input.tenantId,
      integration_id: input.integrationId,
      credential_key: input.credentialKey,
      encrypted_value: encrypted,
      rotated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,integration_id,credential_key" },
  );
  if (error) throw error;
}

export async function getIntegrationById(
  supabase: SupabaseClient,
  tenantId: string,
  integrationId: string,
): Promise<FlowIntegrationRow | null> {
  const { data, error } = await supabase
    .from("dulabs_flow_integrations")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", integrationId)
    .maybeSingle();
  if (error) throw error;
  return (data as FlowIntegrationRow | null) ?? null;
}

export async function getIntegrationCredentials(
  supabase: SupabaseClient,
  tenantId: string,
  integrationId: string,
): Promise<FlowCredentialRow[]> {
  const { data, error } = await supabase
    .from("dulabs_flow_credentials")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("integration_id", integrationId);
  if (error) throw error;
  return (data ?? []) as FlowCredentialRow[];
}

// ---------------------------------------------------------------------------
// Executions
// ---------------------------------------------------------------------------

export async function getActiveExecutionByConversation(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    phoneNumberId: string;
    telefonoCliente: string;
  },
): Promise<FlowExecutionRow | null> {
  const { data, error } = await supabase
    .from("dulabs_flow_executions")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("phone_number_id", input.phoneNumberId)
    .eq("telefono_cliente", input.telefonoCliente)
    .in("status", [...ACTIVE_EXECUTION_STATUSES])
    .maybeSingle();
  if (error) throw error;
  return (data as FlowExecutionRow | null) ?? null;
}

export async function createExecution(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    flowId: string;
    flowVersionId: string;
    executionId: string;
    phoneNumberId: string;
    telefonoCliente: string;
    initialState: FlowEngineState;
  },
): Promise<CreateExecutionResult> {
  const patch = engineStateToExecutionUpdate(input.initialState);
  const { data, error } = await supabase
    .from("dulabs_flow_executions")
    .insert({
      tenant_id: input.tenantId,
      flow_id: input.flowId,
      flow_version_id: input.flowVersionId,
      execution_id: input.executionId,
      phone_number_id: input.phoneNumberId,
      telefono_cliente: input.telefonoCliente,
      state_version: 0,
      ...patch,
    })
    .select("*")
    .single();

  if (error) {
    if (isDuplicateExecutionId(error)) {
      throw error;
    }
    if (isActiveConversationConflict(error)) {
      const existing = await getActiveExecutionByConversation(supabase, {
        tenantId: input.tenantId,
        phoneNumberId: input.phoneNumberId,
        telefonoCliente: input.telefonoCliente,
      });
      if (existing) {
        return { created: false, reason: "active_execution_exists", existing };
      }
      throw new FlowActiveExecutionExistsError(input.executionId);
    }
    throw error;
  }

  return { created: true, row: data as FlowExecutionRow };
}

export async function getExecutionById(
  supabase: SupabaseClient,
  tenantId: string,
  executionRowId: string,
): Promise<FlowExecutionRow | null> {
  const { data, error } = await supabase
    .from("dulabs_flow_executions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", executionRowId)
    .maybeSingle();
  if (error) throw error;
  return (data as FlowExecutionRow | null) ?? null;
}

export async function getExecutionEngineState(
  supabase: SupabaseClient,
  tenantId: string,
  executionRowId: string,
): Promise<FlowEngineState | null> {
  const row = await getExecutionById(supabase, tenantId, executionRowId);
  return row ? executionRowToEngineState(row) : null;
}

export async function saveExecutionState(
  supabase: SupabaseClient,
  tenantId: string,
  executionRowId: string,
  state: FlowEngineState,
  expectedStateVersion: number,
): Promise<SaveExecutionStateResult> {
  const patch = engineStateToExecutionUpdate(state);
  const nextVersion = expectedStateVersion + 1;

  const { data, error } = await supabase
    .from("dulabs_flow_executions")
    .update({
      ...patch,
      state_version: nextVersion,
    })
    .eq("tenant_id", tenantId)
    .eq("id", executionRowId)
    .eq("state_version", expectedStateVersion)
    .select("state_version")
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new FlowExecutionConcurrencyConflictError({
      tenantId,
      executionRowId,
      expectedStateVersion,
    });
  }

  return { stateVersion: data.state_version as number };
}

// ---------------------------------------------------------------------------
// Idempotencia — events & effects
// ---------------------------------------------------------------------------

export async function insertEventIdempotent(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    flowExecutionId: string;
    eventId: string;
    eventType: string;
    rawPayload?: Record<string, unknown>;
    processedAt?: string;
  },
): Promise<InsertEventResult> {
  const { data, error } = await supabase
    .from("dulabs_flow_events")
    .insert({
      tenant_id: input.tenantId,
      flow_execution_id: input.flowExecutionId,
      event_id: input.eventId,
      event_type: input.eventType,
      raw_payload: input.rawPayload ?? {},
      processed_at: input.processedAt ?? null,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return { inserted: false, row: null };
    throw error;
  }
  return { inserted: true, row: data as FlowEventRow };
}

export async function insertEffectIdempotent(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    flowExecutionId: string;
    effectId: string;
    nodeId: string;
    kind: string;
    integrationId?: string;
    status?: FlowEffectRow["status"];
  },
): Promise<InsertEffectResult> {
  const { data, error } = await supabase
    .from("dulabs_flow_effects")
    .insert({
      tenant_id: input.tenantId,
      flow_execution_id: input.flowExecutionId,
      effect_id: input.effectId,
      node_id: input.nodeId,
      kind: input.kind,
      integration_id: input.integrationId ?? null,
      status: input.status ?? "pending",
    })
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return { inserted: false, row: null };
    throw error;
  }
  return { inserted: true, row: data as FlowEffectRow };
}

async function loadEffectForResolve(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    flowExecutionId: string;
    effectId: string;
  },
): Promise<
  | { kind: "found"; row: FlowEffectRow }
  | {
      kind: "error";
      reason: "not_found" | "invalid_transition" | "tenant_mismatch" | "effect_mismatch";
    }
> {
  const direct = await getEffectByEffectId(
    supabase,
    input.tenantId,
    input.flowExecutionId,
    input.effectId,
  );
  if (direct) {
    return { kind: "found", row: direct };
  }

  const { data: sameTenantEffect, error: tenantEffectError } = await supabase
    .from("dulabs_flow_effects")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("effect_id", input.effectId)
    .maybeSingle();
  if (tenantEffectError) throw tenantEffectError;
  if (
    sameTenantEffect &&
    (sameTenantEffect as FlowEffectRow).flow_execution_id !== input.flowExecutionId
  ) {
    return { kind: "error", reason: "effect_mismatch" };
  }

  const { data: sameExecEffect, error: execEffectError } = await supabase
    .from("dulabs_flow_effects")
    .select("*")
    .eq("flow_execution_id", input.flowExecutionId)
    .eq("effect_id", input.effectId)
    .maybeSingle();
  if (execEffectError) throw execEffectError;
  if (sameExecEffect && (sameExecEffect as FlowEffectRow).tenant_id !== input.tenantId) {
    return { kind: "error", reason: "tenant_mismatch" };
  }

  return { kind: "error", reason: "not_found" };
}

export async function getEffectByEffectId(
  supabase: SupabaseClient,
  tenantId: string,
  flowExecutionId: string,
  effectId: string,
): Promise<FlowEffectRow | null> {
  const { data, error } = await supabase
    .from("dulabs_flow_effects")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("flow_execution_id", flowExecutionId)
    .eq("effect_id", effectId)
    .maybeSingle();
  if (error) throw error;
  return (data as FlowEffectRow | null) ?? null;
}

function terminalEffectStatusesMatch(
  existing: FlowEffectRow,
  requested: "succeeded" | "failed",
): boolean {
  return existing.status === requested;
}

/**
 * Cierra un efecto PENDING → SUCCEEDED | FAILED con protección de concurrencia.
 * UPDATE atómico WHERE status = 'pending'. Re-fetch idempotente en carrera.
 * No permite SUCCEEDED/FAILED → PENDING ni reversión de terminal opuesto.
 */
export async function resolveEffectResult(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    flowExecutionId: string;
    effectId: string;
    status: "succeeded" | "failed";
    resultPayloadRaw?: Record<string, unknown>;
    resultPayloadApplied?: Record<string, unknown>;
    resolvedAt?: string;
  },
): Promise<ResolveEffectResultOutcome> {
  const loaded = await loadEffectForResolve(supabase, input);
  if (loaded.kind === "error") {
    return { ok: false, reason: loaded.reason };
  }

  const existing = loaded.row;

  if (existing.status === "succeeded" || existing.status === "failed") {
    if (terminalEffectStatusesMatch(existing, input.status)) {
      return { ok: true, row: existing, alreadyResolved: true };
    }
    return { ok: false, reason: "invalid_transition" };
  }

  if (existing.status !== "pending") {
    return { ok: false, reason: "invalid_transition" };
  }

  const resolvedAt = input.resolvedAt ?? new Date().toISOString();
  const resultPayloadRaw = input.resultPayloadRaw
    ? (sanitizePayloadForObservability(input.resultPayloadRaw) as Record<string, unknown>)
    : null;
  const resultPayloadApplied = input.resultPayloadApplied
    ? (sanitizePayloadForObservability(input.resultPayloadApplied) as Record<string, unknown>)
    : resultPayloadRaw;

  const { data, error } = await supabase
    .from("dulabs_flow_effects")
    .update({
      status: input.status,
      result_payload_raw: resultPayloadRaw,
      result_payload_applied: resultPayloadApplied,
      resolved_at: resolvedAt,
    })
    .eq("tenant_id", input.tenantId)
    .eq("flow_execution_id", input.flowExecutionId)
    .eq("effect_id", input.effectId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) throw error;

  if (data) {
    return { ok: true, row: data as FlowEffectRow, alreadyResolved: false };
  }

  const refreshed = await getEffectByEffectId(
    supabase,
    input.tenantId,
    input.flowExecutionId,
    input.effectId,
  );

  if (!refreshed) {
    return { ok: false, reason: "not_found" };
  }

  if (refreshed.status === "succeeded" || refreshed.status === "failed") {
    if (terminalEffectStatusesMatch(refreshed, input.status)) {
      return { ok: true, row: refreshed, alreadyResolved: true };
    }
    return { ok: false, reason: "effect_mismatch" };
  }

  return { ok: false, reason: "invalid_transition" };
}

export async function recordNodeTransition(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    flowExecutionId: string;
    eventId?: string;
    fromNodeId?: string | null;
    toNodeId: string;
    sourceHandle?: string;
  },
): Promise<void> {
  const { error } = await supabase.from("dulabs_flow_node_transitions").insert({
    tenant_id: input.tenantId,
    flow_execution_id: input.flowExecutionId,
    event_id: input.eventId ?? null,
    from_node_id: input.fromNodeId ?? null,
    to_node_id: input.toNodeId,
    source_handle: input.sourceHandle ?? null,
  });
  if (error) throw error;
}

export {
  executionRowToEngineState,
  engineStateToExecutionUpdate,
  definitionContainsEmbeddedSecrets,
};

export {
  FlowStoreError,
  FlowExecutionConcurrencyConflictError,
  FlowActiveExecutionExistsError,
  FlowEmbeddedSecretsError,
  FLOW_STORE_ERROR_CODES,
} from "@/lib/flow/flow-store-errors";
