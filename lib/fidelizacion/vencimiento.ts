// Fidelización (Fase 7, genérico, autorizado) — 3) cálculo de vencimiento.
// Puro: nunca llama Date.now() por su cuenta, siempre recibe `ahora`.

/** Días completos transcurridos desde la visita hasta `ahora` (piso, no redondeo). */
export function diasTranscurridos(fechaVisita: Date, ahora: Date): number {
  const ms = ahora.getTime() - fechaVisita.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * true desde el día exacto configurado en adelante (>=, no ==): si el
 * motor no corre justo ese día (mantenimiento, cron caído), la visita
 * sigue siendo candidata al día siguiente en vez de perderse para siempre.
 */
export function haVencido(fechaVisita: Date, dias: number, ahora: Date): boolean {
  return diasTranscurridos(fechaVisita, ahora) >= dias;
}
