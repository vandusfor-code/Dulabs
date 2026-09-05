import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";

export const runtime = "nodejs";

type BodyBloqueo = { tipo?: string; inicio?: string; fin?: string; motivo?: string; activo?: boolean };

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const bloqueoId = Number(id);
  if (!Number.isInteger(bloqueoId)) return Response.json({ error: "ID inválido" }, { status: 400 });

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

  const cambios: Record<string, unknown> = {};
  if (body.tipo !== undefined) cambios.tipo = body.tipo.trim();
  if (body.inicio !== undefined) {
    const d = new Date(body.inicio);
    if (Number.isNaN(d.getTime())) return Response.json({ error: "Fecha/hora de inicio inválida" }, { status: 400 });
    cambios.inicio = d.toISOString();
  }
  if (body.fin !== undefined) {
    const d = new Date(body.fin);
    if (Number.isNaN(d.getTime())) return Response.json({ error: "Fecha/hora de fin inválida" }, { status: 400 });
    cambios.fin = d.toISOString();
  }
  if (body.motivo !== undefined) cambios.motivo = body.motivo.trim() || null;
  if (body.activo !== undefined) cambios.activo = Boolean(body.activo);
  if (Object.keys(cambios).length === 0) return Response.json({ error: "No hay cambios para guardar" }, { status: 400 });
  cambios.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("dulabs_bloqueos")
    .update(cambios)
    .eq("id_tenant", tenant.idTenant)
    .eq("id", bloqueoId)
    .select("id, especialista_id, tipo, inicio, fin, motivo, activo")
    .maybeSingle();

  if (error) {
    if (error.code === "23514") {
      const detalle = error.message.includes("rango_valido")
        ? "La fecha/hora de inicio debe ser antes que la de fin"
        : "El tipo de bloqueo no es válido";
      return Response.json({ error: detalle }, { status: 400 });
    }
    console.error("[bloqueos] error editando:", error.message);
    return Response.json({ error: "No se pudo guardar el bloqueo" }, { status: 500 });
  }
  if (!data) return Response.json({ error: "Bloqueo no encontrado" }, { status: 404 });

  return Response.json({ success: true, bloqueo: data });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const bloqueoId = Number(id);
  if (!Number.isInteger(bloqueoId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const { data } = await supabase
    .from("dulabs_bloqueos")
    .delete()
    .eq("id_tenant", tenant.idTenant)
    .eq("id", bloqueoId)
    .select("id")
    .maybeSingle();
  if (!data) return Response.json({ error: "Bloqueo no encontrado" }, { status: 404 });

  return Response.json({ success: true });
}
