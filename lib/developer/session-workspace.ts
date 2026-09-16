import type { SupabaseClient } from "@supabase/supabase-js";
import { listarWorkspacesDelUsuario, type RolDev } from "@/lib/developer/memberships-store";

// DuLabs Developer V1 -- Fase 9 (Developer Dashboard, autorizado, D1).
// ÚNICA fuente de verdad de la resolución sesión -> workspace -> rol para
// las superficies de SESIÓN (Supabase Auth), compartida por:
//   - el Gateway Cloud Run (services/gateway/management-handler.ts), y
//   - las rutas Next del Dashboard (app/api/developer/*).
// Extraído de conWorkspaceAutenticado (Fase 8) sin cambiar su contrato -- así
// ninguna de las dos superficies puede divergir en autorización.

export function extraerBearer(header: string | undefined | null): string | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  const valor = header.slice("Bearer ".length).trim();
  return valor.length > 0 ? valor : null;
}

/** Resuelve el user_id (Supabase Auth) desde el token de sesión. El backend corre con service_role (bypassea RLS): la identidad humana se valida con auth.getUser, nunca con un id del request. */
export async function resolverUsuarioDesdeToken(supabase: SupabaseClient, tokenSesion: string): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser(tokenSesion);
  if (error || !data?.user) return null;
  return data.user.id;
}

export type SeleccionWorkspace =
  | { ok: true; workspaceId: string; rol: RolDev }
  | { ok: false; status: number; error: string };

/**
 * D3 -- selección de workspace. NUNCA confía en un workspace_id del cliente:
 * `workspaceHeader` (X-Dulabs-Workspace) solo se acepta si está dentro de los
 * workspaces con membresía Developer efectiva del usuario (incluye fallback
 * Business, D2). Sin header + un solo workspace => ese; varios => se exige el
 * header (nunca se elige "al azar").
 */
export async function resolverWorkspaceSeleccionado(
  supabase: SupabaseClient,
  params: { userId: string; workspaceHeader?: string }
): Promise<SeleccionWorkspace> {
  const workspaces = await listarWorkspacesDelUsuario(supabase, params.userId);
  if (workspaces.length === 0) return { ok: false, status: 401, error: "sin_membresia_activa" };

  const header = params.workspaceHeader?.trim();
  if (header) {
    const match = workspaces.find((w) => w.workspaceId === header);
    if (!match) return { ok: false, status: 403, error: "workspace_no_autorizado" };
    return { ok: true, workspaceId: match.workspaceId, rol: match.rol };
  }
  if (workspaces.length === 1) return { ok: true, workspaceId: workspaces[0].workspaceId, rol: workspaces[0].rol };
  return { ok: false, status: 400, error: "workspace_ambiguo" };
}

export type ContextoSesion = { workspaceId: string; userId: string; rol: RolDev };

export type ResolucionSesion =
  | { ok: true; ctx: ContextoSesion }
  | { ok: false; status: number; error: string };

/**
 * Resolución completa: token -> userId -> workspace seleccionado -> rol, con
 * gate de rol (D4). `rolesPermitidos` es la lista de roles que pueden
 * ejecutar la operación; un rol fuera de esa lista => 403 forbidden.
 */
export async function resolverSesionWorkspace(
  supabase: SupabaseClient,
  params: { autorizacion: string | undefined | null; workspaceHeader?: string; rolesPermitidos: RolDev[] }
): Promise<ResolucionSesion> {
  const token = extraerBearer(params.autorizacion);
  if (!token) return { ok: false, status: 401, error: "falta_token_sesion" };
  const userId = await resolverUsuarioDesdeToken(supabase, token);
  if (!userId) return { ok: false, status: 401, error: "sesion_invalida" };

  const seleccion = await resolverWorkspaceSeleccionado(supabase, { userId, workspaceHeader: params.workspaceHeader });
  if (!seleccion.ok) return { ok: false, status: seleccion.status, error: seleccion.error };

  if (!params.rolesPermitidos.includes(seleccion.rol)) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, ctx: { workspaceId: seleccion.workspaceId, userId, rol: seleccion.rol } };
}
