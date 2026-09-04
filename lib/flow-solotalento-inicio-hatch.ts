/**
 * Reconocimiento determinístico (autorizado) del mensaje automático que
 * WhatsApp envía cuando alguien llega desde el botón "Chatear" de la página
 * de SOLOTALENTO SAS -- mismo criterio exacto que lib/flow-pestanas-hatch.ts
 * / lib/flow-escape-hatch.ts: vocabulario fijo, sin IA, nunca una
 * clasificación probabilística.
 *
 * Sin este hatch, si la conversación ya tenía una ejecución activa esperando
 * un dígito (menú principal o cualquier submenú), este mismo mensaje quedaba
 * atrapado por la validación regex de esa pregunta pendiente ("La respuesta
 * no cumple el formato esperado.") en vez de reiniciar al cliente en el
 * menú -- ver lib/flow-runtime-bridge.ts::intentarInicioSolotalento, que es
 * quien de verdad cierra la ejecución vieja y reinicia el flow. Un primer
 * mensaje de una conversación NUEVA ya funciona bien sin este hatch (el
 * evento "start" nunca valida el texto contra ninguna pregunta) -- este
 * archivo solo decide SI el texto matchea, nunca decide qué hacer con eso.
 */
export function esMensajeInicioSolotalento(texto: string): boolean {
  const t = texto.toLowerCase();
  return t.includes("solotalento") && t.includes("quiero conocer");
}
