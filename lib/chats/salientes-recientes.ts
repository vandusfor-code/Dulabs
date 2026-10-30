/**
 * AMORE — los últimos mensajes SALIENTES de una conversación de WhatsApp-QR (lo que la clienta realmente recibió), del más nuevo al más viejo, con quién los escribió
 * (`origen`: «humano» = una persona del equipo desde el celular o el panel; «automatico» = el asistente), su texto y su hora. Lo usa el registro de clientas para saber si sigue
 * VIVO (lib/amore-registro-vigencia.ts): la fila de estado solo dice «se está registrando»; únicamente el historial real dice si la última palabra la tuvo una persona, hace
 * cuánto fue el último aviso y cuántas veces seguidas ya se le repitió lo mismo.
 *
 * Mismas tablas y mismo criterio que lib/chats/ultimo-saliente.ts y lib/chats/historial-reciente.ts (el worker persiste ahí TODO mensaje, de ambas direcciones). Orden por `id`
 * descendente (el orden real de inserción), nunca por `enviado_en`: dos mensajes del mismo segundo empatan. Nunca lanza: ante cualquier error devuelve `null` («no se pudo
 * leer»), y quien la usa trata `null` igual que «sin historial» (el comportamiento de siempre).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SalienteReciente {
  /** Quién lo escribió: una persona del equipo ('humano'), el asistente ('automatico') o null si la fila no lo trae. */
  origen: "humano" | "automatico" | null;
  texto: string | null;
  /** Hora de envío en ISO (`enviado_en`); null si la fila no lo trae. */
  enviadoEn: string | null;
}

const LIMITE_POR_DEFECTO = 4;

export async function leerSalientesRecientes(
  supabase: SupabaseClient,
  params: { idTenant: string; telefono: string; limite?: number },
): Promise<SalienteReciente[] | null> {
  try {
    const { data: conversacion, error: errorConversacion } = await supabase
      .from("dulabs_chat_conversaciones")
      .select("id")
      .eq("id_tenant", params.idTenant)
      .eq("telefono", params.telefono)
      .maybeSingle();
    if (errorConversacion) throw errorConversacion;
    if (!conversacion) return [];

    const { data, error } = await supabase
      .from("dulabs_chat_mensajes")
      .select("origen, texto, enviado_en")
      .eq("conversacion_id", conversacion.id as number)
      .eq("direccion", "saliente")
      .order("id", { ascending: false })
      .limit(params.limite ?? LIMITE_POR_DEFECTO);
    if (error) throw error;

    return ((data ?? []) as { origen?: string | null; texto?: string | null; enviado_en?: string | null }[]).map((fila) => ({
      origen: fila.origen === "humano" || fila.origen === "automatico" ? fila.origen : null,
      texto: fila.texto ?? null,
      enviadoEn: fila.enviado_en ?? null,
    }));
  } catch (err) {
    console.error("[chats] no se pudieron leer los últimos mensajes enviados -- se continúa como si no hubiera historial:", err instanceof Error ? err.message : "error desconocido");
    return null;
  }
}
