import type { ResultadoCandidatoFidelizacion } from "./motor";

// Fidelización (Fase 7, genérico, autorizado) — resumen del lote para el
// endpoint diario. Pura -- solo cuenta, no toca Supabase.
export type ResumenFidelizacion = { procesados: number; generadas: number; candidatos: number; omitidas: number };

export function resumirResultados(procesados: ResultadoCandidatoFidelizacion[]): ResumenFidelizacion {
  let generadas = 0;
  let candidatosDryRun = 0;
  let omitidas = 0;
  for (const p of procesados) {
    if (p.resultado === "generada") generadas++;
    else if (p.resultado === "candidato") candidatosDryRun++;
    else omitidas++;
  }
  return { procesados: procesados.length, generadas, candidatos: candidatosDryRun, omitidas };
}
