/**
 * AGENDA V2 -- resolución DETERMINÍSTICA de respuestas en lenguaje natural contra las opciones REALMENTE mostradas.
 *
 * Por qué existe: cada paso de Agenda V2 solo aceptaba el número de la opción. "Quiero con Cristal", "me da igual",
 * "mejor el viernes", "a las 3" o "sí, perfecto" respondían "No reconocí esa opción" -- un formulario rígido. Esa regla
 * de "solo números" tenía una razón real que se CONSERVA intacta: nunca elegir algo por una interpretación ambigua (ej.
 * "Tengo disponibilidad a las 4." jamás es la opción 4 -- normalizarNumeroDeOpcion no se toca). Esta capa es
 * independiente y se evalúa SOLO cuando el mensaje no es un número de opción, con reglas igual de estrictas:
 *
 * - Nombres (profesional, categoría, servicio): coincidencia de PALABRA COMPLETA, sin tildes/mayúsculas, y ÚNICA entre
 *   las opciones mostradas. Dos coincidencias = ambiguo = se pregunta, nunca se elige.
 * - Fechas y horas: el MISMO parser determinístico de siempre (parseFechaColombia / parseHoraColombia), tras quitar a
 *   lo sumo muletillas iniciales de una lista cerrada ("mejor", "puede ser", "prefiero"…). Quien valida contra la agenda
 *   real sigue siendo el backend (router.ts): una fecha u hora bien formada nunca se da por libre sin consultarla.
 * - Confirmar / sí / no: vocabulario CERRADO y coincidencia EXACTA del mensaje completo. "sí" confirma; "sí, pero mejor a
 *   las 4" no coincide con nada y se pregunta de nuevo.
 *
 * Nada de esto usa IA: es puro, síncrono y 100% testeable.
 */
import { parseFechaColombia } from "@/lib/parse-fecha-colombia";
import { parseHoraColombia } from "@/lib/parse-hora-colombia";
import { formatearHoraAmPm } from "@/lib/especialistas-flow-adaptador";

export function normalizarFrase(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}:\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(texto: string): string[] {
  const n = normalizarFrase(texto);
  return n ? n.split(" ") : [];
}

function contieneSecuencia(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((t, j) => haystack[i + j] === t)) return true;
  }
  return false;
}

export type ResultadoNombre<T> = { tipo: "unica"; opcion: T } | { tipo: "ambigua"; opciones: T[] } | { tipo: "ninguna" };

/**
 * Busca qué opciones se nombran en el mensaje (palabra completa). Si un nombre coincidente está contenido en otro
 * también coincidente ("Manicure" dentro de "Manicure semipermanente"), gana el más largo -- la clienta dijo el nombre
 * completo. Cualquier otra combinación de 2+ coincidencias es ambigua.
 */
export function resolverPorNombre<T>(mensaje: string, opciones: T[], nombreDe: (o: T) => string): ResultadoNombre<T> {
  const tm = tokens(mensaje);
  const coincidencias = opciones.filter((o) => contieneSecuencia(tm, tokens(nombreDe(o))));
  const maximales = coincidencias.filter(
    (o) => !coincidencias.some((otra) => otra !== o && tokens(nombreDe(otra)).length > tokens(nombreDe(o)).length && contieneSecuencia(tokens(nombreDe(otra)), tokens(nombreDe(o)))),
  );
  if (maximales.length === 1) return { tipo: "unica", opcion: maximales[0]! };
  if (maximales.length > 1) return { tipo: "ambigua", opciones: maximales };
  return { tipo: "ninguna" };
}

// --- "Me da igual quién" ----------------------------------------------------------------------------------------

const FRASES_CUALQUIER_PROFESIONAL = [
  "cualquiera",
  "cualquier profesional",
  "cualquier persona",
  "cualquier chica",
  "me da igual",
  "da igual",
  "me es indiferente",
  "no importa",
  "no me importa",
  "la que tenga",
  "la que este disponible",
  "la que este libre",
  "la que haya",
  "la que sea",
  "la que pueda",
  "quien sea",
  "quien este disponible",
  "la primera disponible",
  "la mas pronto",
  "lo mas pronto",
  "no tengo preferencia",
  "sin preferencia",
  "ninguna en especial",
  "ninguna en particular",
  "la que me recomiendes",
  "la que tu digas",
  "la que usted diga",
  "no se",
];

/** Solo tiene sentido en el paso de elegir profesional: "me da igual", "la que tenga disponibilidad", "mmm no sé". */
export function esPedidoCualquierProfesional(mensaje: string): boolean {
  const n = ` ${normalizarFrase(mensaje)} `;
  return FRASES_CUALQUIER_PROFESIONAL.some((f) => n.includes(` ${f} `));
}

// --- Fechas ---------------------------------------------------------------------------------------------------

/** Muletillas iniciales (lista cerrada) que se quitan antes de pasar la frase al parser determinístico de fechas. */
const MULETILLAS_INICIALES = [
  "mejor para",
  "mejor el dia",
  "mejor",
  "entonces",
  "pues",
  "bueno",
  "ok",
  "okay",
  "si",
  "y para",
  "y el dia",
  "y",
  "puede ser",
  "podria ser",
  "seria",
  "que sea",
  "prefiero",
  "quiero",
  "quisiera",
  "me gustaria",
  "tienes para",
  "tienen para",
  "hay para",
  "para",
  "el dia",
];

function quitarMuletillas(frase: string): string {
  let s = normalizarFrase(frase);
  for (let vuelta = 0; vuelta < 4; vuelta++) {
    const m = MULETILLAS_INICIALES.find((p) => s === p || s.startsWith(`${p} `));
    if (!m) break;
    s = s.slice(m.length).trim();
  }
  // "el 9 de septiembre": el parser acepta "9 de septiembre" pero no con artículo delante de un número.
  return s.replace(/^(el|la) (?=\d)/, "");
}

/**
 * Fecha concreta expresada en texto ("mañana", "el viernes", "mejor el 30 de septiembre", "¿y el sábado?"). `null` si
 * no hay una fecha inequívoca o ya pasó. `sinManana`: en el paso de HORA, "mañana" sola significa "en la mañana"
 * (franja), no "el día de mañana" -- ahí solo cuentan días de la semana, fechas explícitas, "hoy" y "pasado mañana".
 */
export function extraerFechaNatural(mensaje: string, hoyIso: string, opciones: { sinManana?: boolean } = {}): string | null {
  const s = quitarMuletillas(mensaje);
  if (!s) return null;
  if (opciones.sinManana && /^manana\b/.test(s)) return null;
  const r = parseFechaColombia(s, hoyIso);
  return r.ok ? r.fecha : null;
}

// --- Horas ----------------------------------------------------------------------------------------------------

export type ResultadoHoraNatural =
  | { tipo: "unica"; hora: string }
  | { tipo: "no_disponible"; hora: string }
  | { tipo: "filtro"; horas: string[]; descripcion: string }
  | { tipo: "ninguna" };

function minutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

function horaDePeriodo(hora: number, texto: string): number {
  // "después de las 5" en un salón es 5 p. m. (nunca hay agenda a las 5 a. m.): de 1 a 8 sin marca se lee p. m.
  if (/\b(am|de la manana)\b/.test(texto)) return hora === 12 ? 0 : hora;
  if (/\b(pm|de la tarde|de la noche)\b/.test(texto)) return hora === 12 ? 12 : hora + 12;
  return hora >= 1 && hora <= 8 ? hora + 12 : hora;
}

/**
 * Normalizaciones previas al parser compartido (lib/parse-hora-colombia.ts, que no se modifica porque también lo usa el
 * Flow Engine). Defectos reales encontrados al probarlo: "3pm" pegado era ambiguo, "4 y media pm" devolvía 16:00
 * (perdía la media hora) y "tipo 4"/"como a las 4" eran inválidos.
 */
function prepararHora(s: string): string {
  return s
    .replace(/^(tipo|como|a eso de|mas o menos|aproximadamente|aprox|la de|el de|la que es|el que es)( a)?\s+/, "")
    .replace(/\b(\d{1,2})\s*(am|pm)\b/g, "$1 $2")
    .replace(/\b(\d{1,2}) y media\b/g, "$1:30")
    .replace(/\b(\d{1,2}) y cuarto\b/g, "$1:15");
}

const MARCA_PERIODO = /\b(am|pm|manana|tarde|noche|madrugada)\b/;

function sumar12(hhmm: string): string {
  const [h, m] = hhmm.split(":");
  return `${String(Number(h) + 12).padStart(2, "0")}:${m}`;
}

/** Lecturas posibles de una hora dicha sin marca de periodo: "4:30" puede ser 04:30 o 16:30. */
function lecturasDe(texto: string): string[] {
  const r = parseHoraColombia(texto);
  if (r.ok) {
    const h = Number(r.hhmm.slice(0, 2));
    return !MARCA_PERIODO.test(texto) && h >= 1 && h <= 11 ? [r.hhmm, sumar12(r.hhmm)] : [r.hhmm];
  }
  if (r.kind === "ambiguous") {
    return [`${texto} am`, `${texto} pm`].map((t) => parseHoraColombia(t)).flatMap((x) => (x.ok ? [x.hhmm] : []));
  }
  return [];
}

/**
 * Resuelve una hora dicha en texto contra los horarios REALES libres de ese día (`disponibles`, ya calculados por el
 * motor con Nylas). Una hora exacta solo se acepta si está en esa lista; si la hora admite dos lecturas ("a las 4",
 * "4:30") se acepta solo cuando exactamente una de ellas está libre. Franjas y rangos ("en la tarde", "después de las
 * 5", "antes de las 12") filtran la misma lista -- nunca se inventa un horario.
 */
export function resolverHoraNatural(mensaje: string, disponibles: string[]): ResultadoHoraNatural {
  const s = prepararHora(quitarMuletillas(mensaje));
  if (!s) return { tipo: "ninguna" };

  const rango = s.match(/\b(despues de|desde|a partir de|antes de|hasta)( las?)? (\d{1,2})(?::(\d{2}))?/);
  if (rango) {
    const limite = horaDePeriodo(Number(rango[3]), s) * 60 + Number(rango[4] ?? 0);
    const antes = rango[1] === "antes de" || rango[1] === "hasta";
    const horas = disponibles.filter((h) => (antes ? minutos(h) < limite : minutos(h) >= limite));
    const hhmm = `${String(Math.floor(limite / 60)).padStart(2, "0")}:${String(limite % 60).padStart(2, "0")}`;
    return { tipo: "filtro", horas, descripcion: `${antes ? "antes de las" : "desde las"} ${formatearHoraAmPm(hhmm)}` };
  }

  const franjas: [RegExp, string, (m: number) => boolean][] = [
    [/^(en la |por la |de )?manana\b|^temprano\b/, "en la mañana", (m) => m < 12 * 60],
    [/^(en la |por la |de )?tarde\b|^al medio dia\b|^despues del almuerzo\b/, "en la tarde", (m) => m >= 12 * 60],
    [/^(en la |por la |de )?noche\b/, "en la noche", (m) => m >= 18 * 60],
  ];
  for (const [patron, descripcion, cumple] of franjas) {
    if (patron.test(s)) return { tipo: "filtro", horas: disponibles.filter((h) => cumple(minutos(h))), descripcion };
  }

  const lecturas = lecturasDe(s);
  if (lecturas.length === 0) return { tipo: "ninguna" };
  const libres = lecturas.filter((h) => disponibles.includes(h));
  if (libres.length === 1) return { tipo: "unica", hora: libres[0]! };
  if (libres.length > 1) return { tipo: "ninguna" }; // dos lecturas libres: nunca se adivina, se vuelve a preguntar
  // Ninguna lectura libre: se informa la lectura que cae en horario de salón (la de la tarde si la hay).
  return { tipo: "no_disponible", hora: lecturas[lecturas.length - 1]! };
}

// --- Confirmación / sí / no -----------------------------------------------------------------------------------

const SI = new Set([
  "si",
  "sii",
  "siii",
  "si senora",
  "si senor",
  "si por favor",
  "si porfa",
  "si porfavor",
  "si gracias",
  "si perfecto",
  "si claro",
  "si dale",
  "si listo",
  "si esta bien",
  "si de acuerdo",
  "si confirmo",
  "si confirmar",
  "si reservala",
  "si agendala",
  "confirmo",
  "confirmar",
  "confirmado",
  "confirmada",
  "perfecto",
  "perfecto gracias",
  "perfecto si",
  "dale",
  "dale si",
  "listo",
  "listo gracias",
  "de una",
  "claro",
  "claro que si",
  "ok",
  "okay",
  "ok perfecto",
  "vale",
  "esta bien",
  "de acuerdo",
  "hagale",
  "super",
  "genial",
  "agendala",
  "agendalo",
  "reservala",
  "reservalo",
]);

const NO = new Set(["no", "noo", "no gracias", "mejor no", "ya no", "no quiero", "no por ahora", "ahora no", "no senora", "no senor"]);

const CAMBIAR_FECHA = new Set(["otro dia", "otra fecha", "cambiar fecha", "cambiar la fecha", "cambiar el dia", "mejor otro dia", "mejor otra fecha", "quiero otro dia", "quiero otra fecha"]);
const CAMBIAR_HORA = new Set(["otra hora", "otro horario", "cambiar hora", "cambiar la hora", "cambiar el horario", "mejor otra hora", "mejor otro horario", "quiero otra hora", "quiero otro horario"]);

export type RespuestaConfirmacionNatural = "confirmar" | "cambiar_fecha" | "cambiar_hora" | "cancelar" | null;

/** Negativas CLARAS de seguir con la reserva en curso. Un "no" suelto NO está: puede querer cambiar algo, se pregunta. */
const DESISTIR_RESERVA = new Set(["mejor no", "ya no", "no quiero", "ya no quiero", "no gracias", "no por ahora", "ahora no", "cancela", "cancelala", "cancelalo", "cancelar la cita", "cancela la cita"]);

/** Paso de confirmación de la cita: coincidencia EXACTA contra vocabulario cerrado. `null` = no se entendió (se vuelve a preguntar). */
export function resolverConfirmacionNatural(mensaje: string): RespuestaConfirmacionNatural {
  const n = normalizarFrase(mensaje);
  if (SI.has(n)) return "confirmar";
  if (CAMBIAR_FECHA.has(n)) return "cambiar_fecha";
  if (CAMBIAR_HORA.has(n)) return "cambiar_hora";
  if (DESISTIR_RESERVA.has(n)) return "cancelar";
  return null;
}

/** Preguntas binarias (¿cancelo tu cita? / ¿la reprogramamos?): mismo vocabulario cerrado, coincidencia exacta. */
export function resolverSiNoNatural(mensaje: string): "si" | "no" | null {
  const n = normalizarFrase(mensaje);
  if (SI.has(n)) return "si";
  if (NO.has(n)) return "no";
  return null;
}
