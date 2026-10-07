/**
 * CMS comercial — TIEMPO Y VIGENCIA. PURO: sin I/O y con el reloj siempre inyectado.
 *
 * La administradora escribe fechas en HORA DE BOGOTÁ, sin zona: `2026-10-31` o `2026-10-31T18:00`. Se guardan tal cual las escribió y se interpretan
 * AQUÍ, en un solo lugar:
 *   - `desde`: el instante exacto (solo fecha => 00:00 de Bogotá de ese día).
 *   - `hasta`: límite EXCLUSIVO (solo fecha => 00:00 de Bogotá del día SIGUIENTE, o sea que «hasta el 31» incluye todo el 31; con hora => ese instante).
 * Una vigencia es el intervalo [desde, hasta): vigente cuando `desde <= ahora < hasta`. Sin proceso programado: «vencida» se DERIVA al leer, así que una
 * oferta deja de valer en el instante exacto de su fin.
 *
 * Bogotá no tiene horario de verano (UTC-5 todo el año desde 1993): el desfase es una constante y no hace falta una base de zonas horarias.
 * Un valor mal formado (o una fecha imposible como 2026-02-30) NUNCA se interpreta con generosidad: queda fuera de vigencia (fail-closed).
 */

export const ZONA_NEGOCIO = "America/Bogota";
const DESFASE_MS = -5 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Reloj inyectable (epoch en milisegundos). Los tests lo fijan; producción usa el real. */
export type Reloj = () => number;
export const relojReal: Reloj = () => Date.now();

const RE_SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_FECHA_HORA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

interface Partes {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  soloFecha: boolean;
}

function partesDe(valor: unknown): Partes | null {
  if (typeof valor !== "string") return null;
  const f = RE_FECHA_HORA.exec(valor);
  const s = f ? null : RE_SOLO_FECHA.exec(valor);
  const m = f ?? s;
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const hora = f ? Number(m[4]) : 0;
  const minuto = f ? Number(m[5]) : 0;
  if (anio < 2000 || anio > 2100 || hora > 23 || minuto > 59) return null;
  // Una fecha imposible (30 de febrero, mes 13) se detecta reconstruyéndola: si cambia, no existía.
  const utc = new Date(Date.UTC(anio, mes - 1, dia, hora, minuto));
  if (utc.getUTCFullYear() !== anio || utc.getUTCMonth() !== mes - 1 || utc.getUTCDate() !== dia) return null;
  return { anio, mes, dia, hora, minuto, soloFecha: !f };
}

/** ¿Es una fecha local escrita en el formato permitido y que existe en el calendario? */
export function esFechaLocalValida(valor: unknown): valor is string {
  return partesDe(valor) !== null;
}

const aInstante = (p: Partes, extraMs = 0): number => Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto) - DESFASE_MS + extraMs;

/** Instante (ms) en que EMPIEZA el valor: la fecha sola cuenta desde las 00:00 de Bogotá. null si no es válido. */
export function inicioLocalMs(valor: unknown): number | null {
  const p = partesDe(valor);
  return p ? aInstante(p) : null;
}

/** Límite EXCLUSIVO de un «hasta»: la fecha sola llega hasta el final de ese día (00:00 del siguiente); con hora, ese instante. null si no es válido. */
export function finExclusivoMs(valor: unknown): number | null {
  const p = partesDe(valor);
  return p ? aInstante(p, p.soloFecha ? DIA_MS : 0) : null;
}

/** Fecha de calendario de Bogotá (`YYYY-MM-DD`) de un instante. */
export function fechaLocalDeMs(ms: number): string {
  const d = new Date(ms + DESFASE_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Fecha y hora de Bogotá (`YYYY-MM-DDTHH:mm`) de un instante. */
export function fechaHoraLocalDeMs(ms: number): string {
  const d = new Date(ms + DESFASE_MS);
  return `${fechaLocalDeMs(ms)}T${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export interface VigenciaLocal {
  desde?: string | null;
  hasta?: string | null;
}

export type EstadoVigencia = "sin_limite" | "programada" | "vigente" | "vencida";

/** Intervalo [desde, hasta) en ms; cada extremo null = sin límite. null si alguna fecha escrita no es válida. */
export function intervaloDe(vigencia: VigenciaLocal | undefined | null): { desde: number | null; hasta: number | null } | null {
  const rawDesde = vigencia?.desde ?? null;
  const rawHasta = vigencia?.hasta ?? null;
  const desde = rawDesde === null || rawDesde === "" ? null : inicioLocalMs(rawDesde);
  const hasta = rawHasta === null || rawHasta === "" ? null : finExclusivoMs(rawHasta);
  if ((rawDesde !== null && rawDesde !== "" && desde === null) || (rawHasta !== null && rawHasta !== "" && hasta === null)) return null;
  return { desde, hasta };
}

/**
 * Estado de la vigencia en `ahora`. Una vigencia ilegible o con el fin antes del inicio NUNCA está vigente (se trata como vencida):
 * ante la duda, lo comercial no se muestra.
 */
export function estadoDeVigencia(vigencia: VigenciaLocal | undefined | null, ahora: number): EstadoVigencia {
  const intervalo = intervaloDe(vigencia);
  if (!intervalo) return "vencida";
  const { desde, hasta } = intervalo;
  if (desde !== null && hasta !== null && hasta <= desde) return "vencida";
  if (desde === null && hasta === null) return "sin_limite";
  if (desde !== null && ahora < desde) return "programada";
  if (hasta !== null && ahora >= hasta) return "vencida";
  return "vigente";
}

/** ¿Se puede usar ahora? (vigente, o sin límites de fecha). */
export const vigenteAhora = (vigencia: VigenciaLocal | undefined | null, ahora: number): boolean => {
  const e = estadoDeVigencia(vigencia, ahora);
  return e === "vigente" || e === "sin_limite";
};

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** «31 de octubre de 2026» o, si trae hora, «31 de octubre de 2026, 6:00 p. m.». null si el valor no es válido. */
export function formatearFechaLocal(valor: unknown): string | null {
  const p = partesDe(valor);
  if (!p) return null;
  const fecha = `${p.dia} de ${MESES[p.mes - 1]} de ${p.anio}`;
  if (p.soloFecha) return fecha;
  const hora12 = p.hora % 12 === 0 ? 12 : p.hora % 12;
  return `${fecha}, ${hora12}:${String(p.minuto).padStart(2, "0")} ${p.hora < 12 ? "a. m." : "p. m."}`;
}

/**
 * Vigencia en palabras para el cliente (la redacta el BACKEND; ARIA la cita tal cual y la guarda de anclaje la usa como evidencia):
 * «del 25 de octubre de 2026 al 31 de octubre de 2026», «hasta el …», «desde el …». null si no hay fechas válidas que contar.
 */
export function describirVigencia(vigencia: VigenciaLocal | undefined | null): string | null {
  const desde = vigencia?.desde ? formatearFechaLocal(vigencia.desde) : null;
  const hasta = vigencia?.hasta ? formatearFechaLocal(vigencia.hasta) : null;
  if (desde && hasta) return `del ${desde} al ${hasta}`;
  if (hasta) return `hasta el ${hasta}`;
  if (desde) return `desde el ${desde}`;
  return null;
}
