import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { fechaTenantHoy } from "@/lib/cumpleanos/fecha";

export const runtime = "nodejs";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

type ClienteFila = { id: number; nombre: string; cumple_dia: number | null; cumple_mes: number | null };

// Cumpleaños (autorizado) — lista REAL de clientes con cumpleaños
// registrado (dulabs_clientes_conocidos.cumple_dia/cumple_mes, Fase 3/4),
// con "días hasta" calculado en la zona horaria del tenant (mismo
// lib/cumpleanos/fecha.ts que usa el motor real) -- ninguna fecha se
// inventa ni se lee de la hora del servidor.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const { data } = await supabase
    .from("dulabs_clientes_conocidos")
    .select("id, nombre, cumple_dia, cumple_mes")
    .eq("id_tenant", tenant.idTenant)
    .not("cumple_dia", "is", null)
    .not("cumple_mes", "is", null);

  const hoy = fechaTenantHoy("America/Bogota");

  const conDias = ((data ?? []) as ClienteFila[]).map((c) => {
    const dia = c.cumple_dia!;
    const mes = c.cumple_mes!;
    let diasHasta = 0;
    if (mes === hoy.mes && dia === hoy.dia) {
      diasHasta = 0;
    } else {
      // Próxima ocurrencia (este año o el que viene) contada en días de calendario, sin tocar horas.
      const anioBase = hoy.anio;
      let proxima = new Date(Date.UTC(anioBase, mes - 1, dia));
      const hoyUTC = new Date(Date.UTC(hoy.anio, hoy.mes - 1, hoy.dia));
      if (proxima.getTime() < hoyUTC.getTime()) proxima = new Date(Date.UTC(anioBase + 1, mes - 1, dia));
      diasHasta = Math.round((proxima.getTime() - hoyUTC.getTime()) / (24 * 60 * 60 * 1000));
    }
    return {
      id: c.id,
      nombre: c.nombre,
      esHoy: diasHasta === 0,
      diasHasta,
      fecha: `${dia} de ${MESES[mes - 1]}`,
    };
  });

  conDias.sort((a, b) => a.diasHasta - b.diasHasta);

  return Response.json({ cumpleanos: conDias });
}
