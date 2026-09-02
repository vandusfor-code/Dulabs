/**
 * Parser determinístico de expresiones de fecha colombianas → YYYY-MM-DD.
 * Espejo conceptual de parse-hora-colombia.ts: mismo criterio de "nunca
 * adivinar" -- una expresión que no se pueda resolver con certeza devuelve
 * un error explícito, nunca un valor inventado.
 *
 * SIEMPRE necesita `hoyISO` (YYYY-MM-DD, América/Bogotá) como ancla -- este
 * archivo no calcula "hoy" por sí mismo, lo recibe ya resuelto (mismo
 * patrón que ya usa 'hoy' en ai-extraer: sembrado una vez por el
 * orchestrator, nunca recalculado a mitad de conversación).
 */

export type ParseFechaColombiaOk = { ok: true; fecha: string };
export type ParseFechaColombiaFail = {
  ok: false;
  kind: "invalid" | "ambiguous" | "past";
  message: string;
};
export type ParseFechaColombiaResult = ParseFechaColombiaOk | ParseFechaColombiaFail;

const DIAS_SEMANA: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

const MESES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function normalizeInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[¿?¡!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Fecha (mediodía Colombia, evita cruces de día por huso horario) a partir de un YYYY-MM-DD. */
function anclaMediodia(iso: string): Date {
  return new Date(`${iso}T12:00:00-05:00`);
}

function diaSemanaDe(iso: string): number {
  return anclaMediodia(iso).getDay();
}

function sumarDias(iso: string, dias: number): string {
  const base = anclaMediodia(iso);
  base.setDate(base.getDate() + dias);
  return fmt(base.getFullYear(), base.getMonth() + 1, base.getDate());
}

/** true si year/month/day forman una fecha calendario real (rechaza "31 de febrero" en vez de dejar que Date la desborde a marzo). */
function esFechaCalendarioValida(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const diasEnMes = new Date(year, month, 0).getDate();
  return day <= diasEnMes;
}

function esFechaPasada(fecha: string, hoyISO: string): boolean {
  return fecha < hoyISO;
}

function ok(fecha: string): ParseFechaColombiaOk {
  return { ok: true, fecha };
}

function fail(kind: ParseFechaColombiaFail["kind"], message: string): ParseFechaColombiaFail {
  return { ok: false, kind, message };
}

const MSG_INVALIDA =
  "No logré identificar bien la fecha 😅 ¿Para qué día deseas tu cita? (por ejemplo: \"el sábado\", \"mañana\" o \"4 de septiembre\")";
const MSG_PASADA = "Esa fecha ya pasó 😅 ¿Para qué día (de aquí en adelante) deseas tu cita?";
const MSG_AMBIGUA = "No me quedó claro a qué día te refieres 😅 ¿Podrías darme una fecha más específica, como \"el sábado\" o \"4 de septiembre\"?";

/**
 * Convierte texto natural colombiano a YYYY-MM-DD, anclado a `hoyISO`.
 * Nunca inventa: si no puede resolver con certeza, devuelve un error
 * explícito ("invalid"/"ambiguous") en vez de una fecha adivinada; si la
 * fecha resuelta ya pasó, devuelve "past" en vez de aceptarla.
 */
export function parseFechaColombia(raw: string, hoyISO: string): ParseFechaColombiaResult {
  const s = normalizeInput(raw);
  if (!s) return fail("invalid", MSG_INVALIDA);

  if (s === "hoy") return ok(hoyISO);
  if (s === "manana" || s === "mañana") return ok(sumarDias(hoyISO, 1));
  if (s === "pasado manana" || s === "pasado mañana") return ok(sumarDias(hoyISO, 2));

  // "el sábado" / "este sábado" / "próximo sábado" / "el próximo sábado" / "sábado"
  const diaAlt = Object.keys(DIAS_SEMANA).join("|");
  const mProximo = s.match(new RegExp(`^(?:el |la )?proximo(?:s)? (${diaAlt})$`));
  // Tolera texto adicional después del día ("el sábado estaría bien", "el
  // sábado por favor") -- antes exigía que el texto TERMINARA exactamente
  // en el nombre del día.
  const mEsteOSolo = s.match(new RegExp(`^(?:el |este )?(${diaAlt})\\b`));

  if (mProximo || mEsteOSolo) {
    const nombreDia = (mProximo?.[1] ?? mEsteOSolo?.[1])!;
    const objetivo = DIAS_SEMANA[nombreDia]!;
    const hoyDow = diaSemanaDe(hoyISO);
    let delta = (objetivo - hoyDow + 7) % 7; // 0..6, 0 = hoy mismo
    // "próximo X" dicho el mismo día X significa la semana SIGUIENTE, no hoy
    // -- "el X"/"este X" dicho el mismo día X significa hoy. Única diferencia
    // real entre ambas formas (documentado, decisión de negocio explícita).
    if (mProximo && delta === 0) delta = 7;
    return ok(sumarDias(hoyISO, delta));
  }

  // "4 de septiembre" / "4 de sept"
  const mDiaDeMes = s.match(/^(\d{1,2}) de ([a-z]+)$/);
  if (mDiaDeMes) {
    const dia = Number(mDiaDeMes[1]);
    const mesTexto = mDiaDeMes[2]!;
    const mes = MESES[mesTexto] ?? Object.entries(MESES).find(([k]) => k.startsWith(mesTexto))?.[1];
    if (mes === undefined) return fail("invalid", MSG_INVALIDA);
    const anioHoy = Number(hoyISO.slice(0, 4));
    if (!esFechaCalendarioValida(anioHoy, mes, dia)) return fail("invalid", MSG_INVALIDA);
    const candidata = fmt(anioHoy, mes, dia);
    if (esFechaPasada(candidata, hoyISO)) return fail("past", MSG_PASADA);
    return ok(candidata);
  }

  // "septiembre 4"
  const mMesDia = s.match(/^([a-z]+) (\d{1,2})$/);
  if (mMesDia) {
    const mesTexto = mMesDia[1]!;
    const dia = Number(mMesDia[2]);
    const mes = MESES[mesTexto] ?? Object.entries(MESES).find(([k]) => k.startsWith(mesTexto))?.[1];
    if (mes !== undefined) {
      const anioHoy = Number(hoyISO.slice(0, 4));
      if (!esFechaCalendarioValida(anioHoy, mes, dia)) return fail("invalid", MSG_INVALIDA);
      const candidata = fmt(anioHoy, mes, dia);
      if (esFechaPasada(candidata, hoyISO)) return fail("past", MSG_PASADA);
      return ok(candidata);
    }
  }

  // "DD/MM", "DD-MM", "D/M", "D-M" (año implícito = año de hoy)
  const mNumerica = s.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (mNumerica) {
    const dia = Number(mNumerica[1]);
    const mes = Number(mNumerica[2]);
    const anioHoy = Number(hoyISO.slice(0, 4));
    if (!esFechaCalendarioValida(anioHoy, mes, dia)) return fail("invalid", MSG_INVALIDA);
    const candidata = fmt(anioHoy, mes, dia);
    if (esFechaPasada(candidata, hoyISO)) return fail("past", MSG_PASADA);
    return ok(candidata);
  }

  // Ya viene en YYYY-MM-DD (ej. lo que la propia IA ya normalizó bien, o un cliente que copia el formato pedido).
  const mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mIso) {
    const [, y, m, d] = mIso;
    if (!esFechaCalendarioValida(Number(y), Number(m), Number(d))) return fail("invalid", MSG_INVALIDA);
    const candidata = `${y}-${m}-${d}`;
    if (esFechaPasada(candidata, hoyISO)) return fail("past", MSG_PASADA);
    return ok(candidata);
  }

  // Texto que claramente habla de un día pero sin datos suficientes para
  // resolverlo con certeza (ej. "el otro sábado", "en unos días") -- nunca
  // adivinar, se marca ambiguo en vez de "invalid" genérico para que el
  // llamador pueda, si quiere, distinguir el mensaje.
  if (/\b(dia|semana|finde|otro|otra)\b/.test(s)) {
    return fail("ambiguous", MSG_AMBIGUA);
  }

  return fail("invalid", MSG_INVALIDA);
}
