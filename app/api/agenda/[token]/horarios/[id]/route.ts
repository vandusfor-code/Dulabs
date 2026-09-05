import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken } from "@/lib/agenda-admin-auth";

export const runtime = "nodejs";

type BodyHorario = { dia_semana?: number; hora_inicio?: string; hora_fin?: string; activo?: boolean };

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const horarioId = Number(id);
  if (!Number.isInteger(horarioId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });

  let body: BodyHorario;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const cambios: Record<string, unknown> = {};
  if (body.dia_semana !== undefined) cambios.dia_semana = Number(body.dia_semana);
  if (body.hora_inicio !== undefined) cambios.hora_inicio = body.hora_inicio;
  if (body.hora_fin !== undefined) cambios.hora_fin = body.hora_fin;
  if (body.activo !== undefined) cambios.activo = Boolean(body.activo);
  if (Object.keys(cambios).length === 0) return Response.json({ error: "No hay cambios para guardar" }, { status: 400 });
  cambios.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("dulabs_horario_especialista")
    .update(cambios)
    .eq("id_tenant", tenant.idTenant)
    .eq("id", horarioId)
    .select("id, especialista_id, dia_semana, hora_inicio, hora_fin, activo")
    .maybeSingle();

  if (error) {
    if (error.code === "23514") {
      const detalle = error.message.includes("rango_valido")
        ? "La hora de inicio debe ser antes que la hora de fin"
        : "El día de la semana no es válido";
      return Response.json({ error: detalle }, { status: 400 });
    }
    console.error("[horarios] error editando:", error.message);
    return Response.json({ error: "No se pudo guardar el horario" }, { status: 500 });
  }
  if (!data) return Response.json({ error: "Horario no encontrado" }, { status: 404 });

  return Response.json({ success: true, horario: data });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const horarioId = Number(id);
  if (!Number.isInteger(horarioId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });

  const { data } = await supabase
    .from("dulabs_horario_especialista")
    .delete()
    .eq("id_tenant", tenant.idTenant)
    .eq("id", horarioId)
    .select("id")
    .maybeSingle();
  if (!data) return Response.json({ error: "Horario no encontrado" }, { status: 404 });

  return Response.json({ success: true });
}
