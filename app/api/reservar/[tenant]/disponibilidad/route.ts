import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { planDelTenant } from "@/lib/plan-limits";
import { listarHorariosDisponiblesPorServicio } from "@/lib/disponibilidad-servicio";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// Horarios REALES disponibles -- delega el cálculo completo a
// listarHorariosDisponiblesPorServicio (Fase 2), la misma función que
// consumirá cualquier otro canal futuro. El frontend nunca calcula slots
// por su cuenta: solo muestra lo que esta respuesta devuelve.
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  if (!UUID_RE.test(tenant)) return Response.json({ error: "Enlace inválido" }, { status: 404 });

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

  const supabase = supabaseAdmin();
  const plan = await planDelTenant(supabase, tenant);
  if (plan.id === "sin_plan") return Response.json({ especialistas: [] });

  const resultado = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: tenant, servicioId, fecha, especialistaId });
  if (!resultado.ok) return Response.json({ especialistas: [] });

  return Response.json({ servicio: resultado.servicio, especialistas: resultado.especialistas });
}
