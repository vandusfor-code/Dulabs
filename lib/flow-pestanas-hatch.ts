/**
 * Transferencia determinista de pestañas (cierre final Daniela, autorizado).
 *
 * Pestañas NUNCA se agenda automáticamente (Nicol las confirma ella misma,
 * cita previa, disponibilidad limitada -- ver base_conocimiento). Cualquier
 * mención de pestañas -- primer mensaje ("quiero pestañas"), pregunta
 * ("¿cuánto cuestan las pestañas?") o respuesta a cualquier pregunta abierta
 * del flow ("pestañas" tecleado en vez de elegir un servicio/fecha/horario)
 * -- transfiere de inmediato a Dani, SIN pasar por ninguna clasificación de
 * IA (mismo criterio exacto que "Hablar con Dani": un vocabulario fijo,
 * determinista, nunca una decisión probabilística).
 *
 * Deliberadamente NO es un nodo del grafo (mismo motivo que
 * flow-escape-hatch.ts: ningún nodo question/buttons puede "abandonar" la
 * conversación desde cualquier punto). A diferencia del escape hatch, este
 * SÍ debe disparar en el primer mensaje de una conversación nueva (todavía
 * sin ejecución activa) -- "quiero pestañas" como primer contacto debe
 * transferir igual, no solo a mitad de una pregunta.
 */

const PATRON_PESTANAS = /pesta[ñn]/i;

/**
 * true si el texto menciona pestañas, sin importar la forma (selección
 * libre, pregunta, mención suelta). Determinista, sin IA.
 */
export function esMencionPestanas(texto: string): boolean {
  return PATRON_PESTANAS.test(texto);
}

export const MENSAJE_TRANSFERENCIA_PESTANAS =
  "Con gusto 💕 te paso con Dani para que pueda ayudarte con toda la información sobre pestañas. ❤️";
