import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { planDelTenant } from "@/lib/plan-limits";
import { resolverEspecialistasElegiblesParaServicio } from "@/lib/asignacion-categoria";

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
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  if (!UUID_RE.test(tenant)) return Response.json({ error: "Enlace inválido" }, { status: 404 });

  const servicioId = request.nextUrl.searchParams.get("servicioId")?.trim();
  if (!servicioId) return Response.json({ error: "Falta servicioId" }, { status: 400 });

  const supabase = supabaseAdmin();
  const plan = await planDelTenant(supabase, tenant);
  if (plan.id === "sin_plan") return Response.json({ especialistas: [] });

  // El servicio debe existir, estar activo y pertenecer a este tenant --
  // igual que reservarCitaPorServicio, nunca se confía en que el servicioId
  // que llegó del frontend sea válido.
  const { data: servicio } = await supabase
    .from("dulabs_servicios")
    .select("id")
    .eq("id_tenant", tenant)
    .eq("id", servicioId)
    .eq("activo", true)
    .maybeSingle();
  if (!servicio) return Response.json({ especialistas: [] });

  const { especialistas } = await resolverEspecialistasElegiblesParaServicio(supabase, tenant, servicioId);

  return Response.json({ especialistas: especialistas.map((e) => ({ id: e.especialistaId, nombre: e.nombre })) });
}
