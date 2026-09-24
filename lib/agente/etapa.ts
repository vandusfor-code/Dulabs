/**
 * ETAPA DE LA CONVERSACIÓN (Bloque 12) — derivada por el BACKEND del estado real en cada turno.
 *
 * No se guarda ni la escribe el modelo: se calcula del carrito, las opciones abiertas, la
 * propuesta, el pedido activo y la foto citada. Así nunca se desincroniza ("la IA cree que
 * ya confirmó") y cada guarda depende de hechos, no de una etiqueta.
 *
 *   inicio                  nada mostrado todavía
 *   explorando              ya vio productos; nada abierto por elegir
 *   eligiendo               hay varias opciones mostradas y el cliente no dijo cuál
 *   armando_pedido          hay productos en la selección
 *   esperando_confirmacion  el cliente ya vio la propuesta (productos + total) del backend
 *   pedido_con_problemas    hay un pedido que el backend no puede proponer (precio, stock…)
 *   pedido_confirmado       el pedido quedó confirmado / en manos del negocio
 *
 * Las acciones que se sugieren al modelo son orientación; las PERMITIDAS las imponen las guardas
 * de las herramientas (procedencia, selección, confirmación explícita y ligada, una escritura).
 */
import type { TurnFacts } from "@/lib/agente/contexto";
import type { ConversationState } from "@/lib/agente/estado";

export const CONVERSATION_STAGES = ["inicio", "explorando", "eligiendo", "armando_pedido", "esperando_confirmacion", "pedido_con_problemas", "pedido_confirmado"] as const;
export type ConversationStage = (typeof CONVERSATION_STAGES)[number];

export function conversationStage(state: ConversationState, facts: Pick<TurnFacts, "activeOrder">): ConversationStage {
  const order = facts.activeOrder;
  if (state.proposal && state.proposal.presentedTurn !== null) return "esperando_confirmacion";
  if (order && order.next_step === "resolve_issues") return "pedido_con_problemas";
  if (state.cart.length > 0) return "armando_pedido";
  if (order && (order.status === "confirmed" || order.next_step === "wait_human")) return "pedido_confirmado";
  if (state.ambiguity && state.ambiguity.presentedTurn !== null) return "eligiendo";
  if (state.lastShown.length > 0 || state.known.length > 0) return "explorando";
  return "inicio";
}

/** Qué conviene hacer en cada etapa (orientación para el modelo; las guardas deciden). */
export const STAGE_GUIDANCE: Readonly<Record<ConversationStage, string>> = {
  inicio: "Saluda y entiende qué busca (tipo de joya, color, material, presupuesto) o si prefiere ver el catálogo.",
  explorando: "Ayúdalo a encontrar: búsqueda, más resultados, parecidos, fotos o el catálogo.",
  eligiendo: "Hay varias opciones abiertas: pregúntale cuál quiere (número, referencia o que responda a la foto). No agregues nada sin su elección.",
  armando_pedido: "Confirma cantidades, ofrece agregar algo más y, cuando esté listo, crea la solicitud y muéstrale la propuesta con el total.",
  esperando_confirmacion: "Espera que confirme la propuesta mostrada. Solo si dice que sí de forma explícita, confirma; si quiere cambiar algo, ajusta la selección.",
  pedido_con_problemas: "Explica los problemas del pedido (precio cambió, sin stock, producto no disponible) con los datos del sistema y ayúdalo a ajustarlo.",
  pedido_confirmado: "El pedido ya está en manos del negocio: agradece y resuelve dudas; si pide algo más, empieza una nueva selección.",
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const AFFIRMATIVE = /\b(?:si|sip|confirmo|confirmado|confirmada|confirma|confirmar|dale|listo|lista|de acuerdo|ok|okay|okey|vale|va|hagale|perfecto|claro|correcto|acepto|aceptado|adelante|procede|proceda|asi esta bien|esta bien|me sirve|hecho|de una)\b/;
/** Algo que niega, condiciona o cambia la propuesta (o una pregunta): entonces NO es una confirmación. */
const NEGATION_OR_CHANGE = /\b(?:no|todavia|aun|espera|esperame|cancela|cancelar|cambia|cambiar|cambio|mejor|quita|quitar|quitale|agrega|agregar|agregale|anade|pero|en vez|otra|otro)\b|\?/;

/**
 * ¿El mensaje del cliente ACEPTA explícitamente la propuesta? Determinista: debe haber una
 * afirmación ("sí", "confirmo", "dale", "listo"…) y nada que la condicione o la niegue
 * ("no", "pero", "cambia", "agrega", una pregunta). "ok gracias" confirma; "sí pero quita uno", no.
 */
export function isExplicitConfirmation(text: string): boolean {
  // "sí, cómo no" es un sí (el "no" de la expresión no niega).
  const t = norm(text).trim().replace(/\bcomo no\b/g, "claro");
  if (!t || t.length > 160) return false;
  return AFFIRMATIVE.test(t) && !NEGATION_OR_CHANGE.test(t);
}
