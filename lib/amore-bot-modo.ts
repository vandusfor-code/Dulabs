/**
 * AMORE — cómo se comporta el asistente de WhatsApp durante la conversación. Un solo interruptor, de reversa inmediata.
 *
 *   «saludo_unico» (POR DEFECTO, desde 2026-10-08, pedido de la clienta): el asistente saluda UNA sola vez (bienvenida + menú 1/2/3), manda el enlace de reserva cuando
 *      piden una cita y, salvo lo transaccional (gestionar SU cita por frases claras, hablar con una persona, comprar desde la tienda), se CALLA: lo demás lo atiende el
 *      equipo. No llama a la IA en la conversación. Las sesiones viejas abandonadas ya no contestan mensajes sueltos.
 *   «completo»: el comportamiento anterior (el asistente conversa con IA durante toda la charla, responde consultas con los datos del negocio, «gracias», «no entendí»…).
 *      Es la REVERSA: poner AMORE_BOT_MODO=completo en Vercel y redesplegar (Vercel aplica las variables en el siguiente despliegue, ~3 min).
 *
 * Solo AMORE: el resto de los negocios no lee este interruptor. Cualquier valor distinto de «completo» (vacío, mal escrito) es «saludo_unico»: ante la duda, el
 * asistente habla menos, nunca más.
 */
export type ModoBotAmore = "saludo_unico" | "completo";

export const VARIABLE_MODO_BOT_AMORE = "AMORE_BOT_MODO";

export function modoBotAmore(env: Record<string, string | undefined> = process.env): ModoBotAmore {
  return (env[VARIABLE_MODO_BOT_AMORE] ?? "").trim().toLowerCase() === "completo" ? "completo" : "saludo_unico";
}
