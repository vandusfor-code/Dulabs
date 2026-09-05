import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";

export const runtime = "nodejs";

const ESTADOS_VALIDOS = ["pendiente", "contactado", "descartado"] as const;
type Estado = (typeof ESTADOS_VALIDOS)[number];

// Fidelización (Fase 7, autorizado) — único cambio que el panel puede hacer
// en esta fase: mover el flujo MANUAL de una oportunidad (pendiente ->
// contactado/descartado). No reenvía nada ni dispara ningún mensaje -- eso
// es la Fase 9. SIEMPRE filtrado por id_tenant: un token de un tenant nunca
// puede tocar la oportunidad de otro, ni adivinando el id.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const oportunidadId = Number(id);
  if (!Number.isInteger(oportunidadId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  let body: { estado?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Solicitud inválida" }, { status: 400 });
  }
  if (!ESTADOS_VALIDOS.includes(body.estado as Estado)) {
    return Response.json({ error: "Estado inválido" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("dulabs_fidelizacion_oportunidades")
    .update({ estado: body.estado, updated_at: new Date().toISOString() })
    .eq("id_tenant", tenant.idTenant)
    .eq("id", oportunidadId)
    .select("id")
    .maybeSingle();

  if (error) return Response.json({ error: "No se pudo actualizar" }, { status: 500 });
  if (!data) return Response.json({ error: "Oportunidad no encontrada" }, { status: 404 });

  return Response.json({ ok: true });
}
