import type { SupabaseClient } from "@supabase/supabase-js";

// DuLabs Developer V1 -- Fase 8 (Workspaces + Users + API Keys, autorizado).
// Capa de identidad/roles PROPIA de Developer sobre dulabs_dev_memberships
// (migración 20261014000000). NUNCA modifica Business: la tabla
// dulabs_miembros_equipo solo se LEE, como fallback (D2).
//
// Reglas congeladas:
//   D2 -- prioridad: si existe fila Developer para (workspace,user), esa
//         manda (suspendida => sin acceso). Si NO existe fila Developer y hay
//         membresía Business activa para ese tenant => OWNER implícito.
//   D4 -- roles: OWNER (todo + miembros + transferir), ADMIN (api-keys/
//         números/webhooks), MEMBER (solo lectura).

export type RolDev = "OWNER" | "ADMIN" | "MEMBER";
export type FuenteMembresia = "dev" | "business";

export type MembresiaEfectiva = { workspaceId: string; rol: RolDev; fuente: FuenteMembresia };

export type MiembroFila = {
  id: string;
  workspace_id: string;
  user_id: string;
  rol: RolDev;
  estado: "activo" | "suspendido";
  created_at: string;
  updated_at: string;
};

/**
 * Resuelve el rol EFECTIVO del usuario en un workspace concreto (o null si
 * no tiene acceso). Aplica la prioridad D2: una fila Developer manda sobre
 * el fallback Business, incluso si está suspendida (=> corta el acceso).
 */
export async function resolverMembresiaEfectiva(
  supabase: SupabaseClient,
  params: { userId: string; workspaceId: string }
): Promise<MembresiaEfectiva | null> {
  const { data: dev, error: eDev } = await supabase
    .from("dulabs_dev_memberships")
    .select("rol, estado")
    .eq("workspace_id", params.workspaceId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (eDev) throw new Error(`[developer/memberships] error leyendo membresía Developer: ${eDev.message}`);
  if (dev) {
    // Existe fila Developer -> manda (D2). Suspendida = sin acceso.
    return dev.estado === "activo" ? { workspaceId: params.workspaceId, rol: dev.rol as RolDev, fuente: "dev" } : null;
  }

  // Sin fila Developer -> fallback a membresía Business activa (OWNER implícito).
  const { data: biz, error: eBiz } = await supabase
    .from("dulabs_miembros_equipo")
    .select("estado")
    .eq("tenant_id", params.workspaceId)
    .eq("user_id", params.userId)
    .eq("estado", "activo")
    .maybeSingle();
  if (eBiz) throw new Error(`[developer/memberships] error leyendo membresía Business (fallback): ${eBiz.message}`);
  if (biz) return { workspaceId: params.workspaceId, rol: "OWNER", fuente: "business" };

  return null;
}

/**
 * Lista TODOS los workspaces del usuario con su rol efectivo -- membresías
 * Developer activas + fallback Business (tenant activo sin NINGUNA fila
 * Developer, de cualquier estado). Base de la selección multi-workspace (D3)
 * y de GET /api/v1/dev/workspace.
 */
export async function listarWorkspacesDelUsuario(supabase: SupabaseClient, userId: string): Promise<MembresiaEfectiva[]> {
  const { data: devTodas, error: eDev } = await supabase
    .from("dulabs_dev_memberships")
    .select("workspace_id, rol, estado")
    .eq("user_id", userId);
  if (eDev) throw new Error(`[developer/memberships] error listando membresías Developer: ${eDev.message}`);

  const resultado: MembresiaEfectiva[] = [];
  const workspacesConFilaDev = new Set<string>();
  for (const fila of devTodas ?? []) {
    workspacesConFilaDev.add(fila.workspace_id as string);
    if (fila.estado === "activo") resultado.push({ workspaceId: fila.workspace_id as string, rol: fila.rol as RolDev, fuente: "dev" });
  }

  // Fallback Business: dulabs_miembros_equipo tiene unique(user_id) -> a lo
  // sumo un tenant. Se incluye solo si NO hay ninguna fila Developer para él.
  const { data: biz, error: eBiz } = await supabase
    .from("dulabs_miembros_equipo")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("estado", "activo")
    .maybeSingle();
  if (eBiz) throw new Error(`[developer/memberships] error leyendo membresía Business (fallback): ${eBiz.message}`);
  if (biz && !workspacesConFilaDev.has(biz.tenant_id as string)) {
    resultado.push({ workspaceId: biz.tenant_id as string, rol: "OWNER", fuente: "business" });
  }

  return resultado;
}

/** Miembros Developer EXPLÍCITOS de un workspace (filas dulabs_dev_memberships). El OWNER implícito por fallback Business no aparece acá hasta que se materialice con una fila Developer. */
export async function listarMiembros(supabase: SupabaseClient, workspaceId: string): Promise<MiembroFila[]> {
  const { data, error } = await supabase
    .from("dulabs_dev_memberships")
    .select("id, workspace_id, user_id, rol, estado, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`[developer/memberships] error listando miembros: ${error.message}`);
  return (data ?? []) as MiembroFila[];
}

/**
 * Alta/actualización idempotente de un miembro Developer. UNIQUE(workspace_id,
 * user_id) + upsert => alta concurrente nunca duplica (D/test 17): re-agregar
 * al mismo usuario ajusta su rol y lo reactiva, nunca crea una segunda fila.
 */
export async function crearMiembro(
  supabase: SupabaseClient,
  params: { workspaceId: string; userId: string; rol: RolDev }
): Promise<MiembroFila> {
  const { data, error } = await supabase
    .from("dulabs_dev_memberships")
    .upsert(
      { workspace_id: params.workspaceId, user_id: params.userId, rol: params.rol, estado: "activo", updated_at: new Date().toISOString() },
      { onConflict: "workspace_id,user_id" }
    )
    .select("id, workspace_id, user_id, rol, estado, created_at, updated_at")
    .single();
  if (error) throw new Error(`[developer/memberships] error creando miembro: ${error.message}`);
  return data as MiembroFila;
}

export type ResultadoCambioRol = { ok: true; rol: RolDev } | { ok: false; motivo: "no_encontrado" | "ultimo_owner" | "rol_invalido" };

/** Cambia el rol de un miembro -- ATÓMICO con guarda de último OWNER (función Postgres con advisory lock). */
export async function cambiarRolMiembro(
  supabase: SupabaseClient,
  params: { workspaceId: string; membershipId: string; nuevoRol: RolDev }
): Promise<ResultadoCambioRol> {
  const { data, error } = await supabase.rpc("dulabs_dev_cambiar_rol_miembro", {
    p_workspace_id: params.workspaceId,
    p_membership_id: params.membershipId,
    p_nuevo_rol: params.nuevoRol,
  });
  if (error) throw new Error(`[developer/memberships] error cambiando rol: ${error.message}`);
  const fila = Array.isArray(data) ? data[0] : data;
  if (!fila) throw new Error("[developer/memberships] la función de cambio de rol no devolvió resultado");
  if (fila.resultado === "ok") return { ok: true, rol: fila.rol as RolDev };
  return { ok: false, motivo: fila.resultado as "no_encontrado" | "ultimo_owner" | "rol_invalido" };
}

export type ResultadoEliminarMiembro = { ok: true } | { ok: false; motivo: "no_encontrado" | "ultimo_owner" };

/** Elimina un miembro -- ATÓMICO con guarda de último OWNER. */
export async function eliminarMiembro(
  supabase: SupabaseClient,
  params: { workspaceId: string; membershipId: string }
): Promise<ResultadoEliminarMiembro> {
  const { data, error } = await supabase.rpc("dulabs_dev_eliminar_miembro", {
    p_workspace_id: params.workspaceId,
    p_membership_id: params.membershipId,
  });
  if (error) throw new Error(`[developer/memberships] error eliminando miembro: ${error.message}`);
  const fila = Array.isArray(data) ? data[0] : data;
  if (!fila) throw new Error("[developer/memberships] la función de eliminación no devolvió resultado");
  if (fila.resultado === "ok") return { ok: true };
  return { ok: false, motivo: fila.resultado as "no_encontrado" | "ultimo_owner" };
}
