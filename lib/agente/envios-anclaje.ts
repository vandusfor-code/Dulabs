/**
 * FASE 3B.6 — ANCLAJE DE LO QUE EL MODELO DICE SOBRE ENVÍOS (anti-invención aplicada por CÓDIGO).
 *
 * Solo corre en un negocio que tiene reglas de envío (`checkout_opciones.envios`): ahí, todo lo que el texto del
 * modelo afirme sobre ENVÍOS tiene que estar respaldado por lo que `consultar_envio` devolvió EN ESTE TURNO (los hechos
 * del backend). Si no lo está, la respuesta no sale tal cual (el runtime pide corregirla una vez y, si persiste,
 * pasa la conversación a una persona). Se vigila:
 *   - tiempos: "hoy", "mañana", "mismo día", "N días", "N a M días", horas, "al día siguiente"… solo los que el negocio
 *     declaró; el mismo día solo como POSIBILIDAD ("puede") y solo si el motor la dio; nunca una garantía;
 *   - cobertura: "cubrimos / enviamos a / llegamos a / a todo el país" (solo con una ciudad confirmada como cubierta) y
 *     "no tenemos cobertura" (solo con una ciudad excluida); una ciudad que no se consultó en este turno no se afirma;
 *   - costo: "gratis / sin costo" solo si el negocio lo configuró; cualquier otro costo de envío no existe;
 *   - transportadora: solo la que el motor devolvió (la habitual del negocio, o la fijada para esa ciudad);
 *   - garantías: "te garantizo", "seguro llega", "sin falta"… nunca.
 * Las preguntas (¿te llega hoy?) no afirman nada y no cuentan. No toca nada si el negocio no usa el motor de envíos.
 */
import { plano } from "@/lib/agente/lenguaje/normalizar";
import { CIUDADES } from "@/lib/agente/lenguaje/lexico";
import type { ShippingDecision } from "@/lib/agente/envios";

/** Evidencia de envíos del turno: solo existe (`active`) cuando el negocio usa el motor de envíos. */
export interface ShippingEvidence {
  active: true;
  facts: ShippingDecision[];
}

export const emptyShippingEvidence = (): ShippingEvidence => ({ active: true, facts: [] });

const NUMERO_PALABRA: Readonly<Record<string, number>> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const NUM = "(\\d{1,2}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)";
const aNumero = (s: string): number => (/^\d+$/.test(s) ? Number(s) : (NUMERO_PALABRA[s] ?? -1));

/** Verbos de "esto llega / se entrega / sale": un tiempo solo es una afirmación de envío con uno de ellos o con "días". */
const VERBO_ENTREGA = /\b(llega|llegan|llegara|llegaran|llegaria|llegar|entrega|entregan|entregamos|entregaran|entregar|entregado|recibes|recibiras|recibiria|recibir|tendras|despacha|despachan|despachamos|despachado|sale|salimos|saldra|enviamos|envian|enviara|enviaran|enviado)\b/;
const COBERTURA_SI = /(?:\b(?:cubrimos|tenemos cobertura|llegamos a|llegamos hasta|enviamos a|enviamos hasta|hacemos envios? a|hacemos envios? hasta|despachamos a|envios a todo|enviamos a todo)\b|(?<!\bsi\s)\bhay cobertura\b)/;
/** Cobertura GENERAL ("a todo el país"): el hecho de una ciudad no la prueba; solo si el propio texto del negocio la dice. */
const NACIONAL = /\b(a nivel nacional|todo el pais|toda colombia|todo colombia|cualquier ciudad|todas las ciudades)\b/;
const COBERTURA_NO = /\b(no cubrimos|no tenemos cobertura|no hay cobertura|sin cobertura|fuera de (?:nuestra )?cobertura|no llegamos|no enviamos|no hacemos envios?|no despachamos)\b/;
const GRATIS = /\b(gratis|gratuito|gratuita|sin costo|sin cargo|no tiene costo|no tienen costo|no cobramos|cero costo|costo cero|no hay (?:ningun )?(?:costo|cargo))\b/;
const COSTO = /\b(cuesta|cuestan|costo|costos|valor|tarifa|cobramos|cobra|cobran|flete)\b/;
const CONTEXTO_ENVIO = /\b(envio|envios|flete|despacho|transporte)\b/;
const GARANTIA = /\b(te garantizo|garantizo|garantizamos|garantizado|garantizada|te aseguro|aseguramos|seguro que llega|seguro llega|sin falta|con certeza|con total seguridad|100 seguro|si o si)\b/;
const COTA = /\b(puede|pueden|podria|podrian|posible|posibilidad|podria ser|depende|sujeto|si pides antes|si lo pides antes|si haces tu pedido antes|antes de las)\b/;
const OTRA_ENTREGA = /\b(dia siguiente|siguiente dia|proximo dia habil|dia habil siguiente|al dia siguiente|pasado manana)\b/;
const TRANSPORTADORAS_CONOCIDAS = ["servientrega", "coordinadora", "interrapidisimo", "inter rapidisimo", "tcc", "deprisa", "domina", "saferbo", "fedex", "dhl", "mensajeros urbanos", "99 minutos", "olva", "speed"];
/** "la transportadora Mensajería Veloz", "con Transportadora de Prueba": un NOMBRE propio (con mayúscula) tras la palabra. */
const TRANSPORTADORA_PROPIA = /[Tt]ransportadora(?:\s+(?:de|del|la))?\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+){0,2})/g;

const sinEspacios = (s: string) => plano(s).replace(/\s+/g, "");
const palabra = (t: string, re: RegExp) => re.test(t);

/** Ciudades del léxico que el texto menciona (claves normalizadas). */
function ciudadesMencionadas(t: string): string[] {
  const out: string[] = [];
  for (const c of Object.keys(CIUDADES)) if (new RegExp(`(?:^|\\s)${c}(?:\\s|$)`).test(t)) out.push(c);
  return out;
}

function numerosDe(texto: string): number[] {
  const t = plano(texto);
  const out: number[] = [];
  for (const m of t.matchAll(new RegExp(`\\b${NUM}\\b`, "g"))) out.push(aNumero(m[1]));
  return out.filter((n) => n >= 0);
}

/**
 * Afirmaciones sobre envíos en `text` que los hechos del turno NO respaldan. [] = nada sin respaldo.
 * Cada elemento es un código estable (sin texto del cliente) para la traza y la corrección.
 */
export function checkShippingClaims(text: string, facts: readonly ShippingDecision[]): string[] {
  const out = new Set<string>();
  const consultadas = new Set(facts.flatMap((f) => (f.city ? [plano(f.city)] : [])));
  const permiteSameDay = facts.some((f) => f.same_day_possible);
  const gratis = facts.some((f) => f.free_shipping === true);
  const cubierta = facts.some((f) => f.status === "covered" && f.covered === true);
  const excluida = facts.some((f) => f.status === "not_covered");
  const textosDelNegocio = facts.map((f) => plano(f.customer_text ?? ""));
  const diasPermitidos = new Set<number>();
  for (const f of facts) {
    if (f.min_business_days !== null) diasPermitidos.add(f.min_business_days);
    if (f.max_business_days !== null) diasPermitidos.add(f.max_business_days);
  }
  for (const t of facts.map((f) => f.customer_text ?? "")) for (const n of numerosDe(t)) diasPermitidos.add(n);
  const transportadorasPermitidas = new Set(facts.flatMap((f) => [f.carrier, f.usual_carrier]).filter((x): x is string => !!x).map(sinEspacios));
  const dicePalabra = (palabraClave: string) => textosDelNegocio.some((t) => t.includes(palabraClave));

  for (const original of text.split(/(?<=[.!\n])\s*|(?=¿)/)) {
    if (original.includes("¿") || original.trim().endsWith("?")) continue;
    const t = plano(original);
    if (!t) continue;
    const entrega = palabra(t, VERBO_ENTREGA);

    // --- Garantías: ningún tiempo de entrega lo es.
    if (palabra(t, GARANTIA)) out.add("guarantee");

    // --- Tiempos. ("N días" solo cuenta con contexto de envío o entrega: "30 días de garantía" no es un tiempo de envío.)
    const contextoTiempo = entrega || palabra(t, CONTEXTO_ENVIO) || palabra(t, /\b(demora|demoran|tarda|tardan|habiles|plazo|llegada)\b/);
    let afirmaTiempo = false;
    if ((palabra(t, /\b(hoy|mismo dia|en el dia|dentro del dia|esta tarde|esta noche)\b/) && entrega) || palabra(t, /\b(hoy mismo|el mismo dia|mismo dia)\b/)) {
      afirmaTiempo = true;
      if (!permiteSameDay) out.add("same_day_unbacked");
      else if (!palabra(t, COTA)) out.add("same_day_unhedged");
    }
    if (palabra(t, /\bmanana\b/) && entrega) {
      afirmaTiempo = true;
      if (!dicePalabra("manana")) out.add("tomorrow_unbacked");
    }
    if (palabra(t, OTRA_ENTREGA)) {
      afirmaTiempo = true;
      if (!textosDelNegocio.some((x) => OTRA_ENTREGA.test(x))) out.add("next_day_unbacked");
    }
    if (contextoTiempo) {
      for (const m of t.matchAll(new RegExp(`\\b${NUM}(?:\\s+(?:a|o|y|al|hasta))?(?:\\s+${NUM})?\\s+dias?\\b`, "g"))) {
        afirmaTiempo = true;
        for (const n of [m[1], m[2]].filter(Boolean).map(aNumero)) if (!diasPermitidos.has(n)) out.add(`days:${n}`);
      }
      for (const m of t.matchAll(new RegExp(`\\b${NUM}\\s+horas?\\b`, "g"))) {
        afirmaTiempo = true;
        if (!textosDelNegocio.some((x) => new RegExp(`\\b${m[1]}\\s+horas?\\b`).test(x))) out.add(`hours:${aNumero(m[1])}`);
      }
    }

    // --- Cobertura (y que la ciudad de la que se habla sea una consultada en este turno).
    const noCubre = palabra(t, COBERTURA_NO);
    const afirmaCobertura = !noCubre && palabra(t, COBERTURA_SI);
    if (!noCubre && palabra(t, NACIONAL) && !dicePalabra("pais") && !dicePalabra("nacional")) out.add("national_coverage_unbacked");
    if (noCubre && !excluida) out.add("coverage_denied_unbacked");
    if (afirmaCobertura && !cubierta) out.add("coverage_unbacked");
    if (facts.length > 0 && (noCubre || afirmaCobertura || afirmaTiempo)) {
      for (const c of ciudadesMencionadas(t)) if (!consultadas.has(c)) out.add(`city_not_consulted:${c}`);
    }

    // --- Costo.
    const contextoEnvio = palabra(t, CONTEXTO_ENVIO);
    if (contextoEnvio && palabra(t, GRATIS)) {
      if (!gratis) out.add("free_shipping_unbacked");
    } else if (contextoEnvio && palabra(t, COSTO)) out.add("shipping_cost_unbacked");

    // --- Transportadora.
    const dicha = new Set<string>();
    for (const c of TRANSPORTADORAS_CONOCIDAS) if (new RegExp(`(?:^|\\s)${c}(?:\\s|$)`).test(t)) dicha.add(c.replace(/\s+/g, ""));
    for (const m of original.matchAll(TRANSPORTADORA_PROPIA)) dicha.add(sinEspacios(m[1]));
    for (const c of dicha) if (![...transportadorasPermitidas].some((p) => p === c || p.includes(c) || c.includes(p))) out.add(`carrier_unbacked:${c}`);
  }
  return [...out];
}
