/**
 * Bloque B (Authoring UI, autorizado) — wrappers I/O delgados sobre
 * /api/business-agent/*. Mismo patrón que lib/flow-builder/create-flow.ts
 * (fetchImpl inyectable, sin reglas de negocio acá, headers vía
 * flowApiHeaders). Parsea el envelope {success,data}/{success:false,error}
 * de esta API (distinto del {error} plano de /api/flows/*).
 */
import { flowApiHeaders } from "@/lib/flow-builder/flow-api-headers";
import type { AgentSummaryPublic, AgentVersionPublic } from "@/lib/agent-compiler/api/business-agent-api";
import type { AgentVersionSummary } from "@/lib/agent-compiler/registry/types";
import type { PreviewTurnResult, SimulationInputEvent } from "@/lib/agent-compiler/api/preview";
import type { CompilerDiagnostic } from "@/lib/agent-compiler/diagnostics";

export type FetchLike = typeof fetch;

export interface ClientApiError {
  code: string;
  message: string;
  diagnostics?: CompilerDiagnostic[];
  status: number;
}
export type ClientResult<T> = { ok: true; data: T } | { ok: false; error: ClientApiError };

async function callApi<T>(
  doFetch: FetchLike,
  input: string,
  init: RequestInit,
): Promise<ClientResult<T>> {
  let response: Response;
  try {
    response = await doFetch(input, init);
  } catch (err) {
    return { ok: false, error: { code: "NETWORK_ERROR", message: err instanceof Error ? err.message : "Error de red", status: 0 } };
  }
  let body: { success?: boolean; data?: T; error?: { code: string; message: string; diagnostics?: CompilerDiagnostic[] } } = {};
  try {
    body = await response.json();
  } catch {
    // respuesta sin cuerpo JSON válido -- error genérico abajo
  }
  if (response.ok && body.success && body.data !== undefined) {
    return { ok: true, data: body.data };
  }
  return {
    ok: false,
    error: {
      code: body.error?.code ?? "UNKNOWN",
      message: body.error?.message ?? "Error inesperado",
      diagnostics: body.error?.diagnostics,
      status: response.status,
    },
  };
}

interface AuthParams {
  accessToken: string;
  adminTenantId?: string;
  fetchImpl?: FetchLike;
}

export async function getCurrentBusinessAgent(params: AuthParams): Promise<ClientResult<AgentSummaryPublic>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent", { headers: flowApiHeaders(params.accessToken, { adminTenantId: params.adminTenantId }) });
}

export async function listBusinessAgentVersions(params: AuthParams): Promise<ClientResult<{ versions: AgentVersionSummary[] }>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/versions", { headers: flowApiHeaders(params.accessToken, { adminTenantId: params.adminTenantId }) });
}

export async function getBusinessAgentVersion(params: AuthParams & { flowVersionId: string }): Promise<ClientResult<AgentVersionPublic>> {
  return callApi(params.fetchImpl ?? fetch, `/api/business-agent/versions/${params.flowVersionId}`, { headers: flowApiHeaders(params.accessToken, { adminTenantId: params.adminTenantId }) });
}

export async function saveBusinessAgentDraft(
  params: AuthParams & { editableSpec: object; baseVersionNumber?: number },
): Promise<ClientResult<AgentVersionPublic>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/draft", {
    method: "POST",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify({ ...params.editableSpec, baseVersionNumber: params.baseVersionNumber }),
  });
}

export interface ValidateResponse {
  valid: boolean;
  validationStatus: "validated" | "failed";
  diagnostics: CompilerDiagnostic[];
  checksums?: { spec: string; ir: string; flow: string };
}

export async function validateBusinessAgentSpecDraft(
  params: AuthParams & { editableSpec: object },
): Promise<ClientResult<ValidateResponse>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/validate", {
    method: "POST",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify(params.editableSpec),
  });
}

export interface PublishResponse {
  flowId: string;
  flowVersionId: string;
  publishedAt: string;
  supersededVersionId: string | null;
}

export async function publishBusinessAgentDraft(
  params: AuthParams & { flowVersionId: string; expectedChecksum?: string },
): Promise<ClientResult<PublishResponse>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/publish", {
    method: "POST",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify({ flowVersionId: params.flowVersionId, expectedChecksum: params.expectedChecksum }),
  });
}

export interface RollbackResponse extends PublishResponse {
  alreadyPublished: boolean;
}

export async function rollbackBusinessAgent(
  params: AuthParams & { flowVersionId: string; confirm: boolean },
): Promise<ClientResult<RollbackResponse>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/rollback", {
    method: "POST",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify({ flowVersionId: params.flowVersionId, confirm: params.confirm }),
  });
}

export interface PreviewResponse extends PreviewTurnResult {
  flowVersionId: string;
  versionNumber: number;
}

export async function previewBusinessAgent(
  params: AuthParams & { flowVersionId?: string; engineState: unknown; event: SimulationInputEvent },
): Promise<ClientResult<PreviewResponse>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/preview", {
    method: "POST",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify({ flowVersionId: params.flowVersionId, engineState: params.engineState, event: params.event }),
  });
}

export interface BlockedNumbersResponse {
  phoneNumberId: string;
  blockedNumbers: string[];
  skipped?: string[];
}

export async function getBlockedNumbers(params: AuthParams & { phoneNumberId: string }): Promise<ClientResult<BlockedNumbersResponse>> {
  return callApi(params.fetchImpl ?? fetch, `/api/business-agent/blocked-numbers?phoneNumberId=${encodeURIComponent(params.phoneNumberId)}`, {
    headers: flowApiHeaders(params.accessToken, { adminTenantId: params.adminTenantId }),
  });
}

export async function addBlockedNumber(params: AuthParams & { phoneNumberId: string; numero: string }): Promise<ClientResult<BlockedNumbersResponse>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/blocked-numbers", {
    method: "POST",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify({ phoneNumberId: params.phoneNumberId, numero: params.numero }),
  });
}

export async function removeBlockedNumber(params: AuthParams & { phoneNumberId: string; numero: string }): Promise<ClientResult<BlockedNumbersResponse>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/blocked-numbers", {
    method: "DELETE",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify({ phoneNumberId: params.phoneNumberId, numero: params.numero }),
  });
}

/**
 * Conecta/desconecta el Business Agent (su flowId, un dulabs_flows normal) a
 * un número de WhatsApp del tenant -- REUTILIZA el mecanismo de Self-Service
 * Flow Activation existente (POST /api/flows/[id]/activate|deactivate,
 * lib/flow/flow-activation.ts), el MISMO que usa Flow Studio. No se crea un
 * segundo mecanismo de binding para Business Agent.
 */
export async function setBusinessAgentActiveOnNumber(
  params: AuthParams & { flowId: string; phoneNumberId: string; active: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const doFetch = params.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`/api/flows/${params.flowId}/${params.active ? "activate" : "deactivate"}`, {
      method: "POST",
      headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
      body: JSON.stringify({ phoneNumberId: params.phoneNumberId }),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error de red" };
  }
  if (response.ok) return { ok: true };
  let body: { error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // sin cuerpo
  }
  return { ok: false, error: body.error ?? "Error inesperado" };
}
