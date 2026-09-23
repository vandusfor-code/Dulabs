/**
 * Estados de la carga masiva — ÚNICA definición (UI, servicio e historial).
 *
 * Dos niveles, a propósito:
 *
 *   1. Fase de la pantalla (ImportPhase), en el navegador:
 *        draft -> analyzing -> ready -> processing -> completed
 *                                                  -> completed_with_errors
 *                                                  -> failed
 *      (draft/analyzing/ready no se guardan: hasta confirmar no existe nada
 *      en la BD).
 *
 *   2. Estado guardado (PersistedImportStatus), en dulabs_catalogo_importaciones.estado:
 *        "procesando" | "completada"  (CHECK de la migración 20261107000000).
 *      El resultado fino (con errores, fallida, interrumpida) se DERIVA de los
 *      contadores con `outcomeOf`: no hay que migrar la BD para agregar
 *      matices, y no puede haber un estado guardado que contradiga los números.
 */

export const IMPORT_PHASES = ["draft", "analyzing", "ready", "processing", "completed", "completed_with_errors", "failed"] as const;
export type ImportPhase = (typeof IMPORT_PHASES)[number];

/** Transiciones permitidas de la pantalla (cualquier otra es un error de programación). */
const TRANSITIONS: Record<ImportPhase, readonly ImportPhase[]> = {
  draft: ["analyzing"],
  analyzing: ["ready", "draft"],
  ready: ["analyzing", "processing", "draft"],
  processing: ["completed", "completed_with_errors", "failed", "ready"],
  completed: ["draft"],
  completed_with_errors: ["draft"],
  failed: ["draft"],
};

export function canTransition(from: ImportPhase, to: ImportPhase): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function isFinalPhase(p: ImportPhase): p is ImportOutcomeFinal {
  return p === "completed" || p === "completed_with_errors" || p === "failed";
}

/** Valores de la columna `estado` (deben coincidir con el CHECK de la migración). */
export const PERSISTED_STATUS = { processing: "procesando", completed: "completada" } as const;
export type PersistedImportStatus = (typeof PERSISTED_STATUS)[keyof typeof PERSISTED_STATUS];

export type ImportOutcomeFinal = "completed" | "completed_with_errors" | "failed";
/** Resultado de una importación del historial. */
export type ImportOutcome = "processing" | "interrupted" | ImportOutcomeFinal;

/** Una importación que sigue "procesando" después de esto no terminó (pestaña cerrada, sin conexión). */
export const INTERRUPTED_AFTER_MS = 60 * 60 * 1000;

export interface OutcomeCounts {
  created: number;
  errors: number;
  photosFailed: number;
}

/**
 * Resultado final a partir de los números:
 *   - failed: no se creó nada y hubo errores;
 *   - completed_with_errors: se creó algo, pero hubo filas con error o fotos que no subieron;
 *   - completed: todo lo que se podía crear se creó (las filas omitidas por
 *     repetidas NO son errores: es el comportamiento esperado).
 */
export function finalOutcome(c: OutcomeCounts): ImportOutcomeFinal {
  if (c.created === 0 && c.errors > 0) return "failed";
  if (c.errors > 0 || c.photosFailed > 0) return "completed_with_errors";
  return "completed";
}

export function outcomeOf(r: OutcomeCounts & { status: PersistedImportStatus; createdAt: string }, now: number): ImportOutcome {
  if (r.status === PERSISTED_STATUS.processing) {
    return now - new Date(r.createdAt).getTime() > INTERRUPTED_AFTER_MS ? "interrupted" : "processing";
  }
  return finalOutcome(r);
}

/** Textos para la persona (sin términos técnicos). */
export const OUTCOME_LABEL: Record<ImportOutcome, { es: string; en: string; tone: "ok" | "warn" | "error" | "muted" }> = {
  processing: { es: "En curso", en: "In progress", tone: "muted" },
  interrupted: { es: "Interrumpida", en: "Interrupted", tone: "warn" },
  completed: { es: "Completada", en: "Completed", tone: "ok" },
  completed_with_errors: { es: "Completada con correcciones pendientes", en: "Completed, some rows need fixes", tone: "warn" },
  failed: { es: "No se creó ningún producto", en: "No product was created", tone: "error" },
};

/** Pasos que ve la persona (el paso activo sale de la fase). */
export const IMPORT_STEPS = [
  { n: 1, es: "Sube tus productos", en: "Upload your products" },
  { n: 2, es: "Revisa los resultados", en: "Review the results" },
  { n: 3, es: "Confirma la importación", en: "Confirm the import" },
] as const;

export function stepOf(p: ImportPhase): 1 | 2 | 3 {
  if (p === "draft" || p === "analyzing") return 1;
  if (p === "ready") return 2;
  return 3;
}
