import type { SupabaseClient } from "@supabase/supabase-js";

export type UltimoMensajeConversacion = {
  phone_number_id: string;
  telefono_cliente: string;
  contenido: string;
  direccion: string;
  created_at: string;
};

// Tope defensivo -- nunca "sin límite", pero mucho más alto que el límite de
// 200 que ya aplica la UI del Inbox (ver app/api/dashboard/conversaciones/route.ts)
// porque este resultado también alimenta conteos de analytics (F10), que
// necesitan ver el universo completo de conversaciones activas del tenant,
// no solo la página visible.
export const LIMITE_CONVERSACIONES_RECIENTES = 3000;

// Fase 10 (Analytics + Scalability, autorizado) -- hallazgo F10-B: antes de
// esta función, la lista de conversaciones del Inbox se construía tomando
// los 500 mensajes MÁS RECIENTES de TODO el tenant y deduplicando en
// memoria (ver historial de app/api/dashboard/conversaciones/route.ts). Con
// tráfico alto y desparejo (pocas conversaciones muy activas acaparando ese
// corte), una conversación real pero menos activa podía desaparecer por
// completo de la lista sin ningún error visible.
//
// Esta función usa la función SQL dulabs_conversaciones_recientes
// (20260930000000_dulabs_f10_analytics_indices.sql), que resuelve "el
// mensaje más reciente de CADA conversación" con DISTINCT ON dentro de
// Postgres antes de limitar -- ninguna conversación real puede desaparecer
// por el corte, sin importar cuántos mensajes tenga cualquier otra.
//
// Tolerante a que la migración de F10 todavía no se haya aplicado (mismo
// criterio que lib/conversacion-estado.ts para F9): si el RPC falla por
// cualquier motivo (función inexistente u otro error), cae al mismo patrón
// de antes (traer los N mensajes más recientes y deduplicar en memoria) --
// nunca rompe el Inbox ya desplegado.
export async function resolverUltimoMensajePorConversacion(
  supabase: SupabaseClient,
  phoneNumberIds: string[],
  limite: number = LIMITE_CONVERSACIONES_RECIENTES,
): Promise<UltimoMensajeConversacion[]> {
  if (phoneNumberIds.length === 0) return [];
  const limiteAplicado = Math.min(limite, LIMITE_CONVERSACIONES_RECIENTES);

  const { data, error } = await supabase.rpc("dulabs_conversaciones_recientes", {
    p_phone_number_ids: phoneNumberIds,
    p_limite: limiteAplicado,
  });
  if (!error && data) return data as UltimoMensajeConversacion[];

  if (error) {
    console.error(
      "[conversaciones-inbox] RPC dulabs_conversaciones_recientes no disponible (¿falta aplicar la migración de F10?), usando fallback:",
      error.message,
    );
  }

  // Fallback: mismo comportamiento que existía antes de F10 -- puede perder
  // conversaciones poco activas bajo tráfico alto y desparejo, pero nunca
  // rompe ni bloquea el Inbox mientras la migración no esté aplicada.
  const { data: mensajes, error: mensajesError } = await supabase
    .from("dulabs_mensajes_log")
    .select("phone_number_id, telefono_cliente, direccion, contenido, created_at")
    .in("phone_number_id", phoneNumberIds)
    .order("created_at", { ascending: false })
    .limit(500);
  if (mensajesError) throw mensajesError;

  const vistos = new Set<string>();
  const resultado: UltimoMensajeConversacion[] = [];
  for (const m of mensajes ?? []) {
    const clave = `${m.phone_number_id}:${m.telefono_cliente}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    resultado.push(m as UltimoMensajeConversacion);
  }
  return resultado;
}
