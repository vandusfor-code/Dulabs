import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { conversacionDelTenant } from "@/lib/chats/conversaciones";
import { enviarAudioWhatsApp } from "@/lib/whatsapp-worker-client";

export const runtime = "nodejs";

// ~16MB reales en base64 -- mismo límite que aplica el worker (ver
// worker/src/server.ts, ruta enviar-audio), verificado acá también para
// rechazar rápido sin ni siquiera llamar al worker.
const LIMITE_BASE64 = Math.ceil((16 * 1024 * 1024 * 4) / 3);

// Chats AMORE (autorizado) — envía una nota de audio real grabada en el
// navegador (MediaRecorder). Mismo principio que el envío de texto: esta
// ruta nunca escribe la fila del mensaje, solo pide al worker que lo mande
// de verdad; el worker la persiste al recibir su propio evento de Baileys.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const conversacionId = Number(id);
  if (!Number.isInteger(conversacionId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const conversacion = await conversacionDelTenant(supabase, tenant.idTenant, conversacionId);
  if (!conversacion) return Response.json({ error: "Conversación no encontrada" }, { status: 404 });

  let body: { audioBase64?: string; mimeType?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.audioBase64 || !body.mimeType) return Response.json({ error: "Falta el audio" }, { status: 400 });
  if (body.audioBase64.length === 0 || body.audioBase64.length > LIMITE_BASE64) {
    return Response.json({ error: "El audio es demasiado largo" }, { status: 400 });
  }

  const resultado = await enviarAudioWhatsApp({
    tenantId: tenant.idTenant,
    telefono: conversacion.telefono,
    audioBase64: body.audioBase64,
    mimeType: body.mimeType,
  });
  if (!resultado.ok) return Response.json({ error: resultado.error }, { status: resultado.status });

  return Response.json({ success: true });
}
