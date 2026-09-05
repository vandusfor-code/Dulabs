import type { RangoFechas, TipoPeriodo } from "./tipos";

// Contabilidad (Fase 10, genérico, autorizado) — TODOS los rangos de fecha
// se calculan en America/Bogota, nunca en la zona horaria del servidor
// (Vercel corre en UTC). Colombia no observa horario de verano -- su offset
// es -05:00 fijo todo el año, así que un timestamp exacto se puede
// construir directamente con ese offset, sin depender de ninguna librería
// de zonas horarias. Mismo principio que lib/cumpleanos/fecha.ts.
const OFFSET_BOGOTA = "-05:00";

function fechaBogotaYMD(fecha: Date): { anio: number; mes: number; dia: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(fecha);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  return { anio: valor("year"), mes: valor("month"), dia: valor("day") };
}

function inicioDelDiaBogota(anio: number, mes: number, dia: number): Date {
  const p2 = (n: number) => String(n).padStart(2, "0");
  return new Date(`${anio}-${p2(mes)}-${p2(dia)}T00:00:00${OFFSET_BOGOTA}`);
}

/** 0=domingo..6=sábado, calculado en Bogotá (no en el huso del servidor). */
function diaSemanaBogota(anio: number, mes: number, dia: number): number {
  const p2 = (n: number) => String(n).padStart(2, "0");
  // Mediodía UTC-5 nunca cruza a otro día calendario por redondeo de huso.
  return new Date(`${anio}-${p2(mes)}-${p2(dia)}T12:00:00${OFFSET_BOGOTA}`).getUTCDay();
}

export function rangoHoy(ahora: Date): RangoFechas {
  const { anio, mes, dia } = fechaBogotaYMD(ahora);
  const desde = inicioDelDiaBogota(anio, mes, dia);
  return { desde, hasta: new Date(desde.getTime() + 24 * 60 * 60 * 1000) };
}

/** Semana calendario lunes-domingo (Bogotá). */
export function rangoSemana(ahora: Date): RangoFechas {
  const { anio, mes, dia } = fechaBogotaYMD(ahora);
  const inicioHoy = inicioDelDiaBogota(anio, mes, dia);
  const diaSemana = diaSemanaBogota(anio, mes, dia);
  const diasDesdeLunes = diaSemana === 0 ? 6 : diaSemana - 1;
  const desde = new Date(inicioHoy.getTime() - diasDesdeLunes * 24 * 60 * 60 * 1000);
  return { desde, hasta: new Date(desde.getTime() + 7 * 24 * 60 * 60 * 1000) };
}

/** Mes calendario completo (Bogotá). */
export function rangoMes(ahora: Date): RangoFechas {
  const { anio, mes } = fechaBogotaYMD(ahora);
  const desde = inicioDelDiaBogota(anio, mes, 1);
  const { anio: anioSig, mes: mesSig } = mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };
  return { desde, hasta: inicioDelDiaBogota(anioSig, mesSig, 1) };
}

/** "desde"/"hasta" en formato YYYY-MM-DD (fecha de calendario en Bogotá), ambos inclusivos. */
export function rangoPersonalizado(desdeYMD: string, hastaYMD: string): RangoFechas | null {
  const desde = new Date(`${desdeYMD}T00:00:00${OFFSET_BOGOTA}`);
  const hastaExclusivo = new Date(`${hastaYMD}T00:00:00${OFFSET_BOGOTA}`);
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hastaExclusivo.getTime())) return null;
  return { desde, hasta: new Date(hastaExclusivo.getTime() + 24 * 60 * 60 * 1000) };
}

/** Mismo largo exacto, inmediatamente anterior a "desde". Correcto para hoy/semana/personalizado -- para "mes" usar rangoAnteriorDe (evita comparar un mes de 31 días contra un tramo de 31 días que no es el mes calendario anterior). */
export function rangoAnterior(rango: RangoFechas): RangoFechas {
  const duracionMs = rango.hasta.getTime() - rango.desde.getTime();
  return { desde: new Date(rango.desde.getTime() - duracionMs), hasta: new Date(rango.desde.getTime()) };
}

/** El mes calendario inmediatamente anterior al de "ahora" (Bogotá) -- length-aware, nunca un tramo de N días. */
export function rangoMesAnterior(ahora: Date): RangoFechas {
  const { anio, mes } = fechaBogotaYMD(ahora);
  const { anio: anioPrev, mes: mesPrev } = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
  return { desde: inicioDelDiaBogota(anioPrev, mesPrev, 1), hasta: inicioDelDiaBogota(anio, mes, 1) };
}

/** Período anterior "correcto" según el tipo -- para "mes" usa el mes calendario anterior, para el resto usa el mismo largo inmediatamente antes. */
export function rangoAnteriorDe(tipo: TipoPeriodo, rango: RangoFechas, ahora: Date): RangoFechas {
  if (tipo === "mes") return rangoMesAnterior(ahora);
  return rangoAnterior(rango);
}

export function resolverRango(
  tipo: TipoPeriodo,
  ahora: Date,
  personalizado?: { desde: string; hasta: string }
): RangoFechas | null {
  if (tipo === "hoy") return rangoHoy(ahora);
  if (tipo === "semana") return rangoSemana(ahora);
  if (tipo === "mes") return rangoMes(ahora);
  if (!personalizado) return null;
  return rangoPersonalizado(personalizado.desde, personalizado.hasta);
}
