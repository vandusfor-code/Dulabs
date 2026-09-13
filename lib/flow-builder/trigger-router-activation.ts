/**
 * FASE F8.2 (Trigger Router SaaS — Self-Service Activation, autorizado) —
 * wrappers I/O delgados sobre app/api/flows/[id]/trigger-router/activate y
 * /deactivate. Mismo patrón exacto que lib/flow-builder/activate-flow.ts
 * (F4, sin modificar): fetchImpl inyectable para testear sin red real, la
 * API es la única autoridad (rol, ownership, Flow activo/publicado).
 */

export type FetchLike = typeof fetch;

export type TriggerRouterErrorKind = "unauthorized" | "forbidden" | "not_found" | "conflict" | "network" | "unknown";
export interface TriggerRouterError {
  kind: TriggerRouterErrorKind;
  message: string;
  status?: number;
}
export type TriggerRouterResult =
  | { ok: true; triggerRoutingActivo: boolean }
  | { ok: false; error: TriggerRouterError };

function errorKindForStatus(status: number): TriggerRouterErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return "unknown";
}

async function postTriggerRouter(params: {
  path: "activate" | "deactivate";
  flowId: string;
  phoneNumberId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<TriggerRouterResult> {
  const doFetch = params.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`/api/flows/${params.flowId}/trigger-router/${params.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.accessToken}` },
      body: JSON.stringify({ phoneNumberId: params.phoneNumberId }),
    });
  } catch (err) {
    return { ok: false, error: { kind: "network", message: err instanceof Error ? err.message : "Error de red" } };
  }

  let body: { success?: boolean; triggerRoutingActivo?: boolean; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // respuesta sin cuerpo JSON válido -- se trata como error genérico abajo
  }

  if (response.ok && body.success && typeof body.triggerRoutingActivo === "boolean") {
    return { ok: true, triggerRoutingActivo: body.triggerRoutingActivo };
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

/** POST /api/flows/[id]/trigger-router/activate -- activa el Router SaaS en `phoneNumberId`. */
export async function activateTriggerRouter(params: {
  flowId: string;
  phoneNumberId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<TriggerRouterResult> {
  return postTriggerRouter({ path: "activate", ...params });
}

/** POST /api/flows/[id]/trigger-router/deactivate -- desactiva el Router SaaS en `phoneNumberId`. */
export async function deactivateTriggerRouter(params: {
  flowId: string;
  phoneNumberId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<TriggerRouterResult> {
  return postTriggerRouter({ path: "deactivate", ...params });
}
