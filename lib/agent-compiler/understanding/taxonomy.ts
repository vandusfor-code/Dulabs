// DuLabs Business — Business Agent 2.0, FASE 2 — taxonomía universal de intenciones.
//
// Pequeña, agnóstica de industria y versionada. Un intent describe QUÉ quiere el cliente con su mensaje, nunca CÓMO
// lo atiende un negocio concreto: "corte clásico", "mesa para 4" o "camiseta talla M" son SLOTS de BOOKING_REQUEST u
// ORDER_REQUEST, no intents propios. Agregar un intent es un cambio de versión (TAXONOMY_VERSION), no un cambio de
// código en los consumidores: todo consumidor debe tratar un intent desconocido como UNKNOWN.
//
// Decisiones de diseño (evaluadas contra la lista de partida):
//   - PURCHASE_INTENT NO se incluye: se solapa con ORDER_REQUEST (pedir) y PRODUCT_INQUIRY (interesarse). La "fuerza"
//     de la intención de compra se expresa con la confianza, no con otra etiqueta que el modelo confundiría.
//   - CONFIRMATION / REJECTION son señales CONTEXTUALES: solo significan algo si el sistema tenía una confirmación
//     pendiente (ver signals.confirmation en el contrato). Un "sí" suelto no confirma nada.
//   - CORRECTION existe como intent (un mensaje que SOLO corrige: "mejor a las 5") y además como marca por slot.

export const TAXONOMY_VERSION = "1.0.0";

export const UNDERSTANDING_INTENTS = [
  "GREETING",
  "FAREWELL",
  "INFORMATION_REQUEST",
  "PRODUCT_INQUIRY",
  "SERVICE_INQUIRY",
  "PRICE_INQUIRY",
  "AVAILABILITY_INQUIRY",
  "BOOKING_REQUEST",
  "ORDER_REQUEST",
  "CANCELLATION",
  "RESCHEDULING",
  "CONFIRMATION",
  "REJECTION",
  "COMPLAINT",
  "HUMAN_HANDOFF",
  "FOLLOW_UP",
  "CORRECTION",
  "UNKNOWN",
] as const;

export type UnderstandingIntent = (typeof UNDERSTANDING_INTENTS)[number];

export interface IntentDefinition {
  /** Una línea: es lo que ve el modelo (sin ejemplos de industria). */
  description: string;
  /**
   * Slots universales que el intent normalmente necesita para poder actuar. Es una PISTA para calcular
   * `missingSlots`; qué datos son obligatorios de verdad lo decide el backend del negocio (FASE 3).
   */
  expectedSlots: readonly string[];
}

export const INTENT_DEFINITIONS: Readonly<Record<UnderstandingIntent, IntentDefinition>> = {
  GREETING: { description: "Saluda o inicia la conversación sin pedir nada más.", expectedSlots: [] },
  FAREWELL: { description: "Se despide o cierra la conversación.", expectedSlots: [] },
  INFORMATION_REQUEST: { description: "Pregunta información general del negocio (horario, ubicación, políticas, cómo funciona).", expectedSlots: [] },
  PRODUCT_INQUIRY: { description: "Pregunta por productos: qué hay, características, variantes, existencias.", expectedSlots: [] },
  SERVICE_INQUIRY: { description: "Pregunta por servicios: qué se ofrece, en qué consiste, duración.", expectedSlots: [] },
  PRICE_INQUIRY: { description: "Pregunta cuánto cuesta algo.", expectedSlots: [] },
  AVAILABILITY_INQUIRY: { description: "Pregunta si hay disponibilidad o cupo, sin pedir todavía reservar.", expectedSlots: ["date"] },
  BOOKING_REQUEST: { description: "Quiere reservar o agendar una cita, turno, mesa o sesión.", expectedSlots: ["service", "date", "time"] },
  ORDER_REQUEST: { description: "Quiere comprar o pedir productos.", expectedSlots: ["product", "quantity"] },
  CANCELLATION: { description: "Quiere cancelar una cita, reserva o pedido existente.", expectedSlots: [] },
  RESCHEDULING: { description: "Quiere cambiar la fecha u hora de una cita o reserva existente.", expectedSlots: ["date", "time"] },
  CONFIRMATION: { description: "Acepta o confirma lo que se le propuso (sí, de acuerdo, confirmo).", expectedSlots: [] },
  REJECTION: { description: "Rechaza o no acepta lo que se le propuso (no, así no).", expectedSlots: [] },
  COMPLAINT: { description: "Se queja o reporta un problema con el servicio o un producto.", expectedSlots: [] },
  HUMAN_HANDOFF: { description: "Pide hablar con una persona, asesor o humano.", expectedSlots: [] },
  FOLLOW_UP: { description: "Pregunta por el estado de algo ya pedido o reservado.", expectedSlots: [] },
  CORRECTION: { description: "Solo corrige un dato que dio antes (\"mejor a las 5\").", expectedSlots: [] },
  UNKNOWN: { description: "No se puede determinar qué quiere, o el mensaje no tiene relación con el negocio.", expectedSlots: [] },
};

/** Límite de intents secundarios por mensaje (multi-intent acotado). */
export const MAX_SECONDARY_INTENTS = 2;

export function isUnderstandingIntent(value: unknown): value is UnderstandingIntent {
  return typeof value === "string" && (UNDERSTANDING_INTENTS as readonly string[]).includes(value);
}
