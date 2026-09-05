import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";

export const runtime = "nodejs";

// Lista las ventanas laborales del tenant -- si se pide un especialistaId
// puntual, filtra a ese; si no, trae las de TODOS (útil para un resumen).
// Estas son EXACTAMENTE las filas que lee el motor de disponibilidad
// (ventanasLaboralesEspecialista, lib/especialistas.ts) -- no hay una
// segunda fuente de horarios para el panel.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const especialistaIdRaw = request.nextUrl.searchParams.get("especialistaId");
  let query = supabase
    .from("dulabs_horario_especialista")
    .select("id, especialista_id, dia_semana, hora_inicio, hora_fin, activo")
    .eq("id_tenant", tenant.idTenant)
    .order("especialista_id", { ascending: true })
    .order("dia_semana", { ascending: true })
    .order("hora_inicio", { ascending: true });
  if (especialistaIdRaw) {
    const especialistaId = Number(especialistaIdRaw);
    if (!Number.isInteger(especialistaId)) return Response.json({ error: "especialistaId inválido" }, { status: 400 });
    query = query.eq("especialista_id", especialistaId);
  }
  const { data } = await query;
  return Response.json({ horarios: data ?? [] });
}

type BodyHorario = { especialista_id?: number; dia_semana?: number; hora_inicio?: string; hora_fin?: string };

// Crea una ventana laboral. El especialista debe pertenecer a este tenant
// (verificado explícitamente, además de la FK compuesta que ya lo garantiza
// a nivel de Postgres); hora_inicio < hora_fin y dia_semana 0-6 los sigue
// validando el CHECK de la tabla -- si falla, se traduce a un mensaje claro
// en vez de dejar pasar el código de Postgres crudo.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  let body: BodyHorario;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const especialistaId = Number(body.especialista_id);
  const diaSemana = Number(body.dia_semana);
  const horaInicio = body.hora_inicio?.trim();
  const horaFin = body.hora_fin?.trim();
  if (!Number.isInteger(especialistaId) || !Number.isInteger(diaSemana) || !horaInicio || !horaFin) {
    return Response.json({ error: "Faltan datos obligatorios" }, { status: 400 });
  }

  const { data: especialista } = await supabase
    .from("dulabs_especialistas")
    .select("id")
    .eq("id_tenant", tenant.idTenant)
    .eq("id", especialistaId)
    .maybeSingle();
  if (!especialista) return Response.json({ error: "Ese profesional no pertenece a este negocio" }, { status: 404 });

  const { data, error } = await supabase
    .from("dulabs_horario_especialista")
    .insert({ id_tenant: tenant.idTenant, especialista_id: especialistaId, dia_semana: diaSemana, hora_inicio: horaInicio, hora_fin: horaFin })
    .select("id, especialista_id, dia_semana, hora_inicio, hora_fin, activo")
    .single();

  if (error) {
    if (error.code === "23514") {
      const detalle = error.message.includes("rango_valido")
        ? "La hora de inicio debe ser antes que la hora de fin"
        : "El día de la semana no es válido";
      return Response.json({ error: detalle }, { status: 400 });
    }
    console.error("[horarios] error creando:", error.message);
    return Response.json({ error: "No se pudo crear el horario" }, { status: 500 });
  }

  return Response.json({ success: true, horario: data });
}
