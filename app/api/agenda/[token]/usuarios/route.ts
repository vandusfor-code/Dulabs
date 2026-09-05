import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { hashPassword } from "@/lib/auth/password";

export const runtime = "nodejs";

type UsuarioFila = {
  id: number;
  nombre: string;
  username: string;
  rol: "administrador" | "colaboradora";
  especialista_id: number | null;
  activo: boolean;
  dulabs_especialistas: { nombre: string } | null;
};

// Login AMORE (autorizado) — CRUD de cuentas de login del equipo, admin-only
// (spec Fase 19-20). Nunca selecciona ni devuelve password_hash hacia el
// navegador -- ninguna consulta de este archivo lo incluye en el select.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const { data, error } = await supabase
    .from("dulabs_usuarios")
    .select("id, nombre, username, rol, especialista_id, activo, dulabs_especialistas(nombre)")
    .eq("id_tenant", tenant.idTenant)
    .order("nombre", { ascending: true });
  if (error) return Response.json({ error: "No se pudieron cargar los usuarios" }, { status: 500 });

  const usuarios = ((data ?? []) as unknown as UsuarioFila[]).map((u) => ({
    id: u.id,
    nombre: u.nombre,
    username: u.username,
    rol: u.rol,
    especialistaId: u.especialista_id,
    especialistaNombre: u.dulabs_especialistas?.nombre ?? null,
    activo: u.activo,
  }));

  return Response.json({ usuarios });
}

type BodyUsuario = {
  nombre?: string;
  username?: string;
  password?: string;
  rol?: "administrador" | "colaboradora";
  especialistaId?: number | null;
  activo?: boolean;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  let body: BodyUsuario;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const nombre = body.nombre?.trim();
  const username = body.username?.trim();
  const password = body.password;
  const rol = body.rol;

  if (!nombre) return Response.json({ error: "El nombre es obligatorio" }, { status: 400 });
  if (!username) return Response.json({ error: "El usuario es obligatorio" }, { status: 400 });
  if (!password || password.length < 8) return Response.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
  if (rol !== "administrador" && rol !== "colaboradora") {
    return Response.json({ error: "'rol' debe ser 'administrador' o 'colaboradora'" }, { status: 400 });
  }
  if (rol === "colaboradora" && !body.especialistaId) {
    return Response.json({ error: "Una colaboradora necesita una especialista vinculada" }, { status: 400 });
  }

  if (body.especialistaId) {
    const { data: especialista } = await supabase
      .from("dulabs_especialistas")
      .select("id")
      .eq("id", body.especialistaId)
      .eq("id_tenant", tenant.idTenant)
      .maybeSingle();
    if (!especialista) return Response.json({ error: "Esa especialista no pertenece a este negocio" }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  const { data, error } = await supabase
    .from("dulabs_usuarios")
    .insert({
      id_tenant: tenant.idTenant,
      especialista_id: body.especialistaId ?? null,
      username,
      password_hash: passwordHash,
      nombre,
      rol,
      activo: body.activo ?? true,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return Response.json({ error: "Ese nombre de usuario ya está en uso" }, { status: 409 });
    return Response.json({ error: "No se pudo crear el usuario" }, { status: 500 });
  }
  return Response.json({ ok: true, id: data!.id });
}
