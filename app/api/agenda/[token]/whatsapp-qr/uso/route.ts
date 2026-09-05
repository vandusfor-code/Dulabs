import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken } from "@/lib/agenda-admin-auth";

export const runtime = "nodejs";

// WhatsApp QR (autorizado) — conteo REAL de uso por tipo de mensaje, leído
// de las tablas de idempotencia que cada motor ya escribe (Fase 6A/7/8):
// dulabs_cumpleanos_procesados, dulabs_comunicaciones_procesadas (tipo
// confirmacion/recordatorio) y dulabs_fidelizacion_oportunidades. Ningún
// motor envía WhatsApp real todavía (ver lib/whatsapp-worker-client.ts,
// Fase L) -- estos números cuentan corridas reales del motor (simuladas o
// enviadas), nunca datos inventados. Un tenant sin cron activo ni historial
// (como AMORE hoy) muestra honestamente 0 en los cuatro.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });

  const [confirmaciones, recordatorios, cumpleanos, fidelizacion] = await Promise.all([
    supabase
      .from("dulabs_comunicaciones_procesadas")
      .select("id", { count: "exact", head: true })
      .eq("id_tenant", tenant.idTenant)
      .eq("tipo", "confirmacion"),
    supabase
      .from("dulabs_comunicaciones_procesadas")
      .select("id", { count: "exact", head: true })
      .eq("id_tenant", tenant.idTenant)
      .eq("tipo", "recordatorio"),
    supabase.from("dulabs_cumpleanos_procesados").select("id", { count: "exact", head: true }).eq("id_tenant", tenant.idTenant),
    supabase.from("dulabs_fidelizacion_oportunidades").select("id", { count: "exact", head: true }).eq("id_tenant", tenant.idTenant),
  ]);

  return Response.json({
    uso: [
      { label: "Confirmaciones", cantidad: confirmaciones.count ?? 0 },
      { label: "Recordatorios", cantidad: recordatorios.count ?? 0 },
      { label: "Cumpleaños", cantidad: cumpleanos.count ?? 0 },
      { label: "Fidelización", cantidad: fidelizacion.count ?? 0 },
    ],
  });
}
