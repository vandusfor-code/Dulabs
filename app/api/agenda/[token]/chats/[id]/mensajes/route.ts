import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { conversacionDelTenant } from "@/lib/chats/conversaciones";
import { enviarMensajeWhatsApp } from "@/lib/whatsapp-worker-client";

export const runtime = "nodejs";

// Chats AMORE (autorizado) — envía un texto real por WhatsApp-QR. Esta ruta
// NUNCA inserta la fila del mensaje: el único escritor real es el propio
// worker, reaccionando al evento genuino de Baileys (ver
// worker/src/chats/persistir-mensaje.ts, messages.upsert también reporta
// los mensajes fromMe) -- así lo que Jessica ve en pantalla es siempre lo
// que de verdad viajó, nunca un eco optimista que pudiera desincronizarse si
// el envío fallara silenciosamente. El frontend pinta un estado "enviando"
// local mientras esta llamada resuelve, y confirma con el próximo polling
// del hilo.
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

  let body: { texto?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const texto = body.texto?.trim();
  if (!texto) return Response.json({ error: "El mensaje no puede estar vacío" }, { status: 400 });

  const resultado = await enviarMensajeWhatsApp({ tenantId: tenant.idTenant, telefono: conversacion.telefono, mensaje: texto });
  if (!resultado.ok) return Response.json({ error: resultado.error }, { status: resultado.status });

  return Response.json({ success: true });
}
