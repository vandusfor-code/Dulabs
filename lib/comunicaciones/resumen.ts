import type { ResultadoCitaComunicacion } from "./motor";

// Confirmaciones y recordatorios (Fase 8, genérico, autorizado) — resumen
// del lote para el endpoint diario. Pura -- solo cuenta, no toca Supabase.
export type ResumenComunicaciones = { procesados: number; procesadas: number; candidatos: number; omitidas: number; errores: number };

export function resumirResultados(procesados: ResultadoCitaComunicacion[]): ResumenComunicaciones {
  let procesadas = 0;
  let candidatos = 0;
  let omitidas = 0;
  let errores = 0;
  for (const p of procesados) {
    if (p.resultado === "procesada") procesadas++;
    else if (p.resultado === "candidata") candidatos++;
    else if (p.resultado === "ya_procesada") omitidas++;
    else errores++;
  }
  return { procesados: procesados.length, procesadas, candidatos, omitidas, errores };
}
