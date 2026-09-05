import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { conversacionDelTenant } from "@/lib/chats/conversaciones";
import { enviarMensajeWhatsApp } from "@/lib/whatsapp-worker-client";

export const runtime = "nodejs";

// "Enviar catálogo" (Chats AMORE, autorizado) — texto compuesto por el
// admin con los servicios REALES activos del tenant (dulabs_servicios) y el
// link REAL del portal público (app/reservar/amore), nunca datos
// inventados. Esto es un envío DIRECTO (enviarMensajeWhatsApp), no un
// mensaje del Flow Engine -- Claim Security
// (lib/flow/external-claim-security.ts::filterClaimSecuredEffects) solo
// intercepta los efectos que arma el propio motor de flows, así que no
// aplica acá y no hace falta ningún bypass.
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

  const { data: servicios } = await supabase
    .from("dulabs_servicios")
    .select("nombre, precio, duracion_min")
    .eq("id_tenant", tenant.idTenant)
    .eq("activo", true)
    .order("nombre", { ascending: true });

  if (!servicios || servicios.length === 0) {
    return Response.json({ error: "No hay servicios activos para enviar" }, { status: 409 });
  }

  const lineas = (servicios as { nombre: string; precio: number | null; duracion_min: number }[]).map((s) => {
    const precio = s.precio != null ? ` — $${Number(s.precio).toLocaleString("es-CO")}` : "";
    return `• ${s.nombre} (${s.duracion_min} min)${precio}`;
  });
  const mensaje = [
    "Este es nuestro catálogo de servicios:",
    "",
    ...lineas,
    "",
    "Puedes agendar directamente aquí: https://www.dulabs.co/reservar/amore",
  ].join("\n");

  const resultado = await enviarMensajeWhatsApp({ tenantId: tenant.idTenant, telefono: conversacion.telefono, mensaje });
  if (!resultado.ok) return Response.json({ error: resultado.error }, { status: resultado.status });

  return Response.json({ success: true });
}
