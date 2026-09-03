/**
 * Auth compartida para /api/flows/* (Fase 1, API de autoría, autorizado).
 *
 * Mismo patrón exacto que ya usa cada ruta de /api/dashboard/* (ver
 * app/api/dashboard/agentes/route.ts::autenticar) -- centralizado acá porque
 * los 9 endpoints nuevos de Flows lo necesitan idéntico, y repetirlo 9 veces
 * más habría sido la duplicación que se pidió evitar. No cambia el patrón,
 * solo evita copiarlo.
 */
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol, type Miembro, type Rol } from "@/lib/team";

export interface FlowAccessContext {
  supabase: SupabaseClient;
  miembro: Miembro;
}

export type FlowAccessResult =
  | { ok: true; ctx: FlowAccessContext }
  | { ok: false; response: Response };

/**
 * Bearer token -> supabase.auth.getUser -> resolverMiembroEquipo -> requireRol.
 * tenantId SIEMPRE sale de miembro.tenantId (derivado del usuario
 * autenticado) -- nunca se acepta desde body/query/params del request.
 */
export async function requireFlowAccess(
  request: NextRequest,
  roles: Rol[],
): Promise<FlowAccessResult> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return { ok: false, response: Response.json({ error: "Falta el token de sesión" }, { status: 401 }) };
  }

  const supabase = supabaseAdmin();
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData.user) {
    return { ok: false, response: Response.json({ error: "Sesión inválida" }, { status: 401 }) };
  }

  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!requireRol(miembro, roles)) {
    return { ok: false, response: Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 }) };
  }

  return { ok: true, ctx: { supabase, miembro } };
}
