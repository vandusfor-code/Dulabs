import type { SupabaseClient } from "@supabase/supabase-js";
import { planDelTenant, contarUsuarios } from "@/lib/plan-limits";
import { esSinPlan, MENSAJE_SIN_PLAN } from "@/lib/planes";

// FASE F15 (Operations Center, autorizado) -- lógica de dominio de equipo
// extraída de app/api/dashboard/equipo/route.ts, reutilizada por el Panel
// de Operaciones para gestionar el equipo de CUALQUIER tenant (mismo
// criterio que lib/suscripcion-domain.ts). El caller decide de quién es
// `idTenant`; esta capa nunca autoriza nada por sí sola.

export type ResultadoDominio<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function listarEquipo(supabase: SupabaseClient, idTenant: string) {
  const { data, error } = await supabase
    .from("dulabs_miembros_equipo")
    .select("id, email, nombre, rol, estado, created_at")
    .eq("tenant_id", idTenant)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function invitarMiembro(
  supabase: SupabaseClient,
  params: { idTenant: string; email: string; rol: string; invitadoPor: string | null; siteUrl?: string },
): Promise<ResultadoDominio<{ miembro: Record<string, unknown> }>> {
  const { idTenant, invitadoPor } = params;
  const email = params.email.trim().toLowerCase();
  const rol = params.rol;
  if (!email || !["admin", "agente", "lectura"].includes(rol)) {
    return { ok: false, status: 400, error: "Faltan 'email' o 'rol' válido" };
  }

  const { data: yaExiste } = await supabase.from("dulabs_miembros_equipo").select("id, tenant_id").eq("email", email).maybeSingle();
  if (yaExiste) {
    return {
      ok: false,
      status: 409,
      error: yaExiste.tenant_id === idTenant ? "Ese correo ya es miembro de este equipo" : "Ese correo ya pertenece a otra cuenta",
    };
  }

  const [plan, usuariosActuales] = await Promise.all([planDelTenant(supabase, idTenant), contarUsuarios(supabase, idTenant)]);
  if (plan.limites.usuarios !== null && usuariosActuales >= plan.limites.usuarios) {
    return {
      ok: false,
      status: 400,
      error: esSinPlan(plan)
        ? MENSAJE_SIN_PLAN
        : `El plan ${plan.nombre} permite máximo ${plan.limites.usuarios} usuario${plan.limites.usuarios === 1 ? "" : "s"} en el equipo.`,
    };
  }

  const { data: invitado, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: params.siteUrl ? `${params.siteUrl}/login` : undefined,
  });
  if (inviteError || !invitado.user) {
    return { ok: false, status: 500, error: inviteError?.message ?? "No se pudo enviar la invitación" };
  }

  const { data: fila, error: insertError } = await supabase
    .from("dulabs_miembros_equipo")
    .insert({ tenant_id: idTenant, user_id: invitado.user.id, email, rol, estado: "invitado", invitado_por: invitadoPor })
    .select("id, email, rol, estado, created_at")
    .single();
  if (insertError) return { ok: false, status: 500, error: insertError.message };

  return { ok: true, data: { miembro: fila } };
}

export async function cambiarMiembro(
  supabase: SupabaseClient,
  params: { idTenant: string; miembroId: number; rol?: string; estado?: string },
): Promise<ResultadoDominio<{ success: true }>> {
  const { idTenant, miembroId } = params;
  if (!miembroId || (!params.rol && !params.estado)) {
    return { ok: false, status: 400, error: "Falta 'miembro_id' y al menos 'rol' o 'estado'" };
  }
  if (params.rol && !["admin", "agente", "lectura"].includes(params.rol)) {
    return { ok: false, status: 400, error: "Rol inválido" };
  }
  if (params.estado && !["activo", "suspendido"].includes(params.estado)) {
    return { ok: false, status: 400, error: "Estado inválido" };
  }

  if ((params.rol && params.rol !== "admin") || params.estado === "suspendido") {
    const { count } = await supabase
      .from("dulabs_miembros_equipo")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", idTenant)
      .eq("rol", "admin")
      .eq("estado", "activo")
      .neq("id", miembroId);
    if (!count || count === 0) {
      return { ok: false, status: 400, error: "El equipo debe conservar al menos un administrador activo" };
    }
  }

  const cambios: Record<string, string> = {};
  if (params.rol) cambios.rol = params.rol;
  if (params.estado) cambios.estado = params.estado;

  const { error } = await supabase.from("dulabs_miembros_equipo").update(cambios).eq("id", miembroId).eq("tenant_id", idTenant);
  if (error) return { ok: false, status: 500, error: error.message };

  return { ok: true, data: { success: true } };
}
