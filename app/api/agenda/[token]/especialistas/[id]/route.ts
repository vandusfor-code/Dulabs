import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken } from "@/lib/agenda-admin-auth";

export const runtime = "nodejs";

const COLUMNAS = "id, nombre, numero_whatsapp, servicio, duracion_min, activo, bloquea_horario, es_general, requiere_aprobacion";

type BodyEspecialista = {
  nombre?: string;
  numero_whatsapp?: string;
  servicio?: string;
  duracion_min?: number;
  activo?: boolean;
  bloquea_horario?: boolean;
  requiere_aprobacion?: boolean;
};

// Edita un profesional existente (incluye activar/desactivar). Nunca toca
// token, phone_number_id, id_tenant ni es_general -- esos campos siguen
// siendo responsabilidad de otras partes del sistema (legacy, catálogo
// general) y no se exponen para edición en esta fase.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const especialistaId = Number(id);
  if (!Number.isInteger(especialistaId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });

  const { data: existente } = await supabase
    .from("dulabs_especialistas")
    .select("id")
    .eq("id_tenant", tenant.idTenant)
    .eq("id", especialistaId)
    .maybeSingle();
  if (!existente) return Response.json({ error: "Profesional no encontrado" }, { status: 404 });

  let body: BodyEspecialista;
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
  if (body.numero_whatsapp !== undefined) {
    const numero = body.numero_whatsapp.replace(/\D/g, "");
    if (!numero) return Response.json({ error: "El número de WhatsApp no puede quedar vacío" }, { status: 400 });
    cambios.numero_whatsapp = numero;
  }
  if (body.servicio !== undefined) {
    const servicio = body.servicio.trim();
    if (!servicio) return Response.json({ error: "El campo de especialidad no puede quedar vacío" }, { status: 400 });
    cambios.servicio = servicio;
  }
  if (body.duracion_min !== undefined) {
    const duracionMin = Number(body.duracion_min);
    if (!Number.isInteger(duracionMin) || duracionMin <= 0) {
      return Response.json({ error: "La duración debe ser un número entero mayor a 0" }, { status: 400 });
    }
    cambios.duracion_min = duracionMin;
  }
  if (body.activo !== undefined) cambios.activo = Boolean(body.activo);
  if (body.bloquea_horario !== undefined) cambios.bloquea_horario = Boolean(body.bloquea_horario);
  if (body.requiere_aprobacion !== undefined) cambios.requiere_aprobacion = Boolean(body.requiere_aprobacion);

  if (Object.keys(cambios).length === 0) return Response.json({ error: "No hay cambios para guardar" }, { status: 400 });
  cambios.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("dulabs_especialistas")
    .update(cambios)
    .eq("id_tenant", tenant.idTenant)
    .eq("id", especialistaId)
    .select(COLUMNAS)
    .single();

  if (error) {
    if (error.code === "23505") return Response.json({ error: "Ya existe un profesional con ese número de WhatsApp" }, { status: 409 });
    console.error("[especialistas] error editando:", error.message);
    return Response.json({ error: "No se pudo guardar el profesional" }, { status: 500 });
  }

  return Response.json({ success: true, especialista: data });
}
