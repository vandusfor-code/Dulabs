import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstadoSuscripcion } from "@/lib/developer/plans";
import type { ResumenUso } from "@/lib/developer/usage-ledger";

// DuLabs Developer V1 -- Fase 11 (autorizado). Capa de datos de la CUENTA
// (dulabs_dev_accounts) y sus recursos a nivel de cuenta. La cuenta porta la
// suscripción y agrupa workspaces. Materialización perezosa: un workspace sin
// cuenta es DEVELOPER legacy hasta que una operación de suscripción/creación
// de recurso crea y enlaza su cuenta. NUNCA toca Business/AMORE.

export type CuentaFila = {
  id: string;
  owner_user_id: string;
  plan_codigo: string;
  estado: EstadoSuscripcion;
  numeros_adicionales: number;
  periodo_inicio: string | null;
  periodo_fin: string | null;
  cancelar_al_fin_periodo: boolean;
  created_at: string;
  updated_at: string;
};

const CAMPOS = "id, owner_user_id, plan_codigo, estado, numeros_adicionales, periodo_inicio, periodo_fin, cancelar_al_fin_periodo, created_at, updated_at";

export async function obtenerCuentaPorId(supabase: SupabaseClient, accountId: string): Promise<CuentaFila | null> {
  const { data, error } = await supabase.from("dulabs_dev_accounts").select(CAMPOS).eq("id", accountId).maybeSingle();
  if (error) throw new Error(`[developer/accounts] error leyendo cuenta: ${error.message}`);
  return (data as CuentaFila) ?? null;
}

/** account_id del workspace (o null si es legacy sin cuenta). */
export async function obtenerAccountIdDeWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("dulabs_dev_workspace_plans")
    .select("account_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`[developer/accounts] error leyendo workspace_plans: ${error.message}`);
  return (data?.account_id as string | undefined) ?? null;
}

export async function obtenerCuentaDeWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<CuentaFila | null> {
  const accountId = await obtenerAccountIdDeWorkspace(supabase, workspaceId);
  if (!accountId) return null;
  return obtenerCuentaPorId(supabase, accountId);
}

/**
 * Garantiza que el workspace tenga cuenta, de forma ATÓMICA E IDEMPOTENTE vía
 * el RPC dulabs_dev_ensure_account_for_workspace (advisory lock por workspace
 * en la BD): dos requests concurrentes sobre el mismo workspace nunca crean
 * dos cuentas huérfanas -- el segundo ve la cuenta ya creada. Crea una cuenta
 * DEVELOPER (active, período mensual) y enlaza SOLO este workspace (sin
 * backfill de otros workspaces del owner -- ver doc, Riesgos). El gate
 * OWNER/ADMIN y el aislamiento tenant los aplica la ruta que llama.
 */
export async function ensureCuentaParaWorkspace(
  supabase: SupabaseClient,
  params: { workspaceId: string; ownerUserId: string }
): Promise<CuentaFila> {
  const { data, error } = await supabase.rpc("dulabs_dev_ensure_account_for_workspace", {
    p_workspace_id: params.workspaceId,
    p_owner_user_id: params.ownerUserId,
  });
  if (error) throw new Error(`[developer/accounts] error materializando cuenta: ${error.message}`);
  const fila = Array.isArray(data) ? data[0] : data;
  if (!fila?.account_id) throw new Error("[developer/accounts] ensure_account_for_workspace no devolvió account_id");
  const cuenta = await obtenerCuentaPorId(supabase, fila.account_id as string);
  if (!cuenta) throw new Error("[developer/accounts] cuenta materializada pero no recuperable");
  return cuenta;
}

// --- Conteos A NIVEL DE CUENTA (para display y validaciones no atómicas) ---

export async function contarNumerosDeCuenta(supabase: SupabaseClient, accountId: string): Promise<number> {
  const { data: ws, error: eWs } = await supabase.from("dulabs_dev_workspace_plans").select("workspace_id").eq("account_id", accountId);
  if (eWs) throw new Error(`[developer/accounts] error listando workspaces de la cuenta: ${eWs.message}`);
  const ids = (ws ?? []).map((w) => w.workspace_id as string);
  if (ids.length === 0) return 0;
  const { count, error } = await supabase.from("dulabs_dev_whatsapp_numbers").select("id", { count: "exact", head: true }).in("workspace_id", ids);
  if (error) throw new Error(`[developer/accounts] error contando números de la cuenta: ${error.message}`);
  return count ?? 0;
}

export async function contarWorkspacesDeCuenta(supabase: SupabaseClient, accountId: string): Promise<number> {
  const { count, error } = await supabase.from("dulabs_dev_workspace_plans").select("workspace_id", { count: "exact", head: true }).eq("account_id", accountId);
  if (error) throw new Error(`[developer/accounts] error contando workspaces de la cuenta: ${error.message}`);
  return count ?? 0;
}

export async function contarMiembrosDeCuenta(supabase: SupabaseClient, accountId: string): Promise<number> {
  const { data: ws, error: eWs } = await supabase.from("dulabs_dev_workspace_plans").select("workspace_id").eq("account_id", accountId);
  if (eWs) throw new Error(`[developer/accounts] error listando workspaces de la cuenta: ${eWs.message}`);
  const ids = (ws ?? []).map((w) => w.workspace_id as string);
  if (ids.length === 0) return 0;
  const { data, error } = await supabase.from("dulabs_dev_memberships").select("user_id").in("workspace_id", ids).eq("estado", "activo");
  if (error) throw new Error(`[developer/accounts] error contando miembros de la cuenta: ${error.message}`);
  return new Set((data ?? []).map((m) => m.user_id as string)).size;
}

/** Resumen mensual de mensajes AGREGADO across los workspaces de la cuenta (mismo criterio que la reserva atómica: reservado+confirmado cuentan). */
export async function obtenerResumenMensualDeCuenta(supabase: SupabaseClient, params: { accountId: string; period: string }): Promise<ResumenUso> {
  const { data: ws, error: eWs } = await supabase.from("dulabs_dev_workspace_plans").select("workspace_id").eq("account_id", params.accountId);
  if (eWs) throw new Error(`[developer/accounts] error listando workspaces de la cuenta: ${eWs.message}`);
  const ids = (ws ?? []).map((w) => w.workspace_id as string);
  const resumen: ResumenUso = { reserved: 0, confirmed: 0, released: 0 };
  if (ids.length === 0) return resumen;
  const { data, error } = await supabase.from("dulabs_dev_usage_ledger").select("estado, cantidad").in("workspace_id", ids).eq("period", params.period);
  if (error) throw new Error(`[developer/accounts] error obteniendo resumen mensual de la cuenta: ${error.message}`);
  for (const fila of data ?? []) {
    const cantidad = (fila.cantidad as number) ?? 0;
    if (fila.estado === "reservado") resumen.reserved += cantidad;
    else if (fila.estado === "confirmado") resumen.confirmed += cantidad;
    else if (fila.estado === "liberado") resumen.released += cantidad;
  }
  return resumen;
}
