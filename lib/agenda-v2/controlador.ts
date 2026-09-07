/**
 * AGENDA V2 (autorizado) — controlador MÍNIMO para esta fase (sección 3 del
 * pedido): la finalidad NO es tener una agenda funcional todavía, es
 * demostrar que el router puede aislar una conversación por completo. Los
 * pasos reales (servicio/profesional/fecha/horario/confirmación) se
 * implementan en fases posteriores, cada una con su propia autorización.
 */
import { normalizeText } from "@/lib/flow-triggers/normalize-text";
import type { SesionAgendaV2 } from "@/lib/agenda-v2/sesiones";

export const RESPUESTA_PLACEHOLDER_AGENDA_V2 = "Agenda V2 activa. Selecciona una opción.";
const RESPUESTA_CANCELACION = "Listo, cancelé tu proceso de agenda 💗 Escríbeme cuando quieras retomarlo.";

/** Vocabulario cerrado, coincidencia EXACTA tras normalizar -- nunca "contains", mismo criterio que el resto del proyecto para comandos de control (ver esCancelacionExplicitaDeReserva). */
const COMANDO_CANCELAR = "cancelar";

export type ResultadoControladorAgendaV2 =
  | { accion: "cerrar_sesion"; respuesta: string }
  | { accion: "continuar"; respuesta: string };

/**
 * Procesa UN mensaje ya sabido perteneciente a una sesión activa. Nunca
 * llama a resolverEscenario, ejecutarBotWhatsAppQR, Gemini/Claude, ni
 * ningún otro escenario -- el mensaje entero queda resuelto acá.
 */
export function manejarMensajeAgendaV2(_sesion: SesionAgendaV2, mensaje: string): ResultadoControladorAgendaV2 {
  const normalizado = normalizeText(mensaje);
  if (normalizado === COMANDO_CANCELAR) {
    return { accion: "cerrar_sesion", respuesta: RESPUESTA_CANCELACION };
  }
  // Sección 3 del pedido -- para esta fase, cualquier otro mensaje (válido,
  // inválido, o lo que sea) recibe la misma respuesta temporal: el objetivo
  // es demostrar aislamiento, no todavía la lógica real de pasos.
  return { accion: "continuar", respuesta: RESPUESTA_PLACEHOLDER_AGENDA_V2 };
}
