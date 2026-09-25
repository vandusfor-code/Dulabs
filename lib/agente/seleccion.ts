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
import { leerCantidad } from "@/lib/agente/lenguaje/interpretar";

export type SelectionVia = "image_reply" | "position" | "reference" | "name";

export interface SelectionResult {
  selected: Array<{ reference: string; via: SelectionVia }>;
  /** El cliente señaló algo ("este", "ese", "el de arriba", "el otro") sin decir cuál. */
  deictic: boolean;
  /** Pidió una cantidad sin decir de qué producto ("quiero 3"). */
  quantityOnly: boolean;
  /** Deíctico o cantidad sin producto, sin resolver, con varias opciones abiertas: hay que preguntar. */
  needsClarification: boolean;
  /** Bloque 28: pidió TODAS las opciones señaladas ("todos", "los dos", "uno de cada uno"). */
  all?: boolean;
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
/** Bloque 28 (solo con la capa de lenguaje): "uno de cada uno" también es TODAS. */
const ALL_B28 = /\b(?:todos|todas|ambos|ambas|(?:uno|una) de cada (?:uno|una)|de cada uno|de cada una)\b/;
/** Bloque 28: "los dos" / "las dos" = ambas SOLO si hay exactamente dos opciones a la vista. */
const BOTH = /\b(?:los|las)\s+dos\b/;
const DEICTIC =
  /\b(?:este|esta|estos|estas|ese|esa|esos|esas|eso|esto|aquel|aquella|aquellos|aquellas)\b|\b(?:el|la)\s+de\s+la\s+(?:foto|imagen)\b|\b(?:el|la)\s+(?:de\s+(?:arriba|abajo)|anterior|otr[oa])\b/;
/** "el otro" / "la otra": solo se resuelve con exactamente dos opciones y una ya elegida. */
const OTHER = /\b(?:el|la)\s+otr[oa]\b/;
/**
 * Mensaje que SOLO pide una cantidad ("3", "quiero 3", "dame dos unidades", "mejor 4"). Con UNA
 * sola opción a la vista, es de esa; con varias, hay que preguntar de cuál. Un número dentro de
 * otra frase ("¿tienes aretes de 2 cm?") no cuenta.
 */
const QUANTITY_ONLY =
  /^(?:(?:quiero|dame|deme|necesito|ponme|pongame|agrega(?:me)?|me\s+llevo|llevo|seria[n]?|mejor|que\s+sean)\s+)?(?:[1-9]\d?|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)(?:\s+(?:unidades?|piezas?|por\s+favor|porfa))?\s*[.!]?$/;

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
  opts: {
    replyReference?: string | null;
    typedReferences?: readonly string[];
    /** Lo que el cliente ya eligió antes (selección anterior y carrito): resuelve "el otro". */
    previous?: readonly string[];
    /** Bloque 28: referencias de las fotos enviadas en la conversación reciente ("el de la foto" con UNA sola). */
    photoReferences?: readonly string[];
    /**
     * Bloque 28: capa de lenguaje ("los dos", "uno de cada uno", "x2" / "eran 3" como cantidad). Solo con el
     * checkout conversacional; sin ella, la selección es exactamente la de antes.
     */
    lenguaje?: boolean;
  } = {},
): SelectionResult {
  const selected: SelectionResult["selected"] = [];
  const add = (reference: string, via: SelectionVia) => {
    if (!selected.some((s) => s.reference === reference)) selected.push({ reference, via });
  };
  const t = norm(text);
  let all = false;

  if (opts.replyReference) add(opts.replyReference, "image_reply");
  // "El de la foto" / "la de la imagen" sin citarla: solo si se envió UNA sola foto (con varias, se pregunta).
  const fotos = [...new Set(opts.photoReferences ?? [])];
  if (!opts.replyReference && fotos.length === 1 && /\b(?:el|la|los|las)\s+de\s+la\s+(?:foto|imagen)\b/.test(t)) add(fotos[0], "image_reply");
  for (const r of opts.typedReferences ?? []) add(r.toUpperCase(), "reference");

  if (shown.length > 0) {
    const positions = new Set<number>();
    for (const [re, n] of ORDINALS) if (re.test(t)) positions.add(n);
    for (const m of t.matchAll(MARKED_NUMBER)) positions.add(Number(m[1]));
    if (LAST.test(t)) positions.add(shown.length);
    for (const p of [...positions].sort((a, b) => a - b)) if (p >= 1 && p <= shown.length) add(shown[p - 1].reference, "position");
    all = ((opts.lenguaje ? ALL_B28 : ALL).test(t) && shown.length > 1) || (!!opts.lenguaje && BOTH.test(t) && shown.length === 2);
    if (all) for (const s of shown) add(s.reference, "position");

    if (shown.length > 1) {
      // Solo palabras que distinguen a UNA opción de las demás.
      const words = tokens(text);
      const perItem = shown.map((s) => tokens(s.name));
      shown.forEach((s, i) => {
        const distinctive = [...perItem[i]].filter((w) => perItem.every((other, j) => j === i || !other.has(w)));
        if (distinctive.some((w) => words.has(w))) add(s.reference, "name");
      });
      // "El otro": dos opciones y una ya elegida => la que no.
      if (selected.length === 0 && OTHER.test(t) && shown.length === 2) {
        const previous = new Set(opts.previous ?? []);
        const chosen = shown.filter((x) => previous.has(x.reference));
        if (chosen.length === 1) add(shown.find((x) => !previous.has(x.reference))!.reference, "position");
      }
    } else if (shown.length === 1 && (DEICTIC.test(t) || QUANTITY_ONLY.test(t.trim()) || (!!opts.lenguaje && leerCantidad(text) !== null))) {
      // Una sola opción a la vista: "ese" o "quiero 3" no son ambiguos.
      add(shown[0].reference, "position");
    }
  }

  const deictic = DEICTIC.test(t);
  // Bloque 28: también "x2", "2 und", "eran 3", "no mejor 3", "uno más" (lib/agente/lenguaje).
  const quantityOnly = selected.length === 0 && (QUANTITY_ONLY.test(t.trim()) || (!!opts.lenguaje && leerCantidad(text) !== null));
  return { selected, deictic, quantityOnly, needsClarification: (deictic || quantityOnly) && selected.length === 0 && shown.length > 1, ...(all ? { all } : {}) };
}
