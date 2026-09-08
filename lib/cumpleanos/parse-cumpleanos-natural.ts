/**
 * FASE 1 -- Agendamiento conversacional, revisión (autorizado). Parser
 * DETERMINISTA (nunca IA) de una fecha de cumpleaños dicha en lenguaje
 * natural por WhatsApp -- SOLO día y mes, nunca año (mismo criterio que
 * dulabs_clientes_conocidos.cumple_dia/cumple_mes, ver
 * 20260904210000_clientes_conocidos_cumpleanos.sql: un cumpleaños se repite
 * cada año, el año de nacimiento nunca se pide ni se guarda acá).
 *
 * Deliberadamente MÁS SIMPLE que lib/parse-fecha-colombia.ts: no hay "hoy"
 * relativo al que anclar, no hay ambigüedad de "próximo/otro" día de la
 * semana, no hay que resolver un año -- por eso es un parser propio y
 * pequeño, no una reutilización forzada del otro (que sí resuelve fechas
 * completas relativas a una fecha de referencia, un problema distinto).
 */
export const MESES: Record<string, number> = {
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
/** Prefijo real (mínimo 3 letras, como "mar"/"ene") -- mismo criterio de abreviatura que ya usa parseFechaColombia para meses. */
export function resolverMesPorPrefijo(texto: string): number | undefined {
  if (texto.length < 3) return undefined;
  const encontrado = Object.entries(MESES).find(([nombre]) => nombre.startsWith(texto));
  return encontrado?.[1];
}

function normalizarBasico(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[¿?¡!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function diasEnMes(mes: number): number {
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1]!; // 29 para febrero -- nunca se guarda año, así que un 29 de febrero real siempre es válido de nombrarse
}

export type ResultadoCumpleanosNatural = { ok: true; dia: number; mes: number } | { ok: false };

/**
 * Acepta "15 de marzo", "15 de mar", "3/7", "03-07", "el 20 de diciembre".
 * Un año explícito ("15 de marzo de 1990", "15/03/1990") se tolera pero se
 * IGNORA por completo -- nunca se calcula ni se guarda edad/año de
 * nacimiento. Nunca inventa: si no hay un día+mes real reconocible, o el
 * día no existe en ese mes, devuelve {ok:false}.
 */
export function parseCumpleanosNatural(mensaje: string): ResultadoCumpleanosNatural {
  const normalizado = normalizarBasico(mensaje);

  const conNombreDeMes = normalizado.match(/\b(\d{1,2})\s+de\s+([a-z]+)\b/);
  if (conNombreDeMes) {
    const dia = Number(conNombreDeMes[1]);
    const mes = resolverMesPorPrefijo(conNombreDeMes[2]!);
    if (mes && dia >= 1 && dia <= diasEnMes(mes)) return { ok: true, dia, mes };
    return { ok: false };
  }

  const numerico = normalizado.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?\b/);
  if (numerico) {
    const dia = Number(numerico[1]);
    const mes = Number(numerico[2]);
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasEnMes(mes)) return { ok: true, dia, mes };
    return { ok: false };
  }

  return { ok: false };
}

/**
 * AMORE (Fase 2 -- registro de clientes nuevos, autorizado) — el registro
 * pregunta día y mes por SEPARADO (dos mensajes distintos), a diferencia de
 * parseCumpleanosNatural (un solo mensaje combinado) -- por eso son
 * funciones propias y pequeñas, pero reutilizan TAL CUAL diasEnMes y (para
 * el mes) la MISMA tabla MESES/resolverMesPorPrefijo -- nunca una segunda
 * tabla de nombres de mes. Nunca inventan: un valor fuera de rango o no
 * reconocible devuelve null, sin adivinar.
 *
 * Acepta "1", "01", "15", "28", "31" -- solo dígitos, rango 1-31 (mismo
 * rango que ya valida el CHECK real de dulabs_clientes_conocidos.cumple_dia,
 * nunca validado contra el mes porque en este paso el mes todavía no se
 * conoce).
 */
export function parseDiaCumpleanos(mensaje: string): number | null {
  const normalizado = normalizarBasico(mensaje);
  if (!/^\d{1,2}$/.test(normalizado)) return null;
  const dia = Number(normalizado);
  return dia >= 1 && dia <= 31 ? dia : null;
}

/** Acepta "1"-"12" numérico, o el nombre/prefijo real del mes (mismo criterio de abreviatura de 3+ letras que resolverMesPorPrefijo ya usa). */
export function parseMesCumpleanos(mensaje: string): number | null {
  const normalizado = normalizarBasico(mensaje);
  if (/^\d{1,2}$/.test(normalizado)) {
    const mes = Number(normalizado);
    return mes >= 1 && mes <= 12 ? mes : null;
  }
  return resolverMesPorPrefijo(normalizado) ?? null;
}
