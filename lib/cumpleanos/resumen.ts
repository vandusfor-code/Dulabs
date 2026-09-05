import type { ResultadoClienteCumpleanos } from "./motor";

// Cumpleaños automáticos (Fase 6B, genérico, autorizado) — resumen del lote
// para el endpoint diario: procesados/enviados/omitidos/errores. Pura --
// solo cuenta, no toca Supabase ni Meta.
export type ResumenCumpleanos = { procesados: number; enviados: number; omitidos: number; errores: number };

export function resumirResultados(procesados: ResultadoClienteCumpleanos[]): ResumenCumpleanos {
  let enviados = 0;
  let omitidos = 0;
  let errores = 0;
  for (const p of procesados) {
    if (p.resultado === "enviado" || p.resultado === "simulado") enviados++;
    else if (p.resultado === "ya_procesado") omitidos++;
    else errores++;
  }
  return { procesados: procesados.length, enviados, omitidos, errores };
}
