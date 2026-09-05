import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";

export const runtime = "nodejs";

type Body = { activa?: boolean; dias?: number; mensaje?: string };

// Edita/activa/desactiva una regla existente (autorizado) -- SIEMPRE
// filtrado por id_tenant, un tenant nunca puede tocar la regla de otro ni
// adivinando el id.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const reglaId = Number(id);
  if (!Number.isInteger(reglaId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (body.dias !== undefined && (!Number.isInteger(body.dias) || body.dias <= 0)) {
    return Response.json({ error: "'dias' debe ser un número entero mayor a 0" }, { status: 400 });
  }

  const cambios: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.activa !== undefined) cambios.activa = body.activa;
  if (body.dias !== undefined) cambios.dias = body.dias;
  if (body.mensaje !== undefined) cambios.mensaje = body.mensaje.trim();

  const { data, error } = await supabase
    .from("dulabs_fidelizacion_reglas")
    .update(cambios)
    .eq("id_tenant", tenant.idTenant)
    .eq("id", reglaId)
    .select("id")
    .maybeSingle();

  if (error) return Response.json({ error: "No se pudo actualizar la regla" }, { status: 500 });
  if (!data) return Response.json({ error: "Regla no encontrada" }, { status: 404 });

  return Response.json({ ok: true });
}
