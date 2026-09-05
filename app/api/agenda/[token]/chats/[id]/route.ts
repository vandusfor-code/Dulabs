import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { conversacionDelTenant } from "@/lib/chats/conversaciones";

export const runtime = "nodejs";

type MensajeFila = {
  id: number;
  direccion: string;
  tipo: string;
  texto: string | null;
  media_path: string | null;
  mime_type: string | null;
  duracion_seg: number | null;
  estado: string;
  enviado_en: string;
};

const LIMITE_MENSAJES = 50;

// Chats AMORE (autorizado) — detalle de UNA conversación + su hilo de
// mensajes (paginado hacia atrás con `antes`, un ISO timestamp -- el
// composer siempre ve primero los últimos LIMITE_MENSAJES, orden
// ascendente para pintar de arriba hacia abajo). `mediaUrl` nunca es la ruta
// real del bucket privado: es el proxy autenticado de esta misma app (ver
// chats/media/[mensajeId]/route.ts), el único camino por el que un audio
// llega al navegador.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
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

  const antes = request.nextUrl.searchParams.get("antes");
  let consultaMensajes = supabase
    .from("dulabs_chat_mensajes")
    .select("id, direccion, tipo, texto, media_path, mime_type, duracion_seg, estado, enviado_en")
    .eq("id_tenant", tenant.idTenant)
    .eq("conversacion_id", conversacionId)
    .order("enviado_en", { ascending: false })
    .limit(LIMITE_MENSAJES);
  if (antes) consultaMensajes = consultaMensajes.lt("enviado_en", antes);

  const { data: mensajes } = await consultaMensajes;
  const mensajesAsc = ((mensajes ?? []) as MensajeFila[]).slice().reverse();

  return Response.json({
    conversacion: {
      id: conversacion.id,
      telefono: conversacion.telefono,
      clienteId: conversacion.cliente_id,
      nombreVisible: conversacion.nombre_visible,
      estado: conversacion.estado,
    },
    mensajes: mensajesAsc.map((m) => ({
      id: m.id,
      direccion: m.direccion,
      tipo: m.tipo,
      texto: m.texto,
      mediaUrl: m.media_path ? `/api/agenda/${token}/chats/media/${m.id}` : null,
      mimeType: m.mime_type,
      duracionSeg: m.duracion_seg,
      estado: m.estado,
      enviadoEn: m.enviado_en,
    })),
    hayMas: mensajesAsc.length === LIMITE_MENSAJES,
  });
}

type BodyAccion = { accion?: "marcar_leido" | "archivar" | "desarchivar" | "manual" | "reactivar_asistente" };

// Acciones de estado real sobre la conversación -- ninguna es cosmética:
// no_leidos y estado se leen tal cual por el resto del módulo (lista,
// badges, filtros de pestaña, ver persistir-mensaje.ts en el worker).
// "reactivar_asistente" deja el estado en 'automatico' de forma HONESTA: hoy
// no existe ningún respondedor automático conectado a este canal -- es un
// estado real y funcional para cuando exista un puente Flow Engine <->
// Baileys, no una simulación de que algo está respondiendo ahora mismo.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
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

  let body: BodyAccion;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const ACCIONES = ["marcar_leido", "archivar", "desarchivar", "manual", "reactivar_asistente"];
  if (!body.accion || !ACCIONES.includes(body.accion)) {
    return Response.json({ error: `'accion' debe ser una de: ${ACCIONES.join(", ")}` }, { status: 400 });
  }

  const cambios: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.accion === "marcar_leido") cambios.no_leidos = 0;
  else if (body.accion === "archivar") cambios.estado = "archivada";
  else if (body.accion === "desarchivar") cambios.estado = "requiere_atencion";
  else if (body.accion === "manual") cambios.estado = "manual";
  else if (body.accion === "reactivar_asistente") cambios.estado = "automatico";

  const { data: actualizada, error } = await supabase
    .from("dulabs_chat_conversaciones")
    .update(cambios)
    .eq("id", conversacionId)
    .select("id, estado, no_leidos")
    .single();
  if (error || !actualizada) return Response.json({ error: "No se pudo actualizar la conversación" }, { status: 500 });

  return Response.json({ success: true, conversacion: actualizada });
}
