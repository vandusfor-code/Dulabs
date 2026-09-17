import type { SupabaseClient } from "@supabase/supabase-js";

// DuLabs Developer V1 -- Fase 7 (Billing + Usage + Limits) + Fase 11 (Plans /
// Pricing / Subscriptions / Entitlements, autorizado). ÚNICO resolvedor de
// entitlements: la tabla dulabs_dev_plans es la fuente de verdad del plan
// base; la cuenta (dulabs_dev_accounts) porta la suscripción y agrupa
// workspaces; dulabs_dev_plan_overrides ajusta límites de Enterprise por
// cuenta. NO se hardcodean límites/precios acá (solo el CÓDIGO del plan por
// defecto, decisión de producto).
//
// Modelo aprobado (Fase 11): números, mensajes, miembros y workspaces se
// cuentan A NIVEL DE CUENTA. Un workspace sin cuenta = DEVELOPER legacy
// (compat Fase 7, sin backfill). NULL en un límite = "sin límite" (no bloquea).
//
// Dos vistas del mismo estado, un solo origen:
//   - resolverEntitlementsDeWorkspace(): NOMINAL + estado + flags -> para
//     mostrar en el Dashboard (GET /subscription, /usage).
//   - resolverLimitesDelWorkspace(): EFECTIVO para ENFORCEMENT -> lo consumen
//     el connect de números (Fase 10) y la reserva de mensajes (Fase 5) sin
//     cambiar su código; cuando la cuenta no está `active`, el límite de
//     consumo efectivo es 0 (bloquea consumo nuevo sin borrar nada).

export const PLAN_POR_DEFECTO = "DEVELOPER" as const;

export type EstadoSuscripcion = "active" | "past_due" | "canceled";

export type PlanFila = {
  codigo: string;
  nombre: string;
  mensajes_mensuales_incluidos: number | null;
  numeros_incluidos: number | null;
  mensajes_por_segundo_por_numero: number | null;
  precio_numero_adicional_usd: number | null;
  precio_mensual_usd: number | null;
  max_workspaces: number | null;
  max_members: number | null;
  permite_numeros_adicionales: boolean;
};

const CAMPOS =
  "codigo, nombre, mensajes_mensuales_incluidos, numeros_incluidos, mensajes_por_segundo_por_numero, precio_numero_adicional_usd, precio_mensual_usd, max_workspaces, max_members, permite_numeros_adicionales";

/** Lee una fila de plan por código. */
export async function obtenerPlan(supabase: SupabaseClient, codigo: string): Promise<PlanFila | null> {
  const { data, error } = await supabase.from("dulabs_dev_plans").select(CAMPOS).eq("codigo", codigo).maybeSingle();
  if (error) throw new Error(`[developer/plans] error leyendo plan '${codigo}': ${error.message}`);
  return (data as PlanFila) ?? null;
}

type CuentaResuelta = {
  accountId: string | null;
  planCodigo: string;
  estado: EstadoSuscripcion;
  numerosAdicionales: number;
};

/** Resuelve la cuenta del workspace (o DEVELOPER/active sin cuenta = compat legacy). */
async function resolverCuentaDeWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<CuentaResuelta> {
  const { data: wp, error: eWp } = await supabase
    .from("dulabs_dev_workspace_plans")
    .select("account_id, plan_codigo")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (eWp) throw new Error(`[developer/plans] error resolviendo workspace_plans: ${eWp.message}`);

  const accountId = (wp?.account_id as string | undefined) ?? null;
  if (!accountId) {
    // Sin cuenta: DEVELOPER por defecto (compat). Si había plan_codigo legacy
    // en la fila (Fase 7), se respeta como plan base; estado siempre active.
    return { accountId: null, planCodigo: (wp?.plan_codigo as string | undefined) ?? PLAN_POR_DEFECTO, estado: "active", numerosAdicionales: 0 };
  }

  const { data: acc, error: eAcc } = await supabase
    .from("dulabs_dev_accounts")
    .select("plan_codigo, estado, numeros_adicionales")
    .eq("id", accountId)
    .maybeSingle();
  if (eAcc) throw new Error(`[developer/plans] error resolviendo cuenta: ${eAcc.message}`);
  if (!acc) return { accountId, planCodigo: PLAN_POR_DEFECTO, estado: "active", numerosAdicionales: 0 };
  return {
    accountId,
    planCodigo: (acc.plan_codigo as string) ?? PLAN_POR_DEFECTO,
    estado: (acc.estado as EstadoSuscripcion) ?? "active",
    numerosAdicionales: (acc.numeros_adicionales as number) ?? 0,
  };
}

/** Código de plan efectivo del workspace (para lecturas legacy de Fase 7). */
export async function resolverCodigoPlanDelWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<string> {
  return (await resolverCuentaDeWorkspace(supabase, workspaceId)).planCodigo;
}

export type Entitlements = {
  accountId: string | null;
  planCodigo: string;
  planNombre: string;
  estado: EstadoSuscripcion;
  /** true si estado != active -> se bloquea el consumo nuevo que genera costo. */
  consumoBloqueado: boolean;
  includedNumbers: number | null;
  additionalNumbers: number;
  /** included + additional (o null = sin tope). NOMINAL, para mostrar. */
  maxNumbers: number | null;
  canBuyAdditionalNumbers: boolean;
  maxMessagesMonth: number | null;
  maxWorkspaces: number | null;
  maxMembers: number | null;
  throughputPerNumber: number | null;
  precioMensualUsd: number | null;
  precioNumeroAdicionalUsd: number | null;
};

/**
 * ÚNICO resolvedor de entitlements NOMINALES de un workspace: cuenta -> plan
 * base -> overrides (Enterprise). NULL = usar valor del plan base.
 */
export async function resolverEntitlementsDeWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<Entitlements> {
  const cuenta = await resolverCuentaDeWorkspace(supabase, workspaceId);
  const plan =
    (await obtenerPlan(supabase, cuenta.planCodigo)) ??
    (cuenta.planCodigo !== PLAN_POR_DEFECTO ? await obtenerPlan(supabase, PLAN_POR_DEFECTO) : null);
  if (!plan) {
    throw new Error(`[developer/plans] no se encontró el plan '${cuenta.planCodigo}' ni '${PLAN_POR_DEFECTO}' en dulabs_dev_plans (¿migraciones Fase 7/11 aplicadas?)`);
  }

  // Overrides de Enterprise por cuenta (si hay cuenta).
  let ov: { numeros_incluidos: number | null; mensajes_mensuales_incluidos: number | null; max_workspaces: number | null; max_members: number | null; throughput_por_numero: number | null } | null = null;
  if (cuenta.accountId) {
    const { data, error } = await supabase
      .from("dulabs_dev_plan_overrides")
      .select("numeros_incluidos, mensajes_mensuales_incluidos, max_workspaces, max_members, throughput_por_numero")
      .eq("account_id", cuenta.accountId)
      .maybeSingle();
    if (error) throw new Error(`[developer/plans] error leyendo overrides: ${error.message}`);
    ov = data ?? null;
  }

  const includedNumbers = ov?.numeros_incluidos ?? plan.numeros_incluidos;
  const additionalNumbers = plan.permite_numeros_adicionales ? cuenta.numerosAdicionales : 0;
  const maxNumbers = includedNumbers === null ? null : includedNumbers + additionalNumbers;

  return {
    accountId: cuenta.accountId,
    planCodigo: plan.codigo,
    planNombre: plan.nombre,
    estado: cuenta.estado,
    consumoBloqueado: cuenta.estado !== "active",
    includedNumbers,
    additionalNumbers,
    maxNumbers,
    canBuyAdditionalNumbers: plan.permite_numeros_adicionales,
    maxMessagesMonth: ov?.mensajes_mensuales_incluidos ?? plan.mensajes_mensuales_incluidos,
    maxWorkspaces: ov?.max_workspaces ?? plan.max_workspaces,
    maxMembers: ov?.max_members ?? plan.max_members,
    throughputPerNumber: ov?.throughput_por_numero ?? plan.mensajes_por_segundo_por_numero,
    precioMensualUsd: plan.precio_mensual_usd,
    precioNumeroAdicionalUsd: plan.precio_numero_adicional_usd,
  };
}

export type LimitesPlan = {
  planCodigo: string;
  planNombre: string;
  /** EFECTIVO para enforcement: 0 si consumoBloqueado (past_due/canceled). null = sin tope. */
  mensajesMensualesIncluidos: number | null;
  /** EFECTIVO para enforcement de números = maxNumbers (pool de cuenta incl. adicionales). 0 si bloqueado. null = sin tope. */
  numerosIncluidos: number | null;
  mensajesPorSegundoPorNumero: number | null;
};

/**
 * Límites EFECTIVOS de enforcement (compat de firma con Fase 7). Los consumen
 * el connect de números (Fase 10) y la reserva de mensajes (Fase 5) tal cual.
 * `numerosIncluidos` es en realidad el máximo efectivo de números de la cuenta
 * (incluidos + adicionales); cuando la suscripción no está `active`, el
 * consumo nuevo se bloquea devolviendo 0 (sin borrar recursos existentes).
 */
export async function resolverLimitesDelWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<LimitesPlan> {
  const e = await resolverEntitlementsDeWorkspace(supabase, workspaceId);
  const bloqueado = e.consumoBloqueado;
  return {
    planCodigo: e.planCodigo,
    planNombre: e.planNombre,
    mensajesMensualesIncluidos: bloqueado ? 0 : e.maxMessagesMonth,
    numerosIncluidos: bloqueado ? 0 : e.maxNumbers,
    mensajesPorSegundoPorNumero: e.throughputPerNumber,
  };
}
