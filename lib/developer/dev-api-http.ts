import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverSesionWorkspace, resolverUsuarioDesdeToken, resolverWorkspaceSeleccionado, extraerBearer, type ContextoSesion } from "@/lib/developer/session-workspace";
import type { RolDev } from "@/lib/developer/memberships-store";

// DuLabs Developer V1 -- Fase 9 (Developer Dashboard, autorizado, D1).
// Envoltorio de las rutas Next del Dashboard (app/api/developer/*). Superficie
// de SESIÓN (Supabase Auth Bearer) -- distinta del Gateway público por API
// key. Reutiliza EXACTAMENTE la resolución de Fase 8/9
// (session-workspace.ts): misma autorización, cero duplicación. Corre con
// service_role server-side (nunca en el navegador).

export type DevCtx = ContextoSesion & { supabase: SupabaseClient; requestId: string };

const CODIGO_POR_MOTIVO: Record<string, string> = {
  falta_token_sesion: "missing_session",
  sesion_invalida: "invalid_session",
  sin_membresia_activa: "no_membership",
  workspace_ambiguo: "workspace_required",
  workspace_no_autorizado: "workspace_forbidden",
  forbidden: "forbidden",
};

export function jsonError(status: number, code: string, requestId: string, detalle?: string): Response {
  return Response.json({ error: { code, request_id: requestId, ...(detalle ? { detalle } : {}) } }, { status });
}

export function jsonOk(cuerpo: Record<string, unknown>, requestId: string, status = 200): Response {
  return Response.json(cuerpo, { status, headers: { "X-Request-Id": requestId } });
}

/**
 * Resuelve sesión + workspace seleccionado + rol y aplica el gate de rol
 * (D4). Uniforma el error (código estable + request_id) y nunca filtra
 * detalles de infraestructura. Un error interno real => 500 internal_error.
 */
export async function conSesionDeveloper(
  req: NextRequest,
  rolesPermitidos: RolDev[],
  fn: (ctx: DevCtx) => Promise<Response>
): Promise<Response> {
  const requestId = `dev_${randomUUID()}`;
  const supabase = supabaseAdmin();
  try {
    const r = await resolverSesionWorkspace(supabase, {
      autorizacion: req.headers.get("authorization"),
      workspaceHeader: req.headers.get("x-dulabs-workspace") ?? undefined,
      rolesPermitidos,
    });
    if (!r.ok) return jsonError(r.status, CODIGO_POR_MOTIVO[r.error] ?? r.error, requestId);
    return await fn({ ...r.ctx, supabase, requestId });
  } catch (err) {
    console.error(`[dev-api] error interno (request_id=${requestId}):`, err instanceof Error ? err.message : String(err));
    return jsonError(500, "internal_error", requestId);
  }
}

export type DevUsuarioCtx = { userId: string; supabase: SupabaseClient; requestId: string };

/**
 * Variante que SOLO exige una sesión válida (sin resolver un workspace
 * concreto) -- necesaria para GET /api/developer/workspace, que debe poder
 * devolver la LISTA de workspaces para poblar el selector incluso cuando el
 * usuario tiene varios y todavía no eligió uno.
 */
export async function conUsuarioDeveloper(req: NextRequest, fn: (ctx: DevUsuarioCtx) => Promise<Response>): Promise<Response> {
  const requestId = `dev_${randomUUID()}`;
  const supabase = supabaseAdmin();
  try {
    const token = extraerBearer(req.headers.get("authorization"));
    if (!token) return jsonError(401, "missing_session", requestId);
    const userId = await resolverUsuarioDesdeToken(supabase, token);
    if (!userId) return jsonError(401, "invalid_session", requestId);
    return await fn({ userId, supabase, requestId });
  } catch (err) {
    console.error(`[dev-api] error interno (request_id=${requestId}):`, err instanceof Error ? err.message : String(err));
    return jsonError(500, "internal_error", requestId);
  }
}

/** Selección "suave" para el endpoint de workspace: nunca falla por ambigüedad; devuelve la lista + el seleccionado (o null si hay varios y no se envió header). */
export async function resolverSeleccionSuave(
  supabase: SupabaseClient,
  params: { userId: string; workspaceHeader?: string }
): Promise<{ seleccionado: { workspaceId: string; rol: RolDev } | null }> {
  const sel = await resolverWorkspaceSeleccionado(supabase, params);
  return { seleccionado: sel.ok ? { workspaceId: sel.workspaceId, rol: sel.rol } : null };
}
