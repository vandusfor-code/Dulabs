import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";
import { listarEquipo, invitarMiembro, cambiarMiembro } from "@/lib/equipo-domain";

export const runtime = "nodejs";

// FASE F15 (Operations Center, autorizado) -- gestión de equipo de un
// cliente desde el Panel de Operaciones. Reutiliza lib/equipo-domain.ts,
// la misma lógica que ya usa el propio cliente en /dashboard/equipo.
export async function GET(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;

  try {
    const miembros = await listarEquipo(acceso.supabase, idTenant);
    return Response.json({ miembros });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;

  let body: { email?: string; rol?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const r = await invitarMiembro(supabase, {
    idTenant,
    email: body.email ?? "",
    rol: body.rol ?? "",
    invitadoPor: acceso.miembro.userId,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });
  await registrarAuditoriaAdmin(supabase, {
    operador: acceso.miembro,
    accion: "INVITE_MEMBER",
    idTenant,
    resultado: r.ok ? "ok" : "error",
    motivo: r.ok ? null : r.error,
    metadata: { email: body.email, rol: body.rol },
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ miembro: r.data.miembro });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;

  let body: { miembro_id?: number; rol?: string; estado?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const r = await cambiarMiembro(supabase, { idTenant, miembroId: body.miembro_id ?? 0, rol: body.rol, estado: body.estado });
  const accion = body.rol ? "CHANGE_ROLE" : body.estado === "suspendido" ? "SUSPEND_MEMBER" : "REACTIVATE_MEMBER";
  await registrarAuditoriaAdmin(supabase, {
    operador: acceso.miembro,
    accion,
    idTenant,
    recurso: String(body.miembro_id),
    resultado: r.ok ? "ok" : "error",
    motivo: r.ok ? null : r.error,
    metadata: { rol: body.rol, estado: body.estado },
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ success: true });
}
