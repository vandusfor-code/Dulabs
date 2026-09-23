/**
 * NUEVA FASE (autorizado, extracción de datos para RESERVAR_CITA) — resuelve
 * una mención libre ("Mary", "las uñas") contra una lista de opciones REALES
 * ya resueltas por el backend (catálogo activo, especialistas elegibles).
 * Si hay CERO o MÁS DE UNA coincidencia, devuelve `undefined` -- nunca adivina
 * entre varias, nunca inventa una que no exista. El caller
 * (lib/agenda-v2/router.ts) trata `undefined` igual que "la clienta no
 * mencionó nada": cae al menú normal de esa opción.
 *
 * Corrección (auditoría): antes comparaba por SUBCADENA
 * (`nombre.includes(mención) || mención.includes(nombre)`), lo que
 * contradecía el "nunca fuzzy" y podía prellenar a la persona equivocada:
 * "con Ana" elegía a "Mariana", "con Mar" a "Mary", "Natalia" a "Nata". Ahora
 * usa la MISMA coincidencia por palabra completa que el resto de Agenda V2
 * (lib/agenda-v2/seleccion-natural.ts).
 */
import { resolverPorNombre } from "@/lib/agenda-v2/seleccion-natural";

export function resolverMencionUnica<T>(mencion: string, opciones: T[], nombreDe: (opcion: T) => string): T | undefined {
  const r = resolverPorNombre(mencion, opciones, nombreDe);
  return r.tipo === "unica" ? r.opcion : undefined;
}

/** Texto crudo extraído por Gemini (ver lib/amore-entrada-gemini.ts) -- NUNCA un dato ya resuelto/validado. */
export interface EntidadesExtraidasReserva {
  servicioMencion?: string | null;
  profesionalMencion?: string | null;
  fechaMencion?: string | null;
  horaMencion?: string | null;
}
