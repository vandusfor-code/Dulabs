/**
 * R4 — tokenizador de consultas para la búsqueda de conocimiento. PURO.
 *
 * Convierte el mensaje del cliente en términos de búsqueda: minúsculas, SIN
 * tildes (misma transformación que public.dulabs_ba_unaccent en la BD; conserva
 * la ñ), solo [a-z0-9ñ], sin stopwords ni saludos, sin duplicados y con tope.
 * La BD aplica el stemming ('spanish') tanto al texto indexado como a cada
 * término, así que "cancelaciones" encuentra "cancelarse".
 *
 * Este módulo NUNCA arma SQL ni sintaxis de tsquery: entrega un arreglo de
 * términos limpios y la BD los combina (quote_literal). Un mensaje hostil con
 * operadores (& | ! : ' \) queda reducido a palabras inertes.
 */
import { KNOWLEDGE_LIMITS } from "@/lib/business-agent-knowledge/limits";

/** Minúsculas y sin tildes (conserva la ñ). Espejo de public.dulabs_ba_unaccent. */
export function unaccent(text: string): string {
  return text
    .toLowerCase()
    .replace(/[áàâ]/g, "a")
    .replace(/[éèê]/g, "e")
    .replace(/[íìî]/g, "i")
    .replace(/[óòô]/g, "o")
    .replace(/[úùûü]/g, "u");
}

/**
 * Palabras vacías del español (ya sin tildes) más verbos/muletillas de pregunta
 * que no aportan al buscar ("quiero saber si tienen…"). NO incluye "dias",
 * "horario", "precio", "consulta", "ayuda", etc.: pueden ser términos de contenido.
 */
const STOPWORDS = new Set([
  "de", "del", "la", "las", "el", "los", "lo", "al", "un", "una", "unos", "unas", "y", "e", "o", "u", "a", "en", "por",
  "para", "con", "sin", "sobre", "entre", "hasta", "desde", "que", "cual", "cuales", "cuanto", "cuanta", "cuantos",
  "cuantas", "como", "donde", "cuando", "quien", "quienes", "porque", "es", "son", "ser", "soy", "eres", "esta", "estan",
  "estoy", "estamos", "estar", "hay", "tiene", "tienen", "tienes", "tengo", "tenemos", "tener", "puedo", "puedes",
  "puede", "pueden", "podria", "podrian", "podrias", "quiero", "quieres", "quiere", "quisiera", "saber", "conocer",
  "favor", "gracias", "hola", "saludos", "dice", "dicen", "decir", "me", "te", "se", "nos", "mi", "tu", "su", "mis",
  "tus", "sus", "ya", "si", "no", "mas", "muy", "tambien", "pero", "ese", "esa", "eso", "este", "esto", "estos", "esos",
  "estas", "esas", "ustedes", "usted", "vosotros", "algun", "alguna", "algunos", "algunas", "ver", "dar", "hacer",
  "hace", "hacen", "necesito", "necesitas", "ayudar", "preguntar", "buscando", "busco", "info", "informacion",
  "detalle", "detalles", "ok", "vale", "chao", "adios", "bye",
]);

/** Saludos de varias palabras que no son una consulta ("buenos días", "buenas tardes"). */
const GREETING_PHRASES = /\bbuen[oa]s?\s+(?:dias?|tardes?|noches?)\b/g;

export interface TokenizedQuery {
  /** Términos de búsqueda (máx. KNOWLEDGE_LIMITS.queryMaxTerms), en orden de aparición. */
  terms: string[];
  /** true si no quedó ningún término de contenido (solo saludo/muletillas/vacío). */
  empty: boolean;
}

export function tokenizeQuery(raw: string | null | undefined): TokenizedQuery {
  const acotado = (raw ?? "").slice(0, KNOWLEDGE_LIMITS.queryMaxChars);
  const limpio = unaccent(acotado).replace(GREETING_PHRASES, " ");
  const palabras = limpio.match(/[a-z0-9ñ]+/g) ?? [];
  const vistos = new Set<string>();
  const terms: string[] = [];
  for (const p of palabras) {
    if (p.length < 2 || p.length > 40) continue;
    if (STOPWORDS.has(p)) continue;
    if (vistos.has(p)) continue;
    vistos.add(p);
    terms.push(p);
    if (terms.length >= KNOWLEDGE_LIMITS.queryMaxTerms) break;
  }
  return { terms, empty: terms.length === 0 };
}
