import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";
import { desconectarNumeroWhatsapp } from "@/lib/whatsapp-connection-lifecycle";

export const runtime = "nodejs";

// FASE F15 (Operations Center, autorizado) -- vista y control de WhatsApp
// de un cliente. NUNCA expone meta_permanent_token (ni cifrado ni
// descifrado) -- Fase 10 del pedido: "NO mostrar tokens. NO mostrar
// secretos.". Desconectar reutiliza desconectarNumeroWhatsapp (Connection
// Lifecycle, F8.5) tal cual -- reconectar NO es posible server-side (solo
// vía Embedded Signup real, ver el docblock de esa función), así que esta
// ruta no ofrece esa acción -- inventarla sería simular algo que no existe.
export async function GET(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;

  const { data: numeros, error } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, nombre_negocio, telefono_negocio, whatsapp_business_account_id, estado_conexion, desconectado_en, meta_permanent_token, updated_at")
    .eq("id_tenant", idTenant);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    numeros: (numeros ?? []).map((n) => ({
      phoneNumberId: n.phone_number_id,
      nombreNegocio: n.nombre_negocio,
      telefonoNegocio: n.telefono_negocio,
      wabaId: n.whatsapp_business_account_id,
      estadoConexion: n.estado_conexion ?? (n.meta_permanent_token ? "conectado" : "desconectado"),
      desconectadoEn: n.desconectado_en,
      actualizadoEn: n.updated_at,
    })),
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;

  let body: { phone_number_id?: string; accion?: "desconectar" };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.phone_number_id || body.accion !== "desconectar") {
    return Response.json({ error: "Faltan 'phone_number_id' o 'accion' (solo 'desconectar' está soportado)" }, { status: 400 });
  }

  const resultado = await desconectarNumeroWhatsapp(supabase, { tenantId: idTenant, phoneNumberId: body.phone_number_id });
  if (!resultado.ok) {
    await registrarAuditoriaAdmin(supabase, {
      operador: acceso.miembro,
      accion: "DISCONNECT_WHATSAPP",
      idTenant,
      recurso: body.phone_number_id,
      resultado: "error",
      motivo: resultado.motivo === "no_encontrado" ? "Número no encontrado" : resultado.mensaje,
    });
    return Response.json({ error: resultado.motivo === "no_encontrado" ? "Número no encontrado para este cliente" : resultado.mensaje }, { status: resultado.motivo === "no_encontrado" ? 404 : 500 });
  }

  await registrarAuditoriaAdmin(supabase, { operador: acceso.miembro, accion: "DISCONNECT_WHATSAPP", idTenant, recurso: body.phone_number_id });
  return Response.json({ success: true });
}
