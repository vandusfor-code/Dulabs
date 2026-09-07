/**
 * FASE 1 -- Agendamiento conversacional (autorizado). Extracción
 * DETERMINISTA (nunca por IA) de las entidades propias de una reserva:
 * profesional mencionada, fecha, hora/bloque horario, confirmación y
 * cancelación explícitas. Reutiliza TAL CUAL los parsers ya existentes y
 * probados (parseFechaColombia/parseHoraColombia, ya usados por Daniela) --
 * nunca reimplementa el cálculo de fechas/horas.
 */
import { parseFechaColombia, type ParseFechaColombiaResult } from "@/lib/parse-fecha-colombia";
import { parseHoraColombia, type ParseHoraColombiaResult } from "@/lib/parse-hora-colombia";

/** Exportada (autorizado, MODO AGENDA GUIADA) -- misma normalización reutilizada por el menú guiado para comparar la respuesta del cliente contra las opciones reales mostradas. */
export function normalizarBasico(mensaje: string): string {
  return mensaje
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[¿?¡!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Especialistas reales (activas) del tenant -- se busca coincidencia de palabra completa, nunca substring parcial (evita falsos positivos con nombres cortos). */
export function detectarEspecialistaMencionada(
  mensaje: string,
  especialistas: Array<{ id: number; nombre: string }>,
): { id: number; nombre: string } | undefined {
  const normalizado = normalizarBasico(mensaje);
  for (const e of especialistas) {
    const nombreNormalizado = normalizarBasico(e.nombre);
    if (!nombreNormalizado) continue;
    const patron = new RegExp(`(^|[^a-z0-9])${nombreNormalizado}([^a-z0-9]|$)`);
    if (patron.test(normalizado)) return { id: e.id, nombre: e.nombre };
  }
  return undefined;
}

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const PALABRAS_FECHA_DIRECTAS = ["hoy", "pasado manana", "manana", "proximo domingo", "proximo lunes", "proximo martes", "proximo miercoles", "proximo jueves", "proximo viernes", "proximo sabado", ...DIAS_SEMANA];

/**
 * Busca una mención de fecha en cualquier parte del mensaje (no exige que
 * esté al inicio) y delega el cálculo real a parseFechaColombia -- nunca
 * inventa una fecha. Devuelve `undefined` solo si NO hay ninguna palabra de
 * fecha reconocible; si hay una palabra de fecha pero resulta ambigua o
 * pasada, se devuelve el `fail` real para que el caller pueda responder con
 * honestidad (nunca se traga el error en silencio).
 */
// Nombres reales de mes (y abreviaturas por prefijo, igual que
// parseFechaColombia) -- NUNCA un [a-z]+ genérico: "a las 4 de la tarde"
// contiene literalmente "4 de la", y "la" pasaría como "mes" con un patrón
// genérico, rompiendo la detección (bug real encontrado con este mensaje).
const MESES_TEXTO = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic";

/**
 * Corrección (autorizada, rediseño arquitectónico agendamiento) — bug real:
 * cuando el mensaje trae DOS palabras de fecha ("el sábado en la mañana",
 * "el viernes... mañana"), la versión anterior devolvía la que aparece
 * PRIMERO en PALABRAS_FECHA_DIRECTAS (orden fijo del arreglo), sin importar
 * en qué posición real del mensaje aparecía cada una -- como "manana" está
 * declarada antes que los días de la semana, "el sábado en la mañana"
 * resolvía a MAÑANA (día siguiente) en vez de a SÁBADO. Ahora se recogen
 * TODAS las apariciones reales y gana la que aparece más temprano en el
 * mensaje, igual que ya se hace entre los 3 formatos (número+mes, número+
 * barra, palabra directa) más abajo.
 */
function esBloqueHorarioDeManana(normalizado: string, idx: number): boolean {
  // "en la mañana"/"por la mañana"/"de la mañana" es un BLOQUE HORARIO (ver
  // extraerHoraOBloqueMencionado/PATRON_BLOQUE_SUELTO), nunca una fecha --
  // ahí "mañana" significa "morning", no "tomorrow". Se excluye SOLO esta
  // aparición puntual de la palabra, nunca otra mención real de fecha en el
  // mismo mensaje.
  return /\b(?:en|por|de) la\s*$/.test(normalizado.slice(0, idx));
}

export function extraerFechaMencionada(mensaje: string, hoyISO: string): ParseFechaColombiaResult | undefined {
  const normalizado = normalizarBasico(mensaje);

  const mNumericaMes = normalizado.match(new RegExp(`\\b\\d{1,2}\\s+de\\s+(?:${MESES_TEXTO})\\w*\\b`));
  const mNumericaBarra = normalizado.match(/\b\d{1,2}[/-]\d{1,2}\b/);

  let mejorPalabra: { idx: number; texto: string } | undefined;
  for (const palabra of PALABRAS_FECHA_DIRECTAS) {
    const idx = normalizado.indexOf(palabra);
    if (idx === -1) continue;
    if (palabra === "manana" && esBloqueHorarioDeManana(normalizado, idx)) continue;
    if (mejorPalabra && idx >= mejorPalabra.idx) continue;

    // Nunca recortar perdiendo un calificador inmediatamente anterior real
    // ("otro sábado" vs "el sábado" cambian el significado -- parseFechaColombia
    // distingue explícitamente "otro"/"otra" como ambiguo) -- se incluye si
    // está justo antes. El resto del mensaje se conserva tal cual (nunca se
    // recorta al final) porque parseFechaColombia ya tolera texto adicional
    // después de la palabra de fecha (mañana/hoy/día de la semana).
    const antes = normalizado.slice(0, idx).trimEnd();
    const palabraAnterior = antes.split(" ").at(-1) ?? "";
    const incluirAnterior = ["el", "este", "otro", "otra"].includes(palabraAnterior);
    const inicio = incluirAnterior ? idx - palabraAnterior.length - 1 : idx;
    mejorPalabra = { idx, texto: normalizado.slice(Math.max(0, inicio)) };
  }

  const candidatos = [
    mNumericaMes ? { idx: mNumericaMes.index!, texto: mNumericaMes[0] } : undefined,
    mNumericaBarra ? { idx: mNumericaBarra.index!, texto: mNumericaBarra[0] } : undefined,
    mejorPalabra,
  ].filter((c): c is { idx: number; texto: string } => c !== undefined);
  if (candidatos.length === 0) return undefined;

  // Entre los 3 formatos, gana el que aparece MÁS TEMPRANO en el mensaje
  // real -- nunca una prioridad fija arbitraria entre formatos.
  candidatos.sort((a, b) => a.idx - b.idx);
  return parseFechaColombia(candidatos[0]!.texto, hoyISO);
}

export type ExtraccionHora = { tipo: "hora"; resultado: ParseHoraColombiaResult } | { tipo: "bloque"; bloque: "manana" | "tarde" | "noche" };

// Nunca detecta una hora a partir de un número/palabra-numérica SUELTA sin
// ningún marcador real de hora alrededor -- "una" ("una cita") es un
// artículo español normal, no una hora, y colisionaría con "una"=1 de
// parseHoraColombia si se buscara sin marcador. Por eso CADA alternativa
// exige "a las"/"las" ANTES, o un periodo (de la tarde/am/pm) DESPUÉS, o
// formato HH:MM explícito -- nunca un número aislado.
const PERIODOS = "de la manana|de la tarde|de la noche|en la manana|en la tarde|en la noche|por la manana|por la tarde|por la noche|a\\.?\\s*m\\.?|p\\.?\\s*m\\.?";
const NUMERO_O_PALABRA = "\\d{1,2}(?::\\d{2})?|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce";
const PATRON_HORA_NUMERICA = new RegExp(
  `(?:a las |las )(?:${NUMERO_O_PALABRA})\\s*(?:${PERIODOS}|horas?)?` + `|(?:${NUMERO_O_PALABRA})\\s*(?:${PERIODOS})` + `|\\d{1,2}:\\d{2}`,
);

const PATRON_BLOQUE_SUELTO = /\b(?:en la|por la|de la)\s+(manana|tarde|noche)\b/;

/**
 * Busca una hora concreta o, si no hay ninguna, una preferencia de bloque
 * ("en la tarde") en cualquier parte del mensaje. "tipo 4" se trata como
 * sinónimo coloquial de "a las 4" (normalización local, nunca se toca
 * parse-hora-colombia.ts -- ese parser sigue siendo compartido con Daniela
 * sin ningún cambio). Nunca inventa una hora: si el parser real devuelve
 * ambigua/inválida, se propaga ese resultado.
 */
export function extraerHoraOBloqueMencionado(mensaje: string, horaPendiente?: number): ExtraccionHora | undefined {
  const normalizado = normalizarBasico(mensaje).replace(/\btipo\b/g, "a las");

  const mHora = normalizado.match(PATRON_HORA_NUMERICA);
  if (mHora && mHora[0].trim()) {
    const resultado = parseHoraColombia(mHora[0], horaPendiente);
    return { tipo: "hora", resultado };
  }

  const mBloque = normalizado.match(PATRON_BLOQUE_SUELTO);
  if (mBloque) return { tipo: "bloque", bloque: mBloque[1] as "manana" | "tarde" | "noche" };

  return undefined;
}

/**
 * Vocabulario CERRADO y EXPLÍCITO de confirmación de reserva -- a propósito
 * MÁS ESTRICTO que AFIRMACIONES_CORTAS (entidades.ts): "creo que sí"/"esa
 * está bien"/"me gusta" NUNCA deben disparar una reserva real, así que se
 * exige coincidencia EXACTA (tras normalizar), nunca "contains". Solo se
 * consulta cuando el contexto realmente está esperando confirmación
 * (agendamiento.esperandoConfirmacion===true) -- ver resolver.ts.
 */
// Revisión (autorizada) -- ampliado con formas naturales reales de
// confirmación DIRIGIDAS a una opción ya ofrecida ("esa"), sin volverse
// difuso: sigue siendo coincidencia EXACTA tras normalizar (nunca
// "contains"), así que agregar más formas nunca introduce un falso
// positivo nuevo -- solo cubre frases que antes quedaban, injustamente,
// fuera del vocabulario cerrado.
const CONFIRMACIONES_RESERVA = new Set([
  "si",
  "si por favor",
  "confirmo",
  "confirmado",
  "reservala",
  "si reservala",
  "agendamela",
  "agendala",
  "si quiero",
  "dale",
  "de una",
  "claro que si",
  "hazlo",
  "perfecto esa",
  "esa perfecto",
  "si esa me sirve",
  "esa me sirve",
  "quiero esa",
  "esa si",
]);

export function esConfirmacionExplicitaDeReserva(mensaje: string): boolean {
  return CONFIRMACIONES_RESERVA.has(normalizarBasico(mensaje));
}

const CANCELACIONES_RESERVA = new Set([
  "no",
  "no gracias",
  "cancela",
  "cancelalo",
  "cancélalo",
  "olvidalo",
  "olvídalo",
  "dejalo asi",
  "déjalo así",
  "ya no",
  "ya no quiero",
  "mejor no",
]);

export function esCancelacionExplicitaDeReserva(mensaje: string): boolean {
  return CANCELACIONES_RESERVA.has(normalizarBasico(mensaje));
}
