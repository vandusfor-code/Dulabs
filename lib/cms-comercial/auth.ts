/**
 * CMS comercial — AUTORIZACIÓN de /api/dashboard/tienda/*. Mismas tres barreras del catálogo, todas en el backend (el frontend nunca decide):
 *   1. Sesión válida + membresía ACTIVA (reutiliza requireFlowAccess, el helper compartido de las APIs del dashboard). El negocio SIEMPRE sale de la
 *      membresía: jamás de body, query, params ni headers (y sin el «override» de administrador de DuLabs).
 *   2. Rol: lectura = admin, agente, lectura; escritura = solo admin.
 *   3. Módulo `cms_comercial` habilitado para el negocio, verificado de forma ESTRICTA (un error de base de datos es un 500, nunca «permitido»).
 * La política (2 + 3) es la función pura decideCmsAccess, probada sin red ni base de datos.
 */
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/agent-compiler/api/http";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { CMS_MODULE, CMS_ROLES_ESCRITURA, CMS_ROLES_LECTURA, type ActorCms } from "@/lib/cms-comercial/contrato";
import { moduloHabilitado } from "@/lib/tenant-modulos";
import type { Miembro, Rol } from "@/lib/team";

export type CmsAccessMode = "read" | "write";

export type CmsAccessDecision = { allowed: true } | { allowed: false; status: 403; code: "FORBIDDEN" | "MODULE_DISABLED"; message: string };

/** Política pura de acceso (rol + módulo). */
export function decideCmsAccess(input: { role: Rol; mode: CmsAccessMode; moduleEnabled: boolean }): CmsAccessDecision {
  const roles = input.mode === "write" ? CMS_ROLES_ESCRITURA : CMS_ROLES_LECTURA;
  if (!roles.includes(input.role)) {
    return { allowed: false, status: 403, code: "FORBIDDEN", message: input.mode === "write" ? "Solo un administrador puede modificar la tienda." : "No tienes acceso a la administración de la tienda." };
  }
  if (!input.moduleEnabled) {
    return { allowed: false, status: 403, code: "MODULE_DISABLED", message: "La administración de la tienda no está habilitada para tu cuenta." };
  }
  return { allowed: true };
}

export interface CmsAuthContext {
  supabase: SupabaseClient;
  actor: ActorCms;
  member: Miembro;
}

export type CmsAuthResult = { ok: true; ctx: CmsAuthContext } | { ok: false; response: Response };

/** Dependencias inyectables (los tests reemplazan la autenticación, la consulta del módulo y la etiqueta del actor). */
export interface CmsAuthDeps {
  authenticate(request: NextRequest): Promise<{ ok: true; supabase: SupabaseClient; member: Miembro } | { ok: false; status: number; message: string }>;
  isModuleEnabled(supabase: SupabaseClient, tenantId: string): Promise<boolean>;
  /** Nombre o correo del miembro, para el historial («quién lo cambió»). */
  etiqueta(supabase: SupabaseClient, member: Miembro): Promise<string>;
}

const defaultDeps: CmsAuthDeps = {
  async authenticate(request) {
    const access = await requireFlowAccess(request, [...CMS_ROLES_LECTURA]);
    if (access.ok) return { ok: true, supabase: access.ctx.supabase, member: access.ctx.miembro };
    const body = (await access.response
      .clone()
      .json()
      .catch(() => ({}))) as { error?: unknown };
    return { ok: false, status: access.response.status, message: typeof body.error === "string" ? body.error : "No autorizado" };
  },
  isModuleEnabled: (supabase, tenantId) => moduloHabilitado(supabase, tenantId, CMS_MODULE),
  async etiqueta(supabase, member) {
    const respaldo = `Administrador ${member.miembroId}`;
    try {
      const { data } = await supabase.from("dulabs_miembros_equipo").select("nombre, email").eq("id", member.miembroId).maybeSingle();
      const fila = data as { nombre?: string | null; email?: string | null } | null;
      return (fila?.nombre?.trim() || fila?.email?.trim() || respaldo).slice(0, 120);
    } catch {
      return respaldo;
    }
  },
};

export async function requireCms(request: NextRequest, mode: CmsAccessMode, deps: CmsAuthDeps = defaultDeps): Promise<CmsAuthResult> {
  const auth = await deps.authenticate(request);
  if (!auth.ok) {
    return { ok: false, response: apiError(auth.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", auth.message, auth.status) };
  }

  let moduleEnabled: boolean;
  try {
    moduleEnabled = await deps.isModuleEnabled(auth.supabase, auth.member.tenantId);
  } catch (err) {
    console.error("[cms-comercial/auth] no se pudo verificar el módulo:", err instanceof Error ? err.message : err);
    return { ok: false, response: apiError("INTERNAL_ERROR", "No se pudo verificar el acceso a la administración de la tienda.", 500) };
  }

  const decision = decideCmsAccess({ role: auth.member.rol, mode, moduleEnabled });
  if (!decision.allowed) return { ok: false, response: apiError(decision.code, decision.message, decision.status) };

  return {
    ok: true,
    ctx: {
      supabase: auth.supabase,
      member: auth.member,
      // El nombre solo hace falta para firmar lo que se modifica.
      actor: { tenantId: auth.member.tenantId, userId: auth.member.userId, miembroId: auth.member.miembroId, rol: auth.member.rol, etiqueta: mode === "write" ? await deps.etiqueta(auth.supabase, auth.member) : "" },
    },
  };
}
