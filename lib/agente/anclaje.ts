/**
 * ANCLAJE de la respuesta final (anti-alucinación aplicada por CÓDIGO).
 *
 * Antes de enviar, se extraen del texto del modelo:
 *   - referencias (DL-000184) e ids de pedido (DL-ORD-…),
 *   - montos en pesos ($58.000, 58 mil, COP 58000),
 *   - cantidades de unidades ("3 unidades", "2 disponibles"),
 *   - enlaces (https://…, www.…),
 * y cada una debe aparecer en la EVIDENCIA del turno: resultados de las
 * herramientas, el estado confiable de la conversación o el propio mensaje
 * del cliente (si él escribió "quiero 3", el modelo puede repetir "3").
 * Cualquier dato comercial sin respaldo => la respuesta NO se envía tal cual.
 * Un enlace solo se respalda con uno que devolvió el BACKEND (get_catalog_link):
 * nunca con uno que escribió el cliente (evita repetir un link de phishing).
 */

const REF = /\b([A-Z]{1,6}-\d{6,}|DL-ORD-[0-9A-HJKMNP-TV-Z]{6})\b/g;
const PESOS = /(?:\$|COP\s?)\s?(\d{1,3}(?:[.,]\d{3})+|\d+)(?![\d.,]*\s*mil)/gi;
const MIL = /\$?\s?(\d{1,4}(?:[.,]\d{1,3})?)\s*mil\b/gi;
const UNIDADES = /\b(\d{1,6})\s+(?:unidad(?:es)?|disponibles?|piezas?)\b/gi;
/** Números con separador de miles ("58.000 pesos", "1.250.000"): en esta conversación siempre son montos. */
const MILES = /\b\d{1,3}(?:\.\d{3})+\b/g;
/** Enlaces: con esquema o empezando por www. (el signo final de la frase no es parte del enlace). */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'()]+/gi;
const cleanUrl = (u: string) => u.replace(/[.,;:!?*_)\]]+$/, "");

export interface Evidence {
  refs: Set<string>;
  /** Números que devolvió el BACKEND (únicos que respaldan montos). */
  numbers: Set<number>;
  /** Cantidades que escribió el cliente (respaldan "3 unidades", nunca un precio). */
  customerNumbers: Set<number>;
  /** Enlaces que devolvió el backend (únicos que se pueden enviar). */
  urls: Set<string>;
}

export function emptyEvidence(): Evidence {
  return { refs: new Set(), numbers: new Set(), customerNumbers: new Set(), urls: new Set() };
}

const toInt = (s: string) => Number(s.replace(/[.,]/g, ""));

/** Montos, referencias y números mencionados en un texto (para evidencia de mensajes del backend o del cliente). */
function harvestText(text: string, ev: Evidence) {
  for (const m of text.matchAll(URL_PATTERN)) ev.urls.add(cleanUrl(m[0]));
  for (const m of text.toUpperCase().matchAll(REF)) ev.refs.add(m[1]);
  for (const m of text.matchAll(PESOS)) ev.numbers.add(toInt(m[1]));
  for (const m of text.matchAll(/\b\d{1,9}\b/g)) ev.numbers.add(Number(m[0]));
}

/** Agrega TODO lo que devolvió el backend (números, referencias, montos dentro de mensajes). */
export function addEvidence(value: unknown, ev: Evidence, depth = 0): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === "number") {
    if (Number.isFinite(value) && value >= 0) ev.numbers.add(Math.round(value));
    return;
  }
  if (typeof value === "string") {
    harvestText(value, ev);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) addEvidence(v, ev, depth + 1);
    return;
  }
  if (typeof value === "object") for (const v of Object.values(value as Record<string, unknown>)) addEvidence(v, ev, depth + 1);
}

/**
 * Lo que escribió el cliente respalda repetir SUS referencias y cantidades,
 * pero nunca un monto: "¿cuesta 30 mil?" no convierte 30.000 en un precio.
 */
export function addCustomerEvidence(text: string, ev: Evidence): void {
  for (const m of text.toUpperCase().matchAll(REF)) ev.refs.add(m[1]);
  for (const m of text.matchAll(/\b\d{1,3}\b/g)) ev.customerNumbers.add(Number(m[0]));
}

export type GroundingViolation = { kind: "reference" | "amount" | "quantity" | "link"; value: string };

export function checkGrounding(text: string, ev: Evidence): { ok: boolean; violations: GroundingViolation[] } {
  const violations: GroundingViolation[] = [];
  const seen = new Set<string>();
  const add = (v: GroundingViolation, id: string | number = v.value) => {
    const k = `${v.kind}:${id}`;
    if (!seen.has(k)) {
      seen.add(k);
      violations.push(v);
    }
  };
  for (const m of text.matchAll(URL_PATTERN)) {
    const url = cleanUrl(m[0]);
    if (!ev.urls.has(url)) add({ kind: "link", value: url.slice(0, 80) });
  }
  // Las referencias dentro de un enlace ya validado (ficha del producto) no se cuentan aparte.
  const withoutUrls = text.replace(URL_PATTERN, " ");
  for (const m of withoutUrls.toUpperCase().matchAll(REF)) if (!ev.refs.has(m[1])) add({ kind: "reference", value: m[1] });
  for (const m of withoutUrls.matchAll(PESOS)) {
    const n = toInt(m[1]);
    if (!ev.numbers.has(n)) add({ kind: "amount", value: m[0].trim() }, n);
  }
  for (const m of withoutUrls.matchAll(MILES)) {
    const n = toInt(m[0]);
    if (!ev.numbers.has(n)) add({ kind: "amount", value: m[0] }, n);
  }
  for (const m of withoutUrls.matchAll(MIL)) {
    const n = Math.round(Number(m[1].replace(",", ".")) * 1000);
    if (!ev.numbers.has(n)) add({ kind: "amount", value: m[0].trim() }, n);
  }
  for (const m of withoutUrls.matchAll(UNIDADES)) {
    const n = Number(m[1]);
    if (!ev.numbers.has(n) && !ev.customerNumbers.has(n)) add({ kind: "quantity", value: m[0].trim() });
  }
  return { ok: violations.length === 0, violations };
}
