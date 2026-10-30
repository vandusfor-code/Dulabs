/**
 * AMORE — ¿sigue VIVO el registro de una clienta (modos registro_nombre / registro_dia / registro_mes de dulabs_amore_entrada)?
 *
 * El registro por chat se queda con TODOS los mensajes de la clienta (interceptarRegistroClienteAmore corre antes que cualquier otra capa) y no tenía salida: la clienta que lo
 * dejaba a medias —y, desde que las citas nuevas van por el enlace (lib/mi-cita), nadie vuelve a registrar a nadie por chat— quedaba atrapada para siempre. Cada mensaje suyo,
 * por ajeno que fuera («Gracias, listo», «Nos vemos mañana»), recibía otra vez «Necesito un día válido entre 1 y 31», también mientras una persona del equipo le contestaba
 * desde el celular. Aquí se decide, SOLO con lo que la clienta realmente recibió (sus últimos mensajes enviados), cuándo ese registro ya no se debe retomar:
 *   1. «atiende_una_persona»  -- lo último que se le envió lo escribió una persona del equipo: ya la atienden y el asistente no se mete.
 *   2. «registro_vencido»     -- el último mensaje enviado tiene más de REGISTRO_VENCE_MS: el registro se abandonó y lo que escribe ahora es una conversación nueva, no la
 *                                respuesta a una pregunta de hace horas o días (y menos «su nombre»: ese paso aceptaría cualquier texto).
 *   3. «sin_respuesta_valida» -- ya se le repitió MAX_AVISOS_INVALIDOS_SEGUIDOS veces seguidas «necesito un día/mes válido» y sigue sin contestarlo: se deja de insistir.
 * Sin historial legible (null o vacío) no se decide nada: el registro sigue como siempre.
 *
 * Función pura (sin base de datos ni reloj propio) para poder probarla entera; quien la usa lee el historial (lib/chats/salientes-recientes.ts) y suelta el registro.
 */
import { MENSAJE_DIA_INVALIDO, MENSAJE_MES_INVALIDO } from "@/lib/amore-entrada-gemini";
import type { SalienteReciente } from "@/lib/chats/salientes-recientes";

/** Un registro sin ningún mensaje enviado en este tiempo se da por abandonado. */
export const REGISTRO_VENCE_MS = 6 * 60 * 60 * 1000;
/** Cuántos avisos «necesito un día/mes válido» seguidos se le mandan antes de dejar de insistir. */
export const MAX_AVISOS_INVALIDOS_SEGUIDOS = 2;
/** Cuántos de los últimos mensajes enviados hace falta leer para decidir. */
export const SALIENTES_A_REVISAR = MAX_AVISOS_INVALIDOS_SEGUIDOS + 2;

export type MotivoAbandonoRegistro = "atiende_una_persona" | "registro_vencido" | "sin_respuesta_valida";

const compactar = (texto: string) => texto.replace(/\s+/g, " ").trim();
const AVISOS_DE_RESPUESTA_INVALIDA = new Set([compactar(MENSAJE_DIA_INVALIDO), compactar(MENSAJE_MES_INVALIDO)]);

/**
 * `salientes` va del más nuevo al más viejo (lib/chats/salientes-recientes.ts). Devuelve el motivo por el que el registro ya no debe retomarse, o `null` si sigue vivo.
 * El orden de las reglas importa: una persona atendiendo manda sobre todo lo demás.
 */
export function motivoAbandonoRegistro(salientes: readonly SalienteReciente[] | null | undefined, ahoraMs: number): MotivoAbandonoRegistro | null {
  const ultimo = salientes?.[0];
  if (!salientes || !ultimo) return null;

  if (ultimo.origen === "humano") return "atiende_una_persona";

  const enviadoMs = ultimo.enviadoEn ? Date.parse(ultimo.enviadoEn) : Number.NaN;
  if (Number.isFinite(enviadoMs) && ahoraMs - enviadoMs > REGISTRO_VENCE_MS) return "registro_vencido";

  let avisosSeguidos = 0;
  for (const saliente of salientes) {
    if (saliente.texto === null || !AVISOS_DE_RESPUESTA_INVALIDA.has(compactar(saliente.texto))) break;
    avisosSeguidos++;
  }
  return avisosSeguidos >= MAX_AVISOS_INVALIDOS_SEGUIDOS ? "sin_respuesta_valida" : null;
}
