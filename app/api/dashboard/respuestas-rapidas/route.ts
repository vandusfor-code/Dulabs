import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol, type Miembro } from "@/lib/team";

export const runtime = "nodejs";

// Respuestas rápidas: solo admin/agente las ven y gestionan — lectura nunca
// envía mensajes, así que no tiene uso para snippets de compose box.
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
  if (!requireRol(miembro, ["admin", "agente"])) {
    return { error: Response.json({ error: "No tienes permiso para gestionar respuestas rápidas" }, { status: 403 }) };
  }
  return { supabase, miembro };
}

export async function GET(request: NextRequest) {
  const ctx = await autenticar(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;

  const { data, error } = await supabase
    .from("dulabs_respuestas_rapidas")
    .select("id, atajo, mensaje, created_at, updated_at")
    .eq("tenant_id", miembro.tenantId)
    .order("atajo", { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ respuestas: data ?? [] });
}

const MAX_ATAJO = 40;
const MAX_MENSAJE = 4096;

export async function POST(request: NextRequest) {
  const ctx = await autenticar(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;

  let body: { atajo?: string; mensaje?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const atajo = body.atajo?.trim();
  const mensaje = body.mensaje?.trim();
  if (!atajo || !mensaje) {
    return Response.json({ error: "Faltan 'atajo' o 'mensaje'" }, { status: 400 });
  }
  if (atajo.length > MAX_ATAJO) {
    return Response.json({ error: `El atajo no puede superar ${MAX_ATAJO} caracteres` }, { status: 400 });
  }
  if (mensaje.length > MAX_MENSAJE) {
    return Response.json({ error: `El mensaje no puede superar ${MAX_MENSAJE} caracteres` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("dulabs_respuestas_rapidas")
    .insert({ tenant_id: miembro.tenantId, atajo, mensaje })
    .select("id, atajo, mensaje, created_at, updated_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      return Response.json({ error: "Ya existe una respuesta rápida con ese atajo" }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ respuesta: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const ctx = await autenticar(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;

  let body: { id?: number; atajo?: string; mensaje?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { id } = body;
  const atajo = body.atajo?.trim();
  const mensaje = body.mensaje?.trim();
  if (!id || (!atajo && !mensaje)) {
    return Response.json({ error: "Falta 'id' y al menos 'atajo' o 'mensaje'" }, { status: 400 });
  }
  if (atajo && atajo.length > MAX_ATAJO) {
    return Response.json({ error: `El atajo no puede superar ${MAX_ATAJO} caracteres` }, { status: 400 });
  }
  if (mensaje && mensaje.length > MAX_MENSAJE) {
    return Response.json({ error: `El mensaje no puede superar ${MAX_MENSAJE} caracteres` }, { status: 400 });
  }

  const cambios: Record<string, string> = { updated_at: new Date().toISOString() };
  if (atajo) cambios.atajo = atajo;
  if (mensaje) cambios.mensaje = mensaje;

  const { error } = await supabase
    .from("dulabs_respuestas_rapidas")
    .update(cambios)
    .eq("id", id)
    .eq("tenant_id", miembro.tenantId);
  if (error) {
    if (error.code === "23505") {
      return Response.json({ error: "Ya existe una respuesta rápida con ese atajo" }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const ctx = await autenticar(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;

  let body: { id?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.id) return Response.json({ error: "Falta 'id'" }, { status: 400 });

  const { error } = await supabase
    .from("dulabs_respuestas_rapidas")
    .delete()
    .eq("id", body.id)
    .eq("tenant_id", miembro.tenantId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}
