/**
 * Catálogo DuLabs — AUTORIZACIÓN.
 *
 * Tres barreras, todas en el backend (el frontend nunca decide):
 *   1. Sesión válida + membresía ACTIVA (reutiliza requireFlowAccess, el
 *      helper compartido de las APIs del dashboard: Bearer -> getUser ->
 *      resolverMiembroEquipo). El tenant SIEMPRE sale de la membresía --
 *      jamás de body/query/params/headers.
 *   2. Rol: lectura = admin/agente/lectura; escritura = solo admin.
 *   3. Módulo "catalogo" habilitado para el tenant (dulabs_tenant_modulos),
 *      verificado de forma ESTRICTA (un error de BD => 500, nunca "permitido").
 *
 * La política (2 + 3) es la función pura decideCatalogAccess, probada sin red
 * ni base de datos.
 */
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { moduloHabilitado } from "@/lib/tenant-modulos";
import type { Miembro, Rol } from "@/lib/team";
import { apiError } from "@/lib/agent-compiler/api/http";
import type { CatalogActor } from "@/lib/catalogo/service";

export type CatalogAccessMode = "read" | "write";

export const CATALOG_MODULE = "catalogo" as const;
export const CATALOG_READ_ROLES: readonly Rol[] = ["admin", "agente", "lectura"];
export const CATALOG_WRITE_ROLES: readonly Rol[] = ["admin"];

export type CatalogAccessDecision =
  | { allowed: true }
  | { allowed: false; status: 403; code: "FORBIDDEN" | "MODULE_DISABLED"; message: string };

/** Política pura de acceso al Catálogo (rol + módulo). */
export function decideCatalogAccess(input: { role: Rol; mode: CatalogAccessMode; moduleEnabled: boolean }): CatalogAccessDecision {
  const roles = input.mode === "write" ? CATALOG_WRITE_ROLES : CATALOG_READ_ROLES;
  if (!roles.includes(input.role)) {
    return {
      allowed: false,
      status: 403,
      code: "FORBIDDEN",
      message: input.mode === "write" ? "Solo un administrador puede modificar el catálogo." : "No tienes acceso al catálogo.",
    };
  }
  if (!input.moduleEnabled) {
    return { allowed: false, status: 403, code: "MODULE_DISABLED", message: "El módulo Catálogo no está habilitado para tu cuenta." };
  }
  return { allowed: true };
}

export interface CatalogAuthContext {
  supabase: SupabaseClient;
  actor: CatalogActor;
  member: Miembro;
}

export type CatalogAuthResult = { ok: true; ctx: CatalogAuthContext } | { ok: false; response: Response };

/** Dependencias inyectables (los tests reemplazan la autenticación y la consulta del módulo). */
export interface CatalogAuthDeps {
  authenticate(request: NextRequest): Promise<{ ok: true; supabase: SupabaseClient; member: Miembro } | { ok: false; status: number; message: string }>;
  isModuleEnabled(supabase: SupabaseClient, tenantId: string): Promise<boolean>;
}

const defaultDeps: CatalogAuthDeps = {
  async authenticate(request) {
    // Se autentica con TODOS los roles del catálogo; la regla fina por modo
    // la aplica decideCatalogAccess. Sin override de tenant de admin.
    const access = await requireFlowAccess(request, [...CATALOG_READ_ROLES]);
    if (access.ok) return { ok: true, supabase: access.ctx.supabase, member: access.ctx.miembro };
    const body = (await access.response
      .clone()
      .json()
      .catch(() => ({}))) as { error?: unknown };
    return { ok: false, status: access.response.status, message: typeof body.error === "string" ? body.error : "No autorizado" };
  },
  isModuleEnabled: (supabase, tenantId) => moduloHabilitado(supabase, tenantId, CATALOG_MODULE),
};

export async function requireCatalogo(request: NextRequest, mode: CatalogAccessMode, deps: CatalogAuthDeps = defaultDeps): Promise<CatalogAuthResult> {
  const auth = await deps.authenticate(request);
  if (!auth.ok) {
    return { ok: false, response: apiError(auth.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", auth.message, auth.status) };
  }

  let moduleEnabled: boolean;
  try {
    moduleEnabled = await deps.isModuleEnabled(auth.supabase, auth.member.tenantId);
  } catch (err) {
    console.error("[catalogo/auth] no se pudo verificar el módulo:", err instanceof Error ? err.message : err);
    return { ok: false, response: apiError("INTERNAL_ERROR", "No se pudo verificar el acceso al catálogo.", 500) };
  }

  const decision = decideCatalogAccess({ role: auth.member.rol, mode, moduleEnabled });
  if (!decision.allowed) return { ok: false, response: apiError(decision.code, decision.message, decision.status) };

  return {
    ok: true,
    ctx: {
      supabase: auth.supabase,
      member: auth.member,
      actor: { tenantId: auth.member.tenantId, userId: auth.member.userId },
    },
  };
}
