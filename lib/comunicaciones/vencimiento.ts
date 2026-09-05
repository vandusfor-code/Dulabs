// Confirmaciones y recordatorios (Fase 8, genérico, autorizado) — cálculo
// PURO de ventanas de tiempo. Nunca llama Date.now() por su cuenta, siempre
// recibe `ahora`.

/** Una cita confirmada siempre es candidata a confirmación mientras todavía no haya ocurrido -- no tiene ventana de tiempo, a diferencia del recordatorio. */
export function debeConfirmarse(inicioCita: Date, ahora: Date): boolean {
  return inicioCita.getTime() > ahora.getTime();
}

/**
 * true desde que faltan `anticipacionHoras` (o menos) para la cita, MIENTRAS
 * la cita siga siendo futura. Ventana acotada por ambos lados a propósito:
 * - por debajo (<= anticipación): no se avisa con demasiada anticipación.
 * - por arriba (> 0, todavía no pasó): una cita ya iniciada/pasada nunca
 *   recibe un recordatorio, aunque el motor no haya corrido a tiempo.
 */
export function debeRecordarse(inicioCita: Date, anticipacionHoras: number, ahora: Date): boolean {
  const horasHastaLaCita = (inicioCita.getTime() - ahora.getTime()) / (60 * 60 * 1000);
  return horasHastaLaCita > 0 && horasHastaLaCita <= anticipacionHoras;
}
