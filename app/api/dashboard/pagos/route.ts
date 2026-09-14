import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo } from "@/lib/team";

export const runtime = "nodejs";

// FASE F14.2 (Billing / Monetización completa, autorizado) -- hallazgo real:
// dulabs_pagos ya guarda todo lo necesario para reconstruir el historial
// comercial de un tenant (transacción, monto, fecha, estado, plan asociado
// desde esta fase), pero hasta ahora NINGÚN endpoint se lo exponía al propio
// cliente -- solo el Panel de Operaciones (uso interno de DuLabs) podía
// verlo. No es facturación electrónica (eso queda documentado como
// integración futura, ver reporte de esta fase), solo el historial de pagos
// que Fase 13 pide que quede completo y disponible.
//
// Lectura de solo el propio tenant (cualquier miembro activo, no solo
// admin -- mismo criterio de acceso que la lista de equipo/agentes: ver
// datos del propio negocio no requiere ser admin, solo pertenecer a él).
// tipo=marketplace se incluye también -- son pagos reales del mismo tenant,
// aunque no correspondan al plan principal.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });

  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!miembro) return Response.json({ error: "No perteneces a ningún equipo activo" }, { status: 403 });

  type FilaPago = { id: number; wompi_transaction_id: string; monto_cop: number; estado: string; tipo: string; created_at: string; plan?: string | null };
  let pagos: FilaPago[] | null;
  let error: { code?: string; message: string } | null;
  ({ data: pagos, error } = await supabase
    .from("dulabs_pagos")
    .select("id, wompi_transaction_id, monto_cop, estado, tipo, plan, created_at")
    .eq("id_tenant", miembro.tenantId)
    .order("created_at", { ascending: false })
    .limit(200));
  // Fail-safe: si la migración 20260914100000 (columna dulabs_pagos.plan)
  // todavía no corrió, PostgREST rechaza el SELECT completo (PGRST204) --
  // se reintenta sin esa columna en vez de romper el historial entero.
  if (error && (error.code === "PGRST204" || error.code === "42703")) {
    ({ data: pagos, error } = await supabase
      .from("dulabs_pagos")
      .select("id, wompi_transaction_id, monto_cop, estado, tipo, created_at")
      .eq("id_tenant", miembro.tenantId)
      .order("created_at", { ascending: false })
      .limit(200));
  }
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    pagos: (pagos ?? []).map((p) => ({
      id: p.id,
      referencia: p.wompi_transaction_id,
      monto_cop: p.monto_cop,
      estado: p.estado,
      tipo: p.tipo,
      // Null en pagos anteriores a la migración 20260914100000 -- no se
      // inventa retroactivamente, ver el comentario de esa columna.
      plan: p.plan ?? null,
      fecha: p.created_at,
    })),
  });
}
