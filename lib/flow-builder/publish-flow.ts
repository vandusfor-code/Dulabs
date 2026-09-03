/**
 * Etapa 5 (Flow Builder, autorizado) — wrappers I/O delgados sobre las APIs
 * YA EXISTENTES (app/api/flows/[id]/publish, app/api/flows/[id]/versions
 * GET). Ninguna lógica de publicación acá: publishFlowVersion() manda
 * exactamente {versionId} -- nunca `definition`, nunca `publish:true` en
 * /versions -- la API/RPC ya existentes son la única autoridad. Mismo
 * patrón exacto que save-flow.ts (fetchImpl inyectable para testear sin red
 * real), archivo separado a propósito (decisión aprobada #4).
 */

import type { FlowRow, FlowVersionRow } from "@/lib/flow/flow-store-types";

export type FetchLike = typeof fetch;

export type PublishFlowErrorKind = "unauthorized" | "forbidden" | "not_found" | "network" | "unknown";
export interface PublishFlowError {
  kind: PublishFlowErrorKind;
  message: string;
  status?: number;
}
export type PublishFlowResult = { ok: true; flow: FlowRow } | { ok: false; error: PublishFlowError };

export type FetchVersionsErrorKind = "unauthorized" | "forbidden" | "network" | "unknown";
export interface FetchVersionsError {
  kind: FetchVersionsErrorKind;
  message: string;
  status?: number;
}
export type FetchVersionsResult = { ok: true; versions: FlowVersionRow[] } | { ok: false; error: FetchVersionsError };

function publishErrorKindForStatus(status: number): PublishFlowErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  return "unknown";
}

function versionsErrorKindForStatus(status: number): FetchVersionsErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  return "unknown";
}

/**
 * POST /api/flows/[id]/publish -- SIEMPRE manda el versionId ya guardado
 * (lastSavedVersion.id), nunca la definición en memoria. La API/RPC ya
 * existentes deciden todo (rol, tenant, existencia); esto solo transporta
 * la petición y tipa la respuesta.
 */
export async function publishFlowVersion(params: {
  flowId: string;
  versionId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<PublishFlowResult> {
  const doFetch = params.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`/api/flows/${params.flowId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.accessToken}` },
      body: JSON.stringify({ versionId: params.versionId }),
    });
  } catch (err) {
    return { ok: false, error: { kind: "network", message: err instanceof Error ? err.message : "Error de red" } };
  }

  let body: { flow?: FlowRow; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // respuesta sin cuerpo JSON válido -- se trata como error genérico abajo
  }

  if (response.ok && body.flow) {
    return { ok: true, flow: body.flow };
  }

  return {
    ok: false,
    error: {
      kind: publishErrorKindForStatus(response.status),
      message: body.error ?? "Error publicando el flow",
      status: response.status,
    },
  };
}

/** GET /api/flows/[id]/versions -- devuelve el historial tal cual lo manda la API, sin reinterpretar. */
export async function fetchFlowVersions(params: {
  flowId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<FetchVersionsResult> {
  const doFetch = params.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`/api/flows/${params.flowId}/versions`, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
  } catch (err) {
    return { ok: false, error: { kind: "network", message: err instanceof Error ? err.message : "Error de red" } };
  }

  let body: { versions?: FlowVersionRow[]; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // respuesta sin cuerpo JSON válido -- se trata como error genérico abajo
  }

  if (response.ok && body.versions) {
    return { ok: true, versions: body.versions };
  }

  return {
    ok: false,
    error: {
      kind: versionsErrorKindForStatus(response.status),
      message: body.error ?? "Error cargando versiones",
      status: response.status,
    },
  };
}
