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

// Catálogo de etiquetas del tenant. Cualquier rol activo puede verlo.
export async function GET(request: NextRequest) {
  const ctx = await autenticar(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;

  const { data, error } = await supabase
    .from("dulabs_etiquetas")
    .select("id, nombre, color, created_at")
    .eq("tenant_id", miembro.tenantId)
    .order("nombre", { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ etiquetas: data ?? [] });
}

const MAX_NOMBRE = 30;
const COLOR_HEX = /^#[0-9a-fA-F]{6}$/;

// Crea una etiqueta (admin/agente). No requiere rol de lectura porque solo
// admin/agente pueden aplicarlas/quitarlas de una conversación.
export async function POST(request: NextRequest) {
  const ctx = await autenticar(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;
  if (!requireRol(miembro, ["admin", "agente"])) {
    return Response.json({ error: "No tienes permiso para crear etiquetas" }, { status: 403 });
  }

  let body: { nombre?: string; color?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const nombre = body.nombre?.trim();
  const color = body.color?.trim() || "#c6ff3d";
  if (!nombre) return Response.json({ error: "Falta 'nombre'" }, { status: 400 });
  if (nombre.length > MAX_NOMBRE) {
    return Response.json({ error: `El nombre no puede superar ${MAX_NOMBRE} caracteres` }, { status: 400 });
  }
  if (!COLOR_HEX.test(color)) {
    return Response.json({ error: "Color inválido (formato #rrggbb)" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("dulabs_etiquetas")
    .insert({ tenant_id: miembro.tenantId, nombre, color })
    .select("id, nombre, color, created_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      return Response.json({ error: "Ya existe una etiqueta con ese nombre" }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ etiqueta: data }, { status: 201 });
}

// Borra una etiqueta del catálogo (admin/agente). ON DELETE CASCADE la quita
// de cualquier conversación que la tuviera aplicada.
export async function DELETE(request: NextRequest) {
  const ctx = await autenticar(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;
  if (!requireRol(miembro, ["admin", "agente"])) {
    return Response.json({ error: "No tienes permiso para borrar etiquetas" }, { status: 403 });
  }

  let body: { id?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.id) return Response.json({ error: "Falta 'id'" }, { status: 400 });

  const { error } = await supabase
    .from("dulabs_etiquetas")
    .delete()
    .eq("id", body.id)
    .eq("tenant_id", miembro.tenantId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}
