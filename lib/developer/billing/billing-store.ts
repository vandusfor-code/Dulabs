import type { SupabaseClient } from "@supabase/supabase-js";
import type { Intervalo } from "@/lib/developer/billing/pricing";

// DuLabs Developer V1 -- Fase 12 (Billing). Capa de datos sobre
// dulabs_dev_billing_*. Aislada de Business. NUNCA duplica entitlements: el
// estado/plan/período de la cuenta viven en dulabs_dev_accounts (Fase 11) y se
// mutan con sus RPCs (set_estado/cambiar_plan), no aquí.

export type EstadoPago = "PENDING" | "APPROVED" | "DECLINED" | "ERROR" | "VOIDED";
export type TipoPago = "checkout" | "renewal" | "upgrade";

export type PagoFila = {
  id: number;
  account_id: string;
  reference: string;
  provider_transaction_id: string | null;
  tipo: TipoPago;
  plan_codigo: string;
  intervalo: Intervalo;
  precio_usd_cents: number;
  monto_cop_cents: number;
  fx_rate: number;
  estado: EstadoPago;
  created_at: string;
};

const CAMPOS_PAGO =
  "id, account_id, reference, provider_transaction_id, tipo, plan_codigo, intervalo, precio_usd_cents, monto_cop_cents, fx_rate, estado, created_at";

/** Reserva atómica de checkout (RPC). 'ok' => crea pago PENDING; si no, motivo. */
export async function reservarCheckout(
  supabase: SupabaseClient,
  params: { accountId: string; reference: string; tipo: TipoPago; planCodigo: string; intervalo: Intervalo; precioUsdCents: number; montoCopCents: number; fxRate: number }
): Promise<{ ok: true; paymentId: number } | { ok: false; motivo: string }> {
  const { data, error } = await supabase.rpc("dulabs_dev_billing_reservar_checkout", {
    p_account_id: params.accountId,
    p_reference: params.reference,
    p_tipo: params.tipo,
    p_plan_codigo: params.planCodigo,
    p_intervalo: params.intervalo,
    p_precio_usd_cents: params.precioUsdCents,
    p_monto_cop_cents: params.montoCopCents,
    p_fx_rate: params.fxRate,
  });
  if (error) throw new Error(`[developer/billing] error reservando checkout: ${error.message}`);
  const fila = Array.isArray(data) ? data[0] : data;
  if (!fila) throw new Error("[developer/billing] reservar_checkout no devolvió resultado");
  if (fila.resultado === "ok") return { ok: true, paymentId: fila.payment_id as number };
  return { ok: false, motivo: fila.resultado as string };
}

export async function guardarClienteYFuente(
  supabase: SupabaseClient,
  params: { accountId: string; customerEmail: string; paymentSourceId: string }
): Promise<void> {
  const { error } = await supabase.from("dulabs_dev_billing_customers").upsert(
    { account_id: params.accountId, wompi_customer_email: params.customerEmail, wompi_payment_source_id: params.paymentSourceId, updated_at: new Date().toISOString() },
    { onConflict: "account_id" }
  );
  if (error) throw new Error(`[developer/billing] error guardando cliente/fuente: ${error.message}`);
}

export async function obtenerClienteDeCuenta(
  supabase: SupabaseClient,
  accountId: string
): Promise<{ wompi_customer_email: string | null; wompi_payment_source_id: string | null } | null> {
  const { data, error } = await supabase
    .from("dulabs_dev_billing_customers")
    .select("wompi_customer_email, wompi_payment_source_id")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw new Error(`[developer/billing] error leyendo cliente: ${error.message}`);
  return (data as { wompi_customer_email: string | null; wompi_payment_source_id: string | null }) ?? null;
}

export async function upsertSuscripcion(
  supabase: SupabaseClient,
  params: { accountId: string; intervalo: Intervalo; precioUsdCents: number; proximoCobro: string | null; downgradeAPlan?: string | null }
): Promise<void> {
  const cambios: Record<string, unknown> = {
    account_id: params.accountId,
    intervalo: params.intervalo,
    precio_usd_cents: params.precioUsdCents,
    proximo_cobro: params.proximoCobro,
    updated_at: new Date().toISOString(),
  };
  if (params.downgradeAPlan !== undefined) cambios.downgrade_a_plan = params.downgradeAPlan;
  const { error } = await supabase.from("dulabs_dev_billing_subscriptions").upsert(cambios, { onConflict: "account_id" });
  if (error) throw new Error(`[developer/billing] error guardando suscripción: ${error.message}`);
}

export async function obtenerSuscripcion(
  supabase: SupabaseClient,
  accountId: string
): Promise<{ intervalo: Intervalo; precio_usd_cents: number; proximo_cobro: string | null; downgrade_a_plan: string | null } | null> {
  const { data, error } = await supabase
    .from("dulabs_dev_billing_subscriptions")
    .select("intervalo, precio_usd_cents, proximo_cobro, downgrade_a_plan")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw new Error(`[developer/billing] error leyendo suscripción: ${error.message}`);
  return (data as { intervalo: Intervalo; precio_usd_cents: number; proximo_cobro: string | null; downgrade_a_plan: string | null }) ?? null;
}

export async function actualizarPagoTransaccion(
  supabase: SupabaseClient,
  params: { paymentId: number; providerTransactionId: string; estado: EstadoPago }
): Promise<void> {
  const { error } = await supabase
    .from("dulabs_dev_billing_payments")
    .update({ provider_transaction_id: params.providerTransactionId, estado: params.estado, updated_at: new Date().toISOString() })
    .eq("id", params.paymentId);
  if (error) throw new Error(`[developer/billing] error actualizando pago: ${error.message}`);
}

export async function obtenerPagoPorTransaccion(supabase: SupabaseClient, providerTransactionId: string): Promise<PagoFila | null> {
  const { data, error } = await supabase.from("dulabs_dev_billing_payments").select(CAMPOS_PAGO).eq("provider_transaction_id", providerTransactionId).maybeSingle();
  if (error) throw new Error(`[developer/billing] error leyendo pago por transacción: ${error.message}`);
  return (data as PagoFila) ?? null;
}

/** Actualiza por transaction id (webhook) y devuelve la fila. */
export async function actualizarPagoPorTransaccion(
  supabase: SupabaseClient,
  params: { providerTransactionId: string; estado: EstadoPago }
): Promise<PagoFila | null> {
  const { data, error } = await supabase
    .from("dulabs_dev_billing_payments")
    .update({ estado: params.estado, updated_at: new Date().toISOString() })
    .eq("provider_transaction_id", params.providerTransactionId)
    .select(CAMPOS_PAGO)
    .maybeSingle();
  if (error) throw new Error(`[developer/billing] error actualizando pago por transacción: ${error.message}`);
  return (data as PagoFila) ?? null;
}

/**
 * Protección de eventos fuera de orden (patrón F14 de Business): un evento solo
 * se aplica si su pago es el MÁS RECIENTE de la cuenta. Un evento tardío de una
 * transacción vieja no revierte un estado resuelto por un intento más nuevo.
 */
export async function esPagoMasRecienteDeCuenta(supabase: SupabaseClient, params: { accountId: string; paymentId: number }): Promise<boolean> {
  const { data, error } = await supabase
    .from("dulabs_dev_billing_payments")
    .select("id")
    .eq("account_id", params.accountId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[developer/billing] error resolviendo pago más reciente: ${error.message}`);
  return !data || (data.id as number) <= params.paymentId;
}

// ---- Event-log de webhooks (idempotencia/replay/dead-letter) ----

export async function registrarEventoWebhook(
  supabase: SupabaseClient,
  params: { providerEventId: string; tipo: string; payload: unknown; signatureVerified: boolean; correlationId?: string | null }
): Promise<{ nuevo: boolean; id: number | null }> {
  const { data, error } = await supabase
    .from("dulabs_dev_billing_events")
    .insert({
      provider_event_id: params.providerEventId,
      type: params.tipo,
      payload: params.payload as never,
      signature_verified: params.signatureVerified,
      status: "received",
      correlation_id: params.correlationId ?? params.providerEventId,
    })
    .select("id")
    .single();
  if (error) {
    // 23505 = unique_violation -> evento ya visto (duplicado/replay).
    if ((error as { code?: string }).code === "23505") return { nuevo: false, id: null };
    throw new Error(`[developer/billing] error registrando evento: ${error.message}`);
  }
  return { nuevo: true, id: data.id as number };
}

export async function marcarEvento(
  supabase: SupabaseClient,
  params: { id: number; status: "processed" | "failed" | "dead_letter" | "ignored_duplicate"; error?: string | null }
): Promise<void> {
  const cambios: Record<string, unknown> = { status: params.status, processed_at: new Date().toISOString() };
  if (params.error !== undefined) cambios.error = params.error;
  if (params.status === "failed" || params.status === "dead_letter") {
    // incrementa attempts de forma best-effort (lectura+escritura simple)
    const { data } = await supabase.from("dulabs_dev_billing_events").select("attempts").eq("id", params.id).maybeSingle();
    cambios.attempts = ((data?.attempts as number) ?? 0) + 1;
  }
  const { error } = await supabase.from("dulabs_dev_billing_events").update(cambios).eq("id", params.id);
  if (error) throw new Error(`[developer/billing] error marcando evento: ${error.message}`);
}

// ---- Recurrencia (cron) ----

export type SuscripcionPorCobrar = { account_id: string; intervalo: Intervalo; precio_usd_cents: number; proximo_cobro: string | null };

export type SuscripcionPorCobrarConPlan = SuscripcionPorCobrar & { plan_codigo: string };

/**
 * Suscripciones a cobrar hoy: cuentas 'active' (renovación) o 'past_due'
 * (reintento de dunning) cuyo próximo cobro ya venció. Incluye el plan actual
 * (de la cuenta). El caller filtra pagos PENDING recientes (anti doble-cobro).
 */
export async function suscripcionesPorCobrar(supabase: SupabaseClient, hoyISO: string): Promise<SuscripcionPorCobrarConPlan[]> {
  const { data: subs, error } = await supabase
    .from("dulabs_dev_billing_subscriptions")
    .select("account_id, intervalo, precio_usd_cents, proximo_cobro")
    .lte("proximo_cobro", hoyISO);
  if (error) throw new Error(`[developer/billing] error listando suscripciones por cobrar: ${error.message}`);
  if (!subs || subs.length === 0) return [];
  const ids = subs.map((s) => s.account_id as string);
  const { data: cuentas, error: eAcc } = await supabase.from("dulabs_dev_accounts").select("id, estado, plan_codigo").in("id", ids);
  if (eAcc) throw new Error(`[developer/billing] error leyendo estados de cuenta: ${eAcc.message}`);
  const porId = new Map((cuentas ?? []).map((c) => [c.id as string, c]));
  return (subs as SuscripcionPorCobrar[])
    .filter((s) => {
      const c = porId.get(s.account_id);
      return c && (c.estado === "active" || c.estado === "past_due");
    })
    .map((s) => ({ ...s, plan_codigo: (porId.get(s.account_id)!.plan_codigo as string) }));
}

/** true si hay un pago PENDING reciente para la cuenta (no volver a cobrar hoy). */
export async function tienePagoPendienteReciente(supabase: SupabaseClient, accountId: string, minutos = 60): Promise<boolean> {
  const desde = new Date(Date.now() - minutos * 60_000).toISOString();
  const { count, error } = await supabase
    .from("dulabs_dev_billing_payments")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("estado", "PENDING")
    .gt("created_at", desde);
  if (error) throw new Error(`[developer/billing] error revisando pago pendiente: ${error.message}`);
  return (count ?? 0) > 0;
}

export async function insertarPagoRenovacion(
  supabase: SupabaseClient,
  params: { accountId: string; reference: string; planCodigo: string; intervalo: Intervalo; precioUsdCents: number; montoCopCents: number; fxRate: number; providerTransactionId: string; estado: EstadoPago }
): Promise<void> {
  const { error } = await supabase.from("dulabs_dev_billing_payments").insert({
    account_id: params.accountId,
    reference: params.reference,
    provider_transaction_id: params.providerTransactionId,
    tipo: "renewal",
    plan_codigo: params.planCodigo,
    intervalo: params.intervalo,
    precio_usd_cents: params.precioUsdCents,
    monto_cop_cents: params.montoCopCents,
    fx_rate: params.fxRate,
    estado: params.estado,
  });
  if (error) throw new Error(`[developer/billing] error insertando pago de renovación: ${error.message}`);
}

// ---- Auditoría (reutiliza dulabs_dev_account_audit de Fase 11) ----

export async function auditarBilling(
  supabase: SupabaseClient,
  params: { accountId: string; actorUserId?: string | null; accion: string; antes?: unknown; despues?: unknown; motivo?: string | null }
): Promise<void> {
  const { error } = await supabase.from("dulabs_dev_account_audit").insert({
    account_id: params.accountId,
    actor_user_id: params.actorUserId ?? null,
    accion: params.accion,
    antes: (params.antes ?? null) as never,
    despues: (params.despues ?? null) as never,
    motivo: params.motivo ?? null,
  });
  if (error) console.error(`[developer/billing] no se pudo auditar ${params.accion}: ${error.message}`);
}
