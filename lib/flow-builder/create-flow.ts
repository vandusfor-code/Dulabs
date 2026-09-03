/**
 * Etapa 6 (Flow Builder, autorizado) — wrappers I/O delgados sobre
 * POST /api/flows y POST /api/flows/[id]/initial-version. Mismo patrón que
 * saveFlowVersion (save-flow.ts): fetchImpl inyectable, sin reglas de
 * negocio acá -- ambos endpoints ya devuelven la version creada, así que el
 * frontend nunca encadena una segunda llamada por su cuenta para "terminar"
 * de crear un Flow.
 */

import type { FlowRow, FlowVersionRow } from "@/lib/flow/flow-store-types";

export type FetchLike = typeof fetch;

/**
 * Slug único y determinista a partir del nombre -- evita el 409 de
 * POST /api/flows (constraint único tenant_id+slug) sin pedirle un slug
 * aparte al usuario. Reglas sin cambiar respecto a como ya vivían en
 * FlowsListPage.
 */
export function slugFromNombre(nombre: string): string {
  const base = nombre
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "flow"}-${Date.now().toString(36)}`;
}

export type CreateFlowErrorKind = "invalid_name" | "slug_conflict" | "unauthorized" | "forbidden" | "network" | "unknown";
export interface CreateFlowError {
  kind: CreateFlowErrorKind;
  message: string;
  status?: number;
}
export type CreateFlowResult = { ok: true; flow: FlowRow; version: FlowVersionRow } | { ok: false; error: CreateFlowError };

function createErrorKindForStatus(status: number): CreateFlowErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 409) return "slug_conflict";
  if (status === 400) return "invalid_name";
  return "unknown";
}

/** POST /api/flows -- crea el Flow Y su primera versión Draft en un solo request. */
export async function createFlow(params: {
  name: string;
  description?: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<CreateFlowResult> {
  const nombre = params.name.trim();
  if (!nombre) {
    return { ok: false, error: { kind: "invalid_name", message: "El nombre del Flow no puede estar vacío" } };
  }

  const doFetch = params.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch("/api/flows", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.accessToken}` },
      body: JSON.stringify({
        slug: slugFromNombre(nombre),
        name: nombre,
        description: params.description?.trim() || undefined,
      }),
    });
  } catch (err) {
    return { ok: false, error: { kind: "network", message: err instanceof Error ? err.message : "Error de red" } };
  }

  let body: { flow?: FlowRow; version?: FlowVersionRow; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // respuesta sin cuerpo JSON válido -- error genérico abajo
  }

  if (response.ok && body.flow && body.version) {
    return { ok: true, flow: body.flow, version: body.version };
  }

  return {
    ok: false,
    error: { kind: createErrorKindForStatus(response.status), message: body.error ?? "Error creando el Flow", status: response.status },
  };
}

export type EnsureInitialVersionErrorKind = "unauthorized" | "forbidden" | "not_found" | "network" | "unknown";
export interface EnsureInitialVersionError {
  kind: EnsureInitialVersionErrorKind;
  message: string;
  status?: number;
}
export type EnsureInitialVersionResult = { ok: true; version: FlowVersionRow } | { ok: false; error: EnsureInitialVersionError };

/**
 * POST /api/flows/[id]/initial-version -- recuperación para un Flow
 * existente sin ninguna versión (ver ensureInitialFlowVersion en
 * flow-store.ts). Idempotente: llamarlo dos veces nunca produce una v2.
 */
export async function ensureInitialVersion(params: {
  flowId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<EnsureInitialVersionResult> {
  const doFetch = params.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`/api/flows/${params.flowId}/initial-version`, {
      method: "POST",
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
  } catch (err) {
    return { ok: false, error: { kind: "network", message: err instanceof Error ? err.message : "Error de red" } };
  }

  let body: { version?: FlowVersionRow; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // respuesta sin cuerpo JSON válido -- error genérico abajo
  }

  if (response.ok && body.version) {
    return { ok: true, version: body.version };
  }

  const kind: EnsureInitialVersionErrorKind =
    response.status === 401
      ? "unauthorized"
      : response.status === 403
        ? "forbidden"
        : response.status === 404
          ? "not_found"
          : "unknown";
  return { ok: false, error: { kind, message: body.error ?? "Error preparando el Flow", status: response.status } };
}
