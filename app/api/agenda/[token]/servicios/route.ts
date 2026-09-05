import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";

export const runtime = "nodejs";

type ServicioFila = { id: string; nombre: string; categoria: string | null; descripcion: string | null; duracion_min: number; precio: number | null; activo: boolean };

// Lista TODOS los servicios del tenant (activos e inactivos -- el panel
// necesita ver ambos para poder reactivar uno), cada uno con los ids de los
// especialistas ya habilitados (dulabs_servicio_especialista) para poblar
// el checklist de "asociar profesionales" sin una segunda ida y vuelta.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const [{ data: servicios }, { data: relaciones }] = await Promise.all([
    supabase
      .from("dulabs_servicios")
      .select("id, nombre, categoria, descripcion, duracion_min, precio, activo")
      .eq("id_tenant", tenant.idTenant)
      .order("nombre", { ascending: true }),
    supabase.from("dulabs_servicio_especialista").select("servicio_id, especialista_id").eq("id_tenant", tenant.idTenant),
  ]);

  const especialistaIdsPorServicio = new Map<string, number[]>();
  for (const r of (relaciones ?? []) as { servicio_id: string; especialista_id: number }[]) {
    const lista = especialistaIdsPorServicio.get(r.servicio_id) ?? [];
    lista.push(r.especialista_id);
    especialistaIdsPorServicio.set(r.servicio_id, lista);
  }

  const resultado = ((servicios ?? []) as ServicioFila[]).map((s) => ({
    ...s,
    especialistaIds: especialistaIdsPorServicio.get(s.id) ?? [],
  }));

  return Response.json({ servicios: resultado });
}

type BodyServicio = {
  nombre?: string;
  categoria?: string;
  descripcion?: string;
  duracion_min?: number;
  precio?: number | null;
  especialistaIds?: number[];
};

// Crea un servicio nuevo y, si vienen, sus asociaciones iniciales con
// especialistas -- la FK compuesta de dulabs_servicio_especialista es la
// última barrera real contra asociar un especialista de otro tenant (ver
// 20260904030000_daniela_reservas_modelo_v1.sql), no se confía solo en esta
// validación de aplicación.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  let body: BodyServicio;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const nombre = body.nombre?.trim();
  const duracionMin = Number(body.duracion_min);
  if (!nombre) return Response.json({ error: "El nombre es obligatorio" }, { status: 400 });
  if (!Number.isInteger(duracionMin) || duracionMin <= 0) {
    return Response.json({ error: "La duración debe ser un número entero mayor a 0" }, { status: 400 });
  }
  const precio = body.precio === null || body.precio === undefined || body.precio === ("" as unknown) ? null : Number(body.precio);
  if (precio !== null && (!Number.isFinite(precio) || precio < 0)) {
    return Response.json({ error: "El precio no es válido" }, { status: 400 });
  }

  const { data: servicio, error } = await supabase
    .from("dulabs_servicios")
    .insert({
      id_tenant: tenant.idTenant,
      nombre,
      categoria: body.categoria?.trim() || null,
      descripcion: body.descripcion?.trim() || null,
      duracion_min: duracionMin,
      precio,
    })
    .select("id, nombre, categoria, descripcion, duracion_min, precio, activo")
    .single();
  if (error || !servicio) {
    console.error("[servicios] error creando:", error?.message);
    return Response.json({ error: "No se pudo crear el servicio" }, { status: 500 });
  }

  const especialistaIds = Array.isArray(body.especialistaIds) ? body.especialistaIds.filter((id) => Number.isInteger(id)) : [];
  if (especialistaIds.length > 0) {
    const { error: relError } = await supabase
      .from("dulabs_servicio_especialista")
      .insert(especialistaIds.map((especialistaId) => ({ id_tenant: tenant.idTenant, servicio_id: servicio.id, especialista_id: especialistaId })));
    if (relError) {
      console.error("[servicios] error asociando especialistas:", relError.message);
      return Response.json(
        { error: "El servicio se creó, pero no se pudo asociar a los profesionales elegidos", servicio },
        { status: 207 }
      );
    }
  }

  return Response.json({ success: true, servicio: { ...servicio, especialistaIds } });
}
