import type { SupabaseClient } from "@supabase/supabase-js";
import type { Intervalo } from "@/lib/developer/billing/pricing";
import { upsertSuscripcion, auditarBilling } from "@/lib/developer/billing/billing-store";

// DuLabs Developer V1 -- Fase 12 (Billing). Ciclo de vida de la suscripción:
// activación (checkout/renovación aprobada), fallo de renovación (dunning) y
// cancelación al fin de período. El estado/plan se mutan SIEMPRE vía los RPCs
// atómicos de Fase 11 (set_estado/cambiar_plan). El período (periodo_inicio/fin)
// lo fija/renueva Fase 12 (columnas de Fase 11 reservadas para esto). NUNCA se
// duplica el resolvedor de entitlements.

export const MAX_REINTENTOS_DUNNING = 3;
export const DIAS_ENTRE_REINTENTOS = 3;

/** Longitud del período en meses: mensual=1, anual=12 (aunque el precio anual sea x10). */
function mesesDePeriodo(intervalo: Intervalo): number {
  return intervalo === "year" ? 12 : 1;
}

function sumarMeses(desde: Date, meses: number): Date {
  const d = new Date(desde);
  d.setMonth(d.getMonth() + meses);
  return d;
}

function isoFecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function setEstadoSistema(supabase: SupabaseClient, accountId: string, estado: "active" | "past_due" | "canceled", motivo: string): Promise<void> {
  const { error } = await supabase.rpc("dulabs_dev_set_estado", { p_account_id: accountId, p_estado: estado, p_actor_user_id: null, p_motivo: motivo });
  if (error) throw new Error(`[developer/billing] error set_estado(${estado}): ${error.message}`);
}

async function actualizarPeriodoCuenta(supabase: SupabaseClient, accountId: string, inicio: Date, fin: Date): Promise<void> {
  const { error } = await supabase
    .from("dulabs_dev_accounts")
    .update({ periodo_inicio: inicio.toISOString(), periodo_fin: fin.toISOString(), updated_at: new Date().toISOString() })
    .eq("id", accountId);
  if (error) throw new Error(`[developer/billing] error actualizando período: ${error.message}`);
}

/**
 * Activa/renueva la suscripción tras un pago APROBADO. Idempotente a nivel de
 * efecto (dejar 'active' + período nuevo). Si `cambiarA` viene, aplica el plan
 * (upgrade) vía el RPC de Fase 11 antes de activar.
 */
export async function activarSuscripcionPagada(
  supabase: SupabaseClient,
  params: { accountId: string; planCodigo: string; intervalo: Intervalo; precioUsdCents: number; cambiarPlanA?: string | null; motivo: string }
): Promise<void> {
  if (params.cambiarPlanA) {
    const { data, error } = await supabase.rpc("dulabs_dev_cambiar_plan", {
      p_account_id: params.accountId,
      p_nuevo_plan: params.cambiarPlanA,
      p_actor_user_id: null,
      p_motivo: params.motivo,
    });
    if (error) throw new Error(`[developer/billing] error cambiar_plan: ${error.message}`);
    const fila = Array.isArray(data) ? data[0] : data;
    if (fila?.resultado !== "ok") throw new Error(`[developer/billing] cambiar_plan rechazó: ${fila?.resultado ?? "desconocido"} ${fila?.detalle ?? ""}`);
  }

  const ahora = new Date();
  const fin = sumarMeses(ahora, mesesDePeriodo(params.intervalo));
  await actualizarPeriodoCuenta(supabase, params.accountId, ahora, fin);
  await upsertSuscripcion(supabase, {
    accountId: params.accountId,
    intervalo: params.intervalo,
    precioUsdCents: params.precioUsdCents,
    proximoCobro: isoFecha(fin),
  });
  await setEstadoSistema(supabase, params.accountId, "active", params.motivo);
  await auditarBilling(supabase, { accountId: params.accountId, accion: "SUBSCRIPTION_ACTIVATED", despues: { plan: params.cambiarPlanA ?? params.planCodigo, intervalo: params.intervalo, hasta: isoFecha(fin) }, motivo: params.motivo });
}

/** Cuenta los pagos de renovación fallidos desde el último pago APROBADO (largo del ciclo de dunning). */
async function fallosDeRenovacionEnCiclo(supabase: SupabaseClient, accountId: string): Promise<number> {
  const { data: aprobado } = await supabase
    .from("dulabs_dev_billing_payments")
    .select("created_at")
    .eq("account_id", accountId)
    .eq("estado", "APPROVED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let q = supabase
    .from("dulabs_dev_billing_payments")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("tipo", "renewal")
    .in("estado", ["DECLINED", "ERROR", "VOIDED"]);
  if (aprobado?.created_at) q = q.gt("created_at", aprobado.created_at as string);
  const { count, error } = await q;
  if (error) throw new Error(`[developer/billing] error contando fallos de renovación: ${error.message}`);
  return count ?? 0;
}

/**
 * Dunning tras un pago de renovación FALLIDO: pasa a past_due y reprograma el
 * reintento; si se agotaron los reintentos, cancela. NUNCA borra recursos.
 */
export async function procesarRenovacionFallida(supabase: SupabaseClient, params: { accountId: string }): Promise<{ resultado: "past_due" | "canceled" }> {
  const fallos = await fallosDeRenovacionEnCiclo(supabase, params.accountId);
  if (fallos >= MAX_REINTENTOS_DUNNING) {
    await setEstadoSistema(supabase, params.accountId, "canceled", `dunning: ${fallos} intentos fallidos`);
    await auditarBilling(supabase, { accountId: params.accountId, accion: "DUNNING_CANCELED", despues: { fallos } });
    return { resultado: "canceled" };
  }
  await setEstadoSistema(supabase, params.accountId, "past_due", `dunning: intento fallido ${fallos}`);
  const fechaReintento = new Date();
  fechaReintento.setDate(fechaReintento.getDate() + DIAS_ENTRE_REINTENTOS);
  // Solo reprograma el próximo cobro (NO pisa intervalo/precio reales).
  const { error: eReintento } = await supabase
    .from("dulabs_dev_billing_subscriptions")
    .update({ proximo_cobro: isoFecha(fechaReintento), updated_at: new Date().toISOString() })
    .eq("account_id", params.accountId);
  if (eReintento) throw new Error(`[developer/billing] error reprogramando reintento: ${eReintento.message}`);
  await auditarBilling(supabase, { accountId: params.accountId, accion: "DUNNING_PAST_DUE", despues: { fallos, reintento: isoFecha(fechaReintento) } });
  return { resultado: "past_due" };
}

/**
 * Al finalizar el período de una cuenta marcada cancelar_al_fin_periodo: pasa a
 * canceled. NO destruye workspaces/números/datos.
 */
export async function finalizarSiCancelacionProgramada(supabase: SupabaseClient, params: { accountId: string; cancelarAlFinPeriodo: boolean; periodoFin: string | null }): Promise<boolean> {
  if (!params.cancelarAlFinPeriodo || !params.periodoFin) return false;
  if (new Date(params.periodoFin).getTime() > Date.now()) return false;
  await setEstadoSistema(supabase, params.accountId, "canceled", "cancelación al fin de período");
  await auditarBilling(supabase, { accountId: params.accountId, accion: "SUBSCRIPTION_CANCELED", despues: { motivo: "fin_periodo" } });
  return true;
}
