import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";

export const runtime = "nodejs";

// FASE F15 (Operations Center, autorizado) -- Fase 10 del pedido: vista
// administrativa global de WhatsApp. Nunca expone meta_permanent_token.
export async function GET(request: NextRequest) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const supabase = acceso.supabase;

  const { data: numeros, error } = await supabase
    .from("dulabs_clientes_config")
    .select("id_tenant, phone_number_id, nombre_negocio, telefono_negocio, whatsapp_business_account_id, estado_conexion, desconectado_en, meta_permanent_token, updated_at")
    .order("updated_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { data: usuarios } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  const nombrePorTenant = new Map((usuarios?.users ?? []).map((u) => [u.id, (u.user_metadata?.nombre as string | undefined) ?? u.email ?? null]));

  const estadoFiltro = request.nextUrl.searchParams.get("estado");

  let filas = (numeros ?? []).map((n) => ({
    idTenant: n.id_tenant,
    nombreTenant: nombrePorTenant.get(n.id_tenant) ?? null,
    phoneNumberId: n.phone_number_id,
    nombreNegocio: n.nombre_negocio,
    telefonoNegocio: n.telefono_negocio,
    wabaId: n.whatsapp_business_account_id,
    estadoConexion: n.estado_conexion ?? (n.meta_permanent_token ? "conectado" : "desconectado"),
    desconectadoEn: n.desconectado_en,
    actualizadoEn: n.updated_at,
  }));
  if (estadoFiltro) filas = filas.filter((f) => f.estadoConexion === estadoFiltro);

  return Response.json({ numeros: filas });
}
