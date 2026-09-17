import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerPlan } from "@/lib/developer/plans";

// DuLabs Developer V1 -- Fase 12 (Billing, Wompi). ÚNICA fuente de verdad de
// pricing de billing. El precio canónico es USD y vive en dulabs_dev_plans
// (precio_mensual_usd, Fase 7/11). El precio ANUAL se DERIVA aquí (x10 = "2
// meses gratis"), nunca se persiste una columna anual. El cobro real es en COP
// vía Wompi con una tasa FX server-side; el frontend NUNCA fija precio, monto,
// moneda ni FX. Enterprise no tiene checkout automático.

export type Intervalo = "month" | "year";

/** Meses que se cobran según intervalo: mensual=1, anual=10 (2 meses gratis). */
export const MESES_COBRADOS: Record<Intervalo, number> = { month: 1, year: 10 };

export type PricingResuelto = {
  plan: string;
  intervalo: Intervalo;
  /** true si este plan permite checkout self-service (Enterprise = false). */
  checkoutHabilitado: boolean;
  /** Precio USD canónico total a cobrar por el período (mensual o anual). */
  precioUsdCents: number;
  /** Precio USD equivalente por mes (para mostrar "$15.83/mo" en anual). */
  equivalenteMensualUsdCents: number;
};

/** ENTERPRISE es manual: sin checkout self-service (contratación por ventas). */
export function esPlanManual(codigo: string): boolean {
  return codigo.toUpperCase() === "ENTERPRISE";
}

/**
 * Resuelve el pricing de un plan+intervalo desde el catálogo (dulabs_dev_plans).
 * Lanza si el plan no existe o no tiene precio (nunca inventa cifras). Enterprise
 * u otro plan sin precio_mensual_usd => checkoutHabilitado=false.
 */
export async function resolverPricing(
  supabase: SupabaseClient,
  params: { plan: string; intervalo: Intervalo }
): Promise<PricingResuelto> {
  const plan = await obtenerPlan(supabase, params.plan);
  if (!plan) throw new Error(`[developer/billing] plan '${params.plan}' no existe en el catálogo`);

  const mensualUsd = plan.precio_mensual_usd; // numeric(10,2) en USD, o null
  const checkoutHabilitado = !esPlanManual(plan.codigo) && mensualUsd !== null && mensualUsd > 0;

  const mensualCents = mensualUsd === null ? 0 : Math.round(mensualUsd * 100);
  const precioUsdCents = mensualCents * MESES_COBRADOS[params.intervalo];
  const equivalenteMensualUsdCents =
    params.intervalo === "year" ? Math.round(precioUsdCents / 12) : mensualCents;

  return {
    plan: plan.codigo,
    intervalo: params.intervalo,
    checkoutHabilitado,
    precioUsdCents,
    equivalenteMensualUsdCents,
  };
}

// ---- FX USD -> COP (server-side, auditable) ----

/**
 * Tasa FX USD->COP configurada server-side (DEVELOPER_BILLING_USD_COP_RATE).
 * Nunca proviene del cliente. Lanza si falta o es inválida (fail-closed: no se
 * cobra sin una tasa explícita). Se registra por transacción en payments.fx_rate.
 */
export function obtenerTasaFxUsdCop(): number {
  const raw = process.env.DEVELOPER_BILLING_USD_COP_RATE;
  const tasa = raw ? Number(raw) : NaN;
  if (!Number.isFinite(tasa) || tasa <= 0) {
    throw new Error(
      "[developer/billing] DEVELOPER_BILLING_USD_COP_RATE no está configurada o es inválida. FAIL CLOSED: no se cobra sin una tasa FX explícita."
    );
  }
  return tasa;
}

/** Convierte USD (cents) a COP (cents) con la tasa dada. Wompi cobra en COP (amount_in_cents). */
export function usdCentsACopCents(usdCents: number, tasaUsdCop: number): number {
  // usdCents/100 = USD; USD * tasa = COP; COP * 100 = COP cents. Redondeo a cent COP.
  return Math.round((usdCents / 100) * tasaUsdCop * 100);
}
