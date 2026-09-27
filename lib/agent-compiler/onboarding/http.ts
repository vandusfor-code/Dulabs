// DuLabs Business — Business Agent 2.0, FASE 6 — utilidades HTTP de las rutas del onboarding.
//
// El cuerpo de una petición del navegador solo puede traer las claves que cada ruta espera. Cualquier otra (tenantId,
// agentId, capabilities, checksum, compilerVersion…) es rechazo explícito: esos valores son del servidor.

import { apiError } from "@/lib/agent-compiler/api/http";
import { isPlainObject } from "@/lib/agent-compiler/api/business-agent-api";
import { SUPPORT_CODES } from "@/lib/agent-compiler/onboarding/issues";

export async function readBody(request: Request, allowed: readonly string[]): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: apiError(SUPPORT_CODES.DRAFT_INVALID, "No pudimos leer la información enviada.", 400) };
  }
  if (!isPlainObject(body)) return { ok: false, response: apiError(SUPPORT_CODES.DRAFT_INVALID, "No pudimos leer la información enviada.", 400) };
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    return { ok: false, response: apiError(SUPPORT_CODES.DRAFT_INVALID, "La petición incluye datos que solo puede definir DuLabs.", 400, { fields: extra.slice(0, 10) }) };
  }
  return { ok: true, body };
}

export function isRevision(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100_000_000;
}

/** Error inesperado: mensaje humano + código de soporte. El detalle queda en el log del servidor. */
export function unexpected(scope: string, tenantId: string, err: unknown, code: string, message: string): Response {
  console.error(`[business-agent.onboarding] ${scope}_error tenant=${tenantId}:`, err instanceof Error ? err.message : String(err));
  return apiError(code, message, 500);
}
