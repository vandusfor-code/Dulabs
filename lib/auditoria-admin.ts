import type { SupabaseClient } from "@supabase/supabase-js";
import type { Miembro } from "@/lib/team";

// FASE F15 (Operations Center, autorizado) -- registra CADA acción
// administrativa ejecutada desde /admin. Fail-safe: si la migración
// 20260914110000_auditoria_admin.sql todavía no corrió, solo loguea a
// consola y nunca bloquea la acción real que la llamó -- perder un registro
// de auditoría temporalmente es aceptable, perder la operación no lo es.
const CODIGOS_TABLA_INEXISTENTE = new Set(["PGRST204", "PGRST205", "42703", "42P01"]);

export async function registrarAuditoriaAdmin(
  supabase: SupabaseClient,
  params: {
    operador: Miembro;
    operadorEmail?: string | null;
    accion: string;
    idTenant?: string | null;
    recurso?: string | null;
    resultado?: "ok" | "error";
    motivo?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  const { error } = await supabase.from("dulabs_auditoria_admin").insert({
    operador_user_id: params.operador.userId,
    operador_email: params.operadorEmail ?? null,
    accion: params.accion,
    id_tenant: params.idTenant ?? null,
    recurso: params.recurso ?? null,
    resultado: params.resultado ?? "ok",
    motivo: params.motivo ?? null,
    metadata: params.metadata ?? null,
  });
  if (error) {
    if (CODIGOS_TABLA_INEXISTENTE.has(error.code ?? "")) {
      console.error(
        `[auditoria-admin] dulabs_auditoria_admin no existe todavía (falta correr la migración 20260914110000) -- acción ${params.accion} NO quedó auditada:`,
        error.message,
      );
      return;
    }
    console.error(`[auditoria-admin] error registrando auditoría de ${params.accion}:`, error.message);
  }
}

export type FilaAuditoria = {
  id: number;
  operador_email: string | null;
  accion: string;
  id_tenant: string | null;
  recurso: string | null;
  resultado: string;
  motivo: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function listarAuditoriaAdmin(
  supabase: SupabaseClient,
  params: { idTenant?: string; accion?: string; cursor?: string; limite?: number },
): Promise<{ eventos: FilaAuditoria[]; siguienteCursor: string | null }> {
  const limite = Math.min(params.limite ?? 50, 200);
  let query = supabase
    .from("dulabs_auditoria_admin")
    .select("id, operador_email, accion, id_tenant, recurso, resultado, motivo, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(limite + 1);
  if (params.idTenant) query = query.eq("id_tenant", params.idTenant);
  if (params.accion) query = query.eq("accion", params.accion);
  if (params.cursor) query = query.lt("created_at", params.cursor);

  const { data, error } = await query;
  if (error) {
    if (CODIGOS_TABLA_INEXISTENTE.has(error.code ?? "")) return { eventos: [], siguienteCursor: null };
    throw new Error(error.message);
  }
  const filas = data ?? [];
  const hayMas = filas.length > limite;
  const eventos = hayMas ? filas.slice(0, limite) : filas;
  return { eventos, siguienteCursor: hayMas ? eventos[eventos.length - 1].created_at : null };
}
