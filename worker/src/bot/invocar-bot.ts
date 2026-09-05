import { logErrorControlado } from "../logging.js";

// Bot real (autorizado) — ÚNICO punto por el que el worker le avisa a
// Next.js que llegó un mensaje real que el bot (Flow Engine, ver
// lib/whatsapp-qr-bot.ts) debe atender. Dirección NUEVA (Next.js -> worker
// ya existía; esto es worker -> Next.js), autenticada con el MISMO secreto
// compartido (WHATSAPP_WORKER_SECRET) en el sentido contrario. Fire-and-
// forget desde quien llama: nunca debe bloquear el procesamiento de otros
// mensajes entrantes mientras el flow (que puede llamar a un LLM real)
// resuelve.
export async function invocarBotWhatsAppQR(params: { idTenant: string; telefono: string; texto: string; wamid: string }): Promise<void> {
  const baseUrl = process.env.DULABS_APP_URL;
  const secreto = process.env.WHATSAPP_WORKER_SECRET;
  if (!baseUrl || !secreto) {
    logErrorControlado(params.idTenant, "invocacion_bot_sin_configurar");
    return;
  }

  const res = await fetch(`${baseUrl}/api/whatsapp-qr-bot`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secreto}`, "Content-Type": "application/json" },
    body: JSON.stringify({ idTenant: params.idTenant, telefono: params.telefono, texto: params.texto, wamid: params.wamid }),
  });
  if (!res.ok) {
    logErrorControlado(params.idTenant, "invocacion_bot_fallo");
  }
}
