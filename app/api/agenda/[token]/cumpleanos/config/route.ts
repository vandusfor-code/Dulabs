import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { obtenerConfigCumpleanos } from "@/lib/cumpleanos/config";

export const runtime = "nodejs";

// Cumpleaños (autorizado) — lee/escribe la MISMA configuración que ya usa
// el motor real (lib/cumpleanos/*, Fase 6A/6B), sin crear una segunda
// fuente de verdad. Nunca activa el cron ni envía nada -- solo persiste
// cómo quiere el tenant que se comporte el módulo cuando corra.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const config = await obtenerConfigCumpleanos(supabase, tenant.idTenant);
  return Response.json({ config });
}

type Body = { activo?: boolean; mensaje?: string; horaEnvio?: string };

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
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

  const actual = await obtenerConfigCumpleanos(supabase, tenant.idTenant);
  const mensaje = body.mensaje !== undefined ? body.mensaje.trim() : actual.mensaje;
  const activo = body.activo !== undefined ? body.activo : actual.activo;

  if (activo && !mensaje) {
    return Response.json({ error: "Configura un mensaje antes de activar el envío de cumpleaños" }, { status: 400 });
  }

  const { error } = await supabase.from("dulabs_cumpleanos_config").upsert(
    {
      id_tenant: tenant.idTenant,
      activo,
      mensaje,
      hora_envio: body.horaEnvio ?? actual.horaEnvio,
      zona_horaria: actual.zonaHoraria,
      nombre_negocio: actual.nombreNegocio,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id_tenant" }
  );
  if (error) return Response.json({ error: "No se pudo guardar la configuración" }, { status: 500 });

  return Response.json({ config: await obtenerConfigCumpleanos(supabase, tenant.idTenant) });
}
