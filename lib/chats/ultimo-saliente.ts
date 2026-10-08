/**
 * AMORE — ¿una PERSONA del equipo fue la última en escribirle a esta clienta? Se usa para que los números del menú de bienvenida («1», «2», «3») dejen de ser
 * opciones del menú cuando alguien del equipo ya está conversando: si la profesional le ofrece «1) las 10 o 2) las 11» y la clienta responde «1», eso es parte de SU
 * conversación, no una orden para el asistente.
 *
 * Reutiliza las tablas reales de Chats (el worker persiste ahí TODO mensaje, de ambas direcciones): `origen = 'humano'` es lo que el worker guarda cuando el envío no
 * lo hizo el asistente (un mensaje escrito a mano desde el celular o desde el panel). Nunca lanza: ante cualquier error responde `false` (se asume que NO hay una
 * persona conversando, que es el comportamiento de siempre del menú).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function ultimoSalienteLoEscribioUnaPersona(supabase: SupabaseClient, params: { idTenant: string; telefono: string }): Promise<boolean> {
  try {
    const { data: conversacion } = await supabase.from("dulabs_chat_conversaciones").select("id").eq("id_tenant", params.idTenant).eq("telefono", params.telefono).maybeSingle();
    if (!conversacion) return false;
    const { data: ultimo } = await supabase
      .from("dulabs_chat_mensajes")
      .select("origen")
      .eq("conversacion_id", conversacion.id as number)
      .eq("direccion", "saliente")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (ultimo as { origen?: string } | null)?.origen === "humano";
  } catch (err) {
    console.error("[chats] no se pudo saber quién escribió el último mensaje saliente -- se asume que no fue una persona:", err instanceof Error ? err.message : "error desconocido");
    return false;
  }
}
