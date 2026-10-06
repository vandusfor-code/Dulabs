/**
 * AMORE — «MI CITA» en los mensajes que el sistema ya envía por WhatsApp (chat y recordatorios): el enlace personal de una cita que el sistema ya identificó.
 *
 * Es seguro darlo aquí porque la cita se identificó por el NÚMERO de la clienta (la identidad de WhatsApp del chat, o el teléfono guardado en la cita para el
 * recordatorio), no por un dato que ella envíe. Si la cita aún no tiene enlace (p. ej. se creó antes de esta función), se emite en este momento.
 *
 * Nunca lanza: si no se puede, devuelve null / "" y el mensaje sigue exactamente igual que antes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import { createSupabaseEnlacesStore, obtenerOCrearEnlace, type EnlacesStore } from "@/lib/mi-cita/enlaces";
import { textoEnlaceGestionChat } from "@/lib/mi-cita/mensajes";

/** La URL del enlace personal de la cita (la misma cada vez), o null si no es de AMORE o no se pudo. */
export async function urlEnlaceDeCita(supabase: SupabaseClient, idTenant: string, cita: { id: number; fin: string }, store?: EnlacesStore): Promise<string | null> {
  if (idTenant !== AMORE_TENANT_ID) return null;
  try {
    const enlace = await obtenerOCrearEnlace(store ?? createSupabaseEnlacesStore(supabase), { idTenant, citaId: cita.id, citaFinISO: cita.fin });
    return enlace?.url ?? null;
  } catch {
    return null;
  }
}

/** El texto que se agrega a un mensaje del chat sobre una cita: «También puedes modificarla o cancelarla desde tu enlace personal: …» (vacío si no hay enlace). */
export async function sufijoEnlaceParaChat(supabase: SupabaseClient, idTenant: string, cita: { id: number; fin: string }, store?: EnlacesStore): Promise<string> {
  const url = await urlEnlaceDeCita(supabase, idTenant, cita, store);
  return url ? `\n\n${textoEnlaceGestionChat(url)}` : "";
}
