import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";

export const runtime = "nodejs";

const BUCKET = "chats-media";

// Chats AMORE (autorizado) — ÚNICO camino por el que un audio real llega al
// navegador. El bucket `chats-media` es PRIVADO (nunca público, ver la
// migración 20260911000000_chats_whatsapp.sql); esta ruta exige
// tenant+administrador (igual que el resto de Chats) y además vuelve a
// validar que el mensaje pertenece a este mismo tenant antes de leer el
// archivo -- nunca confía en que el id de la URL ya fue filtrado en otro
// lado. No genera URLs firmadas ni expone la service role key al navegador:
// el propio servidor descarga el binario y lo reenvía.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string; mensajeId: string }> }) {
  const { token, mensajeId } = await params;
  const idMensaje = Number(mensajeId);
  if (!Number.isInteger(idMensaje)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const { data: mensaje } = await supabase
    .from("dulabs_chat_mensajes")
    .select("media_path, mime_type")
    .eq("id_tenant", tenant.idTenant)
    .eq("id", idMensaje)
    .maybeSingle();
  if (!mensaje?.media_path || !mensaje.media_path.startsWith(`${tenant.idTenant}/`)) {
    return Response.json({ error: "Audio no encontrado" }, { status: 404 });
  }

  const { data: archivo, error } = await supabase.storage.from(BUCKET).download(mensaje.media_path);
  if (error || !archivo) return Response.json({ error: "No se pudo leer el audio" }, { status: 500 });

  return new Response(await archivo.arrayBuffer(), {
    headers: {
      "Content-Type": mensaje.mime_type ?? "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
