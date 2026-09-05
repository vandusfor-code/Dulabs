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

// Bot real (autorizado) — si el tenant tiene un flow PUBLICADO, existe un
// respondedor automático real (ver lib/whatsapp-qr-bot.ts en el repo de
// Next, invocado desde socket-baileys.ts). Una conversación NUEVA nace
// entonces en "automatico" -- ya no sería falso, hay un bot real que la va a
// atender. Si el tenant NO tiene ningún flow publicado, sigue naciendo en
// "requiere_atencion" (comportamiento original, honesto para ese caso).
async function tenantTieneFlowPublicado(supabase: SupabaseClient, idTenant: string): Promise<boolean> {
  const { data } = await supabase.from("dulabs_flows").select("id").eq("tenant_id", idTenant).eq("status", "published").limit(1);
  return Boolean(data && data.length > 0);
}

export type ResultadoPersistencia = {
  conversacionId: number;
  telefono: string;
  entrante: boolean;
  tipo: "texto" | "audio";
  texto: string | null;
  estadoConversacion: string;
} | null;

/** Resuelve el origen real ("automatico" si lo mandó el bot) de un mensaje SALIENTE ya enviado, por su whatsapp_message_id -- ver socket-baileys.ts, que registra ahí los envíos del bot antes de que lleguen de vuelta por este mismo evento. Sin registro -- incluido cualquier envío manual de Jessica -- se asume "humano", el comportamiento de siempre. */
export type ResolverOrigenSaliente = (whatsappMessageId: string) => "automatico" | undefined;

export async function persistirMensajeEntrante(
  supabase: SupabaseClient,
  idTenant: string,
  msg: WAMessage,
  resolverOrigenSaliente?: ResolverOrigenSaliente
): Promise<ResultadoPersistencia> {
  const jid = msg.key.remoteJid;
  if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return null; // grupos/estados fuera de alcance
  if (!msg.message) return null; // protocolMessage, reacciones, recibos, etc. -- nada que mostrar

  const telefono = telefonoDesdeJid(jid);
  const entrante = !msg.key.fromMe;
  const contenido = await extraerContenido(msg);
  if (!contenido) return null;

  const { data: conversacionExistente } = await supabase
    .from(TABLA_CONVERSACIONES)
    .select("id, estado, no_leidos")
    .eq("id_tenant", idTenant)
    .eq("telefono", telefono)
    .maybeSingle();

  let conversacionId: number;
  let estadoConversacion: string;
  if (conversacionExistente) {
    conversacionId = conversacionExistente.id as number;
    // Un mensaje entrante nuevo sobre una conversación "automatico" se
    // queda en "automatico" -- el bot real la sigue atendiendo. "manual",
    // "requiere_atencion" y "archivada" no se tocan solas: Jessica ya tomó
    // (o cerró, o está esperando tomar) esa conversación a propósito.
    estadoConversacion = conversacionExistente.estado as string;
    await supabase
      .from(TABLA_CONVERSACIONES)
      .update({
        ultimo_mensaje: contenido.tipo === "texto" ? contenido.texto : "🎤 Audio",
        ultima_actividad: new Date().toISOString(),
        no_leidos: entrante ? (conversacionExistente.no_leidos as number) + 1 : conversacionExistente.no_leidos,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversacionId);
  } else {
    estadoConversacion = (await tenantTieneFlowPublicado(supabase, idTenant)) ? "automatico" : "requiere_atencion";
    const { data: nueva } = await supabase
      .from(TABLA_CONVERSACIONES)
      .insert({
        id_tenant: idTenant,
        telefono,
        nombre_visible: msg.pushName?.trim() || telefono,
        ultimo_mensaje: contenido.tipo === "texto" ? contenido.texto : "🎤 Audio",
        ultima_actividad: new Date().toISOString(),
        no_leidos: entrante ? 1 : 0,
        estado: estadoConversacion,
      })
      .select("id")
      .single();
    if (!nueva) return null;
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
  const origen = !entrante && msg.key.id ? (resolverOrigenSaliente?.(msg.key.id) ?? "humano") : "humano";
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
    origen,
    estado: "enviado",
    enviado_en: new Date(timestampMs).toISOString(),
  });

  return {
    conversacionId,
    telefono,
    entrante,
    tipo: contenido.tipo,
    texto: contenido.tipo === "texto" ? contenido.texto : null,
    estadoConversacion,
  };
}
