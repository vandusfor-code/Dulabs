/**
 * ¿Este negocio tiene el bot suspendido por falta de pago? Lo consultan el webhook de Meta y el pipeline de WhatsApp-QR antes de responder.
 *
 * Una sola marca por negocio (dulabs_suscripciones.suspendida_por_pago_at) que pone el cron de cobros y quita el pago registrado: no se pausa ningún número ni se toca ia_pausada,
 * flow_activo ni nada del cliente. FALLA ABIERTO: si la consulta falla (migración sin correr, base caída) el bot sigue respondiendo; un error nunca corta el servicio de nadie.
 * Se recuerda la respuesta unos segundos para no hacer una consulta extra por cada mensaje.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Cuánto se recuerda la respuesta de un negocio: al registrar un pago, el bot vuelve a responder en menos de esto. */
export const TTL_SUSPENSION_MS = 30_000;
/** Si la consulta falla (p. ej. la migración todavía no corrió) no se reintenta en cada mensaje. */
export const TTL_ERROR_MS = 300_000;

const recordados = new Map<string, { suspendido: boolean; hasta: number }>();

export async function tenantSuspendidoPorPago(supabase: SupabaseClient, idTenant: string, ahora: number = Date.now()): Promise<boolean> {
  const recordado = recordados.get(idTenant);
  if (recordado && recordado.hasta > ahora) return recordado.suspendido;
  try {
    const { data, error } = await supabase.from("dulabs_suscripciones").select("suspendida_por_pago_at").eq("id_tenant", idTenant).maybeSingle();
    if (error) {
      console.warn(`[cobros] no se pudo consultar la suspensión por pago de ${idTenant} (¿falta la migración 20261213000000?); el bot sigue respondiendo: ${error.message}`);
      recordados.set(idTenant, { suspendido: false, hasta: ahora + TTL_ERROR_MS });
      return false;
    }
    const suspendido = Boolean((data as { suspendida_por_pago_at?: string | null } | null)?.suspendida_por_pago_at);
    recordados.set(idTenant, { suspendido, hasta: ahora + TTL_SUSPENSION_MS });
    return suspendido;
  } catch (err) {
    console.warn(`[cobros] error consultando la suspensión por pago de ${idTenant}; el bot sigue respondiendo:`, err instanceof Error ? err.message : err);
    recordados.set(idTenant, { suspendido: false, hasta: ahora + TTL_ERROR_MS });
    return false;
  }
}

/** Olvida lo recordado (de un negocio o de todos). Para pruebas y para cuando se sabe que la marca cambió. */
export function olvidarSuspensiones(idTenant?: string): void {
  if (idTenant) recordados.delete(idTenant);
  else recordados.clear();
}
