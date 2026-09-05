import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken } from "@/lib/agenda-admin-auth";
import { diasTranscurridos } from "@/lib/fidelizacion/vencimiento";

export const runtime = "nodejs";

// Fidelización (Fase 7, autorizado) — "Clientes para contactar": lista de
// solo lectura para el panel, SIEMPRE filtrada por el id_tenant que resuelve
// el token. No envía nada -- eso es la Fase 9. `estado` se actualiza vía
// PATCH /oportunidades/[id].
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });

  const estadoFiltro = request.nextUrl.searchParams.get("estado");

  let consulta = supabase
    .from("dulabs_fidelizacion_oportunidades")
    .select(
      "id, fecha_visita, dias_regla, estado, dulabs_clientes_conocidos(nombre, telefono_cliente), dulabs_fidelizacion_reglas(dias, dulabs_servicios(nombre))"
    )
    .eq("id_tenant", tenant.idTenant)
    .order("fecha_visita", { ascending: false });
  if (estadoFiltro) consulta = consulta.eq("estado", estadoFiltro);

  const { data, error } = await consulta;
  if (error) return Response.json({ error: "No se pudieron cargar los clientes para contactar" }, { status: 500 });

  type Fila = {
    id: number;
    fecha_visita: string;
    dias_regla: number;
    estado: "pendiente" | "contactado" | "descartado";
    dulabs_clientes_conocidos: { nombre: string; telefono_cliente: string } | null;
    dulabs_fidelizacion_reglas: { dias: number; dulabs_servicios: { nombre: string } | null } | null;
  };

  const ahora = new Date();
  const resultado = ((data ?? []) as unknown as Fila[]).map((o) => ({
    id: o.id,
    cliente: o.dulabs_clientes_conocidos?.nombre ?? "(cliente eliminado)",
    telefono: o.dulabs_clientes_conocidos?.telefono_cliente ?? null,
    servicio: o.dulabs_fidelizacion_reglas?.dulabs_servicios?.nombre ?? "(servicio eliminado)",
    fechaVisita: o.fecha_visita,
    diasTranscurridos: diasTranscurridos(new Date(o.fecha_visita), ahora),
    diasRegla: o.dias_regla,
    estado: o.estado,
  }));

  return Response.json({ oportunidades: resultado });
}
