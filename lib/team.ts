import type { SupabaseClient } from "@supabase/supabase-js";

export type Rol = "admin" | "agente" | "lectura";
export type EstadoMiembro = "invitado" | "activo" | "suspendido";

export type Miembro = {
  miembroId: number;
  tenantId: string;
  userId: string;
  rol: Rol;
  estado: EstadoMiembro;
};

// Resuelve el miembro de equipo ACTIVO del usuario autenticado. Devuelve
// null si no tiene membresía activa (invitación pendiente, suspendido, o
// nunca fue provisionado) — el llamador decide qué error dar.
export async function resolverMiembroEquipo(
  supabase: SupabaseClient,
  userId: string
): Promise<Miembro | null> {
  const { data, error } = await supabase
    .from("dulabs_miembros_equipo")
    .select("id, tenant_id, user_id, rol, estado")
    .eq("user_id", userId)
    .eq("estado", "activo")
    .maybeSingle();
  if (error || !data) return null;
  return {
    miembroId: data.id,
    tenantId: data.tenant_id,
    userId: data.user_id,
    rol: data.rol,
    estado: data.estado,
  };
}

// Type guard: úsalo como `if (!requireRol(miembro, ["admin"])) return 403`.
export function requireRol(
  miembro: Miembro | null,
  rolesPermitidos: Rol[]
): miembro is Miembro {
  return miembro !== null && rolesPermitidos.includes(miembro.rol);
}
