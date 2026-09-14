import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol, type Miembro } from "@/lib/team";
import { listarEquipo, invitarMiembro, cambiarMiembro } from "@/lib/equipo-domain";

export const runtime = "nodejs";

async function autenticar(
  request: NextRequest
): Promise<{ error: Response } | { supabase: ReturnType<typeof supabaseAdmin>; miembro: Miembro }> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return { error: Response.json({ error: "Falta el token de sesión" }, { status: 401 }) };
  const supabase = supabaseAdmin();
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData.user) return { error: Response.json({ error: "Sesión inválida" }, { status: 401 }) };
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!miembro) return { error: Response.json({ error: "No perteneces a ningún equipo activo" }, { status: 403 }) };
  return { supabase, miembro };
}

// Lista el equipo del tenant. Cualquier rol activo puede ver quién más está.
export async function GET(request: NextRequest) {
  const ctx = await autenticar(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;

  const miembros = await listarEquipo(supabase, miembro.tenantId).catch((e: Error) => {
    throw e;
  });
  return Response.json({ miembros });
}

// Invita a un nuevo miembro (admin únicamente).
export async function POST(request: NextRequest) {
  const ctx = await autenticar(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;
  if (!requireRol(miembro, ["admin"])) {
    return Response.json({ error: "Solo un administrador puede invitar miembros" }, { status: 403 });
  }

  let body: { email?: string; rol?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const r = await invitarMiembro(supabase, {
    idTenant: miembro.tenantId,
    email: body.email ?? "",
    rol: body.rol ?? "",
    invitadoPor: miembro.userId,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ miembro: r.data.miembro });
}

// Cambia rol o estado de un miembro (admin únicamente). No permite dejar el
// equipo sin ningún admin activo.
export async function PATCH(request: NextRequest) {
  const ctx = await autenticar(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;
  if (!requireRol(miembro, ["admin"])) {
    return Response.json({ error: "Solo un administrador puede modificar el equipo" }, { status: 403 });
  }

  let body: { miembro_id?: number; rol?: string; estado?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const r = await cambiarMiembro(supabase, { idTenant: miembro.tenantId, miembroId: body.miembro_id ?? 0, rol: body.rol, estado: body.estado });
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ success: true });
}
