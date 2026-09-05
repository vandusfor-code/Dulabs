import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";

export const runtime = "nodejs";

type BodyServicio = {
  nombre?: string;
  categoria?: string | null;
  descripcion?: string | null;
  duracion_min?: number;
  precio?: number | null;
  activo?: boolean;
  especialistaIds?: number[];
};

// Edita un servicio existente (incluye activar/desactivar) y, si viene
// especialistaIds, REEMPLAZA el conjunto completo de asociaciones -- más
// simple y predecible para un formulario con checklist que un diff parcial.
// Todo queda scoped por id_tenant primero: un id de servicio que no
// pertenezca a este tenant nunca se encuentra, sin importar qué tan válido
// parezca.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const { data: existente } = await supabase
    .from("dulabs_servicios")
    .select("id")
    .eq("id_tenant", tenant.idTenant)
    .eq("id", id)
    .maybeSingle();
  if (!existente) return Response.json({ error: "Servicio no encontrado" }, { status: 404 });

  let body: BodyServicio;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const cambios: Record<string, unknown> = {};
  if (body.nombre !== undefined) {
    const nombre = body.nombre.trim();
    if (!nombre) return Response.json({ error: "El nombre no puede quedar vacío" }, { status: 400 });
    cambios.nombre = nombre;
  }
  if (body.categoria !== undefined) cambios.categoria = body.categoria?.trim() || null;
  if (body.descripcion !== undefined) cambios.descripcion = body.descripcion?.trim() || null;
  if (body.duracion_min !== undefined) {
    const duracionMin = Number(body.duracion_min);
    if (!Number.isInteger(duracionMin) || duracionMin <= 0) {
      return Response.json({ error: "La duración debe ser un número entero mayor a 0" }, { status: 400 });
    }
    cambios.duracion_min = duracionMin;
  }
  if (body.precio !== undefined) {
    const precio = body.precio === null ? null : Number(body.precio);
    if (precio !== null && (!Number.isFinite(precio) || precio < 0)) {
      return Response.json({ error: "El precio no es válido" }, { status: 400 });
    }
    cambios.precio = precio;
  }
  if (body.activo !== undefined) cambios.activo = Boolean(body.activo);

  if (Object.keys(cambios).length > 0) {
    cambios.updated_at = new Date().toISOString();
    const { error } = await supabase.from("dulabs_servicios").update(cambios).eq("id_tenant", tenant.idTenant).eq("id", id);
    if (error) {
      console.error("[servicios] error editando:", error.message);
      return Response.json({ error: "No se pudo guardar el servicio" }, { status: 500 });
    }
  }

  if (Array.isArray(body.especialistaIds)) {
    const especialistaIds = body.especialistaIds.filter((eid) => Number.isInteger(eid));
    const { error: delError } = await supabase
      .from("dulabs_servicio_especialista")
      .delete()
      .eq("id_tenant", tenant.idTenant)
      .eq("servicio_id", id);
    if (delError) {
      console.error("[servicios] error limpiando asociaciones:", delError.message);
      return Response.json({ error: "No se pudieron actualizar los profesionales asociados" }, { status: 500 });
    }
    if (especialistaIds.length > 0) {
      const { error: insError } = await supabase
        .from("dulabs_servicio_especialista")
        .insert(especialistaIds.map((especialistaId) => ({ id_tenant: tenant.idTenant, servicio_id: id, especialista_id: especialistaId })));
      if (insError) {
        console.error("[servicios] error re-asociando:", insError.message);
        return Response.json({ error: "Alguno de los profesionales elegidos no es válido" }, { status: 400 });
      }
    }
  }

  const { data: actualizado } = await supabase
    .from("dulabs_servicios")
    .select("id, nombre, categoria, descripcion, duracion_min, precio, activo")
    .eq("id_tenant", tenant.idTenant)
    .eq("id", id)
    .single();

  return Response.json({ success: true, servicio: actualizado });
}
