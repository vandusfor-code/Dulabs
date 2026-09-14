import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { PLANES, resolverPlanId } from "@/lib/planes";

export const runtime = "nodejs";

// FASE F15 (Operations Center, autorizado) -- Fase 16 del pedido: consumo
// global, con las MISMAS reglas de negocio que enforcea lib/plan-limits.ts
// (contarNumeros/contarUsuarios/contarAgentesEnUso/mensajesIAMesEfectivo) --
// nunca se inventa una métrica de consumo nueva.
//
// FASE F15.2 (Operations Center, cierre) -- hallazgo real de la auditoría de
// esta fase: la versión anterior llamaba esas 4 funciones POR CADA tenant
// activo (N+1 -- para T tenants, 5 queries por tenant incluida la interna de
// contarAgentesEnUso). lib/plan-limits.ts sigue intacto y se sigue usando
// para el enforcement en tiempo real de UN tenant (signup, invitar, crear
// agente) -- ese caso sí es de un tenant a la vez, ahí un batch no aplica.
// Acá, para la vista agregada de TODOS los tenants, se reemplaza por el
// mismo patrón que ya usaba este archivo para mensajesUsadosPorTenant: una
// sola consulta por tabla (nunca por tenant) + agrupación en memoria.
export async function GET(request: NextRequest) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const supabase = acceso.supabase;

  const { data: suscripciones, error } = await supabase
    .from("dulabs_suscripciones")
    .select("id_tenant, plan, estado, mensajes_ia_mes_negociado")
    .eq("estado", "activa");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { data: usuarios } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  const nombrePorTenant = new Map((usuarios?.users ?? []).map((u) => [u.id, (u.user_metadata?.nombre as string | undefined) ?? u.email ?? null]));

  // mes_actual/mensajes_usados_mes, agente_id/prompt_sistema (legado) y
  // números conectados viven todos en dulabs_clientes_config -- UNA sola
  // consulta cubre las 3 métricas que antes salían de 2 llamadas separadas
  // por tenant (contarNumeros + la mitad "legado" de contarAgentesEnUso).
  const mesHoy = new Date().toISOString().slice(0, 7);
  const { data: numerosConfig } = await supabase
    .from("dulabs_clientes_config")
    .select("id_tenant, mensajes_usados_mes, mes_actual, agente_id, prompt_sistema");
  const mensajesUsadosPorTenant = new Map<string, number>();
  const numerosPorTenant = new Map<string, number>();
  const agentesLegadoPorTenant = new Map<string, number>();
  for (const n of numerosConfig ?? []) {
    numerosPorTenant.set(n.id_tenant, (numerosPorTenant.get(n.id_tenant) ?? 0) + 1);
    if (n.mes_actual === mesHoy) {
      mensajesUsadosPorTenant.set(n.id_tenant, (mensajesUsadosPorTenant.get(n.id_tenant) ?? 0) + (n.mensajes_usados_mes ?? 0));
    }
    if (n.agente_id === null && n.prompt_sistema !== null) {
      agentesLegadoPorTenant.set(n.id_tenant, (agentesLegadoPorTenant.get(n.id_tenant) ?? 0) + 1);
    }
  }

  const { data: miembrosActivos } = await supabase.from("dulabs_miembros_equipo").select("tenant_id").neq("estado", "suspendido");
  const usuariosPorTenant = new Map<string, number>();
  for (const m of miembrosActivos ?? []) usuariosPorTenant.set(m.tenant_id, (usuariosPorTenant.get(m.tenant_id) ?? 0) + 1);

  const { data: agentesNuevos } = await supabase.from("dulabs_agentes").select("id_tenant");
  const agentesNuevosPorTenant = new Map<string, number>();
  for (const a of agentesNuevos ?? []) agentesNuevosPorTenant.set(a.id_tenant, (agentesNuevosPorTenant.get(a.id_tenant) ?? 0) + 1);

  const filtro = request.nextUrl.searchParams.get("filtro"); // "80" | "90" | "excedido"

  const filas = (suscripciones ?? []).map((s) => {
    const plan = PLANES[resolverPlanId(s.plan)];
    const topeMensajes = plan.limites.mensajesIAMes === null ? null : (s.mensajes_ia_mes_negociado ?? plan.limites.mensajesIAMes);
    const mensajesUsados = mensajesUsadosPorTenant.get(s.id_tenant) ?? 0;
    const porcentajeMensajes = topeMensajes ? Math.round((mensajesUsados / topeMensajes) * 100) : null;
    const agentes = (agentesNuevosPorTenant.get(s.id_tenant) ?? 0) + (agentesLegadoPorTenant.get(s.id_tenant) ?? 0);
    return {
      idTenant: s.id_tenant,
      nombre: nombrePorTenant.get(s.id_tenant) ?? null,
      plan: plan.nombre,
      numeros: { usados: numerosPorTenant.get(s.id_tenant) ?? 0, limite: plan.limites.numeros },
      usuarios: { usados: usuariosPorTenant.get(s.id_tenant) ?? 0, limite: plan.limites.usuarios },
      agentesIA: { usados: agentes, limite: plan.limites.agentesIA },
      mensajesIA: { usados: mensajesUsados, limite: topeMensajes, porcentaje: porcentajeMensajes },
    };
  });

  const filtradas = filas.filter((f) => {
    if (!filtro) return true;
    const p = f.mensajesIA.porcentaje;
    if (p === null) return false;
    if (filtro === "80") return p >= 80;
    if (filtro === "90") return p >= 90;
    if (filtro === "excedido") return p >= 100;
    return true;
  });

  return Response.json({ clientes: filtradas.sort((a, b) => (b.mensajesIA.porcentaje ?? -1) - (a.mensajesIA.porcentaje ?? -1)) });
}
