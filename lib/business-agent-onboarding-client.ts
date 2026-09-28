/**
 * Business Agent 2.0, FASE 6 — cliente del navegador para /api/business-agent/onboarding/*. Sin reglas de negocio:
 * solo llama a la API (fetch inyectable para tests) y traduce errores a {code, message}. Nunca envía tenant, agente,
 * capacidades ni checksums: el servidor los deriva de la sesión y del borrador guardado.
 */
import { flowApiHeaders } from "@/lib/flow-builder/flow-api-headers";
import type { OnboardingDraft } from "@/lib/agent-compiler/onboarding/draft";
import type { OnboardingIssue } from "@/lib/agent-compiler/onboarding/issues";
import type { AgentTestResult, OnboardingOverview, PublishResult, PublishStageEvent, ValidationReport } from "@/lib/agent-compiler/onboarding/service";
import type { ChecklistItem, OnboardingStatus, PublicationRecord, WhatsAppNumberInfo } from "@/lib/agent-compiler/onboarding/status";

export type FetchLike = typeof fetch;

export interface OnboardingClientError {
  code: string;
  message: string;
  status: number;
  details?: unknown;
}
export type OnboardingClientResult<T> = { ok: true; data: T } | { ok: false; error: OnboardingClientError };

export interface OnboardingAuth {
  accessToken: string;
  adminTenantId?: string;
  fetchImpl?: FetchLike;
}

const BASE = "/api/business-agent/onboarding";
const NETWORK: OnboardingClientError = { code: "BA-NET-001", message: "Sin conexión. Tus cambios siguen en esta pantalla; los guardamos apenas vuelva la conexión.", status: 0 };

async function call<T>(auth: OnboardingAuth, path: string, init: RequestInit & { json?: boolean }): Promise<OnboardingClientResult<T>> {
  const doFetch = auth.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${BASE}${path}`, { ...init, headers: flowApiHeaders(auth.accessToken, { adminTenantId: auth.adminTenantId, json: init.json }) });
  } catch {
    return { ok: false, error: NETWORK };
  }
  let body: { success?: boolean; data?: T; error?: { code?: string; message?: string; diagnostics?: unknown } } = {};
  try {
    body = await res.json();
  } catch {
    // sin cuerpo JSON
  }
  if (res.ok && body.success && body.data !== undefined) return { ok: true, data: body.data };
  if (res.status === 401) return { ok: false, error: { code: "BA-AUTH-001", message: "Tu sesión expiró. Vuelve a iniciar sesión; tus cambios guardados siguen aquí.", status: 401 } };
  if (res.status === 403) return { ok: false, error: { code: "BA-AUTH-002", message: "Tu usuario no tiene permiso para hacer esto.", status: 403 } };
  if (res.status === 429) return { ok: false, error: { code: "BA-RATE-001", message: "Vas muy rápido. Espera unos segundos e intenta de nuevo.", status: 429 } };
  return {
    ok: false,
    error: {
      code: body.error?.code ?? `BA-HTTP-${res.status}`,
      // Nunca "500 Internal Server Error": siempre un mensaje humano (el servidor ya lo manda así).
      message: body.error?.message ?? "Hubo un problema. Intenta de nuevo.",
      status: res.status,
      details: body.error?.diagnostics,
    },
  };
}

export function getOnboarding(auth: OnboardingAuth) {
  return call<OnboardingOverview>(auth, "", { method: "GET" });
}

export function saveOnboardingDraft(auth: OnboardingAuth, input: { expectedRevision: number; draft: OnboardingDraft }) {
  return call<{ revision: number; issues: OnboardingIssue[] }>(auth, "", { method: "PUT", json: true, body: JSON.stringify(input) });
}

export function validateOnboarding(auth: OnboardingAuth) {
  return call<ValidationReport>(auth, "/validate", { method: "POST", json: true, body: "{}" });
}

export function getOnboardingStatus(auth: OnboardingAuth) {
  return call<{ status: OnboardingStatus; pendingChanges: boolean; revision: number; publication: PublicationRecord | null; checklist: { items: ChecklistItem[]; readyToActivate: boolean }; numbers: WhatsAppNumberInfo[] }>(auth, "/status", { method: "GET" });
}

export function previewOnboarding(auth: OnboardingAuth, input: { text: string; state: unknown }) {
  return call<{ replies: string[]; state: unknown; actions: Array<{ action: string; status: string; simulated: boolean }>; revision: number }>(auth, "/preview", { method: "POST", json: true, body: JSON.stringify(input) });
}

export function testOnboardingAgent(auth: OnboardingAuth) {
  return call<Extract<AgentTestResult, { ok: true }>>(auth, "/test", { method: "POST", json: true, body: "{}" });
}

export function activateOnboarding(auth: OnboardingAuth, input: { phoneNumberId: string }) {
  return call<{ ok: true; phoneNumberId: string }>(auth, "/activate", { method: "POST", json: true, body: JSON.stringify(input) });
}

/**
 * Publica leyendo el flujo NDJSON: `onStage` recibe cada etapa REAL a medida que ocurre. Si la conexión se corta a
 * mitad, el resultado es desconocido: se devuelve `unknown` para que la pantalla vuelva a consultar el estado real
 * (la publicación es una transacción: o quedó completa o no quedó nada).
 */
export async function publishOnboarding(
  auth: OnboardingAuth,
  input: { expectedRevision: number },
  onStage: (e: PublishStageEvent & { label?: string }) => void,
): Promise<OnboardingClientResult<PublishResult> | { ok: false; error: OnboardingClientError; unknown: true }> {
  const doFetch = auth.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${BASE}/publish`, { method: "POST", headers: flowApiHeaders(auth.accessToken, { adminTenantId: auth.adminTenantId, json: true }), body: JSON.stringify(input) });
  } catch {
    return { ok: false, error: NETWORK };
  }
  if (!res.ok || !res.body) {
    let body: { error?: { code?: string; message?: string } } = {};
    try {
      body = await res.json();
    } catch {
      // sin cuerpo
    }
    if (res.status === 401) return { ok: false, error: { code: "BA-AUTH-001", message: "Tu sesión expiró. Vuelve a iniciar sesión; tu configuración guardada sigue aquí.", status: 401 } };
    return { ok: false, error: { code: body.error?.code ?? `BA-HTTP-${res.status}`, message: body.error?.message ?? "Hubo un problema al publicar tu agente.", status: res.status } };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: PublishResult | null = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { type: string } & Record<string, unknown>;
        if (msg.type === "stage") onStage(msg as unknown as PublishStageEvent & { label?: string });
        if (msg.type === "result") {
          const { type: _t, ...rest } = msg;
          void _t;
          final = rest as unknown as PublishResult;
        }
      }
    }
  } catch {
    return { ok: false, error: { code: "BA-PUB-008", message: "Se cortó la conexión mientras publicábamos. Revisamos el estado real de tu agente.", status: 0 }, unknown: true };
  }
  if (!final) return { ok: false, error: { code: "BA-PUB-008", message: "Se cortó la conexión mientras publicábamos. Revisamos el estado real de tu agente.", status: 0 }, unknown: true };
  return { ok: true, data: final };
}
