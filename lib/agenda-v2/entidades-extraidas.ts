/**
 * NUEVA FASE (autorizado, extracción de datos para RESERVAR_CITA) — resuelve
 * una mención libre ("Mary", "las uñas") contra una lista de opciones REALES
 * ya resueltas por el backend (catálogo activo, especialistas elegibles).
 * Mismo criterio EXACTO que el resto de Agenda V2: nunca IA/fuzzy real,
 * comparación de texto normalizado. Si hay CERO o MÁS DE UNA coincidencia,
 * devuelve `undefined` -- nunca adivina entre varias, nunca inventa una que
 * no exista. El caller (lib/agenda-v2/router.ts) trata `undefined` igual que
 * "la clienta no mencionó nada": cae al menú normal de esa opción.
 */
import { normalizeText } from "@/lib/flow-triggers/normalize-text";

export function resolverMencionUnica<T>(mencion: string, opciones: T[], nombreDe: (opcion: T) => string): T | undefined {
  const men = normalizeText(mencion);
  if (!men) return undefined;

  const coincidencias = opciones.filter((o) => {
    const nombre = normalizeText(nombreDe(o));
    if (!nombre) return false;
    return nombre === men || nombre.includes(men) || men.includes(nombre);
  });

  return coincidencias.length === 1 ? coincidencias[0] : undefined;
}

/** Texto crudo extraído por Gemini (ver lib/amore-entrada-gemini.ts) -- NUNCA un dato ya resuelto/validado. */
export interface EntidadesExtraidasReserva {
  servicioMencion?: string | null;
  profesionalMencion?: string | null;
  fechaMencion?: string | null;
  horaMencion?: string | null;
}
