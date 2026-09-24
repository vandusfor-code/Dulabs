/**
 * INTENCIÓN y MOTIVO DE ASESORA (Bloque 16) — deterministas, sin IA y sin datos personales.
 *
 *   detectIntent        qué intentó resolver el turno, derivado de las herramientas que
 *                       se pidieron (lo que el modelo HIZO, no lo que dijo) y del resultado.
 *                       Va a la traza para diagnosticar ("¿qué entendió el agente?").
 *   asksForHuman        el cliente pide EXPLÍCITAMENTE una persona: el backend pasa el chat a
 *                       una asesora sin llamar al modelo (no depende de que el modelo lo decida).
 *   HANDOFF_MOTIVES     motivo cerrado del traspaso: se guarda en la traza (el texto libre del
 *                       modelo nunca, puede traer datos del cliente).
 */
import type { AgentToolName } from "@/lib/agente/nombres-herramientas";

export const HANDOFF_MOTIVES = ["customer_request", "order_issue", "payment_or_delivery", "complaint", "out_of_scope", "other"] as const;
export type HandoffMotive = (typeof HANDOFF_MOTIVES)[number];
/** Traspasos que decide el sistema (no el modelo). */
export type SystemHandoffMotive = "customer_request" | "repeated_failures" | "limit_contact_day" | "limit_tenant_tokens_day";

export type TurnIntent =
  | "handoff"
  | "confirm_order"
  | "order"
  | "cart"
  | "photos"
  | "product_detail"
  | "similar"
  | "more_results"
  | "search"
  | "catalog_link"
  | "conversation";

/** Prioridad: la acción más comprometida del turno define la intención. */
const BY_TOOL: ReadonlyArray<[TurnIntent, readonly AgentToolName[]]> = [
  ["handoff", ["handoff_to_human"]],
  ["confirm_order", ["confirm_order"]],
  ["order", ["create_order_request", "validate_order", "resolve_order"]],
  ["cart", ["update_cart", "get_cart"]],
  ["photos", ["request_product_images"]],
  ["product_detail", ["resolve_product_by_reference", "get_product_details", "resolve_product_by_attributes"]],
  ["similar", ["similar_products"]],
  ["more_results", ["more_products"]],
  ["search", ["search_products"]],
  ["catalog_link", ["get_catalog_link"]],
];

export function detectIntent(toolNames: readonly string[], outcome: string): TurnIntent | null {
  if (["duplicate", "rate_limited", "preempted"].includes(outcome)) return null;
  if (outcome === "handoff") return "handoff";
  for (const [intent, tools] of BY_TOOL) if (tools.some((t) => toolNames.includes(t))) return intent;
  return "conversation";
}

const norm = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const PERSONA = "(asesor|asesora|asesoras|asesores|humano|humana|persona|alguien|vendedor|vendedora|agente humano)";
// "quiero hablar con una asesora", "pásame con un asesor", "me comunicas con alguien", "¿me atiende una persona?".
const VERBO_CONTACTO = new RegExp(
  `\\b(hablar|hablo|comunica|comunicas|comunicame|comunicarme|pasame|pasarme|pasas|contactar|contactarme|atienda|atiende)\\b(?: \\S+){0,3} (con |a )?((un|una|el|la|alguna|algun) )?${PERSONA}\\b`,
);
// "necesito una asesora", "quiero un asesor" (pero no "quiero verlo puesto en una persona").
const QUIERO_PERSONA = new RegExp(`\\b(quiero|necesito|prefiero) (un|una) ${PERSONA}\\b`);
const SOLO_PERSONA = new RegExp(`^(una |un )?${PERSONA}( por favor| porfa| porfavor)?$`);
// Preguntas sobre la asesora, no pedidos de hablar con ella: "¿la asesora me envía fotos?".
const NO_ES_PEDIDO = /\b(no quiero|no necesito|sin)\b/;

export function asksForHuman(text: string): boolean {
  const t = norm(text).slice(0, 300);
  if (!t || NO_ES_PEDIDO.test(t)) return false;
  return SOLO_PERSONA.test(t) || VERBO_CONTACTO.test(t) || QUIERO_PERSONA.test(t);
}
