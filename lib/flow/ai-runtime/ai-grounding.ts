/**
 * Anti-invención (Business Agent) — barrera de FUNDAMENTACIÓN de la respuesta de IA.
 *
 * El filtro de afirmaciones externas (external-claim-security) es heurístico y solo mira palabras de dominio
 * ("cita", "reserva", "pago"...): no ve un precio, un descuento, un servicio o una política inventados. Esta barrera
 * cierra ese hueco para los nodos `respond` que declaran `grounding` (ver AiGroundingConfig):
 *   1. VERBATIM: el texto que ve el cliente lo redactó el BACKEND; la IA ni se invoca.
 *   2. FUNDAMENTADA: si la IA redacta, cada cifra/hora/enlace y cada promesa comercial de su texto debe salir de las
 *      variables-fuente; si no, se usa el texto del backend de respaldo (o se rechaza y va a la rama de fallo).
 * Puro (sin red/BD): entra config + variables + resultado del dispatch, sale un resultado.
 */
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchResult } from "@/lib/flow/executor-types";
import type { AiNodeConfig } from "@/lib/flow/types";

// ---------------------------------------------------------------------------
// Texto de variables
// ---------------------------------------------------------------------------

function textoDeVariable(variables: Record<string, unknown>, key: string): string {
  const v = variables[key];
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string").join("\n").trim();
  return "";
}

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Cifras: precios, horas, porcentajes, teléfonos... (todo dígito que el cliente pueda tomar como un hecho)
// ---------------------------------------------------------------------------

const NUMERO = /\d[\d.,:]*\d|\d/g;

/** Forma canónica de una cifra: "45.000" y "45,000" -> "45000"; "08:00" -> "8:00"; "12,5" -> "12.5". */
function canonicaNumero(tok: string): string {
  const t = tok.replace(/[.,:]+$/g, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return t.replace(/[.,]/g, "");
  const hora = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (hora) return `${Number(hora[1])}:${hora[2]}`;
  const decimal = /^(\d+)[.,](\d{1,2})$/.exec(t);
  if (decimal) return `${decimal[1]}.${decimal[2]}`;
  return t.replace(/^0+(?=\d)/, "");
}

function cifras(texto: string): string[] {
  return (texto.match(NUMERO) ?? []).map(canonicaNumero).filter(Boolean);
}

/** Cifras aceptadas de una fuente: las suyas + "8" para "8:00" y "8:00" para "8" (la misma hora escrita distinto). */
function cifrasRespaldadas(fuente: string): Set<string> {
  const set = new Set<string>();
  for (const c of cifras(fuente)) {
    set.add(c);
    const h = /^(\d{1,2}):00$/.exec(c);
    if (h) set.add(h[1]!);
    if (/^\d{1,2}$/.test(c)) set.add(`${Number(c)}:00`);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Enlaces y correos
// ---------------------------------------------------------------------------

const ENLACE = /(?:https?:\/\/|www\.)[^\s)>\]]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi;

function enlaces(texto: string): string[] {
  return (texto.match(ENLACE) ?? []).map((e) => e.toLowerCase().replace(/[.,;:!?]+$/g, ""));
}

// ---------------------------------------------------------------------------
// Palabras: promesas comerciales y términos de contenido
// ---------------------------------------------------------------------------

/**
 * Términos con los que un modelo suele "adornar" un negocio con beneficios que nadie configuró. Si aparecen en la
 * respuesta, DEBEN estar en la fuente (comparación por raíz de 5 letras).
 */
const RAICES_COMERCIALES = [
  "descu", "promo", "ofert", "gratu", "grati", "garan", "envio", "domic", "reemb", "devol", "finan", "cuota", "credi",
  "obseq", "regal", "cupon", "bonif", "premi", "sorte", "cashb", "membr", "afili", "sucur", "sedes", "aceptam", "efect",
  "tarje", "trans", "nequi", "bitco", "crypt", "cript", "dolar", "euros", "iva", "impue", "inclu",
  // Días y meses: un horario o una fecha con un día que la fuente no trae es un hecho inventado.
  "lunes", "marte", "mierc", "jueve", "viern", "sabad", "domin", "festi", "enero", "febre", "marzo", "abril", "mayo", "junio",
  "julio", "agost", "septi", "octub", "novie", "dicie",
];

/** Cifras escritas con letras (un modelo puede evitar los dígitos). "uno/una/dos/tres" son de uso corriente: no cuentan. */
const NUMERO_EN_LETRAS = /\b(cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|veinticinco|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|quinientos|mil|millon|millones)\b/g;

/** Palabras de relleno / cortesía que no son "hechos": se ignoran al medir cuánto del texto está respaldado. */
const RELLENO = new Set(
  [
    "claro", "gracias", "puedo", "puedes", "puede", "pueden", "ayudar", "ayuda", "ayudarte", "ayudarle", "favor", "gusto",
    "informacion", "segun", "negocio", "siempre", "tambien", "ademas", "nuestro", "nuestra", "nuestros", "nuestras",
    "cualquier", "consulta", "consultas", "pregunta", "preguntas", "quieres", "quiere", "quieras", "desees", "desea",
    "necesites", "necesita", "dime", "cuentame", "cuentanos", "hola", "buenos", "buenas", "tardes", "noches", "saludos",
    "equipo", "disponible", "disponibles", "atencion", "atender", "atendemos", "puedes", "aqui", "estamos", "estoy", "estos",
    "estas", "esto", "esta", "este", "sobre", "entre", "hasta", "desde", "donde", "cuando", "como", "cual", "cuales",
    "cuanto", "cuantos", "quien", "tienes", "tiene", "tenemos", "tener", "hacer", "hacemos", "hacen", "sido", "serian",
    "seria", "podemos", "podria", "podrias", "podrian", "manera", "forma", "ejemplo", "datos", "dato", "detalle", "detalles",
    "informar", "informarte", "comentar", "recuerda", "recuerdo", "tomar", "toma", "tener", "cuenta", "cuentas", "mensaje",
    "respuesta", "responder", "responde", "pedir", "pides", "pidas", "solicitar", "indicar", "indica", "indicame", "mejor",
    "bueno", "buena", "buenisimo", "excelente", "perfecto", "listo", "vamos", "sigue", "siguiente", "pronto", "ahora", "todavia",
    "todos", "todas", "todo", "toda", "cada", "algun", "alguna", "algunos", "algunas", "otro", "otra", "otros", "otras",
    "mismo", "misma", "solo", "unicamente", "mucho", "mucha", "muchos", "muchas", "poco", "poca", "pocos", "pocas", "nada",
    "nadie", "alguien", "algo", "cosas", "cosa", "parte", "partes", "lugar", "momento", "vez", "veces", "dias", "dia",
    "escribenos", "escribeme", "escribe", "llamanos", "llamame", "visitanos", "visita", "contactanos", "contacta", "comunicate", "comunicanos",
  ].map(sinAcentos),
);

function raiz(palabra: string): string {
  return palabra.slice(0, 5);
}

function palabrasSignificativas(texto: string): string[] {
  const out: string[] = [];
  for (const w of sinAcentos(texto).match(/[a-z0-9ñ]+/g) ?? []) {
    if (w.length < 5) continue;
    if (/^\d+$/.test(w)) continue;
    if (RELLENO.has(w)) continue;
    out.push(w);
  }
  return out;
}

/** Palabras con mayúscula inicial que NO abren frase (p. ej. "Nequi" en "aceptamos Nequi"), de 4+ letras. */
function nombresPropios(texto: string): string[] {
  const out: string[] = [];
  const re = /[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{3,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const antes = texto.slice(0, m.index).replace(/[\s"'«»(*_]+$/, "");
    if (antes === "" || /[.!?¿¡:\n]$/.test(antes)) continue; // inicio de frase: la mayúscula es ortográfica
    out.push(m[0]);
  }
  return out;
}

function raicesDe(texto: string): Set<string> {
  const set = new Set<string>();
  for (const w of sinAcentos(texto).match(/[a-z0-9ñ]+/g) ?? []) if (w.length >= 3) set.add(raiz(w));
  return set;
}

// ---------------------------------------------------------------------------
// Verificación
// ---------------------------------------------------------------------------

export type GroundingCheck = { ok: true } | { ok: false; reason: string };

/** Máximo de términos de contenido sin respaldo tolerados (redacción propia: sinónimos). Respuesta corta => ninguno. */
function tolerancia(significativas: number): number {
  return Math.floor(significativas * 0.34);
}

/** ¿Todo hecho concreto de `respuesta` está respaldado por `fuentes`? */
export function checkGrounding(respuesta: string, fuentes: string[], permitidos: string[] = []): GroundingCheck {
  const fuente = fuentes.filter((f) => f.trim()).join("\n");
  if (!fuente.trim()) return { ok: false, reason: "sin_fuente" };

  // 1) Cifras (precios, horas, porcentajes, teléfonos): cada una debe estar en la fuente. Las viñetas "1." / "2)" al
  //    inicio de línea son numeración de la lista, no un hecho.
  const sinViñetas = respuesta.replace(/^\s*\d{1,2}\s*[.)]\s+/gm, "");
  const respaldadas = cifrasRespaldadas(fuente);
  for (const c of cifras(sinViñetas)) {
    if (!respaldadas.has(c)) return { ok: false, reason: `cifra_sin_respaldo:${c}` };
  }

  // 2) Enlaces y correos.
  const enlacesFuente = new Set(enlaces(fuente));
  for (const e of enlaces(respuesta)) {
    if (!enlacesFuente.has(e)) return { ok: false, reason: `enlace_sin_respaldo:${e}` };
  }

  // 2b) Cifras escritas con letras ("cinco mil").
  const enLetrasFuente = new Set(sinAcentos(fuente).match(NUMERO_EN_LETRAS) ?? []);
  for (const n of sinAcentos(respuesta).match(NUMERO_EN_LETRAS) ?? []) {
    if (!enLetrasFuente.has(n)) return { ok: false, reason: `cifra_sin_respaldo:${n}` };
  }

  // 3) Promesas comerciales (descuento, garantía, domicilio, envío...): si la respuesta las menciona, la fuente también.
  const raicesFuente = raicesDe(fuente);
  const raicesRespuesta = raicesDe(respuesta);
  const coincide = (x: string, rr: string): boolean => x.startsWith(rr) || (x.length >= 4 && rr.startsWith(x));
  for (const r of RAICES_COMERCIALES) {
    const rr = raiz(r);
    if ([...raicesRespuesta].some((x) => coincide(x, rr)) && ![...raicesFuente].some((x) => coincide(x, rr))) {
      return { ok: false, reason: `promesa_sin_respaldo:${r}` };
    }
  }

  // 3b) Nombres propios (marcas, medios de pago, lugares) que la fuente no trae: "aceptamos Nequi y Daviplata" con Daviplata
  //     inventado pasa por léxico común; el nombre propio lo delata. (Nombre del cliente y demás `permitidos` se exceptúan.)
  const raicesPermitidas = raicesDe(permitidos.join(" "));
  for (const nombre of nombresPropios(respuesta)) {
    const r = raiz(sinAcentos(nombre));
    if (!raicesFuente.has(r) && !raicesPermitidas.has(r)) return { ok: false, reason: `nombre_propio_sin_respaldo:${nombre}` };
  }

  // 4) Términos de contenido: solo una pequeña parte de lo que dice puede quedar fuera de la fuente.
  const signif = palabrasSignificativas(respuesta);
  const sinRespaldo = signif.filter((w) => !raicesFuente.has(raiz(w)));
  if (sinRespaldo.length > tolerancia(signif.length)) {
    return { ok: false, reason: `terminos_sin_respaldo:${[...new Set(sinRespaldo)].slice(0, 4).join(",")}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Integración con el orquestador
// ---------------------------------------------------------------------------

const RECHAZO = EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED;

function resultadoConTexto(text: string, marca: Record<string, unknown>): EffectDispatchResult {
  const data = { responseText: text, ...marca };
  return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
}

/**
 * Paso previo al dispatch. Si el nodo declara `verbatimFrom` y el backend ya redactó el texto, ESE es el resultado (la IA
 * no se invoca). Devuelve null cuando el nodo no es de este tipo o debe pasar por la IA (con `groundedIn`).
 */
export function planAiVerbatim(ai: AiNodeConfig | undefined, variables: Record<string, unknown>): EffectDispatchResult | null {
  const g = ai?.grounding;
  if (!ai || ai.mode !== "respond" || !g?.verbatimFrom) return null;
  const texto = textoDeVariable(variables, g.verbatimFrom);
  if (texto) return resultadoConTexto(texto, { grounding: "verbatim", groundingSource: g.verbatimFrom });
  if ((g.groundedIn?.length ?? 0) > 0) return null; // sin texto exacto: redacta la IA, pero fundamentada
  return {
    success: false,
    classification: RECHAZO,
    error: "ungrounded_response:verbatim_source_missing",
    metadata: { groundingBlocked: true, groundingSource: g.verbatimFrom },
  };
}

/** Paso posterior al dispatch: valida lo que redactó la IA contra las fuentes; respalda con el texto del backend. */
export function applyAiGrounding(input: {
  dispatchResult: EffectDispatchResult;
  ai: AiNodeConfig | undefined;
  variables: Record<string, unknown>;
}): EffectDispatchResult {
  const { dispatchResult, ai, variables } = input;
  const g = ai?.grounding;
  if (!ai || ai.mode !== "respond" || !g || !dispatchResult.success) return dispatchResult;
  const data = (dispatchResult.appliedResult ?? dispatchResult.data ?? {}) as Record<string, unknown>;
  if (data.grounding === "verbatim") return dispatchResult; // ya es texto del backend
  const respuesta = typeof data.responseText === "string" ? data.responseText.trim() : "";
  if (!respuesta) return dispatchResult;

  const fuentes = (g.groundedIn ?? []).map((k) => textoDeVariable(variables, k));
  // `verbatimFrom` sin `groundedIn` y sin texto ya se rechazó en planAiVerbatim; aquí solo llega redacción fundamentada.
  // El saludo por el nombre del cliente ("Hola, Carolina") no es un dato inventado.
  const permitidos = ["customer_name", "nombreCliente"].map((k) => textoDeVariable(variables, k)).filter(Boolean);
  const check = checkGrounding(respuesta, fuentes, permitidos);
  if (check.ok) return dispatchResult;

  const respaldo = g.fallbackFrom ? textoDeVariable(variables, g.fallbackFrom) : "";
  if (respaldo) {
    return {
      ...resultadoConTexto(respaldo, { grounding: "fallback", groundingSource: g.fallbackFrom }),
      metadata: { ...dispatchResult.metadata, groundingFallback: true, groundingReason: check.reason, blockedTextPreview: respuesta.slice(0, 120) },
    };
  }
  const sanitized = { ...data };
  delete sanitized.responseText;
  return {
    ...dispatchResult,
    success: false,
    classification: RECHAZO,
    error: `ungrounded_response:${check.reason}`,
    data: sanitized,
    appliedResult: sanitized,
    metadata: { ...dispatchResult.metadata, groundingBlocked: true, groundingReason: check.reason, blockedTextPreview: respuesta.slice(0, 120) },
  };
}
