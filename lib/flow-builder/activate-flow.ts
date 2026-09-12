/**
 * Fase 4 (Self-Service Flow Activation, autorizado) — wrappers I/O delgados
 * sobre app/api/flows/[id]/activate y /deactivate. Mismo patrón exacto que
 * publish-flow.ts: fetchImpl inyectable para testear sin red real, la API es
 * la única autoridad (rol, ownership, status "published", anti-secuestro de
 * número).
 */

import type { ClienteConfig } from "@/lib/supabase";

export type FetchLike = typeof fetch;

export type ActivateFlowErrorKind = "unauthorized" | "forbidden" | "not_found" | "conflict" | "network" | "unknown";
export interface ActivateFlowError {
  kind: ActivateFlowErrorKind;
  message: string;
  status?: number;
}
export type ActivateFlowResult = { ok: true; negocio: ClienteConfig } | { ok: false; error: ActivateFlowError };

function errorKindForStatus(status: number): ActivateFlowErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return "unknown";
}

async function postActivation(params: {
  path: "activate" | "deactivate";
  flowId: string;
  phoneNumberId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<ActivateFlowResult> {
  const doFetch = params.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`/api/flows/${params.flowId}/${params.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.accessToken}` },
      body: JSON.stringify({ phoneNumberId: params.phoneNumberId }),
    });
  } catch (err) {
    return { ok: false, error: { kind: "network", message: err instanceof Error ? err.message : "Error de red" } };
  }

  let body: { negocio?: ClienteConfig; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // respuesta sin cuerpo JSON válido -- se trata como error genérico abajo
  }

  if (response.ok && body.negocio) {
    return { ok: true, negocio: body.negocio };
  }

  return {
    ok: false,
    error: {
      kind: errorKindForStatus(response.status),
      message: body.error ?? "Error inesperado",
      status: response.status,
    },
  };
}

/** POST /api/flows/[id]/activate -- activa este Flow en `phoneNumberId`. */
export async function activateFlow(params: {
  flowId: string;
  phoneNumberId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<ActivateFlowResult> {
  return postActivation({ path: "activate", ...params });
}

/** POST /api/flows/[id]/deactivate -- desactiva este Flow en `phoneNumberId`. */
export async function deactivateFlow(params: {
  flowId: string;
  phoneNumberId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<ActivateFlowResult> {
  return postActivation({ path: "deactivate", ...params });
}
