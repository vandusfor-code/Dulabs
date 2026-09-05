import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { consultarEstadoWorker } from "@/lib/whatsapp-worker-client";
import type { ConversacionFila } from "@/lib/chats/conversaciones";

export const runtime = "nodejs";

// Chats AMORE (autorizado) — lista de conversaciones reales, SIEMPRE
// filtradas por id_tenant (el worker sostiene una única sesión de WhatsApp
// por tenant, nunca por phone_number_id). `tab` reproduce las pestañas del
// mockup (todos/no_leidos/clientes/archivados); `q` es búsqueda real
// server-side por nombre o teléfono -- nunca un filtro de frontend sobre
// datos ya cargados. Exclusivo de administrador (spec: Chats no está
// disponible para colaboradora).
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const tab = request.nextUrl.searchParams.get("tab") ?? "todos";
  const q = request.nextUrl.searchParams.get("q")?.trim();

  let consulta = supabase
    .from("dulabs_chat_conversaciones")
    .select("id, telefono, cliente_id, nombre_visible, ultimo_mensaje, ultima_actividad, no_leidos, estado")
    .eq("id_tenant", tenant.idTenant);

  if (tab === "no_leidos") consulta = consulta.gt("no_leidos", 0).neq("estado", "archivada");
  else if (tab === "clientes") consulta = consulta.not("cliente_id", "is", null).neq("estado", "archivada");
  else if (tab === "archivados") consulta = consulta.eq("estado", "archivada");
  else consulta = consulta.neq("estado", "archivada"); // "todos" -- nunca mezcla archivados con la bandeja activa

  if (q) {
    const escapado = q.replace(/[%_]/g, "\\$&");
    consulta = consulta.or(`nombre_visible.ilike.%${escapado}%,telefono.ilike.%${escapado}%`);
  }

  const [{ data: conversaciones }, estadoWorker] = await Promise.all([
    consulta.order("ultima_actividad", { ascending: false }),
    consultarEstadoWorker(tenant.idTenant),
  ]);

  const resultado = ((conversaciones ?? []) as ConversacionFila[]).map((c) => ({
    id: c.id,
    telefono: c.telefono,
    clienteId: c.cliente_id,
    nombreVisible: c.nombre_visible,
    ultimoMensaje: c.ultimo_mensaje,
    ultimaActividad: c.ultima_actividad,
    noLeidos: c.no_leidos,
    estado: c.estado,
  }));

  return Response.json({
    conversaciones: resultado,
    whatsapp: {
      conectado: estadoWorker.ok && estadoWorker.data.estado === "conectado",
      numero: estadoWorker.ok ? estadoWorker.data.numeroConectado : null,
    },
  });
}
