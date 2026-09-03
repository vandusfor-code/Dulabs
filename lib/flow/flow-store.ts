/**
 * Flow Store — persistencia Supabase (Fase 3 / 3.1).
 * Solo I/O; sin lógica de engine ni runtime.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { cifrarSecreto } from "@/lib/crypto";
import { createInitialFlowDefinition } from "@/lib/flow-builder/node-factory";
import { resolveFlowSelection } from "@/lib/flow-triggers/trigger-router";
import { buildTriggerConfig, type FlowSelectionResult, type IncomingEvent, type RoutableTrigger, type TriggerConfig } from "@/lib/flow-triggers/types";
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
  type FlowTriggerRow,
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

// Fase 1 (API de autoría, autorizado) — 5 funciones NUEVAS, mismo patrón que
// las de arriba (I/O puro, sin lógica de negocio, siempre .eq("tenant_id", ...)
// primero). Ninguna función existente de este archivo se modificó.

export async function listFlows(
  supabase: SupabaseClient,
  input: { tenantId: string; status?: FlowRow["status"]; limit?: number },
): Promise<FlowRow[]> {
  let query = supabase
    .from("dulabs_flows")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 200);
  if (input.status) query = query.eq("status", input.status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FlowRow[];
}

/** Metadata únicamente -- nunca status/published_version_id (esos solo cambian vía publishFlowVersion/archiveFlow). */
export async function updateFlow(
  supabase: SupabaseClient,
  input: { tenantId: string; flowId: string; name?: string; description?: string; slug?: string },
): Promise<FlowRow | null> {
  const patch: Record<string, string> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.slug !== undefined) patch.slug = input.slug;

  const { data, error } = await supabase
    .from("dulabs_flows")
    .update(patch)
    .eq("tenant_id", input.tenantId)
    .eq("id", input.flowId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as FlowRow | null) ?? null;
}

/**
 * "Eliminar" un Flow = archivar (status='archived'), nunca DELETE físico --
 * dulabs_flow_versions tiene FK ON DELETE RESTRICT hacia esta tabla, así que
 * un DELETE real fallaría en cuanto exista cualquier versión. La protección
 * de "Flow activo para algún cliente" (dulabs_clientes_config.flow_activo)
 * vive en la capa de API (app/api/flows/[id]/route.ts), no acá -- esa tabla
 * no es del dominio de Flow Store.
 */
export async function archiveFlow(
  supabase: SupabaseClient,
  input: { tenantId: string; flowId: string },
): Promise<FlowRow | null> {
  const { data, error } = await supabase
    .from("dulabs_flows")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.flowId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as FlowRow | null) ?? null;
}

export type EnsureInitialVersionResult =
  | { created: true; version: FlowVersionRow }
  | { created: false; version: FlowVersionRow };

/**
 * Garantiza que el Flow tenga al menos una versión (v1, borrador, con la
 * definición inicial mínima -- un nodo Start, ver createInitialFlowDefinition).
 * Idempotente: si ya existe cualquier versión, la devuelve tal cual sin crear
 * nada. Bajo carrera (dos llamadas concurrentes viendo "0 versiones" a la
 * vez), el UNIQUE real de la tabla (tenant_id, flow_id, version_number) --
 * dulabs_flow_versions_tenant_flow_version_key -- rechaza el segundo INSERT
 * con 23505; se recupera releyendo la versión ganadora, nunca se inventa una
 * segunda garantía que la base de datos no tenga.
 */
export async function ensureInitialFlowVersion(
  supabase: SupabaseClient,
  input: { tenantId: string; flowId: string; flowName: string; createdBy?: string },
): Promise<EnsureInitialVersionResult> {
  const existentes = await listFlowVersions(supabase, { tenantId: input.tenantId, flowId: input.flowId, limit: 1 });
  if (existentes.length > 0) {
    return { created: false, version: existentes[0] };
  }

  try {
    const version = await createFlowVersion(supabase, {
      tenantId: input.tenantId,
      flowId: input.flowId,
      versionNumber: 1,
      definition: createInitialFlowDefinition(input.flowName),
      createdBy: input.createdBy,
    });
    return { created: true, version };
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") {
      const carrera = await listFlowVersions(supabase, { tenantId: input.tenantId, flowId: input.flowId, limit: 1 });
      const ganadora = carrera.find((v) => v.version_number === 1) ?? carrera[0];
      if (ganadora) return { created: false, version: ganadora };
    }
    throw error;
  }
}

export async function listFlowVersions(
  supabase: SupabaseClient,
  input: { tenantId: string; flowId: string; limit?: number },
): Promise<FlowVersionRow[]> {
  const { data, error } = await supabase
    .from("dulabs_flow_versions")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("flow_id", input.flowId)
    .order("version_number", { ascending: false })
    .limit(input.limit ?? 100);
  if (error) throw error;
  return (data ?? []) as FlowVersionRow[];
}

// ---------------------------------------------------------------------------
// Triggers + Event Routing (Fase 3) — persistencia pura, SIN reglas de
// matching acá (eso vive en lib/flow-triggers/, código puro sin Supabase).
// ---------------------------------------------------------------------------

function serializeTriggerConfig(config: TriggerConfig): Record<string, unknown> {
  // `type` NUNCA se duplica dentro de la columna config -- ya vive en la
  // columna `type` de la fila. Se descompone el discriminated union a mano
  // (en vez de `const { type, ...rest } = config`) porque TS no angosta la
  // unión completa al desestructurar así.
  switch (config.type) {
    case "keyword":
    case "message_contains":
    case "message_starts_with":
      return { keywords: config.keywords };
    case "event":
      return { eventName: config.eventName };
    case "conversation_started":
    case "user_message":
    case "manual":
      return {};
  }
}

export async function createFlowTrigger(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    flowId: string;
    config: TriggerConfig;
    priority?: number;
    enabled?: boolean;
    createdBy?: string;
  },
): Promise<FlowTriggerRow> {
  const { data, error } = await supabase
    .from("dulabs_flow_triggers")
    .insert({
      tenant_id: input.tenantId,
      flow_id: input.flowId,
      type: input.config.type,
      config: serializeTriggerConfig(input.config),
      priority: input.priority ?? 0,
      enabled: input.enabled ?? true,
      created_by: input.createdBy ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as FlowTriggerRow;
}

/** Autoría (Builder): TODOS los triggers de un Flow, sin importar enabled -- el Builder debe poder mostrar/editar los deshabilitados también. */
export async function listFlowTriggers(
  supabase: SupabaseClient,
  input: { tenantId: string; flowId: string },
): Promise<FlowTriggerRow[]> {
  const { data, error } = await supabase
    .from("dulabs_flow_triggers")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("flow_id", input.flowId)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as FlowTriggerRow[];
}

export async function getFlowTrigger(
  supabase: SupabaseClient,
  input: { tenantId: string; flowId: string; triggerId: string },
): Promise<FlowTriggerRow | null> {
  const { data, error } = await supabase
    .from("dulabs_flow_triggers")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("flow_id", input.flowId)
    .eq("id", input.triggerId)
    .maybeSingle();
  if (error) throw error;
  return (data as FlowTriggerRow | null) ?? null;
}

/**
 * Actualiza SOLO config/priority/enabled -- `type` es inmutable tras
 * creación (cambiar de tipo puede dejar `config` con una forma inválida
 * para el nuevo tipo; la API exige borrar y crear de nuevo en ese caso, ver
 * app/api/flows/[id]/triggers/[triggerId]/route.ts).
 */
export async function updateFlowTrigger(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    flowId: string;
    triggerId: string;
    config?: TriggerConfig;
    priority?: number;
    enabled?: boolean;
  },
): Promise<FlowTriggerRow | null> {
  const patch: Record<string, unknown> = {};
  if (input.config !== undefined) patch.config = serializeTriggerConfig(input.config);
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  const { data, error } = await supabase
    .from("dulabs_flow_triggers")
    .update(patch)
    .eq("tenant_id", input.tenantId)
    .eq("flow_id", input.flowId)
    .eq("id", input.triggerId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as FlowTriggerRow | null) ?? null;
}

export async function deleteFlowTrigger(
  supabase: SupabaseClient,
  input: { tenantId: string; flowId: string; triggerId: string },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("dulabs_flow_triggers")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("flow_id", input.flowId)
    .eq("id", input.triggerId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/**
 * Routing: TODOS los triggers habilitados de un tenant (cualquier Flow),
 * con el status real de su Flow dueño ya incluido (join), listos para
 * pasarle a resolveFlowSelection() -- que es quien decide, de forma pura,
 * cuáles de estos realmente pueden ganar (enabled + Flow published + match).
 * Filas con `config` corrupto/con forma inválida para su `type` se
 * DESCARTAN acá (buildTriggerConfig devuelve null) en vez de romper el
 * routing completo del tenant por una fila mal formada.
 */
export async function listRoutableTriggersForTenant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<RoutableTrigger[]> {
  const { data, error } = await supabase
    .from("dulabs_flow_triggers")
    .select("*, dulabs_flows!inner(status)")
    .eq("tenant_id", tenantId)
    .eq("enabled", true);
  if (error) throw error;

  const rows = (data ?? []) as (FlowTriggerRow & { dulabs_flows: { status: string } })[];
  const result: RoutableTrigger[] = [];
  for (const row of rows) {
    const config = buildTriggerConfig(row.type, row.config);
    if (!config) continue;
    result.push({
      id: row.id,
      tenantId: row.tenant_id,
      flowId: row.flow_id,
      type: config.type,
      config,
      priority: row.priority,
      enabled: row.enabled,
      flowStatus: row.dulabs_flows.status as RoutableTrigger["flowStatus"],
    });
  }
  return result;
}

/**
 * Composición I/O + dominio puro: trae los candidatos reales del tenant del
 * EVENTO (nunca de un tenantId externo -- ver IncomingEvent, siempre viene
 * del contexto autenticado del caller) y delega la decisión determinista a
 * resolveFlowSelection(). Este es el punto de integración que un futuro
 * Flow Engine llamará -- NO ejecuta el Flow seleccionado, solo lo señala.
 */
export async function resolveFlowForIncomingEvent(
  supabase: SupabaseClient,
  event: IncomingEvent,
): Promise<FlowSelectionResult> {
  const candidates = await listRoutableTriggersForTenant(supabase, event.tenantId);
  return resolveFlowSelection(candidates, event);
}

export async function listExecutionsForFlow(
  supabase: SupabaseClient,
  input: { tenantId: string; flowId: string; limit?: number },
): Promise<FlowExecutionRow[]> {
  const { data, error } = await supabase
    .from("dulabs_flow_executions")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("flow_id", input.flowId)
    .order("last_activity_at", { ascending: false })
    .limit(input.limit ?? 100);
  if (error) throw error;
  return (data ?? []) as FlowExecutionRow[];
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
