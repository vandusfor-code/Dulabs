import { obtenerConexionActiva } from "./manager.js";

// WhatsApp QR (Fase 9A/9B, autorizado) — adaptador de salida GENÉRICO.
// Recibe exactamente tenantId + teléfono + mensaje y resuelve la sesión
// WhatsApp del tenant correspondiente (obtenerConexionActiva solo admite un
// idTenant exacto, nunca una lista -- ese es el límite real de aislamiento).
//
// A propósito NO se conecta todavía a ningún motor (cumpleaños,
// fidelización, comunicaciones): esos motores siguen usando sus propios
// adaptadores simulados/mock de las Fases 6-8. Expuesto vía POST
// /tenants/:idTenant/enviar (ver server.ts), pero nada llama esa ruta desde
// un cron ni desde ningún motor en esta fase.
export async function enviarPorWhatsAppQR(idTenant: string, telefono: string, mensaje: string): Promise<void> {
  const socket = obtenerConexionActiva(idTenant);
  if (!socket) {
    throw new Error(`El tenant ${idTenant} no tiene una sesión de WhatsApp QR conectada`);
  }
  await socket.enviarMensaje(telefono, mensaje);
}
