/**
 * Etapa 2 (Flow Builder, autorizado) — tests de dirty state y descartar.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyEdit,
  createBuilderState,
  discardChanges,
  isValidationStale,
  loadDefinitionForEdit,
  markSaved,
  markValidated,
  restoreFromHistory,
} from "@/lib/flow-builder/builder-state";
import { updateNodeLabel } from "@/lib/flow-builder/edit-flow";
import type { FlowDefinition } from "@/lib/flow/types";
import type { FlowValidationResult } from "@/lib/flow/errors";

function fixture(): FlowDefinition {
  return {
    name: "fixture",
    nodes: [{ id: "msg-1", type: "message", config: { text: "hola" } }],
    edges: [],
    variables: [],
  };
}

describe("builder-state", () => {
  it("16a. estado inicial no está dirty", () => {
    const state = createBuilderState(fixture());
    assert.equal(state.isDirty, false);
  });

  it("16b. aplicar una edición marca isDirty=true", () => {
    const state = createBuilderState(fixture());
    const edited = applyEdit(state, (flow) => updateNodeLabel(flow, "msg-1", "nuevo label"));
    assert.equal(edited.isDirty, true);
    assert.equal(edited.definition.nodes[0].label, "nuevo label");
  });

  it("17. discardChanges vuelve exactamente al original y limpia isDirty", () => {
    const state = createBuilderState(fixture());
    const edited = applyEdit(state, (flow) => updateNodeLabel(flow, "msg-1", "nuevo label"));
    const discarded = discardChanges(edited);
    assert.equal(discarded.isDirty, false);
    assert.deepEqual(discarded.definition, state.original);
    assert.equal(discarded.definition.nodes[0].label, undefined);
  });

  it("17b. discardChanges no llama red ni muta el original", () => {
    const state = createBuilderState(fixture());
    const edited = applyEdit(state, (flow) => updateNodeLabel(flow, "msg-1", "x"));
    discardChanges(edited);
    // el `original` guardado en el estado nunca cambió
    assert.equal(state.original.nodes[0].label, undefined);
  });
});

// ---------------------------------------------------------------------------
// Etapa 4 (autorizado) — markSaved / markValidated / staleness por referencia.
// ---------------------------------------------------------------------------

const OK_RESULT: FlowValidationResult = { valid: true, errors: [] };

describe("markSaved", () => {
  it("actualiza original a la definition recién guardada", () => {
    const state = createBuilderState(fixture());
    const edited = applyEdit(state, (flow) => updateNodeLabel(flow, "msg-1", "editado"));
    const saved = markSaved(edited, { id: "v1", versionNumber: 1, definition: edited.definition });
    assert.equal(saved.original, edited.definition);
    assert.equal(saved.original.nodes[0].label, "editado");
  });

  it("pone isDirty=false", () => {
    const state = createBuilderState(fixture());
    const edited = applyEdit(state, (flow) => updateNodeLabel(flow, "msg-1", "x"));
    assert.equal(edited.isDirty, true);
    const saved = markSaved(edited, { id: "v1", versionNumber: 1, definition: edited.definition });
    assert.equal(saved.isDirty, false);
  });

  it("conserva lastSavedVersion tal cual se le pasó", () => {
    const state = createBuilderState(fixture());
    const version = { id: "v7", versionNumber: 7, definition: state.definition };
    const saved = markSaved(state, version);
    assert.equal(saved.lastSavedVersion, version);
    assert.equal(saved.lastSavedVersion?.versionNumber, 7);
  });

  it("no toca definition ni lastValidation", () => {
    const state = createBuilderState(fixture());
    const validado = markValidated(state, OK_RESULT);
    const saved = markSaved(validado, { id: "v1", versionNumber: 1, definition: validado.definition });
    assert.equal(saved.definition, validado.definition);
    assert.equal(saved.lastValidation, validado.lastValidation);
  });

  it("carrera real: si se sigue editando MIENTRAS el guardado está en curso, isDirty se recalcula (no se asume false) y original queda en lo REALMENTE guardado, no en el edit posterior", () => {
    const state = createBuilderState(fixture());
    // "handleSave" captura esta referencia ANTES del await -- es lo que
    // realmente viaja al servidor.
    const definicionEnviada = state.definition;
    // mientras la petición está en vuelo, la clienta sigue editando (Guardar
    // no bloquea el canvas -- decisión aprobada #3, ni siquiera bloquea
    // editar, solo bloquea el propio botón Guardar).
    const editadoDuranteElGuardado = applyEdit(state, (flow) => updateNodeLabel(flow, "msg-1", "edité mientras guardaba"));
    // la petición resuelve: markSaved se llama con la definition ORIGINAL
    // que se mandó, no con la definition actual del state (que ya cambió).
    const saved = markSaved(editadoDuranteElGuardado, { id: "v1", versionNumber: 1, definition: definicionEnviada });
    assert.equal(saved.original, definicionEnviada, "lo guardado de verdad, no lo editado después");
    assert.equal(saved.isDirty, true, "SIGUE habiendo cambios reales sin guardar -- nunca debe mostrarse 'Guardado' sin cambios pendientes");
    assert.equal(saved.definition.nodes[0].label, "edité mientras guardaba", "la edición en curso no se pierde");
  });

  it("descartar después de guardar vuelve a la versión RECIÉN GUARDADA, no a la anterior al guardado", () => {
    const state = createBuilderState(fixture());
    const editado1 = applyEdit(state, (flow) => updateNodeLabel(flow, "msg-1", "version guardada"));
    const guardado = markSaved(editado1, { id: "v1", versionNumber: 1, definition: editado1.definition });
    const editado2 = applyEdit(guardado, (flow) => updateNodeLabel(flow, "msg-1", "cambio sin guardar"));
    assert.equal(editado2.definition.nodes[0].label, "cambio sin guardar");
    const descartado = discardChanges(editado2);
    assert.equal(descartado.definition.nodes[0].label, "version guardada", "debe volver a lo guardado, no al fixture original");
    assert.equal(descartado.isDirty, false);
  });
});

describe("markValidated", () => {
  it("guarda EXACTAMENTE la referencia de definition que se validó", () => {
    const state = createBuilderState(fixture());
    const validado = markValidated(state, OK_RESULT);
    assert.equal(validado.lastValidation?.definition, state.definition);
  });

  it("guarda el resultado tal cual se le pasó", () => {
    const state = createBuilderState(fixture());
    const errores: FlowValidationResult = { valid: false, errors: [{ code: "MISSING_START_NODE", message: "x" }] };
    const validado = markValidated(state, errores);
    assert.equal(validado.lastValidation?.result, errores);
  });

  it("no toca definition/original/isDirty/lastSavedVersion", () => {
    const state = createBuilderState(fixture());
    const validado = markValidated(state, OK_RESULT);
    assert.equal(validado.definition, state.definition);
    assert.equal(validado.original, state.original);
    assert.equal(validado.isDirty, state.isDirty);
    assert.equal(validado.lastSavedVersion, state.lastSavedVersion);
  });
});

describe("isValidationStale — vigencia por referencia, NUNCA por hash/JSON.stringify", () => {
  it("sin ninguna validación previa -> stale", () => {
    const state = createBuilderState(fixture());
    assert.equal(isValidationStale(state), true);
  });

  it("recién validado, sin ediciones -> vigente", () => {
    const state = createBuilderState(fixture());
    const validado = markValidated(state, OK_RESULT);
    assert.equal(isValidationStale(validado), false);
  });

  it("cualquier applyEdit posterior invalida la validación automáticamente", () => {
    const state = createBuilderState(fixture());
    const validado = markValidated(state, OK_RESULT);
    const editado = applyEdit(validado, (flow) => updateNodeLabel(flow, "msg-1", "cambio"));
    assert.equal(isValidationStale(editado), true);
  });

  it("un edit que produce contenido IDÉNTICO igual queda stale -- es por referencia, no por igualdad de contenido", () => {
    const state = createBuilderState(fixture());
    const validado = markValidated(state, OK_RESULT);
    // updateNodeLabel con el MISMO label que ya tenía: el contenido resultante
    // es profundamente igual (deepEqual), pero edit-flow.ts igual construye
    // un objeto nuevo (spread) -- la referencia cambia de todas formas.
    const editado = applyEdit(validado, (flow) => updateNodeLabel(flow, "msg-1", "mismo-label"));
    const editadoOtraVez = applyEdit(editado, (flow) => updateNodeLabel(flow, "msg-1", "mismo-label"));
    assert.deepEqual(editado.definition, editadoOtraVez.definition, "mismo contenido...");
    assert.notEqual(editado.definition, editadoOtraVez.definition, "...pero distinta referencia");
    const validadoDeNuevo = markValidated(editado, OK_RESULT);
    const editadoIgualDeNuevo = applyEdit(validadoDeNuevo, (flow) => updateNodeLabel(flow, "msg-1", "mismo-label"));
    assert.equal(isValidationStale(editadoIgualDeNuevo), true);
  });

  it("markSaved no revalida ni invalida lastValidation por sí solo", () => {
    const state = createBuilderState(fixture());
    const validado = markValidated(state, OK_RESULT);
    const guardado = markSaved(validado, { id: "v1", versionNumber: 1, definition: validado.definition });
    assert.equal(isValidationStale(guardado), false, "guardar no cambia la referencia de definition, sigue vigente");
  });
});

// ---------------------------------------------------------------------------
// Etapa 5 (autorizado) — loadDefinitionForEdit (Restaurar).
// ---------------------------------------------------------------------------

describe("loadDefinitionForEdit — Restaurar: carga una definición histórica como cambio local sin guardar", () => {
  const definicionHistorica: FlowDefinition = {
    name: "fixture",
    nodes: [{ id: "msg-1", type: "message", label: "versión histórica restaurada", config: { text: "hola" } }],
    edges: [],
    variables: [],
  };

  it("crea una referencia nueva de definition (no reutiliza la anterior)", () => {
    const state = createBuilderState(fixture());
    const restaurado = loadDefinitionForEdit(state, definicionHistorica);
    assert.equal(restaurado.definition, definicionHistorica);
    assert.notEqual(restaurado.definition, state.definition);
  });

  it("definition cambia al contenido de la versión histórica", () => {
    const state = createBuilderState(fixture());
    const restaurado = loadDefinitionForEdit(state, definicionHistorica);
    assert.equal(restaurado.definition.nodes[0].label, "versión histórica restaurada");
  });

  it("isDirty pasa a true -- se comporta exactamente como una edición", () => {
    const state = createBuilderState(fixture());
    assert.equal(state.isDirty, false);
    const restaurado = loadDefinitionForEdit(state, definicionHistorica);
    assert.equal(restaurado.isDirty, true);
  });

  it("original permanece intacto -- Descartar después de Restaurar (sin guardar) vuelve a lo de antes de restaurar", () => {
    const state = createBuilderState(fixture());
    const restaurado = loadDefinitionForEdit(state, definicionHistorica);
    assert.equal(restaurado.original, state.original);
    const descartado = discardChanges(restaurado);
    assert.deepEqual(descartado.definition, state.original);
  });

  it("lastSavedVersion permanece intacto -- Restaurar no toca lo último guardado hasta que la clienta pulse Guardar", () => {
    const state = createBuilderState(fixture());
    const guardado = markSaved(state, { id: "v1", versionNumber: 1, definition: state.definition });
    const restaurado = loadDefinitionForEdit(guardado, definicionHistorica);
    assert.equal(restaurado.lastSavedVersion, guardado.lastSavedVersion);
  });

  it("la validación anterior queda stale automáticamente por la nueva referencia, sin tocar lastValidation", () => {
    const state = createBuilderState(fixture());
    const validado = markValidated(state, OK_RESULT);
    const restaurado = loadDefinitionForEdit(validado, definicionHistorica);
    assert.equal(restaurado.lastValidation, validado.lastValidation, "no se toca directamente");
    assert.equal(isValidationStale(restaurado), true, "pero queda obsoleta por la referencia nueva de definition");
  });
});

describe("restoreFromHistory — Professional Editor UX (undo/redo, autorizado)", () => {
  it("deshacer hasta la referencia ORIGINAL exacta vuelve isDirty a false (a diferencia de loadDefinitionForEdit)", () => {
    const state = createBuilderState(fixture());
    // El historial guarda la MISMA referencia que fue `original` -- simula
    // que undo() llegó justo hasta ahí.
    const restaurado = restoreFromHistory(state, state.original);
    assert.equal(restaurado.isDirty, false);
  });

  it("restaurar a una referencia DISTINTA de original sí marca dirty", () => {
    const state = createBuilderState(fixture());
    const editado = updateNodeLabel(state.definition, "msg-1", "cambiado");
    const restaurado = restoreFromHistory(state, editado);
    assert.equal(restaurado.isDirty, true);
  });

  it("no toca lastSavedVersion ni lastValidation directamente", () => {
    const state = createBuilderState(fixture());
    const guardado = markSaved(state, { id: "v1", versionNumber: 1, definition: state.definition });
    const validado = markValidated(guardado, OK_RESULT);
    const otraDefinicion = updateNodeLabel(validado.definition, "msg-1", "otro valor del historial");
    const restaurado = restoreFromHistory(validado, otraDefinicion);
    assert.equal(restaurado.lastSavedVersion, validado.lastSavedVersion);
    assert.equal(restaurado.lastValidation, validado.lastValidation);
  });

  it("tras guardar, deshacer hasta el nuevo 'original' (= lo guardado) también vuelve isDirty a false", () => {
    const state = createBuilderState(fixture());
    const guardado = markSaved(state, { id: "v1", versionNumber: 1, definition: state.definition });
    // markSaved actualiza `original` a la definition guardada -- deshacer
    // hasta ESA referencia (no la de carga inicial) debe ser "sin cambios".
    const restaurado = restoreFromHistory(guardado, guardado.original);
    assert.equal(restaurado.isDirty, false);
  });
});
