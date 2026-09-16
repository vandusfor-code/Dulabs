import type { SupabaseClient } from "@supabase/supabase-js";

// DuLabs Developer V1 -- Fase 7 (Billing + Usage + Limits, autorizado).
// Accesor de la ÚNICA fuente de verdad de límites de plan: la tabla
// dulabs_dev_plans (ver migración 20261013000000). Este módulo NO hardcodea
// límites -- solo los lee. El único valor "de código" es el CÓDIGO del plan
// por defecto (DEVELOPER), que es una decisión de producto aprobada, no un
// límite numérico.
//
// Regla de resolución workspace->plan: si no hay fila en
// dulabs_dev_workspace_plans, el workspace ES DEVELOPER (todos los
// workspaces existentes lo son sin backfill). Un límite NULL en el plan =
// "sin límite definido / configurable" -> el enforcement NO bloquea.

export const PLAN_POR_DEFECTO = "DEVELOPER" as const;

export type PlanFila = {
  codigo: string;
  nombre: string;
  mensajes_mensuales_incluidos: number | null;
  numeros_incluidos: number | null;
  mensajes_por_segundo_por_numero: number | null;
  precio_numero_adicional_usd: number | null;
  precio_mensual_usd: number | null;
};

export type LimitesPlan = {
  planCodigo: string;
  planNombre: string;
  /** null = sin límite mensual definido (AGENCY/ENTERPRISE) -> no se aplica cuota. */
  mensajesMensualesIncluidos: number | null;
  /** null = sin límite de números definido -> no se aplica límite. */
  numerosIncluidos: number | null;
  mensajesPorSegundoPorNumero: number | null;
};

const CAMPOS = "codigo, nombre, mensajes_mensuales_incluidos, numeros_incluidos, mensajes_por_segundo_por_numero, precio_numero_adicional_usd, precio_mensual_usd";

/** Código de plan del workspace -- ausencia de fila = PLAN_POR_DEFECTO. */
export async function resolverCodigoPlanDelWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<string> {
  const { data, error } = await supabase
    .from("dulabs_dev_workspace_plans")
    .select("plan_codigo")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`[developer/plans] error resolviendo plan del workspace: ${error.message}`);
  return (data?.plan_codigo as string | undefined) ?? PLAN_POR_DEFECTO;
}

/** Lee una fila de plan por código. */
export async function obtenerPlan(supabase: SupabaseClient, codigo: string): Promise<PlanFila | null> {
  const { data, error } = await supabase.from("dulabs_dev_plans").select(CAMPOS).eq("codigo", codigo).maybeSingle();
  if (error) throw new Error(`[developer/plans] error leyendo plan '${codigo}': ${error.message}`);
  return (data as PlanFila) ?? null;
}

/**
 * Resuelve los límites efectivos de un workspace (plan asignado, o
 * DEVELOPER por defecto). Si por algún dato inconsistente el código de plan
 * no existiera en dulabs_dev_plans, cae a DEVELOPER en vez de romper el
 * canal -- nunca deja una request sin límites resueltos por un dato faltante.
 */
export async function resolverLimitesDelWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<LimitesPlan> {
  const codigo = await resolverCodigoPlanDelWorkspace(supabase, workspaceId);
  const plan = (await obtenerPlan(supabase, codigo)) ?? (codigo !== PLAN_POR_DEFECTO ? await obtenerPlan(supabase, PLAN_POR_DEFECTO) : null);
  if (!plan) {
    throw new Error(`[developer/plans] no se encontró el plan '${codigo}' ni el plan por defecto '${PLAN_POR_DEFECTO}' en dulabs_dev_plans (¿migración 20261013000000 aplicada?)`);
  }
  return {
    planCodigo: plan.codigo,
    planNombre: plan.nombre,
    mensajesMensualesIncluidos: plan.mensajes_mensuales_incluidos,
    numerosIncluidos: plan.numeros_incluidos,
    mensajesPorSegundoPorNumero: plan.mensajes_por_segundo_por_numero,
  };
}
