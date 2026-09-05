import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken } from "@/lib/agenda-admin-auth";
import { listarHorariosDisponiblesPorServicio } from "@/lib/disponibilidad-servicio";

export const runtime = "nodejs";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// Fase 6A — mismo motor de disponibilidad que ya usa el portal público
// (Fase 4, app/api/reservar/[tenant]/disponibilidad) y el panel de Fase 5 --
// solo cambia cómo se resuelve el tenant (token de especialista, no un
// id_tenant crudo en la URL). Cero cálculo de slots nuevo.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });

  const servicioId = request.nextUrl.searchParams.get("servicioId")?.trim();
  const fecha = request.nextUrl.searchParams.get("fecha")?.trim();
  const especialistaIdRaw = request.nextUrl.searchParams.get("especialistaId")?.trim();
  if (!servicioId || !fecha || !FECHA_RE.test(fecha)) {
    return Response.json({ error: "Faltan parámetros o son inválidos" }, { status: 400 });
  }
  const especialistaId = especialistaIdRaw ? Number(especialistaIdRaw) : undefined;
  if (especialistaIdRaw && !Number.isInteger(especialistaId)) {
    return Response.json({ error: "especialistaId inválido" }, { status: 400 });
  }

  const resultado = await listarHorariosDisponiblesPorServicio(supabase, {
    idTenant: tenant.idTenant,
    servicioId,
    fecha,
    especialistaId,
  });
  if (!resultado.ok) return Response.json({ especialistas: [] });

  return Response.json({ servicio: resultado.servicio, especialistas: resultado.especialistas });
}
