// Cumpleaños automáticos (Fase 6A, genérico, autorizado) — la fecha "de
// hoy" SIEMPRE se resuelve en la zona horaria del tenant, nunca en la del
// servidor (Vercel corre en UTC). Usar Date.getDate()/getMonth() del
// servidor haría que un cliente colombiano "pierda" su cumpleaños cerca de
// medianoche -- Intl.DateTimeFormat con `timeZone` es la única fuente de
// verdad acá.
export function fechaTenantHoy(zonaHoraria: string, ahora: Date = new Date()): { dia: number; mes: number; anio: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: zonaHoraria,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ahora);

  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  return { dia: valor("day"), mes: valor("month"), anio: valor("year") };
}
