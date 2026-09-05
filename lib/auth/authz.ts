import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { extraerTokenCookie, resolverSesion, type UsuarioSesion } from "./session";

export type ResultadoAuth = { ok: true; sesion: UsuarioSesion | null } | { ok: false; status: number; error: string };

// Login AMORE (autorizado) — helpers CENTRALES de autorización, pensados
// para que cualquier tenant existente (Daniela, Solo Talento) siga
// funcionando EXACTAMENTE igual (sin login) mientras no tenga ninguna fila
// en dulabs_usuarios. Un tenant "se activa" para login simplemente teniendo
// usuarios reales -- no hay ninguna bandera aparte que prender, y nada de
// esto está hardcodeado a "AMORE" por nombre.
async function tenantTieneLoginHabilitado(supabase: SupabaseClient, idTenant: string): Promise<boolean> {
  const { count } = await supabase.from("dulabs_usuarios").select("id", { count: "exact", head: true }).eq("id_tenant", idTenant);
  return (count ?? 0) > 0;
}

/**
 * Gate central: si el tenant NO tiene login habilitado, se comporta EXACTO
 * a como siempre (sesion: null, sin exigir nada -- el token de la URL sigue
 * siendo toda la autenticación). Si el tenant SÍ tiene login habilitado,
 * exige una cookie de sesión válida que además pertenezca a ESTE tenant --
 * ni el token adivinado ni una sesión de otro tenant sirven.
 */
export async function requireAuth(supabase: SupabaseClient, request: NextRequest, idTenant: string): Promise<ResultadoAuth> {
  const habilitado = await tenantTieneLoginHabilitado(supabase, idTenant);
  if (!habilitado) return { ok: true, sesion: null };

  const tokenCrudo = extraerTokenCookie(request.headers.get("cookie"));
  if (!tokenCrudo) return { ok: false, status: 401, error: "Debes iniciar sesión" };

  const sesion = await resolverSesion(supabase, tokenCrudo);
  if (!sesion) return { ok: false, status: 401, error: "Tu sesión expiró, inicia sesión de nuevo" };
  if (sesion.idTenant !== idTenant) return { ok: false, status: 403, error: "No autorizado" };

  return { ok: true, sesion };
}

/** sesion=null (tenant sin login) equivale siempre a administrador -- comportamiento de SIEMPRE preservado. */
export function requireRole(
  sesion: UsuarioSesion | null,
  rol: "administrador" | "colaboradora"
): { ok: true } | { ok: false; status: number; error: string } {
  const efectivo = sesion?.rol ?? "administrador";
  if (efectivo !== rol) return { ok: false, status: 403, error: `Esta acción requiere el rol "${rol}"` };
  return { ok: true };
}

/** Un administrador (o un tenant sin login) puede tocar cualquier especialista; una colaboradora SOLO la suya propia. */
export function requireSpecialistScope(
  sesion: UsuarioSesion | null,
  especialistaId: number
): { ok: true } | { ok: false; status: number; error: string } {
  if (!sesion || sesion.rol === "administrador") return { ok: true };
  if (sesion.especialistaId === especialistaId) return { ok: true };
  return { ok: false, status: 403, error: "No puedes operar sobre citas de otra profesional" };
}
