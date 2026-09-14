import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { PLANES, resolverPlanId } from "@/lib/planes";
import { mensajesIAMesEfectivo, contarNumeros, contarUsuarios, contarAgentesEnUso } from "@/lib/plan-limits";

export const runtime = "nodejs";

// FASE F15 (Operations Center, autorizado) -- Fase 16 del pedido: consumo
// global, reutilizando EXACTAMENTE los mismos contadores de lib/plan-limits.ts
// que ya enforcean los límites reales del producto -- nunca se inventa una
// métrica de consumo nueva.
export async function GET(request: NextRequest) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const supabase = acceso.supabase;

  const { data: suscripciones, error } = await supabase
    .from("dulabs_suscripciones")
    .select("id_tenant, plan, estado")
    .eq("estado", "activa");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { data: usuarios } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  const nombrePorTenant = new Map((usuarios?.users ?? []).map((u) => [u.id, (u.user_metadata?.nombre as string | undefined) ?? u.email ?? null]));

  // mes_actual/mensajes_usados_mes ya vive por número -- se suma por tenant.
  const mesHoy = new Date().toISOString().slice(0, 7);
  const { data: mensajesPorNumero } = await supabase.from("dulabs_clientes_config").select("id_tenant, mensajes_usados_mes, mes_actual");
  const mensajesUsadosPorTenant = new Map<string, number>();
  for (const n of mensajesPorNumero ?? []) {
    if (n.mes_actual !== mesHoy) continue;
    mensajesUsadosPorTenant.set(n.id_tenant, (mensajesUsadosPorTenant.get(n.id_tenant) ?? 0) + (n.mensajes_usados_mes ?? 0));
  }

  const filtro = request.nextUrl.searchParams.get("filtro"); // "80" | "90" | "excedido"

  const filas = await Promise.all(
    (suscripciones ?? []).map(async (s) => {
      const plan = PLANES[resolverPlanId(s.plan)];
      const [numeros, usuariosCount, agentes, topeMensajes] = await Promise.all([
        contarNumeros(supabase, s.id_tenant),
        contarUsuarios(supabase, s.id_tenant),
        contarAgentesEnUso(supabase, s.id_tenant),
        mensajesIAMesEfectivo(supabase, s.id_tenant, plan),
      ]);
      const mensajesUsados = mensajesUsadosPorTenant.get(s.id_tenant) ?? 0;
      const porcentajeMensajes = topeMensajes ? Math.round((mensajesUsados / topeMensajes) * 100) : null;
      return {
        idTenant: s.id_tenant,
        nombre: nombrePorTenant.get(s.id_tenant) ?? null,
        plan: plan.nombre,
        numeros: { usados: numeros, limite: plan.limites.numeros },
        usuarios: { usados: usuariosCount, limite: plan.limites.usuarios },
        agentesIA: { usados: agentes, limite: plan.limites.agentesIA },
        mensajesIA: { usados: mensajesUsados, limite: topeMensajes, porcentaje: porcentajeMensajes },
      };
    }),
  );

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
