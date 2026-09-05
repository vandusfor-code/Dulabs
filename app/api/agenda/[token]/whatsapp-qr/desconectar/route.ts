import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken } from "@/lib/agenda-admin-auth";
import { desconectarWorker } from "@/lib/whatsapp-worker-client";

export const runtime = "nodejs";

// WhatsApp QR (Fase 9B, autorizado) — proxy delgado hacia el worker
// persistente (ver worker/): cierra sesión real del tenant (borra
// creds/claves en Supabase, un futuro "Conectar WhatsApp" exige QR nuevo).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });

  const resultado = await desconectarWorker(tenant.idTenant);
  if (!resultado.ok) return Response.json({ error: resultado.error }, { status: resultado.status });
  return Response.json(resultado.data);
}
