import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { iniciarConexionWorker } from "@/lib/whatsapp-worker-client";

export const runtime = "nodejs";

// WhatsApp QR (Fase 9B, autorizado) — proxy delgado hacia el worker
// persistente (ver worker/). El QR llega de forma asíncrona; el panel hace
// polling de GET /whatsapp-qr hasta que aparece. Esta ruta nunca envía
// mensajes ni activa ningún motor (cumpleaños/fidelización/comunicaciones).
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  // "Vincular con número" (autorizado) -- cuerpo opcional {telefono}. Sin
  // cuerpo o sin telefono, sigue siendo el modo QR de siempre.
  let telefono: string | undefined;
  try {
    const body = (await request.json()) as { telefono?: string };
    telefono = body.telefono?.trim() || undefined;
  } catch {
    // sin cuerpo (o JSON vacío) -- modo QR, comportamiento de siempre.
  }
  if (telefono && !/^\d{8,15}$/.test(telefono)) {
    return Response.json({ error: "El teléfono debe ser solo dígitos, con indicativo de país (8 a 15 dígitos)" }, { status: 400 });
  }

  const resultado = await iniciarConexionWorker(tenant.idTenant, { telefono });
  if (!resultado.ok) return Response.json({ error: resultado.error }, { status: resultado.status });
  return Response.json(resultado.data);
}
