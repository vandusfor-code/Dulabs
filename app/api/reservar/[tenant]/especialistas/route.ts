import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { planDelTenant } from "@/lib/plan-limits";
import { resolverEspecialistasElegiblesParaServicio } from "@/lib/asignacion-categoria";
import { resolverEspecialistasParaMultiServicio } from "@/lib/agenda-v2/multi-servicio";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import { servicioIdsDeBusqueda } from "@/lib/reserva-portal-servicios";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Especialistas ACTIVOS de este tenant realmente HABILITADOS para el
// servicio pedido. Fase 8A.8.1 (autorizado) — antes esta ruta reimplementaba
// su propia resolución mirando SOLO dulabs_servicio_especialista, sin el
// fallback por categoría de la Fase 8A.5, por lo que cualquier servicio sin
// asociación explícita (8 de los 11 servicios reales de Daniela) siempre
// devolvía []. Ahora usa el mismo resolver único que ya usa
// listarHorariosDisponiblesPorServicio/reservarCitaPorServicio
// (lib/asignacion-categoria.ts::resolverEspecialistasElegiblesParaServicio)
// -- una sola fuente de verdad para "quién puede atender este servicio", en
// los tres lugares que lo necesitan.
//
// AMORE (portal, autorizado) — `servicioIds=a,b` (hasta 3) pide las
// profesionales que hacen TODOS esos servicios en una sola cita (intersección
// real, lib/agenda-v2/multi-servicio.ts). Con un solo servicio nada cambia.
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  if (!UUID_RE.test(tenant)) return Response.json({ error: "Enlace inválido" }, { status: 404 });

  const pedidos = servicioIdsDeBusqueda(request.nextUrl.searchParams);
  if (!pedidos.ok) return Response.json({ error: pedidos.motivo === "faltan" ? "Falta servicioId" : pedidos.error }, { status: 400 });
  const servicioIds = pedidos.ids;
  // Combinar servicios en una sola cita solo existe para AMORE (su motor real lo soporta); cualquier otro negocio sigue con un servicio por cita.
  if (servicioIds.length > 1 && tenant !== AMORE_TENANT_ID) {
    return Response.json({ error: "Este negocio no permite combinar servicios en una sola cita" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const plan = await planDelTenant(supabase, tenant);
  if (plan.id === "sin_plan") return Response.json({ especialistas: [] });

  // Los servicios deben existir, estar activos y pertenecer a este tenant --
  // igual que reservarCitaPorServicio, nunca se confía en que el servicioId
  // que llegó del frontend sea válido.
  const { data: servicios } = await supabase.from("dulabs_servicios").select("id").eq("id_tenant", tenant).in("id", servicioIds).eq("activo", true);
  if ((servicios ?? []).length !== servicioIds.length) return Response.json({ especialistas: [] });

  if (servicioIds.length === 1) {
    const { especialistas } = await resolverEspecialistasElegiblesParaServicio(supabase, tenant, servicioIds[0]!);
    return Response.json({ especialistas: especialistas.map((e) => ({ id: e.especialistaId, nombre: e.nombre })) });
  }

  const { especialistas } = await resolverEspecialistasParaMultiServicio(supabase, tenant, servicioIds);
  return Response.json({
    especialistas: especialistas.map((e) => ({ id: e.especialistaId, nombre: e.nombre })),
    // Ninguna profesional hace todos los servicios juntos: la pantalla lo explica en vez de mostrar una lista vacía sin motivo.
    ...(especialistas.length === 0 ? { motivo: "combinacion_sin_profesional" } : {}),
  });
}
