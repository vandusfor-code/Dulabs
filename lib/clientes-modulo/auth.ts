/**
 * Módulo Clientes — AUTORIZACIÓN (mismo esquema que el Catálogo).
 *
 * Tres barreras en el backend (el frontend nunca decide):
 *   1. Sesión válida + membresía ACTIVA (requireFlowAccess). El tenant sale
 *      SIEMPRE de la membresía, jamás de body/query/params/headers (sin
 *      override de administrador).
 *   2. Rol: ver = admin/agente/lectura; cambiar estado o asesor = admin/agente.
 *   3. Módulo "clientes" habilitado para el tenant (dulabs_tenant_modulos),
 *      verificado de forma ESTRICTA: un error de base de datos es 500, nunca
 *      "permitido".
 */
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { moduloHabilitado } from "@/lib/tenant-modulos";
import type { Miembro, Rol } from "@/lib/team";

export const CLIENTES_MODULE = "clientes" as const;
export const CLIENTES_READ_ROLES: readonly Rol[] = ["admin", "agente", "lectura"];
export const CLIENTES_WRITE_ROLES: readonly Rol[] = ["admin", "agente"];

export type ClientesAccessMode = "read" | "write";

export type ClientesAccessDecision = { allowed: true } | { allowed: false; status: 403; message: string };

/** Política pura: rol + módulo. */
export function decidirAccesoClientes(input: { rol: Rol; modo: ClientesAccessMode; moduloHabilitado: boolean }): ClientesAccessDecision {
  const roles = input.modo === "write" ? CLIENTES_WRITE_ROLES : CLIENTES_READ_ROLES;
  if (!roles.includes(input.rol)) {
    return {
      allowed: false,
      status: 403,
      message: input.modo === "write" ? "No tienes permiso para modificar clientes." : "No tienes acceso a clientes.",
    };
  }
  if (!input.moduloHabilitado) return { allowed: false, status: 403, message: "El módulo Clientes no está habilitado para tu cuenta." };
  return { allowed: true };
}

export interface ClientesAuthDeps {
  authenticate(request: NextRequest): Promise<{ ok: true; supabase: SupabaseClient; member: Miembro } | { ok: false; response: Response }>;
  isModuleEnabled(supabase: SupabaseClient, tenantId: string): Promise<boolean>;
}

const defaultDeps: ClientesAuthDeps = {
  async authenticate(request) {
    const access = await requireFlowAccess(request, [...CLIENTES_READ_ROLES]);
    if (!access.ok) return { ok: false, response: access.response };
    return { ok: true, supabase: access.ctx.supabase, member: access.ctx.miembro };
  },
  isModuleEnabled: (supabase, tenantId) => moduloHabilitado(supabase, tenantId, CLIENTES_MODULE),
};

export type ClientesAuthResult = { ok: true; supabase: SupabaseClient; tenantId: string; member: Miembro } | { ok: false; response: Response };

export async function requireClientes(
  request: NextRequest,
  modo: ClientesAccessMode,
  deps: ClientesAuthDeps = defaultDeps,
): Promise<ClientesAuthResult> {
  const auth = await deps.authenticate(request);
  if (!auth.ok) return auth;

  let habilitado: boolean;
  try {
    habilitado = await deps.isModuleEnabled(auth.supabase, auth.member.tenantId);
  } catch (err) {
    console.error("[clientes/auth] no se pudo verificar el módulo:", err instanceof Error ? err.message : err);
    return { ok: false, response: Response.json({ error: "No se pudo verificar el acceso a clientes." }, { status: 500 }) };
  }

  const decision = decidirAccesoClientes({ rol: auth.member.rol, modo, moduloHabilitado: habilitado });
  if (!decision.allowed) return { ok: false, response: Response.json({ error: decision.message }, { status: decision.status }) };

  return { ok: true, supabase: auth.supabase, tenantId: auth.member.tenantId, member: auth.member };
}
