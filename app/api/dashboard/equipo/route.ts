import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol, type Miembro } from "@/lib/team";

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

  const { data, error } = await supabase
    .from("dulabs_miembros_equipo")
    .select("id, email, nombre, rol, estado, created_at")
    .eq("tenant_id", miembro.tenantId)
    .order("created_at", { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ miembros: data ?? [] });
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
  const email = body.email?.trim().toLowerCase();
  const rol = body.rol;
  if (!email || !["admin", "agente", "lectura"].includes(rol ?? "")) {
    return Response.json({ error: "Faltan 'email' o 'rol' válido" }, { status: 400 });
  }

  const { data: yaExiste } = await supabase
    .from("dulabs_miembros_equipo")
    .select("id, tenant_id")
    .eq("email", email)
    .maybeSingle();
  if (yaExiste) {
    return Response.json(
      {
        error:
          yaExiste.tenant_id === miembro.tenantId
            ? "Ese correo ya es miembro de tu equipo"
            : "Ese correo ya pertenece a otra cuenta",
      },
      { status: 409 }
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const { data: invitado, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: siteUrl ? `${siteUrl}/login` : undefined,
  });
  if (inviteError || !invitado.user) {
    return Response.json({ error: inviteError?.message ?? "No se pudo enviar la invitación" }, { status: 500 });
  }

  const { data: fila, error: insertError } = await supabase
    .from("dulabs_miembros_equipo")
    .insert({
      tenant_id: miembro.tenantId,
      user_id: invitado.user.id,
      email,
      rol,
      estado: "invitado",
      invitado_por: miembro.userId,
    })
    .select("id, email, rol, estado, created_at")
    .single();
  if (insertError) return Response.json({ error: insertError.message }, { status: 500 });

  return Response.json({ miembro: fila });
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
  const { miembro_id } = body;
  if (!miembro_id || (!body.rol && !body.estado)) {
    return Response.json({ error: "Falta 'miembro_id' y al menos 'rol' o 'estado'" }, { status: 400 });
  }
  if (body.rol && !["admin", "agente", "lectura"].includes(body.rol)) {
    return Response.json({ error: "Rol inválido" }, { status: 400 });
  }
  if (body.estado && !["activo", "suspendido"].includes(body.estado)) {
    return Response.json({ error: "Estado inválido" }, { status: 400 });
  }

  // Evita que el equipo se quede sin ningún admin activo.
  if ((body.rol && body.rol !== "admin") || body.estado === "suspendido") {
    const { count } = await supabase
      .from("dulabs_miembros_equipo")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", miembro.tenantId)
      .eq("rol", "admin")
      .eq("estado", "activo")
      .neq("id", miembro_id);
    if (!count || count === 0) {
      return Response.json({ error: "El equipo debe conservar al menos un administrador activo" }, { status: 400 });
    }
  }

  const cambios: Record<string, string> = {};
  if (body.rol) cambios.rol = body.rol;
  if (body.estado) cambios.estado = body.estado;

  const { error } = await supabase
    .from("dulabs_miembros_equipo")
    .update(cambios)
    .eq("id", miembro_id)
    .eq("tenant_id", miembro.tenantId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}
