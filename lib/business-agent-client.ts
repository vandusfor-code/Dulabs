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
import type { CalendarConnectionPublic, NylasCalendar } from "@/lib/agent-compiler/calendar/types";
import type { BusinessAgentService } from "@/lib/business-agent-services";
import type { BusinessAgentProduct } from "@/lib/business-agent-products";
import type { BusinessAgentFaq } from "@/lib/business-agent-knowledge/faq";
import type { KnowledgeDocumentRecord } from "@/lib/business-agent-knowledge/store";

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

// ---------------------------------------------------------------------------
// Bloque 15C — Calendario self-service (Nylas). El cliente sólo ve conceptos de
// negocio: "conectar agenda", "elegir calendario". El grant_id JAMÁS llega acá
// (la API devuelve la proyección pública). El tenant sale de la sesión.
// ---------------------------------------------------------------------------

export interface CalendarStatusResponse {
  connection: CalendarConnectionPublic;
  providerAvailable: boolean;
}

export async function getBusinessAgentCalendarStatus(params: AuthParams): Promise<ClientResult<CalendarStatusResponse>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/calendar", {
    headers: flowApiHeaders(params.accessToken, { adminTenantId: params.adminTenantId }),
  });
}

export async function startBusinessAgentCalendarConnect(params: AuthParams): Promise<ClientResult<{ authUrl: string }>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/calendar/connect", {
    method: "POST",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify({}),
  });
}

export async function listBusinessAgentCalendars(params: AuthParams): Promise<ClientResult<{ calendars: NylasCalendar[] }>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/calendar/calendars", {
    headers: flowApiHeaders(params.accessToken, { adminTenantId: params.adminTenantId }),
  });
}

export async function selectBusinessAgentCalendar(params: AuthParams & { calendarId: string }): Promise<ClientResult<{ ok: true }>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/calendar/select", {
    method: "POST",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify({ calendarId: params.calendarId }),
  });
}

export async function disconnectBusinessAgentCalendar(params: AuthParams): Promise<ClientResult<{ ok: true }>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/calendar/disconnect", {
    method: "POST",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify({}),
  });
}

// ---------------------------------------------------------------------------
// Servicios estructurados (dulabs_servicios) — autoservicio del Business Agent.
// El precio y la duración quedan ESTRUCTURADOS (nunca en un prompt); las
// acciones de catálogo del Runtime ya los leen.
// ---------------------------------------------------------------------------

export interface ServiceInput {
  nombre: string;
  categoria?: string | null;
  descripcion?: string | null;
  duracionMin: number;
  precio?: number | null;
  activo?: boolean;
}

export async function listBusinessAgentServices(params: AuthParams): Promise<ClientResult<{ services: BusinessAgentService[] }>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/services", {
    headers: flowApiHeaders(params.accessToken, { adminTenantId: params.adminTenantId }),
  });
}

export async function createBusinessAgentService(params: AuthParams & { input: ServiceInput }): Promise<ClientResult<{ service: BusinessAgentService }>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/services", {
    method: "POST",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify(params.input),
  });
}

export async function updateBusinessAgentService(params: AuthParams & { id: string; input: ServiceInput }): Promise<ClientResult<{ service: BusinessAgentService }>> {
  return callApi(params.fetchImpl ?? fetch, `/api/business-agent/services/${encodeURIComponent(params.id)}`, {
    method: "PUT",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify(params.input),
  });
}

export async function deleteBusinessAgentService(params: AuthParams & { id: string }): Promise<ClientResult<{ ok: true }>> {
  return callApi(params.fetchImpl ?? fetch, `/api/business-agent/services/${encodeURIComponent(params.id)}`, {
    method: "DELETE",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
  });
}

// ---------------------------------------------------------------------------
// Productos estructurados (dulabs_inventario_productos) -- R6. El precio queda ESTRUCTURADO:
// la cotización lo calcula el backend, nunca el modelo.
// ---------------------------------------------------------------------------

export interface ProductInput {
  nombre: string;
  categoria?: string | null;
  descripcion?: string | null;
  precio: number;
  stock?: number;
  activo?: boolean;
}

export async function listBusinessAgentProducts(params: AuthParams): Promise<ClientResult<{ products: BusinessAgentProduct[] }>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/products", {
    headers: flowApiHeaders(params.accessToken, { adminTenantId: params.adminTenantId }),
  });
}

export async function createBusinessAgentProduct(params: AuthParams & { input: ProductInput }): Promise<ClientResult<{ product: BusinessAgentProduct }>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/products", {
    method: "POST",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify(params.input),
  });
}

export async function updateBusinessAgentProduct(params: AuthParams & { id: string; input: ProductInput }): Promise<ClientResult<{ product: BusinessAgentProduct }>> {
  return callApi(params.fetchImpl ?? fetch, `/api/business-agent/products/${encodeURIComponent(params.id)}`, {
    method: "PUT",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify(params.input),
  });
}

export async function deleteBusinessAgentProduct(params: AuthParams & { id: string }): Promise<ClientResult<{ ok: true }>> {
  return callApi(params.fetchImpl ?? fetch, `/api/business-agent/products/${encodeURIComponent(params.id)}`, {
    method: "DELETE",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
  });
}

// ---------------------------------------------------------------------------
// Conocimiento (R4): FAQ estructurada + documentos indexados. El agente los
// RECUPERA por relevancia (nunca se inyectan completos en el prompt).
// ---------------------------------------------------------------------------

export interface KnowledgeOverview {
  faqs: BusinessAgentFaq[];
  documents: KnowledgeDocumentRecord[];
  limits: { faqMax: number; docMax: number; docMaxBytes: number; faqQuestionMax: number; faqAnswerMax: number; extensions: string[] };
}

export interface FaqInput {
  question: string;
  answer: string;
  active?: boolean;
}

export interface KnowledgeSearchResponse {
  found: boolean;
  emptyQuery: boolean;
  hits: Array<{ source: "faq" | "documento"; title: string; content: string; coverage: number }>;
}

export async function getBusinessAgentKnowledge(params: AuthParams): Promise<ClientResult<KnowledgeOverview>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/knowledge", {
    headers: flowApiHeaders(params.accessToken, { adminTenantId: params.adminTenantId }),
  });
}

export async function createBusinessAgentFaq(params: AuthParams & { input: FaqInput }): Promise<ClientResult<{ faq: BusinessAgentFaq; warnings: string[] }>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/knowledge/faqs", {
    method: "POST",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify(params.input),
  });
}

export async function updateBusinessAgentFaq(params: AuthParams & { id: string; input: FaqInput }): Promise<ClientResult<{ faq: BusinessAgentFaq; warnings: string[] }>> {
  return callApi(params.fetchImpl ?? fetch, `/api/business-agent/knowledge/faqs/${encodeURIComponent(params.id)}`, {
    method: "PUT",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify(params.input),
  });
}

export async function deleteBusinessAgentFaq(params: AuthParams & { id: string }): Promise<ClientResult<{ ok: true }>> {
  return callApi(params.fetchImpl ?? fetch, `/api/business-agent/knowledge/faqs/${encodeURIComponent(params.id)}`, {
    method: "DELETE",
    headers: flowApiHeaders(params.accessToken, { adminTenantId: params.adminTenantId }),
  });
}

/** Sube un documento (multipart): el servidor valida tamaño/tipo/firma y lo indexa. */
export async function uploadBusinessAgentDocument(params: AuthParams & { file: File }): Promise<ClientResult<{ document: KnowledgeDocumentRecord }>> {
  const form = new FormData();
  form.append("archivo", params.file);
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/knowledge/documents", {
    method: "POST",
    // Sin Content-Type manual: el navegador agrega el boundary del multipart.
    headers: flowApiHeaders(params.accessToken, { adminTenantId: params.adminTenantId }),
    body: form,
  });
}

export async function deleteBusinessAgentDocument(params: AuthParams & { id: string }): Promise<ClientResult<{ ok: true }>> {
  return callApi(params.fetchImpl ?? fetch, `/api/business-agent/knowledge/documents/${encodeURIComponent(params.id)}`, {
    method: "DELETE",
    headers: flowApiHeaders(params.accessToken, { adminTenantId: params.adminTenantId }),
  });
}

/** "Probar una pregunta": la misma recuperación real que usa el agente. */
export async function searchBusinessAgentKnowledge(params: AuthParams & { query: string }): Promise<ClientResult<KnowledgeSearchResponse>> {
  return callApi(params.fetchImpl ?? fetch, "/api/business-agent/knowledge/search", {
    method: "POST",
    headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
    body: JSON.stringify({ query: params.query }),
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
  params: AuthParams & { flowId: string; phoneNumberId: string; active: boolean; timeoutMs?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const doFetch = params.fetchImpl ?? fetch;
  // Timeout duro (AbortController): la petición NUNCA puede quedar colgada. Sin
  // esto, una respuesta que se estanca dejaba el botón "Conectar" en spinner
  // infinito y sin error (bug real). El caller siempre recibe un resultado.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 20000);
  let response: Response;
  try {
    response = await doFetch(`/api/flows/${params.flowId}/${params.active ? "activate" : "deactivate"}`, {
      method: "POST",
      headers: flowApiHeaders(params.accessToken, { json: true, adminTenantId: params.adminTenantId }),
      body: JSON.stringify({ phoneNumberId: params.phoneNumberId }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, error: "La solicitud tardó demasiado. Revisa tu conexión e inténtalo de nuevo." };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Error de red" };
  } finally {
    clearTimeout(timer);
  }
  if (response.ok) return { ok: true };
  let body: { error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // sin cuerpo JSON
  }
  return { ok: false, error: body.error ?? `Error ${response.status}` };
}
