/**
 * Filtro determinista de preguntas laterales (Objetivo 2, autorizado).
 *
 * Detecta, SIN usar IA, cuando un mensaje de texto en medio de una pregunta
 * del Flow PODRÍA ser una pregunta lateral ("¿cuánto cuesta?", "¿qué
 * incluye?", "¿dónde están?") en vez de un intento de responder lo que se
 * preguntó. Es solo un filtro de COSTO (evita llamar a Claude en el caso
 * común de una respuesta directa como "el sábado" o "16:00") -- la
 * clasificación REAL (¿de verdad es lateral?) la hace la IA después, en
 * flow-runtime-bridge.ts::intentarPreguntaLateral. Ver esInterrupcionEscapeHatch
 * en lib/flow-escape-hatch.ts para el mecanismo hermano (interrupciones tipo
 * "cancela"/"hablar con Dani", 100% determinista, sin IA en absoluto).
 *
 * Deliberadamente permisivo (falsos positivos baratos: solo cuestan una
 * llamada extra a Claude que después dice "no es lateral"; falsos negativos
 * caros: una pregunta real sin responder) -- por eso el umbral es bajo.
 */

const PALABRAS_INTERROGATIVAS = /\b(cu[aá]nto|cu[aá]nta|cu[aá]les|cu[aá]l|qu[eé]|d[oó]nde|c[oó]mo|tienen|hay|incluye|dura|demora)\b/i;

function normalizar(texto: string): string {
  return texto.trim();
}

/**
 * true si el texto PODRÍA ser una pregunta lateral -- señal barata basada en
 * "¿"/"?" o vocabulario interrogativo común. No es la decisión final.
 */
export function pareceLikelyPreguntaLateral(texto: string): boolean {
  const s = normalizar(texto);
  if (!s) return false;
  if (/[¿?]/.test(s)) return true;
  return PALABRAS_INTERROGATIVAS.test(s);
}
