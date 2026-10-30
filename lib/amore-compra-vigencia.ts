/**
 * AMORE — ¿el flujo de COMPRA DE PRODUCTO sigue siendo de la clienta? (modos compra_producto_opcion y compra_esperando_pago de dulabs_amore_entrada; ver
 * interceptarCompraProductoAmore en lib/amore-entrada-router.ts).
 *
 * Ese gate se queda con TODOS los mensajes de la clienta mientras el flujo esté abierto, y no tenía salida: «No reconocí esa opción» (menú 1/2) o el recordatorio de pago se repetían con
 * cada mensaje, sin tope, aunque una persona del equipo ya le estuviera contestando desde el celular, aunque hubieran pasado semanas y aunque la clienta hubiera cambiado de tema
 * («quiero una cita»). Es el mismo defecto que tenía el registro (lib/amore-registro-vigencia.ts), pero este flujo SÍ está activo (botón «Comprar» de la tienda) y toca dinero, así que
 * las reglas son más cuidadosas que las del registro:
 *
 *   Menú 1/2 (compra_producto_opcion) -- se SUELTA (modo 'gemini', sin mandar nada y el mensaje sigue su camino) si:
 *     · una persona del equipo fue la última en escribirle (un «1» ahí es de SU conversación, no una opción del menú; mismo criterio que el menú de bienvenida), o
 *     · la clienta cambió de tema (pide una cita o gestiona la que tiene), o
 *     · ya se le repitió «No reconocí esa opción» MAX_AVISOS_OPCION_COMPRA_SEGUIDOS veces y vuelve a no elegir 1 ni 2.
 *     Una respuesta VÁLIDA («1» o «2») nunca se descarta por los avisos anteriores. Sin vencimiento por tiempo: quien elige «1» horas o días después todavía puede pagar.
 *
 *   Esperando el pago (compra_esperando_pago) -- «Ya pagué» se reconoce SIEMPRE, antes que cualquier otra regla (lo importante es no perder un pago). Con cualquier otro mensaje:
 *     · si cambió de tema (pide una cita o gestiona la que tiene) se SUELTA el flujo y el mensaje sigue su camino;
 *     · si una persona del equipo fue la última en escribirle, o si lo último que se le envió ya fue el recordatorio de pago, el asistente CALLA, pero el flujo sigue abierto para
 *       reconocer un «Ya pagué» posterior (el recordatorio se manda UNA vez, no con cada mensaje);
 *     · si no, el recordatorio de siempre.
 *
 * «Una persona fue la última en escribirle» se decide con lo que la clienta realmente recibió (lib/chats/salientes-recientes.ts): `origen = 'humano'` y, por si el worker no hubiera
 * marcado un envío del asistente (el origen se marca desde un registro en memoria que podría fallar tras un reinicio), que el texto NO sea uno de los textos fijos del asistente: así un
 * fallo de esa marca nunca le quita el flujo de pago a la clienta. Sin historial legible (null o vacío) no se decide nada: el flujo sigue como siempre.
 *
 * Funciones puras (sin base de datos ni reloj) para poder probarlas enteras.
 */
import {
  MENSAJE_COMPRA_ASESOR_CLIENTE,
  MENSAJE_COMPRA_MENU,
  MENSAJE_COMPRA_METODOS_PAGO_PENDIENTE,
  MENSAJE_COMPRA_OPCION_INVALIDA,
  MENSAJE_COMPRA_PAGO_REGISTRADO_CLIENTE,
  MENSAJE_COMPRA_RECORDATORIO_PAGO,
  construirMensajeCompraSaludo,
} from "@/lib/amore-entrada-gemini";
import { pideCitaNueva } from "@/lib/amore-pide-cita";
import { detectarIntencionGestionCitas } from "@/lib/agenda-v2/entrada";
import type { SalienteReciente } from "@/lib/chats/salientes-recientes";

/** Cuántos avisos «No reconocí esa opción» seguidos se le mandan antes de dejar de insistir. */
export const MAX_AVISOS_OPCION_COMPRA_SEGUIDOS = 2;
/** Cuántos de los últimos mensajes enviados hace falta leer para decidir. */
export const SALIENTES_COMPRA_A_REVISAR = MAX_AVISOS_OPCION_COMPRA_SEGUIDOS + 2;

export type MotivoSoltarMenuCompra = "atiende_una_persona" | "cambio_de_tema" | "sin_opcion_valida";
export type DecisionEsperaPago = "soltar_cambio_de_tema" | "callar_atiende_una_persona" | "callar_ya_se_recordo" | "recordar";

const compactar = (texto: string) => texto.replace(/\s+/g, " ").trim();

/** Los textos fijos que el asistente envía dentro del flujo de compra (el último mensaje que la clienta recibe en cada paso es siempre uno de estos). */
const TEXTOS_FIJOS_DEL_ASISTENTE = new Set(
  [
    MENSAJE_COMPRA_MENU,
    MENSAJE_COMPRA_OPCION_INVALIDA,
    MENSAJE_COMPRA_METODOS_PAGO_PENDIENTE,
    MENSAJE_COMPRA_RECORDATORIO_PAGO,
    MENSAJE_COMPRA_ASESOR_CLIENTE,
    MENSAJE_COMPRA_PAGO_REGISTRADO_CLIENTE,
  ].map(compactar),
);
/** El saludo del flujo lleva el nombre del producto: se reconoce por su comienzo. */
const COMIENZO_SALUDO_COMPRA = compactar(construirMensajeCompraSaludo("")).replace(/\.$/, "");

/** ¿Este texto lo escribió el asistente (uno de sus textos fijos de la compra)? */
export function esTextoDelAsistente(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const compacto = compactar(texto);
  return TEXTOS_FIJOS_DEL_ASISTENTE.has(compacto) || compacto.startsWith(COMIENZO_SALUDO_COMPRA);
}

/** ¿Una persona del equipo fue la última en escribirle a la clienta? `salientes` va del más nuevo al más viejo. */
export function atiendeUnaPersona(salientes: readonly SalienteReciente[] | null | undefined): boolean {
  const ultimo = salientes?.[0];
  return ultimo?.origen === "humano" && !esTextoDelAsistente(ultimo.texto);
}

/** Cuántos avisos «No reconocí esa opción» seguidos son lo más reciente que se le envió. */
export function avisosDeOpcionInvalidaSeguidos(salientes: readonly SalienteReciente[] | null | undefined): number {
  const aviso = compactar(MENSAJE_COMPRA_OPCION_INVALIDA);
  let seguidos = 0;
  for (const saliente of salientes ?? []) {
    if (saliente.texto === null || compactar(saliente.texto) !== aviso) break;
    seguidos++;
  }
  return seguidos;
}

/** ¿Lo último que se le envió ya fue el recordatorio de pago? */
export function yaSeLeRecordoElPago(salientes: readonly SalienteReciente[] | null | undefined): boolean {
  const ultimo = salientes?.[0]?.texto;
  return ultimo != null && compactar(ultimo) === compactar(MENSAJE_COMPRA_RECORDATORIO_PAGO);
}

/** ¿El mensaje es de otro asunto con certeza (pide una cita nueva o gestiona la que tiene)? Mismos detectores deterministas que usa el resto del asistente. */
export function cambiaDeTema(texto: string): boolean {
  return pideCitaNueva(texto) || detectarIntencionGestionCitas(texto) !== null;
}

/**
 * Menú 1/2: ¿se suelta el flujo en vez de contestarle? `esOpcion` = el mensaje es exactamente «1» o «2» (una respuesta válida nunca se descarta por los avisos anteriores).
 * Devuelve el motivo, o `null` si el flujo sigue siendo suyo.
 */
export function motivoSoltarMenuCompra(params: { texto: string; esOpcion: boolean; salientes: readonly SalienteReciente[] | null | undefined }): MotivoSoltarMenuCompra | null {
  if (atiendeUnaPersona(params.salientes)) return "atiende_una_persona";
  if (cambiaDeTema(params.texto)) return "cambio_de_tema";
  if (!params.esOpcion && avisosDeOpcionInvalidaSeguidos(params.salientes) >= MAX_AVISOS_OPCION_COMPRA_SEGUIDOS) return "sin_opcion_valida";
  return null;
}

/**
 * Esperando el pago, con un mensaje que NO es «Ya pagué» (ese se reconoce antes, siempre): qué hacer. «callar_*» = no mandar nada pero dejar el flujo abierto para un «Ya pagué»
 * posterior; «soltar_cambio_de_tema» = cerrar el flujo y dejar pasar el mensaje; «recordar» = el recordatorio de siempre (se manda una vez seguida).
 */
export function decidirEsperaPago(params: { texto: string; salientes: readonly SalienteReciente[] | null | undefined }): DecisionEsperaPago {
  if (cambiaDeTema(params.texto)) return "soltar_cambio_de_tema";
  if (atiendeUnaPersona(params.salientes)) return "callar_atiende_una_persona";
  if (yaSeLeRecordoElPago(params.salientes)) return "callar_ya_se_recordo";
  return "recordar";
}
