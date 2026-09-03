/**
 * Bugfix real (producción, drag&drop de nodos) — aplica los NodeChange/
 * EdgeChange de tipo "select" que @xyflow/react reporta (onNodesChange/
 * onEdgesChange) sobre un set de ids actualmente seleccionados. Pura y
 * testeable sin React ni @xyflow/react -- FlowCanvas.tsx es el único caller
 * real. Ver el comentario junto a su uso en FlowCanvas.tsx para el porqué:
 * con `nodes`/`edges` controlados, el onSelectionChange nativo de
 * @xyflow/react quedaba desincronizado de su propio store interno; esto
 * reconcilia la selección directamente desde los NodeChange/EdgeChange
 * reales, que es lo que la librería espera que el consumidor aplique.
 */

export interface SelectChange {
  type: string;
  // Ausente en changes que no son "select" (ej. NodeAddChange de
  // @xyflow/react no tiene `id`, tiene `item`) -- ver el filtro de abajo.
  id?: string;
  selected?: boolean;
}

/** Ignora cualquier change que no sea type:"select" (dimensions/position/remove/add/replace los maneja otro callback). */
export function applySelectChanges(current: ReadonlySet<string>, changes: readonly SelectChange[]): string[] {
  const next = new Set(current);
  for (const change of changes) {
    if (change.type !== "select" || !change.id) continue;
    if (change.selected) next.add(change.id);
    else next.delete(change.id);
  }
  return [...next];
}
