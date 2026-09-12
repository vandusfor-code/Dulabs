/**
 * FASE F7 (Contacts + Variables + Tags, autorizado) — tests del caso REAL
 * "etiquetar_conversacion" en InternalActionExecutor (antes un callejón sin
 * salida: "internal_action_not_supported"). Cubre:
 *  - 11. agregar tag
 *  - 12. no duplicar tag (dedup)
 *  - 13. quitar tag
 *  - 17. tenant isolation de tags
 *  - 18. Action + Condition integradas dentro de UNA misma ejecución (el
 *    tag agregado por la Action debe ser visible para una Condición del
 *    MISMO turno, sin ningún cambio al engine -- ver diseño "tag:<nombre>"
 *    en flow-engine.ts::evaluateRule, exists/not_exists).
 *
 * No usa Supabase real: agregarEtiquetaAConversacion/quitarEtiquetaDeConversacion
 * se inyectan como fakes (InternalActionDeps ya las declara OPCIONALES,
 * mismo patrón que el resto de dependencias de este archivo).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalActionExecutor, type InternalActionDeps } from "@/lib/flow/executors/internal-action-executor";
import type { InternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import type { EffectDispatchRequest } from "@/lib/flow/executor-types";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import type { FlowDefinition } from "@/lib/flow/types";
import type { EtiquetaOperationResult } from "@/lib/etiquetas";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function baseRequest(overrides: Partial<EffectDispatchRequest> = {}): EffectDispatchRequest {
  return {
    effectId: "fx-1",
    executionRowId: "exec-row-1",
    tenantId: TENANT_A,
    nodeId: "node-1",
    kind: "action",
    payload: {},
    attempt: 1,
    ...overrides,
  };
}

function alwaysOwnedAuthorizer(): InternalActionAuthorizer {
  return {
    assertActivacionOwnedByTenant: async () => true,
    assertPhoneNumberOwnedByTenant: async () => true,
  };
}

function baseInternalDeps(overrides: Partial<InternalActionDeps> = {}): InternalActionDeps {
  return {
    supabase: {} as SupabaseClient,
    authorizer: alwaysOwnedAuthorizer(),
    guardarLeadEnterprise: async () => ({ success: false, error: "unused" }),
    activarPausaChat: async () => ({ ok: false, error: "unused" }),
    verificarDisponibilidad: async () => false,
    sugerirHorariosLibres: async () => [],
    crearCita: async () => null,
    readPausaUntil: async () => null,
    consultarDisponibilidadEspecialista: async () => ({ ok: false as const, motivo: "servicio_no_manejado" as const, detalle: "stub" }),
    validarServicioEspecialista: async () => ({ ok: false as const, motivo: "servicio_no_manejado" as const, detalle: "stub" }),
    agendarCitaEspecialista: async () => ({ ok: false as const, motivo: "servicio_no_manejado" as const, detalle: "stub" }),
    cancelarCitaEspecialista: async () => ({ ok: false as const, motivo: "sin_cita_activa" as const, detalle: "stub" }),
    consultarCitasActivasEspecialista: async () => ({ cantidad: 0, citas: [] }),
    moverCitaEspecialista: async () => ({ ok: false as const, motivo: "sin_cita_activa" as const, detalle: "stub" }),
    listarHorariosDisponiblesEspecialista: async () => ({ ok: false as const, motivo: "servicio_no_manejado" as const, detalle: "stub" }),
    ...overrides,
  };
}

const conversation = { phoneNumberId: "123", telefonoCliente: "573001112233" };

describe("FASE F7 — InternalActionExecutor::etiquetar_conversacion", () => {
  it("11. agrega una etiqueta -> data expone tag:<nombre>='1'", async () => {
    let calls = 0;
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        agregarEtiquetaAConversacion: async (_supabase, params) => {
          calls += 1;
          assert.equal(params.tenantId, TENANT_A);
          assert.equal(params.etiquetaId, 7);
          return { ok: true, nombre: "cliente_vip" };
        },
      }),
    );
    const result = await executor.dispatch(
      baseRequest({
        action: { actionType: "etiquetar_conversacion", tagId: "7" },
        conversation,
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal(result.data?.["tag:cliente_vip"], "1");
    assert.equal(calls, 1);
  });

  it("12. no duplica tag -- el 23505 ya lo resuelve lib/etiquetas.ts como éxito idempotente", async () => {
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        // Simula lib/etiquetas.ts tratando 23505 como éxito (comportamiento
        // real de agregarEtiquetaAConversacion): la segunda llamada también
        // debe verse como éxito desde el executor.
        agregarEtiquetaAConversacion: async (): Promise<EtiquetaOperationResult> => ({
          ok: true,
          nombre: "cliente_vip",
        }),
      }),
    );
    const first = await executor.dispatch(
      baseRequest({ action: { actionType: "etiquetar_conversacion", tagId: "7" }, conversation }),
      { tenantId: TENANT_A, internal: true },
    );
    const second = await executor.dispatch(
      baseRequest({ action: { actionType: "etiquetar_conversacion", tagId: "7" }, conversation }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(first.success, true);
    assert.equal(second.success, true);
  });

  it("13. quita una etiqueta -> data expone tag:<nombre>='' (nunca boolean false)", async () => {
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        quitarEtiquetaDeConversacion: async () => ({ ok: true, nombre: "cliente_vip" }),
      }),
    );
    const result = await executor.dispatch(
      baseRequest({
        action: { actionType: "etiquetar_conversacion", tagId: "7", operacion: "quitar" },
        conversation,
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal(result.data?.["tag:cliente_vip"], "");
  });

  it("17. tenant isolation -- etiqueta de otro tenant -> SECURITY_REJECTED, nunca se aplica", async () => {
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        agregarEtiquetaAConversacion: async (_supabase, params) => {
          // lib/etiquetas.ts real: la etiqueta 7 pertenece a TENANT_B, no a
          // params.tenantId (TENANT_A) -- resolverEtiquetaDelTenant no la
          // encuentra -> tag_not_found.
          if (params.tenantId !== TENANT_B) return { ok: false, motivo: "tag_not_found" };
          return { ok: true, nombre: "cliente_vip" };
        },
      }),
    );
    const result = await executor.dispatch(
      baseRequest({
        tenantId: TENANT_A,
        action: { actionType: "etiquetar_conversacion", tagId: "7" },
        conversation,
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.error, "tag_not_found");
  });

  it("validación -- sin conversation -> VALIDATION_ERROR (nunca llama a Supabase)", async () => {
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        agregarEtiquetaAConversacion: async () => {
          throw new Error("no debía llamarse sin conversation");
        },
      }),
    );
    const result = await executor.dispatch(
      baseRequest({ action: { actionType: "etiquetar_conversacion", tagId: "7" } }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.error, "conversation_required");
  });
});

// ---------------------------------------------------------------------------
// 18. Action + Condition integradas dentro de UNA misma ejecución.
// ---------------------------------------------------------------------------
// Prueba end-to-end (Engine real + Executor real, sin orchestrator/Supabase)
// de que el tag agregado por la Action queda visible para la Condición del
// MISMO turno -- exactamente el mecanismo genérico ya existente en
// flow-engine.ts::handleEffectResult (rama "action": sin outputVariables
// configurado, TODAS las claves de `data` se copian a state.variables) --
// CERO cambios al engine para que esto funcione.

function actionThenConditionFlow(): FlowDefinition {
  return {
    name: "F7 — etiquetar + condición",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "manual" } },
      { id: "act", type: "action", config: { actionType: "etiquetar_conversacion", tagId: "7" } },
      {
        id: "cond",
        type: "condition",
        config: { rules: [{ field: "tag:cliente_vip", operator: "exists" }], match: "all" },
      },
      { id: "end-vip", type: "end", config: {} },
      { id: "end-normal", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "act" },
      { id: "e2", source: "act", target: "cond" },
      { id: "e3", source: "cond", target: "end-vip", sourceHandle: "true" },
      { id: "e4", source: "cond", target: "end-normal", sourceHandle: "false" },
    ],
    variables: [],
  };
}

describe("FASE F7 — Action etiquetar_conversacion + Condition en la misma ejecución (test 18)", () => {
  it("agrega el tag vía Action y la Condition del mismo turno lo ve como true", async () => {
    const flow = actionThenConditionFlow();
    let state = createFlowEngineState(flow, { executionId: "exec-1" });

    const start = runFlowEngine(flow, state, { type: "start", eventId: "evt-start" });
    assert.equal(start.error, undefined);
    state = start.state;
    assert.equal(state.status, "waiting_effect");
    const pending = state.pendingEffect;
    assert.ok(pending);

    const executor = new InternalActionExecutor(
      baseInternalDeps({
        agregarEtiquetaAConversacion: async () => ({ ok: true, nombre: "cliente_vip" }),
      }),
    );
    const dispatchResult = await executor.dispatch(
      {
        effectId: pending!.effectId,
        executionRowId: "exec-row-1",
        tenantId: TENANT_A,
        nodeId: pending!.nodeId,
        kind: "action",
        payload: {},
        attempt: 1,
        action: { actionType: "etiquetar_conversacion", tagId: "7" },
        conversation,
      },
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(dispatchResult.success, true);

    const afterEffect = runFlowEngine(flow, state, {
      type: "effect_result",
      eventId: "evt-effect-1",
      effectId: pending!.effectId,
      success: true,
      data: dispatchResult.data as Record<string, unknown>,
    });
    assert.equal(afterEffect.error, undefined);
    state = afterEffect.state;

    assert.equal(state.variables["tag:cliente_vip"], "1");
    assert.equal(state.currentNodeId, "end-vip");
    assert.equal(state.status, "completed");
  });

  it("sin la Action (tag nunca agregado), la Condition evalúa false -- nunca lanza", async () => {
    const flow: FlowDefinition = {
      name: "F7 — solo condición, sin tag",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "cond",
          type: "condition",
          config: { rules: [{ field: "tag:cliente_vip", operator: "exists" }], match: "all" },
        },
        { id: "end-vip", type: "end", config: {} },
        { id: "end-normal", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "cond" },
        { id: "e2", source: "cond", target: "end-vip", sourceHandle: "true" },
        { id: "e3", source: "cond", target: "end-normal", sourceHandle: "false" },
      ],
      variables: [],
    };
    const state0 = createFlowEngineState(flow, { executionId: "exec-2" });
    const result = runFlowEngine(flow, state0, { type: "start", eventId: "evt-start" });
    assert.equal(result.error, undefined);
    assert.equal(result.state.currentNodeId, "end-normal");
    assert.equal(result.state.status, "completed");
  });
});
