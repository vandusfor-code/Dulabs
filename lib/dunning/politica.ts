// FASE F16.1 (Commercial Scale — Dunning, autorizado) — política de
// recuperación de pagos. Único lugar donde viven los intervalos de días --
// nunca se hardcodean en otro archivo (cron, webhook, dominio) para poder
// ajustarlos sin tocar la lógica que los usa.
//
// Propuesta inicial del pedido, NO aprobada como política comercial
// definitiva -- deliberadamente fácil de cambiar (una sola constante por
// intervalo, sin mezclarse con lógica).

export const POLITICA_DUNNING = {
  /** Días desde el primer fallo hasta el segundo intento automático de cobro. */
  diasHastaPrimerReintento: 3,
  /** Días desde el primer fallo hasta el segundo aviso (recordatorio) al cliente. */
  diasHastaRecordatorio: 5,
  /** Días desde el primer fallo hasta el último intento automático de cobro. */
  diasHastaUltimoIntento: 7,
  /** Máximo de intentos automáticos de cobro dentro de un ciclo (incluye el que originó el ciclo). */
  maximoIntentos: 3,
} as const;

function sumarDias(base: Date, dias: number): Date {
  const resultado = new Date(base);
  resultado.setUTCDate(resultado.getUTCDate() + dias);
  return resultado;
}

/**
 * Próxima fecha de reintento automático dado el primer fallo del ciclo y
 * cuántos intentos ya se hicieron. Devuelve null cuando ya no corresponde
 * ningún reintento más (se agotó `maximoIntentos` o el día del último
 * intento configurado ya pasó) -- null es la señal para que el llamador
 * cierre el ciclo como vencido_final, nunca para reintentar indefinidamente.
 */
export function calcularProximoIntento(params: { primerFalloAt: Date; intentosRealizados: number }): Date | null {
  if (params.intentosRealizados >= POLITICA_DUNNING.maximoIntentos) return null;
  // El intento 1 ya ocurrió (el pago que abrió el ciclo) -- el intento 2 es
  // "primer reintento", el intento 3 es "último intento". Si la política
  // definiera más intentos que días declarados, se detiene en el último día
  // configurado en vez de inventar una fecha más allá de la política.
  if (params.intentosRealizados === 1) return sumarDias(params.primerFalloAt, POLITICA_DUNNING.diasHastaPrimerReintento);
  if (params.intentosRealizados === 2) return sumarDias(params.primerFalloAt, POLITICA_DUNNING.diasHastaUltimoIntento);
  return null;
}

/** Fecha en la que corresponde mandar el recordatorio (segundo aviso), relativa al primer fallo del ciclo. */
export function fechaRecordatorio(primerFalloAt: Date): Date {
  return sumarDias(primerFalloAt, POLITICA_DUNNING.diasHastaRecordatorio);
}

/** true si, a partir de ahora, ya se agotó la política y el ciclo debe cerrarse como vencido_final. */
export function debeExpirarFinal(params: { intentosRealizados: number; proximoIntentoAt: Date | null }): boolean {
  if (params.intentosRealizados >= POLITICA_DUNNING.maximoIntentos) return true;
  return params.proximoIntentoAt === null;
}
