/**
 * Bloque 12G — Preview/Simulación. 100% offline: Gate real + simulador real
 * de lib/flow (executors SIEMPRE simulados, nunca reales) -- sin Supabase,
 * sin WhatsApp, sin llamadas a un LLM real.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileBusinessAgent } from "@/lib/agent-compiler/compile";
import { compileIRToFlowDefinition } from "@/lib/agent-compiler/flow-compiler";
import { buildGateRules } from "@/lib/agent-compiler/runtime/guardrail-gate";
import { previewBusinessAgentTurn } from "@/lib/agent-compiler/api/preview";
import { photographySpec } from "@/lib/agent-compiler/runtime/fixtures";
import type { FlowDefinition } from "@/lib/flow/types";
import type { GateRule } from "@/lib/agent-compiler/runtime/guardrail-gate";

const TENANT = "11111111-1111-4111-8111-111111111111";

function compilarAgente(spec = photographySpec()): { flow: FlowDefinition; gateRules: GateRule[] } {
  const compiled = compileBusinessAgent(spec, { tenantId: TENANT });
  assert.ok(compiled.success, `compile falló: ${JSON.stringify(compiled.success ? [] : compiled.diagnostics)}`);
  if (!compiled.success) throw new Error("unreachable");
  const flowResult = compileIRToFlowDefinition(compiled.ir, { tenantId: TENANT });
  assert.ok(flowResult.success, `flow-compile falló: ${JSON.stringify(flowResult.success ? [] : flowResult.diagnostics)}`);
  if (!flowResult.success) throw new Error("unreachable");
  return { flow: flowResult.flow, gateRules: buildGateRules(compiled.ir) };
}

describe("previewBusinessAgentTurn — Bloque 12G", () => {
  it("start: Gate pasa (sin texto, nada que bloquear) y el Flow Engine simulado produce el saludo", async () => {
    const { flow, gateRules } = compilarAgente();
    const r = await previewBusinessAgentTurn({ flow, gateRules, tenantId: TENANT, engineState: null, event: { type: "start" } });
    assert.equal(r.gate.decision, "pass");
    assert.ok(r.turn, "el turno del Flow Engine debe estar presente cuando el Gate pasa");
    assert.ok(r.turn!.messages.length > 0, "debe producir al menos el mensaje de bienvenida");
    assert.ok(r.turn!.messages.every((m) => m.simulated === true), "todo mensaje de preview está marcado simulated:true");
  });

  it("guardrail determinista (BLOCK/FIXED_RESPONSE) corta el turno ANTES del Flow Engine -- turn ausente", async () => {
    const { flow, gateRules } = compilarAgente();
    const inicio = await previewBusinessAgentTurn({ flow, gateRules, tenantId: TENANT, engineState: null, event: { type: "start" } });
    assert.ok(inicio.turn);

    const r = await previewBusinessAgentTurn({
      flow,
      gateRules,
      tenantId: TENANT,
      engineState: inicio.turn!.engineState,
      event: { type: "text", text: "puedo pagar en efectivo?" },
    });
    assert.equal(r.gate.decision, "fixed_response");
    assert.equal(r.gate.response, "Por ahora no recibimos pagos en efectivo.");
    assert.equal(r.turn, undefined, "el Flow Engine NUNCA corre cuando el Gate bloquea -- 0 LLM, 0 tools");
  });

  it("20. preview NUNCA ejecuta una acción de negocio real -- todo effectsLog viene marcado simulated:true", async () => {
    const { flow, gateRules } = compilarAgente();

    const inicio = await previewBusinessAgentTurn({ flow, gateRules, tenantId: TENANT, engineState: null, event: { type: "start" } });
    assert.ok(inicio.turn);

    const siguiente = await previewBusinessAgentTurn({ flow, gateRules, tenantId: TENANT, engineState: inicio.turn!.engineState, event: { type: "text", text: "quiero ver el catálogo" } });
    // Sin importar en qué nodo haya quedado (depende del grafo compilado),
    // CUALQUIER efecto que haya corrido en el turno debe venir simulado.
    if (siguiente.turn) {
      assert.ok(siguiente.turn.effectsLog.every((e) => e.simulated === true), "ningún efecto real -- todos simulados");
      assert.ok(siguiente.turn.messages.every((m) => m.simulated === true));
    }
  });

  it("commercialStateBefore se deriva de engineState.currentNodeId (Bloque 11), nunca se inventa", async () => {
    const { flow, gateRules } = compilarAgente();
    const sinEstado = await previewBusinessAgentTurn({ flow, gateRules, tenantId: TENANT, engineState: null, event: { type: "start" } });
    assert.equal(sinEstado.commercialStateBefore, undefined, "sin ejecución previa, no hay estado comercial que reportar");
  });
});
