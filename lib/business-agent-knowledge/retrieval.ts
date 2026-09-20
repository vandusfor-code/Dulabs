/**
 * R4 — recuperación de conocimiento. Autoridad del BACKEND: la IA nunca elige
 * tenant, fuentes ni cuántos resultados. Entrada: el mensaje del cliente.
 * Salida: como máximo KNOWLEDGE_LIMITS.resultsMax fragmentos y
 * resultsMaxChars caracteres, ya con umbral de relevancia. Si nada es
 * relevante devuelve `found:false` y el flujo NO invoca a la IA (no inventa).
 */
import { KNOWLEDGE_LIMITS, KNOWLEDGE_SOURCES, type KnowledgeSource } from "@/lib/business-agent-knowledge/limits";
import { tokenizeQuery, unaccent } from "@/lib/business-agent-knowledge/tokenizer";
import type { KnowledgeStore, RawSearchHit } from "@/lib/business-agent-knowledge/store";

export interface KnowledgeHit {
  source: KnowledgeSource;
  title: string;
  content: string;
  /** Fracción de términos de la consulta presentes en el fragmento (0..1). */
  coverage: number;
}

export interface KnowledgeSearchResult {
  found: boolean;
  /** true si la consulta no tenía términos de contenido (saludo/agradecimiento/vacía). */
  emptyQuery: boolean;
  hits: KnowledgeHit[];
  /** Texto listo para la IA: fragmentos numerados con su fuente, dentro del presupuesto. */
  text: string;
  /**
   * Anti-invención — respuesta EXACTA: si el mejor resultado es una FAQ que cubre TODOS los términos de la consulta y
   * ninguna otra lo hace, su respuesta tal cual la escribió el negocio (el agente la envía sin pasar por la IA). "" si no.
   */
  exact: string;
  /** Texto del mejor resultado, tal cual (respaldo verificable cuando la redacción de la IA no está respaldada). */
  direct: string;
}

const NADA: KnowledgeSearchResult = { found: false, emptyQuery: false, hits: [], text: "", exact: "", direct: "" };

/** Tope del texto directo: un mensaje de WhatsApp legible, no un documento entero. */
const DIRECT_MAX_CHARS = 1200;
/** Frases máximas del extracto de un documento. */
const EXCERPT_MAX_SENTENCES = 3;

function acotar(texto: string): string {
  return texto.length > DIRECT_MAX_CHARS ? `${texto.slice(0, DIRECT_MAX_CHARS - 1).trimEnd()}…` : texto;
}

const raizDe = (w: string): string => w.slice(0, 5);

/**
 * Extracto EXTRACTIVO de un fragmento de documento: las frases (por línea o por punto) que comparten términos con la
 * consulta, en su orden original. Sin IA: solo texto del propio documento. Si ninguna comparte términos, el fragmento entero.
 */
export function extractRelevantExcerpt(content: string, terms: string[]): string {
  const raices = new Set(terms.map(raizDe));
  const frases = content
    .split(/\n+|(?<=[.!?])\s+/)
    .map((f) => f.trim())
    .filter(Boolean);
  const puntuadas = frases.map((frase, indice) => {
    const palabras = unaccent(frase).match(/[a-z0-9ñ]+/g) ?? [];
    const coincidencias = new Set(palabras.map(raizDe).filter((r) => raices.has(r)));
    return { frase, indice, puntaje: coincidencias.size };
  });
  const elegidas = puntuadas
    .filter((p) => p.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje || a.indice - b.indice)
    .slice(0, EXCERPT_MAX_SENTENCES)
    .sort((a, b) => a.indice - b.indice);
  return elegidas.length > 0 ? elegidas.map((p) => p.frase).join(" ") : content;
}

/** ¿El candidato es lo bastante relevante? Exige cobertura mínima de los términos de la consulta. */
export function isRelevant(hit: Pick<RawSearchHit, "matched" | "total">): boolean {
  if (hit.total <= 0 || hit.matched <= 0) return false;
  if (hit.matched / hit.total < KNOWLEDGE_LIMITS.minCoverage) return false;
  // Consultas de 3+ términos: un solo término en común (p. ej. una palabra genérica) no basta.
  if (hit.total >= 3 && hit.matched < 2) return false;
  return true;
}

function sourcePriority(s: KnowledgeSource): number {
  return s === "faq" ? 0 : 1; // una FAQ curada gana a un fragmento de documento con igual cobertura
}

/** Formatea los fragmentos como DATOS (no instrucciones) para la IA. */
export function formatHits(hits: KnowledgeHit[]): string {
  return hits
    .map((h, i) =>
      h.source === "faq"
        ? `[${i + 1}] Pregunta frecuente: ${h.title}\nRespuesta: ${h.content}`
        : `[${i + 1}] Documento "${h.title}" (fragmento):\n${h.content}`,
    )
    .join("\n\n");
}

export async function buscarConocimiento(
  store: Pick<KnowledgeStore, "search">,
  params: { tenantId: string; query: string | null | undefined; sources?: KnowledgeSource[] },
): Promise<KnowledgeSearchResult> {
  if (!params.tenantId) return NADA;
  const { terms, empty } = tokenizeQuery(params.query);
  if (empty) return { ...NADA, emptyQuery: true };

  // Solo fuentes conocidas (defensa: el llamador podría pasar cualquier cosa).
  const sources = (params.sources ?? [...KNOWLEDGE_SOURCES]).filter((s): s is KnowledgeSource => (KNOWLEDGE_SOURCES as readonly string[]).includes(s));
  if (sources.length === 0) return NADA;

  const candidatos = await store.search(params.tenantId, terms, sources, KNOWLEDGE_LIMITS.searchCandidates);

  const ordenados = candidatos
    .filter(isRelevant)
    .map((c) => ({ raw: c, coverage: c.matched / c.total }))
    .sort((a, b) => b.coverage - a.coverage || sourcePriority(a.raw.sourceType) - sourcePriority(b.raw.sourceType) || b.raw.rank - a.raw.rank);

  const hits: KnowledgeHit[] = [];
  const vistos = new Set<string>();
  let usados = 0;
  for (const { raw, coverage } of ordenados) {
    if (hits.length >= KNOWLEDGE_LIMITS.resultsMax) break;
    const clave = `${raw.sourceType}|${raw.content}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);

    let contenido = raw.content.trim();
    const restante = KNOWLEDGE_LIMITS.resultsMaxChars - usados;
    if (restante <= 0) break;
    if (contenido.length > restante) {
      if (restante < 200 && hits.length > 0) break; // no vale la pena un fragmento diminuto
      contenido = `${contenido.slice(0, Math.max(0, restante - 1)).trimEnd()}…`;
    }
    usados += contenido.length;
    hits.push({ source: raw.sourceType, title: raw.title, content: contenido, coverage });
  }

  if (hits.length === 0) return NADA;
  const top = hits[0]!;
  // FAQ: la respuesta curada completa. Documento: solo las frases que tocan lo que preguntó el cliente.
  const direct = acotar(top.source === "faq" ? top.content : extractRelevantExcerpt(top.content, terms));
  const exact = top.source === "faq" && top.coverage >= 0.999 && !hits.slice(1).some((h) => h.coverage >= 0.999) ? top.content : "";
  return { found: true, emptyQuery: false, hits, text: formatHits(hits), exact, direct };
}
