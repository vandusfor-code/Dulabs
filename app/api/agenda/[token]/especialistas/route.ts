import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken } from "@/lib/agenda-admin-auth";

export const runtime = "nodejs";

const COLUMNAS = "id, nombre, numero_whatsapp, servicio, duracion_min, activo, bloquea_horario, es_general, requiere_aprobacion";

// Lista TODOS los profesionales del tenant (activos e inactivos).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });

  const { data } = await supabase.from("dulabs_especialistas").select(COLUMNAS).eq("id_tenant", tenant.idTenant).order("nombre", { ascending: true });
  return Response.json({ especialistas: data ?? [] });
}

type BodyEspecialista = {
  nombre?: string;
  numero_whatsapp?: string;
  servicio?: string;
  duracion_min?: number;
  bloquea_horario?: boolean;
  requiere_aprobacion?: boolean;
};

// Crea un profesional nuevo del mismo negocio (mismo id_tenant/phone_number_id
// que el token que abrió el panel -- nunca se acepta uno distinto desde el
// body). El token de agenda propio se genera solo (columna con DEFAULT en
// Postgres, ver 20260825200000_especialistas_agenda.sql) -- no hace falta
// generarlo aquí.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });

  let body: BodyEspecialista;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const nombre = body.nombre?.trim();
  const numeroWhatsapp = body.numero_whatsapp?.replace(/\D/g, "");
  if (!nombre) return Response.json({ error: "El nombre es obligatorio" }, { status: 400 });
  if (!numeroWhatsapp) return Response.json({ error: "El número de WhatsApp es obligatorio" }, { status: 400 });
  const duracionMin = body.duracion_min !== undefined ? Number(body.duracion_min) : 90;
  if (!Number.isInteger(duracionMin) || duracionMin <= 0) {
    return Response.json({ error: "La duración debe ser un número entero mayor a 0" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("dulabs_especialistas")
    .insert({
      id_tenant: tenant.idTenant,
      phone_number_id: tenant.phoneNumberId,
      nombre,
      numero_whatsapp: numeroWhatsapp,
      servicio: body.servicio?.trim() || nombre,
      duracion_min: duracionMin,
      bloquea_horario: body.bloquea_horario ?? true,
      es_general: false,
      requiere_aprobacion: body.requiere_aprobacion ?? false,
    })
    .select(COLUMNAS)
    .single();

  if (error) {
    if (error.code === "23505") return Response.json({ error: "Ya existe un profesional con ese número de WhatsApp" }, { status: 409 });
    console.error("[especialistas] error creando:", error.message);
    return Response.json({ error: "No se pudo crear el profesional" }, { status: 500 });
  }

  return Response.json({ success: true, especialista: data });
}
