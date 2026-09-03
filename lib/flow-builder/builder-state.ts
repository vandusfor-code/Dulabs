/**
 * Etapa 2 (Flow Builder, autorizado) — estado local del editor: el
 * FlowDefinition editable, el original tal cual llegó de la API (para poder
 * descartar), y si hay cambios sin guardar. Puro: no hace fetch, no toca la
 * API, no persiste nada -- eso es justamente lo que esta etapa NO debe
 * hacer todavía.
 *
 * Etapa 4 (autorizado) agrega lastSavedVersion/lastValidation. La vigencia
 * de "lastValidation" se determina por IGUALDAD DE REFERENCIA contra
 * `definition`, nunca por hash ni por JSON.stringify -- válido porque
 * edit-flow.ts (Etapa 2/3) NUNCA muta un FlowDefinition en el lugar, cada
 * edición crea un objeto nuevo vía spread. Cualquier applyEdit posterior
 * cambia la referencia y automáticamente "vence" la última validación, sin
 * que este archivo tenga que hacer nada especial para eso.
 */

import type { FlowDefinition } from "@/lib/flow/types";
import type { FlowValidationResult } from "@/lib/flow/errors";

export interface SavedVersionInfo {
  id: string;
  versionNumber: number;
  definition: FlowDefinition;
}

export interface ValidationInfo {
  definition: FlowDefinition;
  result: FlowValidationResult;
}

export interface BuilderState {
  original: FlowDefinition;
  definition: FlowDefinition;
  isDirty: boolean;
  lastSavedVersion: SavedVersionInfo | null;
  lastValidation: ValidationInfo | null;
}

export function createBuilderState(loaded: FlowDefinition): BuilderState {
  return { original: loaded, definition: loaded, isDirty: false, lastSavedVersion: null, lastValidation: null };
}

/** Aplica cualquier edición pura (updateNodeLabel/updateNodeConfig/updateNodePosition/addNode/deleteNode/addEdge/deleteEdge) y marca dirty. */
export function applyEdit(state: BuilderState, edit: (flow: FlowDefinition) => FlowDefinition): BuilderState {
  return { ...state, definition: edit(state.definition), isDirty: true };
}

/**
 * Vuelve a la última versión conocida como "buena" -- el original cargado
 * de la API, o la que se guardó más recientemente (ver markSaved: original
 * se actualiza al guardar, así que esto ya cubre ambos casos sin lógica
 * extra acá).
 */
export function discardChanges(state: BuilderState): BuilderState {
  return { ...state, definition: state.original, isDirty: false };
}

/**
 * Tras un POST /versions exitoso: la definición recién guardada (version.definition
 * -- la referencia EXACTA que se mandó al servidor, capturada antes del
 * await, nunca `state.definition` leído después) pasa a ser el nuevo
 * "original" (Descartar cambios después de guardar vuelve A ESTO, no a lo
 * que había antes de guardar). `isDirty` se recalcula comparando contra
 * `state.definition` en vez de asumir `false` a secas: si el guardado y
 * Validar corren en paralelo (permitido, decisión aprobada) y la clienta
 * siguió editando mientras el guardado estaba en curso, `state.definition`
 * ya no es la misma referencia que se guardó -- sigue habiendo cambios
 * reales sin guardar, y "isDirty" debe reflejarlo en vez de esconderlo.
 */
export function markSaved(state: BuilderState, version: SavedVersionInfo): BuilderState {
  return {
    ...state,
    original: version.definition,
    isDirty: state.definition !== version.definition,
    lastSavedVersion: version,
  };
}

/** Tras un POST /validate: guarda el resultado JUNTO CON la referencia exacta de definition que se validó. */
export function markValidated(state: BuilderState, result: FlowValidationResult): BuilderState {
  return {
    ...state,
    lastValidation: { definition: state.definition, result },
  };
}

/** true si lastValidation no existe o quedó obsoleta (la definition cambió de referencia desde que se validó). */
export function isValidationStale(state: BuilderState): boolean {
  return !state.lastValidation || state.lastValidation.definition !== state.definition;
}

/**
 * Etapa 5 (autorizado) — Restaurar: carga una definición histórica (de una
 * versión pasada) como cambio LOCAL sin guardar. Mismo tratamiento que
 * applyEdit: nunca escribe a Supabase, nunca guarda, nunca publica -- solo
 * reemplaza `definition` por una referencia nueva y marca isDirty=true.
 * `original` y `lastSavedVersion` NO se tocan (Descartar cambios después de
 * un Restaurar sin guardar vuelve a lo que había antes de restaurar, igual
 * que con cualquier otro edit). `lastValidation` tampoco se toca -- al ser
 * `definition` una referencia nueva, isValidationStale ya lo detecta solo,
 * sin lógica extra acá (mismo mecanismo que ya usa applyEdit).
 */
export function loadDefinitionForEdit(state: BuilderState, definition: FlowDefinition): BuilderState {
  return { ...state, definition, isDirty: true };
}

/**
 * Professional Flow Editor UX (autorizado) — undo/redo devuelve `definition`
 * al estado que tenía en algún punto del historial LOCAL (nunca al backend).
 * A diferencia de loadDefinitionForEdit (Restaurar, isDirty SIEMPRE true),
 * acá isDirty se recalcula por referencia contra `original`: como
 * lib/flow-builder/history.ts guarda las mismas referencias que alguna vez
 * pasaron por `definition` (nunca clona), deshacer hasta el principio
 * devuelve la referencia EXACTA de `original`, y esto lo detecta solo --
 * "sin cambios" vuelve a ser cierto sin lógica especial en el caller.
 */
export function restoreFromHistory(state: BuilderState, definition: FlowDefinition): BuilderState {
  return { ...state, definition, isDirty: definition !== state.original };
}
