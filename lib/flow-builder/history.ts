/**
 * Professional Flow Editor UX (autorizado) — pila de undo/redo genérica,
 * puramente local al editor. Deliberadamente NO sabe nada de FlowDefinition,
 * de guardar versiones ni de la API: eso es builder-state.ts/save-flow.ts.
 * Undo/redo nunca debe depender de un guardado en backend (requisito
 * explícito) -- esto es memoria del navegador, se pierde al recargar.
 *
 * `group` resuelve el problema real de "escribir en un input dispara un
 * edit por cada tecla": si dos pushes consecutivos comparten el mismo
 * `group` (ej. "node:<id>" mientras se edita el mismo nodo), se fusionan en
 * UNA sola entrada de historial en vez de una por tecla. Un `group` de
 * `null` NUNCA se fusiona con nada (ni siquiera con otro `null` seguido) --
 * así cada operación discreta (agregar, borrar, conectar, duplicar, pegar)
 * es siempre su propio paso de undo, sin importar el orden de llamadas.
 */

export interface EditHistory<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
  /** Última `group` usada en un push -- solo para decidir la próxima fusión. */
  readonly lastGroup: string | null;
}

const DEFAULT_MAX_ENTRIES = 100;

export function createHistory<T>(present: T): EditHistory<T> {
  return { past: [], present, future: [], lastGroup: null };
}

/**
 * Registra `next` como el nuevo presente. Si `next === history.present`
 * (mismo valor, sin cambios reales -- FlowDefinition nunca se muta en el
 * lugar, así que esto solo pasa si el caller intentó un no-op), no hace
 * nada: nunca se ensucia el historial con un paso vacío.
 */
export function pushHistory<T>(
  history: EditHistory<T>,
  next: T,
  group: string | null = null,
  maxEntries: number = DEFAULT_MAX_ENTRIES,
): EditHistory<T> {
  if (next === history.present) return history;

  const shouldCoalesce = group !== null && group === history.lastGroup;
  if (shouldCoalesce) {
    return { ...history, present: next, future: [], lastGroup: group };
  }

  const past = [...history.past, history.present];
  const trimmedPast = past.length > maxEntries ? past.slice(past.length - maxEntries) : past;
  return { past: trimmedPast, present: next, future: [], lastGroup: group };
}

export function canUndo<T>(history: EditHistory<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: EditHistory<T>): boolean {
  return history.future.length > 0;
}

/** Sin cambios si no hay nada que deshacer (`canUndo` false) -- nunca lanza. */
export function undo<T>(history: EditHistory<T>): EditHistory<T> {
  if (!canUndo(history)) return history;
  const previous = history.past[history.past.length - 1]!;
  const past = history.past.slice(0, -1);
  // lastGroup se resetea: lo que sigue nunca debe fusionarse silenciosamente
  // con un paso que el usuario acaba de deshacer.
  return { past, present: previous, future: [history.present, ...history.future], lastGroup: null };
}

/** Sin cambios si no hay nada que rehacer (`canRedo` false) -- nunca lanza. */
export function redo<T>(history: EditHistory<T>): EditHistory<T> {
  if (!canRedo(history)) return history;
  const next = history.future[0]!;
  const future = history.future.slice(1);
  return { past: [...history.past, history.present], future, present: next, lastGroup: null };
}

/** Reinicia el historial al valor actual, sin pasado ni futuro -- usado tras cargar/recargar un flow distinto. */
export function resetHistory<T>(present: T): EditHistory<T> {
  return createHistory(present);
}
