/**
 * FASE 3B.3 — RESPONSABLE de los pedidos pendientes de aceptación (configuración `cierre.responsable`).
 *
 * La configuración solo guarda ids de miembros del equipo; aquí se verifican contra el equipo REAL:
 *   - el miembro existe, es del MISMO negocio y está activo (nunca uno de otro negocio);
 *   - igual el respaldo, si se configuró;
 *   - con canal "correo", el miembro tiene correo.
 * No asigna ni notifica a nadie (eso es la Fase 3B.5): solo responde si la configuración se puede usar.
 * Cualquier duda => no se usa (fail-closed).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckoutOpciones } from "@/lib/agente/perfil-negocio";

export type ResponsableConfig = Extract<NonNullable<CheckoutOpciones["cierre"]>, { modo: "aceptacion_humana" }>["responsable"];

export interface MiembroEquipo {
  id: number;
  tenantId: string;
  estado: string;
  rol: string;
  email: string | null;
}

export interface MiembrosStore {
  /** El miembro con ese id, sea del negocio que sea (para poder decir "es de otro negocio"). */
  porId(id: number): Promise<MiembroEquipo | null>;
}

export type ResponsableError =
  | "responsable_no_existe"
  | "responsable_de_otro_negocio"
  | "responsable_inactivo"
  | "responsable_sin_correo"
  | "respaldo_no_existe"
  | "respaldo_de_otro_negocio"
  | "respaldo_inactivo";

export async function verificarResponsable(
  store: MiembrosStore,
  tenantId: string,
  responsable: ResponsableConfig,
): Promise<{ ok: true; miembro: MiembroEquipo; respaldo: MiembroEquipo | null } | { ok: false; error: ResponsableError }> {
  const revisar = async (id: number, prefijo: "responsable" | "respaldo"): Promise<{ ok: true; miembro: MiembroEquipo } | { ok: false; error: ResponsableError }> => {
    const m = await store.porId(id);
    if (!m) return { ok: false, error: `${prefijo}_no_existe` };
    if (m.tenantId !== tenantId) return { ok: false, error: `${prefijo}_de_otro_negocio` };
    if (m.estado !== "activo") return { ok: false, error: `${prefijo}_inactivo` };
    return { ok: true, miembro: m };
  };
  const principal = await revisar(responsable.miembro_id, "responsable");
  if (!principal.ok) return principal;
  if (responsable.canales.includes("correo") && !principal.miembro.email) return { ok: false, error: "responsable_sin_correo" };
  let respaldo: MiembroEquipo | null = null;
  if (responsable.respaldo_miembro_id !== null) {
    const r = await revisar(responsable.respaldo_miembro_id, "respaldo");
    if (!r.ok) return r;
    respaldo = r.miembro;
  }
  return { ok: true, miembro: principal.miembro, respaldo };
}

export function createSupabaseMiembrosStore(supabase: SupabaseClient): MiembrosStore {
  return {
    async porId(id) {
      const { data, error } = await supabase.from("dulabs_miembros_equipo").select("id, tenant_id, estado, rol, email").eq("id", id).maybeSingle();
      if (error) throw new Error(`[agente/responsable] ${error.code ?? "?"}`);
      const r = data as { id: number; tenant_id: string; estado: string; rol: string; email: string | null } | null;
      return r ? { id: Number(r.id), tenantId: r.tenant_id, estado: r.estado, rol: r.rol, email: r.email } : null;
    },
  };
}

export function createMemoryMiembrosStore(rows: MiembroEquipo[] = []): MiembrosStore & { rows: MiembroEquipo[] } {
  return {
    rows,
    async porId(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
  };
}
