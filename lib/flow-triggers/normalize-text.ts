/**
 * Fase 3 (Event Routing, autorizado) — normalización de texto para matching
 * de keywords. Pura, sin reglas de negocio de matching acá (eso es
 * match-trigger.ts) -- esta función SOLO normaliza la representación de un
 * texto para comparación, nunca decide si dos textos "coinciden".
 *
 * Mismo patrón ya probado en el codebase (normalizarNombreServicio,
 * lib/especialistas-flow-adaptador.ts): NFD + remover marcas combinantes es
 * la forma estándar de quitar acentos en JS sin tabla de reemplazos manual.
 * Deliberadamente NO se elimina puntuación ni se hace stemming -- eso SÍ
 * cambiaría el significado ("¿vendes?" vs "vendes" pueden ser intenciones
 * distintas para un keyword trigger configurado a propósito).
 */
export function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ");
}
