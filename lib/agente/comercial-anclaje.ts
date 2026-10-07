/**
 * BLOQUE 29 · PR 5 — ANCLAJE DE LO QUE EL MODELO DICE SOBRE LO COMERCIAL (anti-invención aplicada por CÓDIGO).
 *
 * Solo corre en un negocio que tiene alguna herramienta comercial (consultar_ofertas, consultar_combos, consultar_campanas, consultar_contenido_comercial) en la
 * lista de su número: ahí, todo lo que el texto del modelo afirme sobre ofertas, descuentos, porcentajes, combos, campañas, vigencias y cifras de políticas tiene
 * que estar respaldado por lo que esas herramientas (o las vistas de producto del catálogo) devolvieron EN ESTE TURNO. Si no lo está, la respuesta no sale tal
 * cual: el runtime pide corregirla una vez y, si persiste, pasa la conversación a una persona con un mensaje fijo. Se vigila (códigos estables, sin texto del cliente):
 *   - percent_unbacked        un porcentaje («20%», «veinte por ciento») que ninguna herramienta devolvió;
 *   - discount_unbacked       «tenemos descuentos / promociones / ofertas» sin ninguna oferta, combo o campaña respaldada en el turno;
 *   - offer_unbacked          una oferta o promoción con un nombre que ninguna herramienta devolvió («la oferta Black Friday»), o «2x1» sin respaldo;
 *   - combo_unbacked          «tenemos combos» sin un combo respaldado, o un combo con un nombre que no se devolvió;
 *   - campaign_unbacked       una campaña o temporada (Navidad, Amor y Amistad, Black Friday…) que ninguna herramienta devolvió;
 *   - absence_unbacked        «no tenemos promociones / combos / campañas» sin que la herramienta correspondiente haya devuelto `empty: true` en el turno;
 *   - validity_unbacked       una fecha o un plazo de vigencia («hasta el 31 de octubre», «solo por hoy») que no está en lo devuelto;
 *   - wholesale_leak          a un cliente DETAL, un precio, descuento, combo o catálogo mayorista (con cifra);
 *   - policy_figure_unbacked  un plazo o cifra de política («30 días de garantía») que ningún texto devuelto contiene.
 * Las preguntas y las negaciones o condicionales («si hay promociones te aviso») no afirman nada y no cuentan. Una cifra que ESCRIBIÓ el cliente y que la frase NIEGA
 * («no es del 50 %», «no puedo aplicar el 40 %») tampoco: repetirla para rechazarla no la afirma (hallazgo de la evaluación con Gemini real). No toca nada si el negocio
 * no usa las herramientas comerciales.
 *
 * LÍMITE HONESTO: la guarda verifica cifras, montos, porcentajes, plazos, fechas y nombres, y qué categorías de ofertas existen; NO puede demostrar cualquier
 * paráfrasis cualitativa de una política. Mitigación: las políticas se devuelven como un texto oficial a citar tal cual, la guarda vigila toda cifra o plazo, y la
 * evaluación con Gemini real mide el resto.
 */
import { esHerramientaComercial, type HerramientaComercial } from "@/lib/agente/nombres-herramientas";

/** Lo que devolvió una herramienta comercial en el turno (la respuesta ESTRUCTURADA del backend). */
export interface HechoComercial {
  tool: HerramientaComercial;
  data: Record<string, unknown>;
}

/** Evidencia comercial del turno: solo existe (`active`) cuando el negocio usa las herramientas comerciales. */
export interface ComercialEvidence {
  active: true;
  /** Canal de la conversación (lo decide el backend): solo a un cliente DETAL se le vigila la fuga mayorista. */
  channel: "retail" | "wholesale";
  /** Las respuestas de las herramientas comerciales de este turno. */
  facts: HechoComercial[];
  /** TODO texto que devolvió cualquier herramienta en este turno (respalda cifras, plazos, fechas y nombres). */
  texts: string[];
  /** Nombres de las ofertas que traen adjuntas las vistas de producto del catálogo (un producto con `offer`): también respaldan «tiene descuento». */
  productOffers: string[];
}

export const emptyComercialEvidence = (channel: "retail" | "wholesale"): ComercialEvidence => ({ active: true, channel, facts: [], texts: [], productOffers: [] });

/** Guarda lo que devolvió una herramienta comercial (solo si la salida es un objeto: una falla no respalda nada). */
export function registrarHechoComercial(ev: ComercialEvidence | undefined, tool: string, data: unknown): void {
  if (!ev || !esHerramientaComercial(tool) || typeof data !== "object" || data === null || Array.isArray(data)) return;
  ev.facts.push({ tool, data: data as Record<string, unknown> });
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

const fold = (s: string): string => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const SEP_MILES = "\u0001";

/** Oraciones afirmativas: sin preguntas. («$80.000» y «20.5» no parten la oración.) */
function oraciones(text: string): string[] {
  const protegido = text.replace(/(\d)[.,](\d)/g, `$1${SEP_MILES}$2`);
  return protegido
    .split(/(?<=[.!\n])\s*|(?=¿)/)
    .map((o) => o.split(SEP_MILES).join("."))
    .filter((o) => o.trim() !== "" && !o.includes("¿") && !o.trim().endsWith("?"));
}

const NEGACION = /\b(no|ni|sin|nunca|jamas|tampoco|ningun|ninguna|ninguno|todavia no|aun no)\b/;
/** Condicionales y deseos: no afirman que algo exista («si hay promociones te aviso», «cuando tengamos combos»). */
const HIPOTETICA = /\b(si hay|si tienes|si quieres|si deseas|si te interesa|cuando haya|cuando tengamos|cuando salga|en caso de|por si|ojala|quiza|quizas|tal vez|podria haber|puede haber|pueden haber|te aviso|te avisamos|avisarte)\b/;

const PROMO = /\b(descuentos?|rebajas?|promocion(?:es)?|promos?|ofertas?|ofertazo|2x1|3x2|liquidacion|precios? especial(?:es)?|black friday|cyber ?monday)\b/;
const COMBO = /\bcombos?\b/;
const CAMPANA = /\bcampanas?\b/;
const ABSENCIA = /\b(?:no\s+(?:hay|tenemos|tengo|contamos\s+con|manejamos|ofrecemos|existen?|se\s+manejan|cuenta\s+con|tiene[ns]?)|ninguna?|por\s+ahora\s+no|actualmente\s+no|en\s+este\s+momento\s+no)\b([^.!?\n]{0,70}?)\b(descuentos?|rebajas?|promocion(?:es)?|promos?|ofertas?|combos?|campanas?)\b/;
/** «no tengo información de promociones» NO es afirmar que no existen: es no saber. */
const SIN_DATO = /\b(informacion|datos?|detalles?|certeza|confirmad[oa]|conocimiento|acceso|a la mano|cerca|historial|registro|registros|antecedentes|memoria|recuerdo|archivo)\b/;
/**
 * Negar un descuento CALIFICADO («no manejamos un descuento ADICIONAL», «por pago de contado no hay descuento», «no hay un 50% de descuento», «no tenemos otros combos») no es afirmar que no existe
 * ninguno: solo se permite si la herramienta de ese tema SÍ se consultó en el turno (con resultados o vacía); sin consulta, sigue siendo una ausencia sin respaldo.
 */
const CALIFICA_ANTES = /\b(otr[oa]s?|adicional(?:es)?|extra|extras|aparte|distint[oa]s?|especial(?:es)?)\b|\d\s?%|\d\s*por\s*ciento|\$\s?\d/;
const CALIFICA_DESPUES = /^\s+(?:(?:del?\s+)?\d{1,3}\s?(?:%|por\s*ciento)|adicional(?:es)?|extras?|especial(?:es)?|aparte|distint[oa]s?|otr[oa]s?|mayor(?:es)?|por\s+(?:volumen|cantidad|pago|contado|compras?|mayor)|para\s+(?:pago|compras?|contado))\b/;
const CALIFICA_ORACION = /\bpor\s+(?:pago|contado|volumen|cantidad|compras?|mayor)\b/;
/** «no es del», «no puedo aplicar el», «no hay un»: la negación va pegada a la cifra (sin coma ni punto de por medio). */
const NIEGA_CIFRA = /\b(?:no|ni|sin|nunca|jamas|tampoco)\s+(?:es|era|fue|seria|serian|son|hay|existe|existen|tenemos|tengo|manejamos|ofrecemos|aplica|aplicamos|corresponde|trabajamos|contamos\s+con|puedo\s+(?:aplicar|dar|ofrecer|confirmar|prometer|garantizar|hacer)|podemos\s+(?:aplicar|dar|ofrecer|confirmar|prometer|garantizar|hacer)|del?|al)\b[^.!?\n,;]*$/;

const MESES = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
const FECHA = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MESES})\\b`, "g");
const HASTA_DIA = /\bhasta\s+el\s+(\d{1,2})\b(?!\s+de\b)/g;
/** «hasta el 20 de noviembre», «del 25 de octubre al 31 de octubre»: una fecha de «hasta» o de rango SIEMPRE afirma una vigencia, aunque la oración no diga «promoción». */
const HASTA_FECHA = new RegExp(`\\bhasta\\s+(?:el\\s+)?\\d{1,2}\\s+de\\s+(?:${MESES})\\b`);
const RANGO_FECHAS = new RegExp(`\\bdel?\\s+\\d{1,2}\\s+de\\s+(?:${MESES})(?:\\s+de\\s+\\d{4})?\\s+(?:al|a|hasta)\\s+(?:el\\s+)?\\d{1,2}\\s+de\\s+(?:${MESES})\\b`);
/** «sigue vigente», «vigente hasta», «válida hasta», «vence»: afirmar la vigencia de algo (casi siempre una promoción). */
const VIGENCIA_CUE = /\b(vigente|vigentes|vigencia|valido|valida|validos|validas|vence|vencen|vencimiento|termina|terminan|rige|aplica hasta|disponible hasta)\b/;
/** «sigue vigente», «todavía está vigente»: afirmar que algo comercial CONTINÚA (sin respaldo, es un descuento o una promoción que no existe). */
const CONTINUA_VIGENTE = /\b(?:sigue|siguen|continua|continuan|todavia\s+(?:esta|estan)|aun\s+(?:esta|estan))\s+(?:\w+\s+){0,2}?vigentes?\b/;
const URGENCIA = /\b(solo\s+(?:por\s+)?(?:hoy|manana)|hasta\s+(?:hoy|manana|el\s+(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)|fin\s+de\s+semana)|este\s+fin\s+de\s+semana|esta\s+semana|ultimos\s+(?:dias|horas)|ultimas\s+(?:horas|unidades)|por\s+tiempo\s+limitado|vence\s+(?:hoy|manana)|termina\s+(?:hoy|manana))\b/g;

const NUMERO_PALABRA: Readonly<Record<string, number>> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15, veinte: 20, veinticinco: 25, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100 };
const NUM = "\\d{1,3}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|veinticinco|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien";
const aNumero = (s: string): number => (/^\d+$/.test(s) ? Number(s) : (NUMERO_PALABRA[s] ?? -1));
const UNIDAD = "dias?|horas?|semanas?|meses|mes|anos?";
const PLAZO = new RegExp(`\\b(${NUM})(?:\\s+(?:a|o|y|al|hasta)\\s+(${NUM}))?\\s+(${UNIDAD})\\b`, "g");
const CUE_POLITICA = /\b(garantia|garantias|garantizamos|cambio|cambios|devolucion|devoluciones|reclamo|reclamos|plazo|plazos|separar|separamos|apartar|apartamos|apartado|reserva|reservamos|abono|abonos|anticipo|vigencia|valido|valida|vence|demora|demoran|tarda|tardan|entrega|entregamos|llega|llegan|envio|envios|despacho|despachamos|duracion|durabilidad)\b/;
const CUE_ENVIO = /\b(envio|envios|entrega|entregamos|llega|llegan|despacho|despachamos|demora|demoran|tarda|tardan|transportadora)\b/;

const PORCENTAJE = /(\d{1,3}(?:[.,]\d{1,2})?)\s?(?:%|por\s?ciento)/g;
const PORCENTAJE_PALABRA = new RegExp(`\\b(${NUM})\\s+por\\s?ciento\\b`, "g");
const MULTI = /\b(\d)\s?x\s?(\d)\b/g;
const MAYORISTA = /\b(mayorista|mayoristas|por mayor|al por mayor)\b/;
const CUE_PRECIO = /\b(precio|precios|valor|valores|cuesta|cuestan|catalogo|descuento|descuentos|oferta|ofertas|promocion|promociones|combo|combos)\b/;
const MINIMO = /\b(compra inicial|inversion inicial|propuesta de compra|minimo|minima|inicial)\b/;
const MONTO = /(?:\$|cop\s?)\s?\d|\b\d{1,3}(?:\.\d{3})+\b|\b\d{1,4}\s*mil\b/;

/** Temporadas y fechas especiales: nombrarlas junto a una promoción o campaña exige que lo devuelto las contenga. */
const TEMPORADAS = ["amor y amistad", "navidad", "black friday", "cyber monday", "dia de la madre", "dia del padre", "dia de la mujer", "dia del amor", "san valentin", "halloween", "fin de ano", "dia del hombre", "dia de los ninos"];

/** Nombre propio tras «oferta / promoción / campaña / combo»: la secuencia que empieza en mayúscula (con conectores) o va entre comillas. */
const NOMBRE_TRAS_CUE = /\b(oferta|ofertas|promoci[oó]n|promociones|promo|campa[nñ]a|campa[nñ]as|combo|combos)\s+(?:(?:de|del|por|para)\s+(?:la\s+|el\s+)?)?[«"“]?([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]*(?:\s+(?:(?:y|de|del|la|el|los|las|para|por|e)\s+){0,2}[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]*){0,4})/g;
const NO_ES_NOMBRE = new Set(["hoy", "manana", "ti", "ellos", "ellas", "ustedes", "nosotros", "nuestros", "nuestras", "nuestro", "nuestra", "colombia", "whatsapp", "dulabs", "vigentes", "vigente", "especial", "especiales", "disponibles", "disponible", "activa", "activas", "actuales", "actual", "ahora", "mayoristas", "mayorista", "detal"]);

// ---------------------------------------------------------------------------
// Evidencia derivada
// ---------------------------------------------------------------------------

function arr(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null) : [];
}
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

interface Respaldo {
  texto: string;
  porcentajes: Set<number>;
  fechas: Set<string>;
  diasDeFecha: Set<number>;
  nombres: string[];
  hayOfertas: boolean;
  hayCombos: boolean;
  hayCampanas: boolean;
  hayPromo: boolean;
  vacias: { ofertas: boolean; combos: boolean; campanas: boolean };
}

function porcentajesEn(texto: string, out: Set<number>): void {
  for (const m of fold(texto).matchAll(PORCENTAJE)) out.add(Number(m[1].replace(",", ".")));
  for (const m of fold(texto).matchAll(PORCENTAJE_PALABRA)) out.add(aNumero(m[1]));
}

function respaldoDe(ev: ComercialEvidence): Respaldo {
  const texto = fold(ev.texts.join("\n"));
  const porcentajes = new Set<number>();
  const fechas = new Set<string>();
  const diasDeFecha = new Set<number>();
  for (const t of ev.texts) porcentajesEn(t, porcentajes);
  for (const m of texto.matchAll(FECHA)) {
    fechas.add(`${Number(m[1])} de ${m[2]}`);
    diasDeFecha.add(Number(m[1]));
  }
  const nombres: string[] = [];
  const porTool = (tool: HerramientaComercial) => ev.facts.filter((f) => f.tool === tool);
  const ofertas = porTool("consultar_ofertas");
  const combos = porTool("consultar_combos");
  const campanas = porTool("consultar_campanas");
  for (const f of ofertas) for (const o of arr(f.data.offers)) if (str(o.name)) nombres.push(fold(str(o.name) as string));
  for (const f of combos) for (const c of arr(f.data.combos)) if (str(c.name)) nombres.push(fold(str(c.name) as string));
  for (const f of campanas) {
    for (const c of arr(f.data.campaigns)) {
      if (str(c.name)) nombres.push(fold(str(c.name) as string));
      for (const o of Array.isArray(c.offers) ? c.offers : []) if (typeof o === "string") nombres.push(fold(o.split(":")[0]));
      for (const k of Array.isArray(c.combos) ? c.combos : []) if (typeof k === "string") nombres.push(fold(k));
    }
  }
  for (const n of ev.productOffers) nombres.push(fold(n));
  const noVacio = (fs: HechoComercial[]) => fs.some((f) => f.data.empty === false);
  const vacia = (fs: HechoComercial[]) => fs.some((f) => f.data.empty === true);
  const hayOfertas = noVacio(ofertas) || ev.productOffers.length > 0;
  const hayCombos = noVacio(combos);
  const hayCampanas = noVacio(campanas);
  return {
    texto,
    porcentajes,
    fechas,
    diasDeFecha,
    nombres: [...new Set(nombres.filter((n) => n !== ""))],
    hayOfertas,
    hayCombos,
    hayCampanas,
    hayPromo: hayOfertas || hayCombos || hayCampanas,
    vacias: { ofertas: vacia(ofertas), combos: vacia(combos), campanas: vacia(campanas) },
  };
}

// ---------------------------------------------------------------------------
// La guarda
// ---------------------------------------------------------------------------

const respaldaNombre = (nombre: string, nombres: readonly string[]): boolean => {
  const n = fold(nombre).replace(/\s+/g, " ").trim();
  return nombres.some((e) => e === n || e.includes(n) || n.includes(e));
};

/**
 * Afirmaciones comerciales en `text` que lo devuelto por las herramientas en este turno NO respalda. [] = nada sin respaldo.
 * Cada elemento es un código estable (sin texto del cliente) para la traza y la corrección.
 */
export function checkCommercialClaims(text: string, ev: ComercialEvidence, opts: { shippingGuardActive?: boolean; customerNumbers?: ReadonlySet<number> } = {}): string[] {
  const out = new Set<string>();
  const r = respaldoDe(ev);
  /** El cliente escribió esa cifra y la frase la NIEGA: no es una afirmación del modelo. */
  const ecoNegado = (t: string, indice: number, n: number): boolean => opts.customerNumbers?.has(n) === true && NIEGA_CIFRA.test(t.slice(Math.max(0, indice - 50), indice));

  for (const original of oraciones(text)) {
    const t = fold(original);
    const negada = NEGACION.test(t);
    const hipotetica = HIPOTETICA.test(t);
    const promo = PROMO.test(t);
    const combo = COMBO.test(t);
    const campana = CAMPANA.test(t);
    const contextoPromo = promo || combo || campana;

    // --- Porcentajes: cualquier porcentaje que se afirme debe haberlo devuelto una herramienta (el del cliente no cuenta).
    if (!hipotetica) {
      for (const m of t.matchAll(PORCENTAJE)) {
        const n = Number(m[1].replace(",", "."));
        if (!r.porcentajes.has(n) && !ecoNegado(t, m.index ?? 0, n)) out.add(`percent_unbacked:${n}`);
      }
      for (const m of t.matchAll(PORCENTAJE_PALABRA)) {
        const n = aNumero(m[1]);
        if (n >= 0 && !r.porcentajes.has(n)) out.add(`percent_unbacked:${n}`);
      }
    }

    // --- «2x1», «3x2»: una promoción por cantidad solo si lo devuelto la trae.
    if (!hipotetica && !negada) for (const m of t.matchAll(MULTI)) if (!r.texto.replace(/\s+/g, "").includes(`${m[1]}x${m[2]}`)) out.add(`offer_unbacked:${m[1]}x${m[2]}`);

    // --- Ausencia: «no tenemos promociones / combos / campañas» solo si la herramienta de ESE tema devolvió `empty: true` en este turno.
    const aus = ABSENCIA.exec(t);
    if (aus && !SIN_DATO.test(aus[1]) && !hipotetica) {
      const tema = aus[2];
      const grupo = /combo/.test(tema) ? "combos" : /campana/.test(tema) ? "campanas" : "ofertas";
      const calificada = CALIFICA_ANTES.test(aus[1]) || CALIFICA_DESPUES.test(t.slice((aus.index ?? 0) + aus[0].length)) || CALIFICA_ORACION.test(t);
      const consultada = grupo === "ofertas" ? r.hayOfertas || r.vacias.ofertas : grupo === "combos" ? r.hayCombos || r.vacias.combos : r.hayCampanas || r.vacias.campanas;
      if (!r.vacias[grupo] && !(calificada && consultada)) out.add(`absence_unbacked:${grupo === "ofertas" ? "offers" : grupo === "combos" ? "combos" : "campaigns"}`);
    }

    // --- Existencia: «tenemos descuentos / combos / campañas» exige respaldo del mismo tipo. Nombrar la campaña con un nombre que una herramienta SÍ devolvió
    // («la campaña de Amor y Amistad» cuando la oferta se llama así) es describir lo respaldado, no inventar una campaña.
    if (!negada && !hipotetica) {
      if (promo && !r.hayPromo) out.add("discount_unbacked");
      if (combo && !r.hayCombos) out.add("combo_unbacked");
      if (campana && !r.hayCampanas) {
        const nombrada = [...original.matchAll(NOMBRE_TRAS_CUE)].some((m) => fold(m[1]).startsWith("campana") && !NO_ES_NOMBRE.has(fold(m[2].trim())) && respaldaNombre(m[2].trim(), r.nombres));
        if (!nombrada) out.add("campaign_unbacked");
      }
    }

    // --- Nombres propios de ofertas, combos y campañas, y temporadas nombradas junto a una promoción.
    if (!negada && !hipotetica) {
      for (const m of original.matchAll(NOMBRE_TRAS_CUE)) {
        const nombre = m[2].trim();
        if (NO_ES_NOMBRE.has(fold(nombre))) continue;
        if (!respaldaNombre(nombre, r.nombres)) {
          const cue = fold(m[1]);
          const codigo = cue.startsWith("combo") ? "combo_unbacked" : cue.startsWith("campana") ? "campaign_unbacked" : "offer_unbacked";
          out.add(`${codigo}:${fold(nombre).slice(0, 40)}`);
        }
      }
      if (contextoPromo) {
        for (const temporada of TEMPORADAS) {
          if (new RegExp(`(?:^|[^a-z])${temporada}(?:[^a-z]|$)`).test(t) && !r.texto.includes(temporada) && !r.nombres.some((n) => n.includes(temporada))) out.add(`campaign_unbacked:${temporada}`);
        }
      }
    }

    // --- «Sigue vigente» sin ninguna promoción, combo o campaña respaldada en el turno: afirma que algo continúa y nada lo respalda.
    if (!negada && !hipotetica && CONTINUA_VIGENTE.test(t) && !r.hayPromo && !CUE_ENVIO.test(t)) out.add("discount_unbacked");

    // --- Vigencia: fechas y plazos de una promoción (o de algo que se dice «vigente / válido / que vence») deben estar en lo devuelto.
    const cueVigencia = (VIGENCIA_CUE.test(t) || HASTA_FECHA.test(t) || RANGO_FECHAS.test(t)) && !CUE_ENVIO.test(t);
    if ((contextoPromo || cueVigencia) && !negada && !hipotetica) {
      for (const m of t.matchAll(FECHA)) if (!r.fechas.has(`${Number(m[1])} de ${m[2]}`)) out.add(`validity_unbacked:${Number(m[1])} de ${m[2]}`);
      for (const m of t.matchAll(HASTA_DIA)) if (!r.diasDeFecha.has(Number(m[1]))) out.add(`validity_unbacked:hasta el ${Number(m[1])}`);
      for (const m of t.matchAll(URGENCIA)) if (!r.texto.includes(m[1])) out.add(`validity_unbacked:${m[1].replace(/\s+/g, "_")}`);
    }

    // --- Fuga mayorista: a un cliente DETAL, nunca un precio, descuento, combo o catálogo mayorista con cifra (la compra inicial / el mínimo sí se puede informar).
    if (ev.channel === "retail" && MAYORISTA.test(t) && CUE_PRECIO.test(t) && !negada && !hipotetica && !MINIMO.test(t)) {
      const conCifra = MONTO.test(t) || new RegExp(PORCENTAJE.source).test(t) || /\b\d{1,3}\s?x\s?\d{1,3}\b/.test(t);
      if (conCifra) out.add("wholesale_leak");
    }

    // --- Cifras de políticas: plazos y duraciones solo si lo devuelto los contiene.
    if (!negada && !hipotetica && CUE_POLITICA.test(t) && !(opts.shippingGuardActive && CUE_ENVIO.test(t))) {
      for (const m of t.matchAll(PLAZO)) {
        const unidad = m[3].replace(/s$/, "").replace(/^mese$/, "mes");
        const numeros = [m[1], m[2]].filter((x): x is string => !!x).map(aNumero);
        for (const n of numeros) {
          if (n < 0) continue;
          const respaldo = new RegExp(`(?:^|[^\\d])${n}(?:\\s+(?:a|o|y|al|hasta)\\s+\\d{1,3})?\\s+${unidad.replace(/s$/, "")}`).test(r.texto) || new RegExp(`\\b\\d{1,3}\\s+(?:a|o|y|al|hasta)\\s+${n}\\s+${unidad}`).test(r.texto);
          if (!respaldo) out.add(`policy_figure_unbacked:${n}_${unidad}`);
        }
      }
    }
  }
  return [...out];
}
