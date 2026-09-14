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
import { esAdminDulabs } from "@/lib/admin-tenant";

export interface FlowAccessContext {
  supabase: SupabaseClient;
  miembro: Miembro;
  /**
   * true cuando el acceso se concedió vía override admin (F15.1, Flow
   * Studio administrado) -- el miembro real es admin de DuLabs pero está
   * operando sobre el tenant del cliente, no el suyo. Los llamadores lo
   * usan para decidir qué acción de auditoría registrar.
   */
  esAdminOverride?: boolean;
}

export type FlowAccessResult =
  | { ok: true; ctx: FlowAccessContext }
  | { ok: false; response: Response };

// Header usado EXCLUSIVAMENTE por el Flow Studio administrado (F15.1) para
// indicar sobre qué tenant de cliente está operando el admin de DuLabs.
// Nunca se confía en esto por sí solo -- requireFlowAccess solo lo honra
// si el usuario autenticado ya es esAdminDulabs (miembro real en el tenant
// fijo TENANT_DULABS_ID con rol admin, ver lib/admin-tenant.ts). Un cliente
// normal que mande este header simplemente lo ve ignorado.
export const ADMIN_TENANT_OVERRIDE_HEADER = "x-admin-tenant-id";

/**
 * Bearer token -> supabase.auth.getUser -> resolverMiembroEquipo -> requireRol.
 * tenantId SIEMPRE sale de miembro.tenantId (derivado del usuario
 * autenticado) -- nunca se acepta desde body/query/params del request.
 *
 * opts.allowAdminOverride (F15.1, aditivo): si es true y la request trae el
 * header ADMIN_TENANT_OVERRIDE_HEADER, y el usuario autenticado es
 * esAdminDulabs, el tenantId efectivo pasa a ser el del header en vez del
 * propio del admin -- así el Flow Studio administrado reusa exactamente
 * esta misma función sin duplicar lógica de autorización. Los call sites
 * que no pasan opts (todos los existentes hasta F15.1) quedan idénticos.
 */
export async function requireFlowAccess(
  request: NextRequest,
  roles: Rol[],
  opts?: { allowAdminOverride?: boolean },
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

  if (opts?.allowAdminOverride) {
    const tenantOverride = request.headers.get(ADMIN_TENANT_OVERRIDE_HEADER);
    if (tenantOverride && esAdminDulabs(miembro)) {
      const miembroOverride: Miembro = { ...miembro, tenantId: tenantOverride };
      if (!requireRol(miembroOverride, roles)) {
        return { ok: false, response: Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 }) };
      }
      return { ok: true, ctx: { supabase, miembro: miembroOverride, esAdminOverride: true } };
    }
  }

  if (!requireRol(miembro, roles)) {
    return { ok: false, response: Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 }) };
  }

  return { ok: true, ctx: { supabase, miembro } };
}
