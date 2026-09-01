/**
 * I/O de dulabs_solicitudes_producto_financiero (ver migración
 * 20260901220000_solicitudes_producto_financiero.sql). Mismo patrón que
 * lib/campaign-lead-store.ts: funciones delgadas, sin lógica -- la lógica
 * vive en lib/soluciones-financieras-bot.ts (puro).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductoFinanciero, SolicitudProductoSession } from "@/lib/soluciones-financieras-bot";

interface SolicitudActiva {
  id: number;
  session: SolicitudProductoSession;
}

/** null si este teléfono no tiene ninguna solicitud en estado "esperando_dato" ahora mismo. */
export async function obtenerSolicitudActiva(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string,
): Promise<SolicitudActiva | null> {
  const { data, error } = await supabase
    .from("dulabs_solicitudes_producto_financiero")
    .select("id, producto, respuesta_cliente, estado")
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente)
    .eq("estado", "esperando_dato")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    session: {
      producto: data.producto as ProductoFinanciero,
      respuestaCliente: data.respuesta_cliente,
      estado: data.estado as SolicitudProductoSession["estado"],
    },
  };
}

/** Crea la solicitud al tocar uno de los 3 botones. Idempotente frente al índice único parcial (activa_idx). */
export async function crearSolicitudProducto(
  supabase: SupabaseClient,
  params: { idTenant: string; phoneNumberId: string; telefonoCliente: string; producto: ProductoFinanciero },
): Promise<void> {
  const { error } = await supabase.from("dulabs_solicitudes_producto_financiero").insert({
    id_tenant: params.idTenant,
    phone_number_id: params.phoneNumberId,
    telefono_cliente: params.telefonoCliente,
    producto: params.producto,
  });
  // 23505 = ya existía una solicitud activa para este cliente (colisión con
  // el índice único parcial, ej. doble tap muy rápido) -- no es un error
  // real, la solicitud ya está creada.
  if (error && (error as { code?: string }).code !== "23505") throw error;
}

export async function guardarSolicitudProducto(
  supabase: SupabaseClient,
  id: number,
  session: SolicitudProductoSession,
): Promise<void> {
  const { error } = await supabase
    .from("dulabs_solicitudes_producto_financiero")
    .update({
      respuesta_cliente: session.respuestaCliente,
      estado: session.estado,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}
