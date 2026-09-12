/**
 * Fase 2 (Execution Inspector, autorizado) — wrappers I/O delgados sobre las
 * APIs YA EXISTENTES/AMPLIADAS (GET /api/flows/[id]/executions,
 * GET /api/flows/[id]/executions/[executionId]). Mismo patrón exacto que
 * save-flow.ts/publish-flow.ts/simulate-flow-client.ts: ninguna regla de
 * negocio acá, `fetchImpl` inyectable, consume la respuesta tal cual llega.
 */

import type { FlowExecutionRow } from "@/lib/flow/flow-store-types";
import type { ExecutionInspectorDetail } from "@/lib/flow/execution-inspector";

export type FetchLike = typeof fetch;

export type ExecutionsErrorKind = "unauthorized" | "forbidden" | "not_found" | "network" | "unknown";
export interface ExecutionsError {
  kind: ExecutionsErrorKind;
  message: string;
  status?: number;
}

function errorKindForStatus(status: number): ExecutionsErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  return "unknown";
}

export interface ListExecutionsParams {
  flowId: string;
  accessToken: string;
  status?: FlowExecutionRow["status"];
  telefono?: string;
  page?: number;
  pageSize?: number;
  fetchImpl?: FetchLike;
}

export type ListExecutionsResult =
  | { ok: true; executions: FlowExecutionRow[]; total: number; page: number; pageSize: number }
  | { ok: false; error: ExecutionsError };

export async function listExecutions(params: ListExecutionsParams): Promise<ListExecutionsResult> {
  const doFetch = params.fetchImpl ?? fetch;
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.telefono) query.set("telefono", params.telefono);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  const qs = query.toString();

  let response: Response;
  try {
    response = await doFetch(`/api/flows/${params.flowId}/executions${qs ? `?${qs}` : ""}`, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
  } catch (err) {
    return { ok: false, error: { kind: "network", message: err instanceof Error ? err.message : "Error de red" } };
  }

  let body: { executions?: FlowExecutionRow[]; total?: number; page?: number; pageSize?: number; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // respuesta sin cuerpo JSON válido -- se trata como error genérico abajo
  }

  if (response.ok && body.executions) {
    return { ok: true, executions: body.executions, total: body.total ?? body.executions.length, page: body.page ?? 1, pageSize: body.pageSize ?? body.executions.length };
  }
  return { ok: false, error: { kind: errorKindForStatus(response.status), message: body.error ?? "Error cargando ejecuciones", status: response.status } };
}

export interface GetExecutionDetailParams {
  flowId: string;
  executionId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}

export type GetExecutionDetailResult = { ok: true; execution: ExecutionInspectorDetail } | { ok: false; error: ExecutionsError };

export async function getExecutionDetail(params: GetExecutionDetailParams): Promise<GetExecutionDetailResult> {
  const doFetch = params.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`/api/flows/${params.flowId}/executions/${params.executionId}`, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
  } catch (err) {
    return { ok: false, error: { kind: "network", message: err instanceof Error ? err.message : "Error de red" } };
  }

  let body: { execution?: ExecutionInspectorDetail; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // respuesta sin cuerpo JSON válido -- se trata como error genérico abajo
  }

  if (response.ok && body.execution) {
    return { ok: true, execution: body.execution };
  }
  return { ok: false, error: { kind: errorKindForStatus(response.status), message: body.error ?? "Error cargando el detalle de la ejecución", status: response.status } };
}
