/**
 * Fase 3 (Flow Builder, autorizado) — wrappers I/O delgados sobre
 * GET/POST /api/flows/[id]/triggers y PATCH/DELETE
 * /api/flows/[id]/triggers/[triggerId]. Mismo patrón que create-flow.ts/
 * save-flow.ts: fetchImpl inyectable, sin reglas de negocio acá (esas viven
 * en lib/flow-triggers/, código puro sin fetch).
 */

import type { FlowTrigger, TriggerConfig } from "@/lib/flow-triggers/types";

export type FetchLike = typeof fetch;

export type TriggersErrorKind = "invalid" | "unauthorized" | "forbidden" | "not_found" | "network" | "unknown";
export interface TriggersError {
  kind: TriggersErrorKind;
  message: string;
  status?: number;
}

function errorKindForStatus(status: number): TriggersErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 400) return "invalid";
  return "unknown";
}

interface FlowTriggerApiRow {
  id: string;
  tenant_id: string;
  flow_id: string;
  type: string;
  enabled: boolean;
  priority: number;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function rowToFlowTrigger(row: FlowTriggerApiRow): FlowTrigger {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    flowId: row.flow_id,
    type: row.type as FlowTrigger["type"],
    enabled: row.enabled,
    priority: row.priority,
    config: { type: row.type, ...row.config } as TriggerConfig,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ListTriggersResult = { ok: true; triggers: FlowTrigger[] } | { ok: false; error: TriggersError };

export async function listTriggers(params: { flowId: string; accessToken: string; fetchImpl?: FetchLike }): Promise<ListTriggersResult> {
  const doFetch = params.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`/api/flows/${params.flowId}/triggers`, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
  } catch (err) {
    return { ok: false, error: { kind: "network", message: err instanceof Error ? err.message : "Error de red" } };
  }
  let body: { triggers?: FlowTriggerApiRow[]; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // sin cuerpo JSON válido -- error genérico abajo
  }
  if (response.ok && body.triggers) {
    return { ok: true, triggers: body.triggers.map(rowToFlowTrigger) };
  }
  return { ok: false, error: { kind: errorKindForStatus(response.status), message: body.error ?? "Error cargando los triggers", status: response.status } };
}

export type TriggerResult = { ok: true; trigger: FlowTrigger } | { ok: false; error: TriggersError };

export async function createTrigger(params: {
  flowId: string;
  config: TriggerConfig;
  priority?: number;
  enabled?: boolean;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<TriggerResult> {
  const doFetch = params.fetchImpl ?? fetch;
  const { type, ...config } = params.config;
  let response: Response;
  try {
    response = await doFetch(`/api/flows/${params.flowId}/triggers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.accessToken}` },
      body: JSON.stringify({ type, config, priority: params.priority, enabled: params.enabled }),
    });
  } catch (err) {
    return { ok: false, error: { kind: "network", message: err instanceof Error ? err.message : "Error de red" } };
  }
  let body: { trigger?: FlowTriggerApiRow; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // sin cuerpo JSON válido -- error genérico abajo
  }
  if (response.ok && body.trigger) return { ok: true, trigger: rowToFlowTrigger(body.trigger) };
  return { ok: false, error: { kind: errorKindForStatus(response.status), message: body.error ?? "Error creando el trigger", status: response.status } };
}

export async function updateTrigger(params: {
  flowId: string;
  triggerId: string;
  config?: TriggerConfig;
  priority?: number;
  enabled?: boolean;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<TriggerResult> {
  const doFetch = params.fetchImpl ?? fetch;
  const patch: { config?: Record<string, unknown>; priority?: number; enabled?: boolean } = {};
  if (params.config) {
    patch.config = Object.fromEntries(Object.entries(params.config).filter(([key]) => key !== "type"));
  }
  if (params.priority !== undefined) patch.priority = params.priority;
  if (params.enabled !== undefined) patch.enabled = params.enabled;

  let response: Response;
  try {
    response = await doFetch(`/api/flows/${params.flowId}/triggers/${params.triggerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.accessToken}` },
      body: JSON.stringify(patch),
    });
  } catch (err) {
    return { ok: false, error: { kind: "network", message: err instanceof Error ? err.message : "Error de red" } };
  }
  let body: { trigger?: FlowTriggerApiRow; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // sin cuerpo JSON válido -- error genérico abajo
  }
  if (response.ok && body.trigger) return { ok: true, trigger: rowToFlowTrigger(body.trigger) };
  return { ok: false, error: { kind: errorKindForStatus(response.status), message: body.error ?? "Error actualizando el trigger", status: response.status } };
}

export type DeleteTriggerResult = { ok: true } | { ok: false; error: TriggersError };

export async function deleteTrigger(params: { flowId: string; triggerId: string; accessToken: string; fetchImpl?: FetchLike }): Promise<DeleteTriggerResult> {
  const doFetch = params.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`/api/flows/${params.flowId}/triggers/${params.triggerId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
  } catch (err) {
    return { ok: false, error: { kind: "network", message: err instanceof Error ? err.message : "Error de red" } };
  }
  if (response.ok) return { ok: true };
  let body: { error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // sin cuerpo JSON válido -- error genérico abajo
  }
  return { ok: false, error: { kind: errorKindForStatus(response.status), message: body.error ?? "Error eliminando el trigger", status: response.status } };
}
