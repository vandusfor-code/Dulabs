import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { downloadMediaMessage, type WAMessage } from "@whiskeysockets/baileys";
import { logErrorControlado } from "../logging.js";

const BUCKET = "chats-media";
const TABLA_CONVERSACIONES = "dulabs_chat_conversaciones";
const TABLA_MENSAJES = "dulabs_chat_mensajes";

// Chats AMORE (autorizado) — ÚNICO punto que persiste mensajes reales de
// WhatsApp-QR, para ambas direcciones (entrante Y saliente). Se llama
// desde el mismo evento real de Baileys (messages.upsert, ver
// socket-baileys.ts) tanto para lo que escribe la clienta como para lo que
// Jessica envía desde el panel -- así nunca hay dos caminos de verdad
// distintos para lo mismo.
function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

function telefonoDesdeJid(jid: string): string {
  return soloDigitos(jid.split("@")[0] ?? jid);
}

type ContenidoExtraido =
  | { tipo: "texto"; texto: string }
  | { tipo: "audio"; mimeType: string; duracionSeg: number | null; buffer: Buffer }
  | null;

async function extraerContenido(msg: WAMessage): Promise<ContenidoExtraido> {
  const contenido = msg.message;
  if (!contenido) return null;

  const texto = contenido.conversation ?? contenido.extendedTextMessage?.text;
  if (texto) return { tipo: "texto", texto };

  if (contenido.audioMessage) {
    try {
      const buffer = (await downloadMediaMessage(msg, "buffer", {})) as Buffer;
      return {
        tipo: "audio",
        mimeType: contenido.audioMessage.mimetype ?? "audio/ogg",
        duracionSeg: contenido.audioMessage.seconds ?? null,
        buffer,
      };
    } catch {
      logErrorControlado("desconocido", "descarga_audio_fallo");
      return null;
    }
  }

  // Otros tipos (imagen/documento/video/sticker/protocolo/recibos de
  // lectura, etc.) -- fuera de alcance de esta fase (spec: solo
  // texto/emoji/audio), se ignoran sin romper el resto del listener.
  return null;
}

function extensionPara(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  return "bin";
}

export async function persistirMensajeEntrante(supabase: SupabaseClient, idTenant: string, msg: WAMessage): Promise<void> {
  const jid = msg.key.remoteJid;
  if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return; // grupos/estados fuera de alcance
  if (!msg.message) return; // protocolMessage, reacciones, recibos, etc. -- nada que mostrar

  const telefono = telefonoDesdeJid(jid);
  const entrante = !msg.key.fromMe;
  const contenido = await extraerContenido(msg);
  if (!contenido) return;

  const { data: conversacionExistente } = await supabase
    .from(TABLA_CONVERSACIONES)
    .select("id, estado, no_leidos")
    .eq("id_tenant", idTenant)
    .eq("telefono", telefono)
    .maybeSingle();

  let conversacionId: number;
  if (conversacionExistente) {
    conversacionId = conversacionExistente.id as number;
    // Un mensaje entrante nuevo sobre una conversación "automatico" pasa a
    // "requiere_atencion" -- ningún respondedor automático real está
    // conectado a este canal todavía (ver comentario de la migración), así
    // que decir "automatico" seguiría siendo falso. "manual" y "archivada"
    // no se tocan solas: Jessica ya tomó o cerró esa conversación a propósito.
    const nuevoEstado =
      entrante && conversacionExistente.estado === "automatico" ? "requiere_atencion" : conversacionExistente.estado;
    await supabase
      .from(TABLA_CONVERSACIONES)
      .update({
        ultimo_mensaje: contenido.tipo === "texto" ? contenido.texto : "🎤 Audio",
        ultima_actividad: new Date().toISOString(),
        estado: nuevoEstado,
        no_leidos: entrante ? (conversacionExistente.no_leidos as number) + 1 : conversacionExistente.no_leidos,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversacionId);
  } else {
    const { data: nueva } = await supabase
      .from(TABLA_CONVERSACIONES)
      .insert({
        id_tenant: idTenant,
        telefono,
        nombre_visible: msg.pushName?.trim() || telefono,
        ultimo_mensaje: contenido.tipo === "texto" ? contenido.texto : "🎤 Audio",
        ultima_actividad: new Date().toISOString(),
        no_leidos: entrante ? 1 : 0,
        estado: "requiere_atencion",
      })
      .select("id")
      .single();
    if (!nueva) return;
    conversacionId = nueva.id as number;
  }

  let mediaPath: string | null = null;
  if (contenido.tipo === "audio") {
    mediaPath = `${idTenant}/${conversacionId}/${randomUUID()}.${extensionPara(contenido.mimeType)}`;
    const { error: errorSubida } = await supabase.storage.from(BUCKET).upload(mediaPath, contenido.buffer, {
      contentType: contenido.mimeType,
      upsert: false,
    });
    if (errorSubida) {
      logErrorControlado(idTenant, "subida_audio_fallo");
      mediaPath = null;
    }
  }

  const timestampMs = msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now();
  await supabase.from(TABLA_MENSAJES).insert({
    id_tenant: idTenant,
    conversacion_id: conversacionId,
    direccion: entrante ? "entrante" : "saliente",
    tipo: contenido.tipo,
    texto: contenido.tipo === "texto" ? contenido.texto : null,
    media_path: mediaPath,
    mime_type: contenido.tipo === "audio" ? contenido.mimeType : null,
    duracion_seg: contenido.tipo === "audio" ? contenido.duracionSeg : null,
    whatsapp_message_id: msg.key.id ?? null,
    origen: "humano",
    estado: "enviado",
    enviado_en: new Date(timestampMs).toISOString(),
  });
}
