/**
 * AMORE (autorizado, Fase 1 atención humana) — historial reciente REAL de
 * una conversación de WhatsApp-QR, para dar contexto a la clasificación de
 * Gemini (lib/amore-entrada-gemini.ts). Reutiliza TAL CUAL las tablas ya
 * reales de Chats AMORE (dulabs_chat_conversaciones/dulabs_chat_mensajes,
 * ver 20260911000000_chats_whatsapp.sql) -- el worker ya persiste ahí TODO
 * mensaje real (ambas direcciones, cualquier origen: Agenda V2, Gemini,
 * Flow Engine), así que no hace falta un historial paralelo que podría
 * desincronizarse de lo que realmente se dijo.
 *
 * Se excluye explícitamente el mensaje cuyo whatsapp_message_id sea el
 * wamid que se está procesando AHORA MISMO -- ese mensaje ya se pasa por
 * separado como `mensaje` a clasificarMensajeConGemini, nunca debe
 * aparecer duplicado al final del historial.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type TurnoHistorial = { role: "user" | "model"; text: string };

const MAX_TURNOS_DEFECTO = 6;

/**
 * Nunca lanza -- sin conversación previa, o ante cualquier error de lectura,
 * se devuelve historial vacío (mismo criterio que recordarNombreCliente:
 * dar contexto es un extra, nunca puede tumbar la clasificación).
 */
export async function obtenerHistorialRecienteChat(
  supabase: SupabaseClient,
  params: { idTenant: string; telefono: string; wamidActual: string; maxTurnos?: number },
): Promise<TurnoHistorial[]> {
  const maxTurnos = params.maxTurnos ?? MAX_TURNOS_DEFECTO;
  try {
    const { data: conversacion } = await supabase
      .from("dulabs_chat_conversaciones")
      .select("id")
      .eq("id_tenant", params.idTenant)
      .eq("telefono", params.telefono)
      .maybeSingle();
    if (!conversacion) return [];

    // Se piden más filas de las necesarias (2x turnos + margen) porque se
    // van a descartar audios y el mensaje actual antes de recortar al
    // límite real -- orden por `id desc` (orden de inserción real), nunca
    // `enviado_en` (timestamp de WhatsApp, puede empatar por segundo entre
    // mensajes consecutivos).
    const { data: mensajes } = await supabase
      .from("dulabs_chat_mensajes")
      .select("direccion, tipo, texto, whatsapp_message_id")
      .eq("conversacion_id", conversacion.id as number)
      .order("id", { ascending: false })
      .limit(maxTurnos * 2 + 4);

    const filas = (mensajes ?? []) as { direccion: "entrante" | "saliente"; tipo: "texto" | "audio"; texto: string | null; whatsapp_message_id: string | null }[];

    const turnos: TurnoHistorial[] = [];
    for (const fila of filas) {
      if (fila.whatsapp_message_id === params.wamidActual) continue; // el mensaje que se está procesando ahora, nunca duplicado
      if (fila.tipo !== "texto" || !fila.texto) continue; // nunca se inventa texto para un audio
      turnos.push({ role: fila.direccion === "entrante" ? "user" : "model", text: fila.texto });
      if (turnos.length >= maxTurnos) break;
    }

    return turnos.reverse(); // filas venían más-reciente-primero -- Gemini necesita orden cronológico
  } catch (err) {
    console.error("[chats] error leyendo historial reciente -- se continúa sin contexto:", err instanceof Error ? err.message : "error desconocido");
    return [];
  }
}
