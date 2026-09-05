import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";

export const runtime = "nodejs";

// Fidelización (Fase 7, autorizado) — lista de solo lectura para el panel:
// reglas del tenant (activas e inactivas) + nombre real del servicio +
// cantidad de oportunidades pendientes por regla. SIEMPRE filtrado por el
// id_tenant que resuelve el token -- un tenant nunca ve reglas de otro.
// Genérico: no hay nada específico de AMORE acá.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

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

type BodyRegla = { servicioId?: string; dias?: number; mensaje?: string };

// Crea una regla nueva (autorizado) -- UNIQUE(id_tenant, servicio_id) en la
// tabla es lo que impide dos reglas para el mismo servicio, no una
// comprobación aparte acá. No inventa ningún mensaje: si no se manda uno,
// rechaza -- la plantilla siempre la escribe el negocio.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  let body: BodyRegla;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.servicioId) return Response.json({ error: "Falta 'servicioId'" }, { status: 400 });
  if (!Number.isInteger(body.dias) || (body.dias ?? 0) <= 0) {
    return Response.json({ error: "'dias' debe ser un número entero mayor a 0" }, { status: 400 });
  }
  if (!body.mensaje?.trim()) return Response.json({ error: "Falta 'mensaje'" }, { status: 400 });

  const { data, error } = await supabase
    .from("dulabs_fidelizacion_reglas")
    .insert({ id_tenant: tenant.idTenant, servicio_id: body.servicioId, dias: body.dias, mensaje: body.mensaje.trim() })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return Response.json({ error: "Ya existe una regla para ese servicio" }, { status: 409 });
    return Response.json({ error: "No se pudo crear la regla" }, { status: 500 });
  }
  return Response.json({ ok: true, id: data!.id });
}
