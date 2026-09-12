/**
 * FASE F7 (Contacts + Variables + Tags, autorizado) — semántica de
 * condiciones basadas en tags, vía la convención "tag:<nombre>" sembrada en
 * state.variables (ver flow-orchestrator.ts::createExecutionRow y
 * internal-action-executor.ts::etiquetarConversacionAction). CERO cambios a
 * evaluateRule/evaluateCondition/ConditionOperator -- se reutilizan tal
 * cual "exists"/"not_exists", ya existentes desde antes de F7.
 *
 * Cubre:
 *  - 14. condición tag=true (variable "tag:x" presente -> exists = true)
 *  - 15. condición tag=false (variable "tag:x" ausente -> exists = false,
 *    not_exists = true)
 *  - 16. contacto sin ningún tag -- el flow no lanza, simplemente toma la
 *    rama "false"/"ausente".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import type { FlowDefinition } from "@/lib/flow/types";

function tagConditionFlow(): FlowDefinition {
  return {
    name: "F7 — condición de tag",
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
}

describe("FASE F7 — Condition sobre tag:<nombre> (sin cambios al engine)", () => {
  it("14. tag presente ('1', sembrado al iniciar la ejecución) -> exists = true", () => {
    const flow = tagConditionFlow();
    const state0 = createFlowEngineState(flow, { executionId: "exec-tag-true" });
    state0.variables["tag:cliente_vip"] = "1";
    const result = runFlowEngine(flow, state0, { type: "start", eventId: "evt-1" });
    assert.equal(result.error, undefined);
    assert.equal(result.state.currentNodeId, "end-vip");
    assert.equal(result.state.status, "completed");
  });

  it("15. tag quitado en el mismo turno ('', nunca boolean false) -> exists = false", () => {
    const flow = tagConditionFlow();
    const state0 = createFlowEngineState(flow, { executionId: "exec-tag-removed" });
    // Simula un tag que estaba asignado (sembrado true al iniciar) y luego
    // se quitó DENTRO de la misma ejecución -- debe ganar la sobrescritura
    // explícita "", nunca quedar pegado al valor sembrado.
    state0.variables["tag:cliente_vip"] = "";
    const result = runFlowEngine(flow, state0, { type: "start", eventId: "evt-1" });
    assert.equal(result.error, undefined);
    assert.equal(result.state.currentNodeId, "end-normal");
  });

  it("16. contacto sin ningún tag (variable nunca sembrada) -> exists = false, no lanza", () => {
    const flow = tagConditionFlow();
    const state0 = createFlowEngineState(flow, { executionId: "exec-no-tags" });
    assert.equal("tag:cliente_vip" in state0.variables, false);
    const result = runFlowEngine(flow, state0, { type: "start", eventId: "evt-1" });
    assert.equal(result.error, undefined);
    assert.equal(result.state.currentNodeId, "end-normal");
    assert.equal(result.state.status, "completed");
  });

  it("not_exists es el inverso exacto -- útil para condicionar por AUSENCIA de un tag", () => {
    const flow: FlowDefinition = {
      name: "F7 — not_exists",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "cond",
          type: "condition",
          config: { rules: [{ field: "tag:moroso", operator: "not_exists" }], match: "all" },
        },
        { id: "end-sin-tag", type: "end", config: {} },
        { id: "end-con-tag", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "cond" },
        { id: "e2", source: "cond", target: "end-sin-tag", sourceHandle: "true" },
        { id: "e3", source: "cond", target: "end-con-tag", sourceHandle: "false" },
      ],
      variables: [],
    };
    const state0 = createFlowEngineState(flow, { executionId: "exec-not-exists" });
    const result = runFlowEngine(flow, state0, { type: "start", eventId: "evt-1" });
    assert.equal(result.state.currentNodeId, "end-sin-tag");
  });
});
