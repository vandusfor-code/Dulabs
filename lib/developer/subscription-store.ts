import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstadoSuscripcion } from "@/lib/developer/plans";

// DuLabs Developer V1 -- Fase 11 (autorizado). Operaciones de suscripción,
// todas ATÓMICAS vía RPCs con advisory lock por cuenta (ver migración
// 20261015000100). Fase 11 NO cobra: `set_estado` y los adicionales quedan
// listos para que Fase 12 valide el pago y dispare transiciones. Nunca toca
// Business/AMORE ni implementa Stripe/checkout.

export type ResultadoCambioPlan =
  | { ok: true }
  | { ok: false; motivo: "cuenta_no_encontrada" | "plan_invalido" | "downgrade_bloqueado"; detalle?: string | null };

export async function cambiarPlan(
  supabase: SupabaseClient,
  params: { accountId: string; nuevoPlan: string; actorUserId: string; motivo?: string | null }
): Promise<ResultadoCambioPlan> {
  const { data, error } = await supabase.rpc("dulabs_dev_cambiar_plan", {
    p_account_id: params.accountId,
    p_nuevo_plan: params.nuevoPlan,
    p_actor_user_id: params.actorUserId,
    p_motivo: params.motivo ?? null,
  });
  if (error) throw new Error(`[developer/subscription] error cambiando plan: ${error.message}`);
  const fila = Array.isArray(data) ? data[0] : data;
  if (!fila) throw new Error("[developer/subscription] cambiar_plan no devolvió resultado");
  if (fila.resultado === "ok") return { ok: true };
  return { ok: false, motivo: fila.resultado, detalle: fila.detalle ?? null };
}

export type ResultadoAdicionales =
  | { ok: true }
  | { ok: false; motivo: "cuenta_no_encontrada" | "no_permitido" | "valor_invalido" | "recursos_por_encima"; detalle?: string | null };

export async function setNumerosAdicionales(
  supabase: SupabaseClient,
  params: { accountId: string; nuevoTotal: number; actorUserId: string; motivo?: string | null }
): Promise<ResultadoAdicionales> {
  const { data, error } = await supabase.rpc("dulabs_dev_set_numeros_adicionales", {
    p_account_id: params.accountId,
    p_nuevo_total: params.nuevoTotal,
    p_actor_user_id: params.actorUserId,
    p_motivo: params.motivo ?? null,
  });
  if (error) throw new Error(`[developer/subscription] error fijando números adicionales: ${error.message}`);
  const fila = Array.isArray(data) ? data[0] : data;
  if (!fila) throw new Error("[developer/subscription] set_numeros_adicionales no devolvió resultado");
  if (fila.resultado === "ok") return { ok: true };
  return { ok: false, motivo: fila.resultado, detalle: fila.detalle ?? null };
}

export type ResultadoEstado = { ok: true } | { ok: false; motivo: "cuenta_no_encontrada" | "estado_invalido" };

/** Fase 12 lo usará al integrar pagos. Expuesto acá para completar el modelo. */
export async function setEstado(
  supabase: SupabaseClient,
  params: { accountId: string; estado: EstadoSuscripcion; actorUserId: string; motivo?: string | null }
): Promise<ResultadoEstado> {
  const { data, error } = await supabase.rpc("dulabs_dev_set_estado", {
    p_account_id: params.accountId,
    p_estado: params.estado,
    p_actor_user_id: params.actorUserId,
    p_motivo: params.motivo ?? null,
  });
  if (error) throw new Error(`[developer/subscription] error fijando estado: ${error.message}`);
  const fila = Array.isArray(data) ? data[0] : data;
  if (!fila) throw new Error("[developer/subscription] set_estado no devolvió resultado");
  if (fila.resultado === "ok") return { ok: true };
  return { ok: false, motivo: fila.resultado };
}

export type ResultadoCrearWorkspace = { ok: true; workspaceId: string } | { ok: false; motivo: "cuenta_no_encontrada" | "limite_workspaces_excedido" };

export async function crearWorkspaceEnCuenta(
  supabase: SupabaseClient,
  params: { accountId: string; ownerUserId: string; limiteWorkspaces: number | null }
): Promise<ResultadoCrearWorkspace> {
  const { data, error } = await supabase.rpc("dulabs_dev_crear_workspace", {
    p_account_id: params.accountId,
    p_owner_user_id: params.ownerUserId,
    p_limite_workspaces: params.limiteWorkspaces,
  });
  if (error) throw new Error(`[developer/subscription] error creando workspace: ${error.message}`);
  const fila = Array.isArray(data) ? data[0] : data;
  if (!fila) throw new Error("[developer/subscription] crear_workspace no devolvió resultado");
  if (fila.resultado === "ok") return { ok: true, workspaceId: fila.workspace_id as string };
  return { ok: false, motivo: fila.resultado };
}
