import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANES, SIN_PLAN, resolverPlanId, type PlanDef } from "@/lib/planes";

// Plan real vigente del tenant. Sin fila en dulabs_suscripciones con
// estado "activa" (nunca pagó, o el pago quedó pendiente/vencido), cae a
// SIN_PLAN: cero funcionalidad hasta que pague. No hay plan gratuito de
// facto -- ver lib/planes.ts para el porqué.
export async function planDelTenant(supabase: SupabaseClient, tenantId: string): Promise<PlanDef> {
  const { data } = await supabase
    .from("dulabs_suscripciones")
    .select("plan")
    .eq("id_tenant", tenantId)
    .eq("estado", "activa")
    .maybeSingle();
  if (!data) return SIN_PLAN;
  return PLANES[resolverPlanId(data.plan)];
}

export async function contarNumeros(supabase: SupabaseClient, tenantId: string): Promise<number> {
  const { count } = await supabase
    .from("dulabs_clientes_config")
    .select("id", { count: "exact", head: true })
    .eq("id_tenant", tenantId);
  return count ?? 0;
}

// Miembros invitados o activos cuentan contra el cupo; los suspendidos no
// (mismo criterio que ya usa el chequeo de "al menos un admin activo" en
// app/api/dashboard/equipo/route.ts).
export async function contarUsuarios(supabase: SupabaseClient, tenantId: string): Promise<number> {
  const { count } = await supabase
    .from("dulabs_miembros_equipo")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .neq("estado", "suspendido");
  return count ?? 0;
}

// Agentes "en uso" = perfiles reales en dulabs_agentes + números que
// todavía usan el prompt legado (sin agente_id asignado) directamente en
// dulabs_clientes_config. Así un tenant que nunca migró a la tabla nueva
// sigue contando contra su cupo de agentes en vez de quedar sin límite.
export async function contarAgentesEnUso(supabase: SupabaseClient, tenantId: string): Promise<number> {
  const [{ count: agentesNuevos }, { count: legado }] = await Promise.all([
    supabase.from("dulabs_agentes").select("id", { count: "exact", head: true }).eq("id_tenant", tenantId),
    supabase
      .from("dulabs_clientes_config")
      .select("id", { count: "exact", head: true })
      .eq("id_tenant", tenantId)
      .is("agente_id", null)
      .not("prompt_sistema", "is", null),
  ]);
  return (agentesNuevos ?? 0) + (legado ?? 0);
}
