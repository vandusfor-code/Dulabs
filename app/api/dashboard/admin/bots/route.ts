import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";

export const runtime = "nodejs";

// FASE F15 (Operations Center, autorizado) -- Fase 18 del pedido: salud del
// bot derivada de señales REALES, nunca "healthy" solo porque una flag diga
// activo. critical = no puede atender de verdad (WhatsApp desconectado, o
// >=3 fallos de Flow recientes); warning = atiende pero con una condición
// real que amerita revisión (IA pausada manualmente, o 1-2 fallos
// recientes, o sin ningún Flow asignado); healthy = todo lo demás.
type Health = "healthy" | "warning" | "critical";

export async function GET(request: NextRequest) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const supabase = acceso.supabase;

  const { data: numeros, error } = await supabase
    .from("dulabs_clientes_config")
    .select("id_tenant, phone_number_id, nombre_negocio, ia_pausada, flow_activo, flow_id, estado_conexion, meta_permanent_token");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const phoneNumberIds = (numeros ?? []).map((n) => n.phone_number_id);
  const fallosPorNumero = new Map<string, { count: number; ultimaEn: string }>();
  const ultimaEjecucionPorNumero = new Map<string, string>();
  if (phoneNumberIds.length > 0) {
    const { data: ejecuciones } = await supabase
      .from("dulabs_flow_executions")
      .select("phone_number_id, status, last_activity_at")
      .in("phone_number_id", phoneNumberIds)
      .order("last_activity_at", { ascending: false })
      .limit(1000);
    for (const e of ejecuciones ?? []) {
      if (!ultimaEjecucionPorNumero.has(e.phone_number_id)) ultimaEjecucionPorNumero.set(e.phone_number_id, e.last_activity_at);
      if (e.status === "failed") {
        const actual = fallosPorNumero.get(e.phone_number_id);
        fallosPorNumero.set(e.phone_number_id, { count: (actual?.count ?? 0) + 1, ultimaEn: actual?.ultimaEn ?? e.last_activity_at });
      }
    }
  }

  const { data: usuarios } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  const nombrePorTenant = new Map((usuarios?.users ?? []).map((u) => [u.id, (u.user_metadata?.nombre as string | undefined) ?? u.email ?? null]));

  const bots = (numeros ?? []).map((n) => {
    const desconectado = n.estado_conexion === "desconectado" || (!n.estado_conexion && !n.meta_permanent_token);
    const fallos = fallosPorNumero.get(n.phone_number_id)?.count ?? 0;
    let health: Health = "healthy";
    if (desconectado || fallos >= 3) health = "critical";
    else if (n.ia_pausada || fallos >= 1 || !n.flow_activo) health = "warning";

    return {
      idTenant: n.id_tenant,
      nombreTenant: nombrePorTenant.get(n.id_tenant) ?? null,
      phoneNumberId: n.phone_number_id,
      nombreNegocio: n.nombre_negocio,
      iaPausada: n.ia_pausada,
      flowActivo: n.flow_activo,
      flowId: n.flow_id,
      fallosRecientes: fallos,
      ultimaEjecucion: ultimaEjecucionPorNumero.get(n.phone_number_id) ?? null,
      health,
    };
  });

  const filtroHealth = request.nextUrl.searchParams.get("health");
  const filtrados = filtroHealth ? bots.filter((b) => b.health === filtroHealth) : bots;

  return Response.json({ bots: filtrados.sort((a, b) => (a.health === b.health ? 0 : a.health === "critical" ? -1 : b.health === "critical" ? 1 : a.health === "warning" ? -1 : 1)) });
}
