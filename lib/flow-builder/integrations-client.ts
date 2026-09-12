/**
 * Fase 5 (Actions + Integrations, autorizado) — wrappers I/O delgados sobre
 * app/api/flows/integrations/**. Mismo patrón exacto que publish-flow.ts/
 * activate-flow.ts: fetchImpl inyectable, la API es la única autoridad.
 */

import type { FlowIntegrationRow } from "@/lib/flow/flow-store-types";

export type FetchLike = typeof fetch;

export type IntegrationsErrorKind = "unauthorized" | "forbidden" | "not_found" | "conflict" | "network" | "unknown";
export interface IntegrationsError {
  kind: IntegrationsErrorKind;
  message: string;
  status?: number;
}

function errorKindForStatus(status: number): IntegrationsErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return "unknown";
}

async function call<T>(
  path: string,
  opts: { method: string; body?: unknown; accessToken: string; fetchImpl?: FetchLike },
): Promise<{ ok: true; body: T } | { ok: false; error: IntegrationsError }> {
  const doFetch = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(path, {
      method: opts.method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.accessToken}` },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    return { ok: false, error: { kind: "network", message: err instanceof Error ? err.message : "Error de red" } };
  }

  let json: Record<string, unknown> = {};
  try {
    json = await response.json();
  } catch {
    // sin cuerpo JSON válido -- se trata como error genérico abajo
  }

  if (response.ok) return { ok: true, body: json as T };
  return {
    ok: false,
    error: { kind: errorKindForStatus(response.status), message: (json.error as string) ?? "Error inesperado", status: response.status },
  };
}

export async function listIntegrations(params: {
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<{ ok: true; integrations: FlowIntegrationRow[] } | { ok: false; error: IntegrationsError }> {
  const result = await call<{ integrations: FlowIntegrationRow[] }>("/api/flows/integrations", { method: "GET", ...params });
  if (!result.ok) return result;
  return { ok: true, integrations: result.body.integrations };
}

export async function createIntegration(params: {
  slug: string;
  displayName: string;
  capability: string;
  url: string;
  httpMethod?: string;
  headersTemplate?: Record<string, string>;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<{ ok: true; integration: FlowIntegrationRow } | { ok: false; error: IntegrationsError }> {
  const { accessToken, fetchImpl, ...body } = params;
  const result = await call<{ integration: FlowIntegrationRow }>("/api/flows/integrations", { method: "POST", body, accessToken, fetchImpl });
  if (!result.ok) return result;
  return { ok: true, integration: result.body.integration };
}

export async function approveIntegration(params: {
  integrationId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<{ ok: true; integration: FlowIntegrationRow } | { ok: false; error: IntegrationsError }> {
  const result = await call<{ integration: FlowIntegrationRow }>(`/api/flows/integrations/${params.integrationId}/approve`, {
    method: "POST",
    accessToken: params.accessToken,
    fetchImpl: params.fetchImpl,
  });
  if (!result.ok) return result;
  return { ok: true, integration: result.body.integration };
}

export async function revokeIntegration(params: {
  integrationId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<{ ok: true; integration: FlowIntegrationRow } | { ok: false; error: IntegrationsError }> {
  const result = await call<{ integration: FlowIntegrationRow }>(`/api/flows/integrations/${params.integrationId}/revoke`, {
    method: "POST",
    accessToken: params.accessToken,
    fetchImpl: params.fetchImpl,
  });
  if (!result.ok) return result;
  return { ok: true, integration: result.body.integration };
}

export async function saveIntegrationCredential(params: {
  integrationId: string;
  credentialKey: string;
  plaintext: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<{ ok: true } | { ok: false; error: IntegrationsError }> {
  const result = await call<{ saved: boolean }>(`/api/flows/integrations/${params.integrationId}/credentials`, {
    method: "POST",
    body: { credentialKey: params.credentialKey, plaintext: params.plaintext },
    accessToken: params.accessToken,
    fetchImpl: params.fetchImpl,
  });
  if (!result.ok) return result;
  return { ok: true };
}

export async function listIntegrationCredentialKeys(params: {
  integrationId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<{ ok: true; credentials: { credentialKey: string; rotatedAt: string | null; updatedAt: string }[] } | { ok: false; error: IntegrationsError }> {
  const result = await call<{ credentials: { credentialKey: string; rotatedAt: string | null; updatedAt: string }[] }>(
    `/api/flows/integrations/${params.integrationId}/credentials`,
    { method: "GET", accessToken: params.accessToken, fetchImpl: params.fetchImpl },
  );
  if (!result.ok) return result;
  return { ok: true, credentials: result.body.credentials };
}
