/**
 * SELECCIÓN DETERMINISTA: ¿a qué producto se refiere el mensaje del cliente?
 *
 * La decide el backend, nunca el modelo, a partir de señales verificables:
 *
 *   1. image_reply  el cliente RESPONDIÓ a una foto (context.id de Meta) y esa
 *                   foto está en el registro de esta conversación;
 *   2. reference    escribió la referencia (DL-000184);
 *   3. position     "el segundo", "la 3", "opción 2", "el último" sobre la
 *                   lista que se le mostró (en el orden en que se le mostró);
 *   4. name         nombró algo que distingue a UNA opción de las demás
 *                   ("el dorado" cuando solo uno es dorado).
 *
 * Si usa un deíctico ("quiero este", "ese") y ninguna señal lo resuelve con
 * varias opciones abiertas, `needsClarification` = true: el agente pregunta.
 * Nunca se toma "el primero de la lista" ni el más probable.
 */
import type { ConversationState } from "@/lib/agente/estado";

export type SelectionVia = "image_reply" | "position" | "reference" | "name";

export interface SelectionResult {
  selected: Array<{ reference: string; via: SelectionVia }>;
  /** El cliente señaló algo ("este", "ese") sin decir cuál. */
  deictic: boolean;
  /** Deíctico sin resolver con varias opciones abiertas: hay que preguntar. */
  needsClarification: boolean;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const ORDINAL_WORDS: Array<[string, number]> = [
  ["primer[oa]?", 1],
  ["segund[oa]", 2],
  ["tercer[oa]?", 3],
  ["cuart[oa]", 4],
  ["quint[oa]", 5],
  ["sext[oa]", 6],
  ["septim[oa]", 7],
  ["octav[oa]", 8],
  ["noven[oa]", 9],
  ["decim[oa]", 10],
];
/**
 * Un ordinal SOLO es posición con artículo o sustantivo ("el segundo", "la tercera opción", "2 del primero"):
 * "es mi primera compra" no señala nada.
 */
const ORDINALS: Array<[RegExp, number]> = ORDINAL_WORDS.map(([w, n]) => [
  new RegExp(`\\b(?:el|la|los|las|del|de\\s+la|al|a\\s+la)\\s+${w}s?\\b|\\b${w}s?\\s+(?:opcion|foto|imagen)\\b|\\b${n}(?:ro|ra|er|do|da|to|ta|mo|ma|vo|va|no|na|°|º)(?![a-z0-9])`),
  n,
]);
/** Un número SOLO es posición con un marcador ("el 2", "opción 2", "#2", "del 3"); "quiero 2" es una cantidad. */
const MARKED_NUMBER = /(?:\b(?:el|la|los|las|del|de\s+la|opcion|numero|nro|no\.|foto|imagen)\s*#?\s*|#\s*)(10|[1-9])\b(?!\s*(?:unidad|unidades|pieza|piezas|de\s+cada))/g;
const LAST = /\bultim[oa]s?\b/;
const ALL = /\b(?:todos|todas|ambos|ambas)\b/;
const DEICTIC = /\b(?:este|esta|estos|estas|ese|esa|esos|esas|eso|esto|aquel|aquella|aquellos|aquellas)\b|\b(?:el|la)\s+de\s+la\s+(?:foto|imagen)\b/;

const STOPWORDS = new Set(["con", "sin", "para", "por", "del", "las", "los", "una", "uno", "unos", "unas", "que", "mas", "muy", "este", "esta", "ese", "esa", "quiero", "tiene", "tienen", "tienes"]);

function tokens(text: string): Set<string> {
  return new Set(
    norm(text)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t)),
  );
}

/**
 * @param replyReference referencia de la foto citada, ya verificada contra el registro de ESTA conversación.
 * @param typedReferences referencias escritas literalmente por el cliente (extractReferences).
 */
export function resolveSelection(
  text: string,
  shown: ConversationState["lastShown"],
  opts: { replyReference?: string | null; typedReferences?: readonly string[] } = {},
): SelectionResult {
  const selected: SelectionResult["selected"] = [];
  const add = (reference: string, via: SelectionVia) => {
    if (!selected.some((s) => s.reference === reference)) selected.push({ reference, via });
  };
  const t = norm(text);

  if (opts.replyReference) add(opts.replyReference, "image_reply");
  for (const r of opts.typedReferences ?? []) add(r.toUpperCase(), "reference");

  if (shown.length > 0) {
    const positions = new Set<number>();
    for (const [re, n] of ORDINALS) if (re.test(t)) positions.add(n);
    for (const m of t.matchAll(MARKED_NUMBER)) positions.add(Number(m[1]));
    if (LAST.test(t)) positions.add(shown.length);
    for (const p of [...positions].sort((a, b) => a - b)) if (p >= 1 && p <= shown.length) add(shown[p - 1].reference, "position");
    if (ALL.test(t) && shown.length > 1) for (const s of shown) add(s.reference, "position");

    if (shown.length > 1) {
      // Solo palabras que distinguen a UNA opción de las demás.
      const words = tokens(text);
      const perItem = shown.map((s) => tokens(s.name));
      shown.forEach((s, i) => {
        const distinctive = [...perItem[i]].filter((w) => perItem.every((other, j) => j === i || !other.has(w)));
        if (distinctive.some((w) => words.has(w))) add(s.reference, "name");
      });
    } else if (shown.length === 1 && DEICTIC.test(t)) {
      // Una sola opción a la vista: "ese" no es ambiguo.
      add(shown[0].reference, "position");
    }
  }

  const deictic = DEICTIC.test(t);
  return { selected, deictic, needsClarification: deictic && selected.length === 0 && shown.length > 1 };
}
