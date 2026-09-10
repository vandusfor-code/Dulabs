import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { obtenerConfigComunicaciones } from "@/lib/comunicaciones/config";
import { ANTICIPACIONES_RECORDATORIO_MINUTOS, type AnticipacionRecordatorioMinutos } from "@/lib/comunicaciones/tipos";

export const runtime = "nodejs";

// Confirmaciones y recordatorios (autorizado) — lee/escribe la MISMA
// configuración que ya usa el motor real (lib/comunicaciones/*, Fase 8).
// NO envía nada ni activa ningún cron -- solo persiste la configuración.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const config = await obtenerConfigComunicaciones(supabase, tenant.idTenant);
  return Response.json({ config });
}

type Body = {
  confirmacionActiva?: boolean;
  confirmacionMensaje?: string;
  recordatorioActivo?: boolean;
  recordatorioAnticipacionMinutos?: number;
  recordatorioMensaje?: string;
};

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

  const actual = await obtenerConfigComunicaciones(supabase, tenant.idTenant);
  const confirmacionMensaje = body.confirmacionMensaje !== undefined ? body.confirmacionMensaje.trim() : actual.confirmacionMensaje;
  const recordatorioMensaje = body.recordatorioMensaje !== undefined ? body.recordatorioMensaje.trim() : actual.recordatorioMensaje;
  const confirmacionActiva = body.confirmacionActiva !== undefined ? body.confirmacionActiva : actual.confirmacionActiva;
  const recordatorioActivo = body.recordatorioActivo !== undefined ? body.recordatorioActivo : actual.recordatorioActivo;

  if (confirmacionActiva && !confirmacionMensaje) {
    return Response.json({ error: "Configura el mensaje de confirmación antes de activarlo" }, { status: 400 });
  }
  if (recordatorioActivo && !recordatorioMensaje) {
    return Response.json({ error: "Configura el mensaje de recordatorio antes de activarlo" }, { status: 400 });
  }
  const anticipacionMinutos = body.recordatorioAnticipacionMinutos ?? actual.recordatorioAnticipacionMinutos;
  if (!ANTICIPACIONES_RECORDATORIO_MINUTOS.includes(anticipacionMinutos as AnticipacionRecordatorioMinutos)) {
    return Response.json(
      { error: `'recordatorioAnticipacionMinutos' debe ser uno de: ${ANTICIPACIONES_RECORDATORIO_MINUTOS.join(", ")}` },
      { status: 400 }
    );
  }

  const { error } = await supabase.from("dulabs_comunicaciones_config").upsert(
    {
      id_tenant: tenant.idTenant,
      confirmacion_activa: confirmacionActiva,
      confirmacion_mensaje: confirmacionMensaje,
      recordatorio_activo: recordatorioActivo,
      recordatorio_anticipacion_minutos: anticipacionMinutos,
      recordatorio_mensaje: recordatorioMensaje,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id_tenant" }
  );
  if (error) return Response.json({ error: "No se pudo guardar la configuración" }, { status: 500 });

  return Response.json({ config: await obtenerConfigComunicaciones(supabase, tenant.idTenant) });
}
