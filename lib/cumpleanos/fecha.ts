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

/** "HH:mm" actual en la zona horaria del tenant -- misma fuente de verdad (Intl + timeZone) que fechaTenantHoy, nunca la hora del servidor. */
export function horaTenantAhora(zonaHoraria: string, ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: zonaHoraria,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(ahora);
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "00";
  return `${valor("hour")}:${valor("minute")}`;
}

// Mejora Cumpleaños (autorizado) -- hora_envio pasa de campo "muerto" (se
// guardaba pero el motor nunca lo leía) a REALMENTE usado: el cron
// (app/api/cron/cumpleanos) corre periódicamente y solo debe disparar el
// envío real de un tenant cuando su hora local configurada ya llegó, no en
// cualquier pasada. ±15 min de tolerancia (más ancho que los ±5 min de
// recordatorios porque un cumpleaños no es sensible al minuto exacto, y
// porque todavía no se definió la cadencia real del cron -- ver
// app/api/cron/cumpleanos/route.ts). Maneja el cruce de medianoche (ej.
// hora_envio "23:55" y son las "00:05" -- 10 min reales de diferencia, nunca
// 1430).
export function estaEnVentanaDeEnvio(horaEnvio: string, zonaHoraria: string, ahora: Date = new Date(), toleranciaMin = 15): boolean {
  const [hEnvio, mEnvio] = horaEnvio.split(":").map(Number);
  const objetivoMin = hEnvio * 60 + mEnvio;
  const [hAct, mAct] = horaTenantAhora(zonaHoraria, ahora).split(":").map(Number);
  const actualMin = hAct * 60 + mAct;
  const diferencia = Math.abs(actualMin - objetivoMin);
  const diferenciaCircular = Math.min(diferencia, 1440 - diferencia);
  return diferenciaCircular <= toleranciaMin;
}
