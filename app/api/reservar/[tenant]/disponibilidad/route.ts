import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { planDelTenant } from "@/lib/plan-limits";
import { listarHorariosDisponiblesPorServicio } from "@/lib/disponibilidad-servicio";
// AMORE: la disponibilidad del portal es la REAL (jornada + bloqueos + citas + Google Calendar), la misma que usan el chat y el panel.
import { listarHorariosDisponiblesPorServiciosConNylas } from "@/lib/disponibilidad-servicio-nylas";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import { depsProduccionMiCita } from "@/lib/mi-cita/gestion";
import { servicioIdsDeBusqueda } from "@/lib/reserva-portal-servicios";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// Horarios REALES disponibles -- delega el cálculo completo a
// listarHorariosDisponiblesPorServicio (Fase 2), la misma función que
// consumirá cualquier otro canal futuro. El frontend nunca calcula slots
// por su cuenta: solo muestra lo que esta respuesta devuelve.
//
// AMORE (portal, autorizado) — `servicioIds=a,b` (hasta 3): horarios de un
// bloque continuo con la duración SUMADA, solo de las profesionales que hacen
// TODOS esos servicios. Con un solo servicio es exactamente la consulta de siempre.
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  if (!UUID_RE.test(tenant)) return Response.json({ error: "Enlace inválido" }, { status: 404 });

  const pedidos = servicioIdsDeBusqueda(request.nextUrl.searchParams);
  const fecha = request.nextUrl.searchParams.get("fecha")?.trim();
  const especialistaIdRaw = request.nextUrl.searchParams.get("especialistaId")?.trim();
  if (!pedidos.ok || !fecha || !FECHA_RE.test(fecha)) {
    return Response.json({ error: !pedidos.ok && pedidos.motivo !== "faltan" ? pedidos.error : "Faltan parámetros o son inválidos" }, { status: 400 });
  }
  const servicioIds = pedidos.ids;
  const especialistaId = especialistaIdRaw ? Number(especialistaIdRaw) : undefined;
  if (especialistaIdRaw && !Number.isInteger(especialistaId)) {
    return Response.json({ error: "especialistaId inválido" }, { status: 400 });
  }
  // Combinar servicios en una sola cita solo existe para AMORE (su motor real lo soporta); cualquier otro negocio sigue con un servicio por cita.
  if (servicioIds.length > 1 && tenant !== AMORE_TENANT_ID) {
    return Response.json({ error: "Este negocio no permite combinar servicios en una sola cita" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const plan = await planDelTenant(supabase, tenant);
  if (plan.id === "sin_plan") return Response.json({ especialistas: [] });

  if (tenant === AMORE_TENANT_ID) {
    // Sin integración de calendario no se ofrece ningún horario (nunca disponibilidad a ciegas: la reserva se rechazaría igual).
    const nylas = depsProduccionMiCita(supabase).nylas;
    if (!nylas) return Response.json({ especialistas: [] });
    const real = await listarHorariosDisponiblesPorServiciosConNylas(supabase, { idTenant: tenant, servicioIds, fecha, especialistaId }, { nylasClient: nylas.read, grantId: nylas.grantId });
    // `motivo` deja a la pantalla explicar por qué no hay opciones (ej. ninguna profesional hace todos los servicios juntos).
    if (!real.ok) return Response.json({ especialistas: [], motivo: real.motivo });
    return Response.json({ servicio: real.servicio, servicios: real.servicios, especialistas: real.especialistas });
  }

  const resultado = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: tenant, servicioId: servicioIds[0]!, fecha, especialistaId });
  if (!resultado.ok) return Response.json({ especialistas: [] });

  return Response.json({ servicio: resultado.servicio, especialistas: resultado.especialistas });
}
