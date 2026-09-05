import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken } from "@/lib/agenda-admin-auth";
import { consultarEstadoWorker } from "@/lib/whatsapp-worker-client";

export const runtime = "nodejs";

// WhatsApp QR (Fase 9B, autorizado) — proxy delgado hacia el worker
// persistente (ver worker/): resuelve el tenant del token (igual que
// siempre) y delega el estado real. Vercel serverless no sostiene el
// WebSocket de Baileys -- eso vive en el worker, ver
// lib/whatsapp-worker-client.ts.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });

  const resultado = await consultarEstadoWorker(tenant.idTenant);
  if (!resultado.ok) return Response.json({ error: resultado.error }, { status: resultado.status });
  return Response.json(resultado.data);
}
