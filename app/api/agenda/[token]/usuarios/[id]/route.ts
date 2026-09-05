import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { hashPassword } from "@/lib/auth/password";

export const runtime = "nodejs";

type Body = {
  nombre?: string;
  rol?: "administrador" | "colaboradora";
  especialistaId?: number | null;
  activo?: boolean;
  password?: string;
};

// Login AMORE (autorizado) — edita una cuenta existente: nombre/rol/
// especialista/activo, y "restablecer contraseña" (spec Fase 21) enviando
// `password` -- se hashea de nuevo, nunca se guarda ni se devuelve en
// plano. SIEMPRE filtrado por id_tenant -- un tenant nunca puede tocar la
// cuenta de otro ni adivinando el id.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const usuarioId = Number(id);
  if (!Number.isInteger(usuarioId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { data: actual } = await supabase
    .from("dulabs_usuarios")
    .select("id, rol, especialista_id")
    .eq("id", usuarioId)
    .eq("id_tenant", tenant.idTenant)
    .maybeSingle();
  if (!actual) return Response.json({ error: "Usuario no encontrado" }, { status: 404 });

  const rolFinal = body.rol ?? actual.rol;
  const especialistaIdFinal = body.especialistaId !== undefined ? body.especialistaId : actual.especialista_id;
  if (rolFinal === "colaboradora" && !especialistaIdFinal) {
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

  const cambios: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.nombre !== undefined) {
    const nombre = body.nombre.trim();
    if (!nombre) return Response.json({ error: "El nombre no puede quedar vacío" }, { status: 400 });
    cambios.nombre = nombre;
  }
  if (body.rol !== undefined) cambios.rol = rolFinal;
  if (body.especialistaId !== undefined) cambios.especialista_id = body.especialistaId;
  if (body.activo !== undefined) cambios.activo = body.activo;
  if (body.password !== undefined) {
    if (body.password.length < 8) return Response.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
    cambios.password_hash = await hashPassword(body.password);
  }

  const { error } = await supabase.from("dulabs_usuarios").update(cambios).eq("id", usuarioId).eq("id_tenant", tenant.idTenant);
  if (error) return Response.json({ error: "No se pudo actualizar el usuario" }, { status: 500 });

  return Response.json({ ok: true });
}
