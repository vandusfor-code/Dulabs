import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, type Miembro } from "@/lib/team";

// Tenant propio de DuLabs (id_tenant de dulabs_clientes_config para el
// número 696346603563682, confirmado directo en base de datos -- ver
// auditoría del Panel de Operaciones). El Panel Admin es EXCLUSIVO de este
// tenant: ver los datos de "todos los clientes" (todas las suscripciones)
// es una capacidad de plataforma, no algo que ningún otro tenant debe tener
// sin importar su rol.
export const TENANT_DULABS_ID = "daf555ef-bda6-40d1-9833-bea40d69e38c";

export function esAdminDulabs(miembro: Miembro | null): miembro is Miembro {
  return miembro !== null && miembro.tenantId === TENANT_DULABS_ID && miembro.rol === "admin";
}

// Punto único de autorización para las rutas del Panel de Operaciones --
// nunca confiar en que el front ocultó el link: cada endpoint admin llama
// esto primero. Devuelve el cliente supabase ya listo (más el miembro
// autenticado, para endpoints que necesiten registrar QUIÉN hizo una acción
// -- ver activarMarketplaceCortesia) si autoriza, o una Response de error si no.
export async function verificarAccesoAdminDulabs(
  request: NextRequest
): Promise<{ ok: true; supabase: SupabaseClient; miembro: Miembro } | { ok: false; response: Response }> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return { ok: false, response: Response.json({ error: "Falta el token de sesión" }, { status: 401 }) };
  }

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return { ok: false, response: Response.json({ error: "Sesión inválida" }, { status: 401 }) };
  }

  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!esAdminDulabs(miembro)) {
    return { ok: false, response: Response.json({ error: "No autorizado" }, { status: 403 }) };
  }

  return { ok: true, supabase, miembro };
}
