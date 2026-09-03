/**
 * Etapa 4 (Flow Builder, autorizado) — tests de permisos de UI. Refleja
 * exactamente lo que ya exige requireFlowAccess en lib/flow/api-auth.ts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canPublishFlow, canPublishNow, canSaveFlow, canValidateFlow, publishDisabledReason } from "@/lib/flow-builder/permissions";
import { applyEdit, createBuilderState, markSaved, markValidated, type BuilderState } from "@/lib/flow-builder/builder-state";
import { updateNodeLabel } from "@/lib/flow-builder/edit-flow";
import type { FlowDefinition } from "@/lib/flow/types";
import type { FlowValidationResult } from "@/lib/flow/errors";

describe("canSaveFlow — solo admin puede Guardar", () => {
  it("admin puede", () => {
    assert.equal(canSaveFlow("admin"), true);
  });
  it("agente NO puede", () => {
    assert.equal(canSaveFlow("agente"), false);
  });
  it("lectura NO puede", () => {
    assert.equal(canSaveFlow("lectura"), false);
  });
  it("sin rol (null) NO puede", () => {
    assert.equal(canSaveFlow(null), false);
  });
});

describe("canValidateFlow — admin y agente pueden Validar", () => {
  it("admin puede", () => {
    assert.equal(canValidateFlow("admin"), true);
  });
  it("agente puede", () => {
    assert.equal(canValidateFlow("agente"), true);
  });
  it("lectura NO puede", () => {
    assert.equal(canValidateFlow("lectura"), false);
  });
  it("sin rol (null) NO puede", () => {
    assert.equal(canValidateFlow(null), false);
  });
});

// ---------------------------------------------------------------------------
// Etapa 5 (autorizado) — canPublishFlow / canPublishNow / publishDisabledReason
// ---------------------------------------------------------------------------

describe("canPublishFlow — solo admin puede Publicar", () => {
  it("admin puede", () => {
    assert.equal(canPublishFlow("admin"), true);
  });
  it("agente NO puede", () => {
    assert.equal(canPublishFlow("agente"), false);
  });
  it("lectura NO puede", () => {
    assert.equal(canPublishFlow("lectura"), false);
  });
  it("sin rol (null) NO puede", () => {
    assert.equal(canPublishFlow(null), false);
  });
});

function fixture(): FlowDefinition {
  return {
    name: "fixture",
    nodes: [{ id: "msg-1", type: "message", config: { text: "hola" } }],
    edges: [],
    variables: [],
  };
}

const OK: FlowValidationResult = { valid: true, errors: [] };

/** Estado "listo para publicar": guardado, validado, vigente, válido, admin. */
function estadoListo(): BuilderState {
  const state = createBuilderState(fixture());
  const editado = applyEdit(state, (f) => updateNodeLabel(f, "msg-1", "v1"));
  const guardado = markSaved(editado, { id: "v1", versionNumber: 1, definition: editado.definition });
  return markValidated(guardado, OK);
}

describe("canPublishNow — gate puro, sin red, combina rol + referencias del estado", () => {
  it("guardado + validado + vigente + válido + admin -> true", () => {
    assert.equal(canPublishNow(estadoListo(), "admin"), true);
  });

  it("mismo estado listo pero con agente -> false (rol insuficiente)", () => {
    assert.equal(canPublishNow(estadoListo(), "agente"), false);
  });

  it("mismo estado listo pero con lectura -> false", () => {
    assert.equal(canPublishNow(estadoListo(), "lectura"), false);
  });

  it("mismo estado listo pero sin rol (null) -> false", () => {
    assert.equal(canPublishNow(estadoListo(), null), false);
  });

  it("state null -> false", () => {
    assert.equal(canPublishNow(null, "admin"), false);
  });

  it("nunca guardado (lastSavedVersion null) -> false", () => {
    const state = createBuilderState(fixture());
    const validado = markValidated(state, OK);
    assert.equal(validado.lastSavedVersion, null);
    assert.equal(canPublishNow(validado, "admin"), false);
  });

  it("nunca validado (lastValidation null) -> false", () => {
    const state = createBuilderState(fixture());
    const guardado = markSaved(state, { id: "v1", versionNumber: 1, definition: state.definition });
    assert.equal(guardado.lastValidation, null);
    assert.equal(canPublishNow(guardado, "admin"), false);
  });

  it("última validación inválida (errores) -> false", () => {
    const state = createBuilderState(fixture());
    const guardado = markSaved(state, { id: "v1", versionNumber: 1, definition: state.definition });
    const invalido: FlowValidationResult = { valid: false, errors: [{ code: "MISSING_START_NODE", message: "x" }] };
    const validado = markValidated(guardado, invalido);
    assert.equal(canPublishNow(validado, "admin"), false);
  });

  it("validación vigente en el momento pero luego se editó (stale) -> false", () => {
    const listo = estadoListo();
    const editadoDeNuevo = applyEdit(listo, (f) => updateNodeLabel(f, "msg-1", "cambio sin validar"));
    assert.equal(canPublishNow(editadoDeNuevo, "admin"), false);
  });

  it("la definición validada es distinta a la de lastSavedVersion (se validó DESPUÉS de guardar, sin volver a guardar) -> false", () => {
    const state = createBuilderState(fixture());
    const editado1 = applyEdit(state, (f) => updateNodeLabel(f, "msg-1", "v1"));
    const guardado = markSaved(editado1, { id: "v1", versionNumber: 1, definition: editado1.definition });
    // edita de nuevo SIN volver a guardar, y valida esa nueva definition
    const editado2 = applyEdit(guardado, (f) => updateNodeLabel(f, "msg-1", "v2 sin guardar"));
    const validadoSinGuardar = markValidated(editado2, OK);
    // lastValidation.definition (la de editado2) !== lastSavedVersion.definition (la de editado1)
    assert.equal(canPublishNow(validadoSinGuardar, "admin"), false);
  });

  it("resultado válido pero con errors.length > 0 de forma inconsistente igual bloquea (defensivo, sin confiar solo en `valid`)", () => {
    const state = createBuilderState(fixture());
    const guardado = markSaved(state, { id: "v1", versionNumber: 1, definition: state.definition });
    const inconsistente: FlowValidationResult = { valid: true, errors: [{ code: "MISSING_START_NODE", message: "x" }] };
    const validado = markValidated(guardado, inconsistente);
    assert.equal(canPublishNow(validado, "admin"), false);
  });
});

describe("publishDisabledReason", () => {
  it("null (listo) cuando canPublishNow es true", () => {
    assert.equal(publishDisabledReason(estadoListo(), "admin"), null);
  });

  it("'Guarda primero...' cuando nunca se guardó", () => {
    const state = createBuilderState(fixture());
    assert.match(publishDisabledReason(state, "admin")!, /Guarda primero/);
  });

  it("'Valida y corrige...' cuando ya se guardó pero falta validar/está inválido/stale", () => {
    const state = createBuilderState(fixture());
    const guardado = markSaved(state, { id: "v1", versionNumber: 1, definition: state.definition });
    assert.match(publishDisabledReason(guardado, "admin")!, /Valida y corrige/);
  });

  it("state null (sin guardar aún) -> mensaje de guardar", () => {
    assert.match(publishDisabledReason(null, "admin")!, /Guarda primero/);
  });
});
