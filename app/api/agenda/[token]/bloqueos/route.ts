import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";

export const runtime = "nodejs";

// Lista bloqueos futuros (o de hoy en adelante) del tenant -- incluye los
// específicos de un especialista y los generales (especialista_id NULL).
// Estas son EXACTAMENTE las filas que lee bloqueosDelDia (lib/especialistas.ts):
// crear uno aquí afecta de inmediato la disponibilidad real, sin ninguna
// lógica duplicada en el frontend.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const desde = new Date();
  desde.setHours(0, 0, 0, 0);
  const { data } = await supabase
    .from("dulabs_bloqueos")
    .select("id, especialista_id, tipo, inicio, fin, motivo, activo")
    .eq("id_tenant", tenant.idTenant)
    .gte("fin", desde.toISOString())
    .order("inicio", { ascending: true });
  return Response.json({ bloqueos: data ?? [] });
}

type BodyBloqueo = { especialista_id?: number | null; tipo?: string; inicio?: string; fin?: string; motivo?: string };

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  let body: BodyBloqueo;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tipo = body.tipo?.trim();
  const inicio = body.inicio ? new Date(body.inicio) : null;
  const fin = body.fin ? new Date(body.fin) : null;
  if (!tipo || !inicio || !fin || Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
    return Response.json({ error: "Faltan datos obligatorios o la fecha/hora es inválida" }, { status: 400 });
  }

  const especialistaId = body.especialista_id !== undefined && body.especialista_id !== null ? Number(body.especialista_id) : null;
  if (especialistaId !== null) {
    if (!Number.isInteger(especialistaId)) return Response.json({ error: "especialista_id inválido" }, { status: 400 });
    const { data: especialista } = await supabase
      .from("dulabs_especialistas")
      .select("id")
      .eq("id_tenant", tenant.idTenant)
      .eq("id", especialistaId)
      .maybeSingle();
    if (!especialista) return Response.json({ error: "Ese profesional no pertenece a este negocio" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("dulabs_bloqueos")
    .insert({
      id_tenant: tenant.idTenant,
      especialista_id: especialistaId,
      tipo,
      inicio: inicio.toISOString(),
      fin: fin.toISOString(),
      motivo: body.motivo?.trim() || null,
    })
    .select("id, especialista_id, tipo, inicio, fin, motivo, activo")
    .single();

  if (error) {
    if (error.code === "23514") {
      const detalle = error.message.includes("rango_valido")
        ? "La fecha/hora de inicio debe ser antes que la de fin"
        : "El tipo de bloqueo no es válido";
      return Response.json({ error: detalle }, { status: 400 });
    }
    console.error("[bloqueos] error creando:", error.message);
    return Response.json({ error: "No se pudo crear el bloqueo" }, { status: 500 });
  }

  return Response.json({ success: true, bloqueo: data });
}
