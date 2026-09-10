import { obtenerConexionActiva } from "./manager.js";
import type { SlotWhatsApp } from "./tipos.js";

// WhatsApp QR (Fase 9A/9B, autorizado) — adaptador de salida GENÉRICO.
// Recibe exactamente tenantId + teléfono + mensaje y resuelve la sesión
// WhatsApp del tenant correspondiente (obtenerConexionActiva solo admite un
// (idTenant, slot) exacto, nunca una lista -- ese es el límite real de
// aislamiento). WhatsApp multi-cuenta (autorizado) -- `slot` por defecto es
// 1 ("WhatsApp principal"), así que todo llamador existente (recordatorios,
// cumpleaños, bot) que nunca pasa `slot` sigue exactamente el mismo camino
// de siempre, sin ningún cambio de comportamiento.
//
// A propósito NO se conecta todavía a ningún motor (cumpleaños,
// fidelización, comunicaciones): esos motores siguen usando sus propios
// adaptadores simulados/mock de las Fases 6-8. Expuesto vía POST
// /tenants/:idTenant/enviar (ver server.ts), pero nada llama esa ruta desde
// un cron ni desde ningún motor en esta fase.
export async function enviarPorWhatsAppQR(
  idTenant: string,
  telefono: string,
  mensaje: string,
  origen?: "automatico",
  slot: SlotWhatsApp = 1
): Promise<void> {
  const socket = obtenerConexionActiva(idTenant, slot);
  if (!socket) {
    throw new Error(`El tenant ${idTenant} no tiene una sesión de WhatsApp QR conectada (slot ${slot})`);
  }
  await socket.enviarMensaje(telefono, mensaje, origen);
}

// Chats AMORE (autorizado) — mismo criterio exacto que enviarPorWhatsAppQR,
// solo que para una nota de audio real.
export async function enviarAudioPorWhatsAppQR(
  idTenant: string,
  telefono: string,
  audio: Buffer,
  mimeType: string,
  slot: SlotWhatsApp = 1
): Promise<void> {
  const socket = obtenerConexionActiva(idTenant, slot);
  if (!socket) {
    throw new Error(`El tenant ${idTenant} no tiene una sesión de WhatsApp QR conectada (slot ${slot})`);
  }
  await socket.enviarAudio(telefono, audio, mimeType);
}
