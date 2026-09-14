import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";

export const runtime = "nodejs";

// FASE F15 (Operations Center, autorizado) -- Fase 21 del pedido: logs
// TÉCNICOS, separados de la auditoría administrativa (/admin/auditoria).
// Reutiliza las tablas reales que ya existen para esto (auditadas esta
// fase): dulabs_flow_executions (status incl. 'failed') y dulabs_fallos_ia
// (errores de IA/Anthropic). No existe una tabla genérica de logs de toda
// la app ni de resultados de cron -- no se inventa una; esto es lo real
// que hay disponible hoy, documentado como tal en el reporte de esta fase.
export async function GET(request: NextRequest) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const supabase = acceso.supabase;

  const idTenant = request.nextUrl.searchParams.get("tenant");
  const modulo = request.nextUrl.searchParams.get("modulo") ?? "flow"; // "flow" | "ia"
  const soloErrores = request.nextUrl.searchParams.get("solo_errores") === "1";
  const cursor = request.nextUrl.searchParams.get("cursor");
  const limite = Math.min(100, Number(request.nextUrl.searchParams.get("limite") ?? "50") || 50);

  if (modulo === "ia") {
    let query = supabase
      .from("dulabs_fallos_ia")
      .select("id, id_tenant, phone_number_id, tipo, mensaje, http_status, created_at")
      .order("created_at", { ascending: false })
      .limit(limite + 1);
    if (idTenant) query = query.eq("id_tenant", idTenant);
    if (cursor) query = query.lt("created_at", cursor);
    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const filas = data ?? [];
    const hayMas = filas.length > limite;
    const eventos = hayMas ? filas.slice(0, limite) : filas;
    return Response.json({ eventos, siguienteCursor: hayMas ? eventos[eventos.length - 1].created_at : null });
  }

  let query = supabase
    .from("dulabs_flow_executions")
    .select("id, tenant_id, phone_number_id, telefono_cliente, status, last_activity_at, created_at")
    .order("last_activity_at", { ascending: false })
    .limit(limite + 1);
  if (idTenant) query = query.eq("tenant_id", idTenant);
  if (soloErrores) query = query.eq("status", "failed");
  if (cursor) query = query.lt("last_activity_at", cursor);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const filas = data ?? [];
  const hayMas = filas.length > limite;
  const eventos = hayMas ? filas.slice(0, limite) : filas;
  return Response.json({ eventos, siguienteCursor: hayMas ? eventos[eventos.length - 1].last_activity_at : null });
}
