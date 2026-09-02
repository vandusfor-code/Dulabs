/**
 * Escape hatch determinista (rediseño de agendamiento, autorizado).
 *
 * Detecta, SIN usar IA, cuando un mensaje de texto en medio de CUALQUIER
 * pregunta abierta del Flow de Daniela es en realidad una interrupción
 * ("cancela", "espera", "quiero hablar con Dani"...) y no una respuesta a
 * la pregunta que está pendiente. Nunca debe guardarse "cancela" como si
 * fuera una fecha/hora/servicio.
 *
 * Deliberadamente NO es un nodo del grafo (ningún nodo question/buttons
 * puede "abandonar" la conversación desde cualquier punto -- el motor solo
 * entiende los edges del nodo activo). Se aplica una capa por encima del
 * motor, en flow-runtime-bridge.ts, antes de construir el evento del
 * engine -- ver ese archivo para el porqué.
 */

const PATRONES_ESCAPE = [
  /\bcancela(r)?\b/,
  /\bolvidalo\b/,
  /\bno importa\b/,
  /\bmejor no\b/,
  /\bespera\b/,
  /\bme equivoque\b/,
  /\b(hablar|hable|hablo)\s+con\s+dani(ela)?\b/,
  /\bcon\s+dani(ela)?\s+por\s+favor\b/,
  /\bnecesito\s+hablar\s+con\s+alguien\b/,
  /\bquiero\s+hablar\s+con\s+(alguien|una?\s+persona|un\s+humano)\b/,
];

function normalizar(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[¿?¡!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * true si el texto es una interrupción reconocida de forma determinista.
 * Nunca se llama a Claude para esta decisión -- vocabulario fijo, igual de
 * verificable que un test.
 */
export function esInterrupcionEscapeHatch(texto: string): boolean {
  const s = normalizar(texto);
  if (!s) return false;
  return PATRONES_ESCAPE.some((re) => re.test(s));
}

/** Mismo texto exacto pedido para el botón "Hablar con Dani" del menú y para el escape hatch. */
export const MENSAJE_HABLAR_CON_DANI = "Claro que sí 💚\n\nEn unos momentos Dani te estará respondiendo.\nDale un momentico, porfa.";
