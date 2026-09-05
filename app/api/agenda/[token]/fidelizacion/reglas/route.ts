import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken } from "@/lib/agenda-admin-auth";

export const runtime = "nodejs";

// Fidelización (Fase 7, autorizado) — lista de solo lectura para el panel:
// reglas del tenant (activas e inactivas) + nombre real del servicio +
// cantidad de oportunidades pendientes por regla. SIEMPRE filtrado por el
// id_tenant que resuelve el token -- un tenant nunca ve reglas de otro.
// Genérico: no hay nada específico de AMORE acá.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });

  const { data: reglas, error } = await supabase
    .from("dulabs_fidelizacion_reglas")
    .select("id, servicio_id, dias, activa, mensaje, dulabs_servicios(nombre)")
    .eq("id_tenant", tenant.idTenant)
    .order("created_at", { ascending: true });
  if (error) return Response.json({ error: "No se pudieron cargar las reglas" }, { status: 500 });

  const { data: pendientes } = await supabase
    .from("dulabs_fidelizacion_oportunidades")
    .select("regla_id")
    .eq("id_tenant", tenant.idTenant)
    .eq("estado", "pendiente");

  const conteoPorRegla = new Map<number, number>();
  for (const o of (pendientes ?? []) as { regla_id: number }[]) {
    conteoPorRegla.set(o.regla_id, (conteoPorRegla.get(o.regla_id) ?? 0) + 1);
  }

  type Fila = { id: number; servicio_id: string; dias: number; activa: boolean; mensaje: string; dulabs_servicios: { nombre: string } | null };

  const resultado = ((reglas ?? []) as unknown as Fila[]).map((r) => ({
    id: r.id,
    servicioId: r.servicio_id,
    servicio: r.dulabs_servicios?.nombre ?? "(servicio eliminado)",
    dias: r.dias,
    activa: r.activa,
    mensaje: r.mensaje,
    pendientes: conteoPorRegla.get(r.id) ?? 0,
  }));

  return Response.json({ reglas: resultado });
}
