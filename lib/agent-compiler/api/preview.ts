// DuLabs Business — Agent Compiler, Bloque 12G — Preview/Simulación.
//
// Reutiliza EXCLUSIVAMENTE infraestructura ya existente, sin inventar un
// segundo runtime:
//   - evaluateGuardrailGate (lib/agent-compiler/runtime/guardrail-gate.ts):
//     el MISMO Gate PRE-LLM que corre en producción (atender-business-agent.ts).
//   - runSimulationTurn + createSimulatedExecutorRegistry (lib/flow/simulate-flow.ts,
//     lib/flow/executors/simulated-executor-registry.ts): el MISMO simulador
//     que ya usa POST /api/flows/[id]/simulate para el Flow Studio -- executors
//     SIMULADOS, estructuralmente incapaces de tocar WhatsApp/Claude/DB reales
//     (este archivo no importa executor-factory.ts ni ningún executor real).
//   - commercialStateFromNodeId (commercial-state-resolver.ts): la MISMA
//     tabla determinista que usa el boundary de producción (Bloque 11).
//
// Sin persistencia: igual que el simulador de Flow Studio, el estado del
// motor viaja completo en la respuesta y el caller lo reenvía en el
// siguiente turno -- nunca toca dulabs_flow_executions.
//
// GAP DOCUMENTADO (a propósito, no se inventa): el clasificador semántico del
// Gate (LLM) es opcional aquí y por defecto NO se pasa -- el preview evalúa
// completo el camino DETERMINISTA del Gate (keywords/condiciones), pero un
// guardrail que dependa EXCLUSIVAMENTE de clasificación semántica no hará
// match salvo que el caller inyecte explícitamente un `classifier` (mismo
// tipo que ya acepta evaluateGuardrailGate/runAgentTurn). No se construyó un
// clasificador de prueba nuevo para no incurrir en llamadas reales a un LLM
// desde un endpoint de preview sin que el usuario lo pida explícitamente.

import { evaluateGuardrailGate, type GateRule, type SemanticClassifier } from "@/lib/agent-compiler/runtime/guardrail-gate";
import { commercialStateFromNodeId } from "@/lib/agent-compiler/runtime/commercial-state-resolver";
import type { CommercialState } from "@/lib/agent-compiler/ir";
import { createSimulatedExecutorRegistry, type SimulationOverrides } from "@/lib/flow/executors/simulated-executor-registry";
import { runSimulationTurn, type RunSimulationTurnInput, type SimulationInputEvent, type SimulationTurnResult } from "@/lib/flow/simulate-flow";
import type { FlowDefinition } from "@/lib/flow/types";
import type { FlowEngineState } from "@/lib/flow/engine-types";

export type { SimulationInputEvent } from "@/lib/flow/simulate-flow";

export interface PreviewTurnInput {
  flow: FlowDefinition;
  gateRules: GateRule[];
  tenantId: string;
  flowId?: string;
  flowVersionId?: string;
  /** null para arrancar (o reiniciar) el preview desde cero. */
  engineState: FlowEngineState | null;
  event: SimulationInputEvent;
  classifier?: SemanticClassifier;
  overrides?: SimulationOverrides;
}

export interface PreviewGateResult {
  decision: "pass" | "block" | "fixed_response" | "transfer_human";
  ruleId?: string;
  matchedBy?: "deterministic" | "semantic";
  /** Texto fijo que se habría enviado (block-con-respuesta / fixed_response / transfer_human), si aplica. */
  response?: string;
  pauseHours?: number;
}

export interface PreviewTurnResult {
  gate: PreviewGateResult;
  /** commercialState de ENTRADA a este turno (antes de procesar el evento), derivado de engineState.currentNodeId. */
  commercialStateBefore: CommercialState | undefined;
  /** Presente SOLO cuando el Gate deja pasar (decision:"pass") -- el Gate cortó el turno antes del Flow Engine/LLM en cualquier otro caso. */
  turn?: SimulationTurnResult;
}

function textFromEvent(event: SimulationInputEvent): string {
  if (event.type === "text") return event.text;
  return ""; // start/button: sin texto libre -- las reglas de keyword nunca deben adivinar.
}

/**
 * Corre UN turno de preview: Gate PRE-LLM (real) -> si pasa, Flow Engine vía
 * simulador (real, executors simulados). Nunca ejecuta una acción de negocio
 * real (agendar, crear lead, cobrar, enviar WhatsApp) -- el registry de
 * executors es SIEMPRE el simulado, sin excepción ni override que apunte a
 * uno real.
 */
export async function previewBusinessAgentTurn(input: PreviewTurnInput): Promise<PreviewTurnResult> {
  const currentNodeId = input.engineState?.currentNodeId ?? null;
  const commercialStateBefore = commercialStateFromNodeId(currentNodeId);

  const decision = await evaluateGuardrailGate({
    rules: input.gateRules,
    context: { message: textFromEvent(input.event), commercialState: commercialStateBefore },
    classifier: input.classifier,
  });

  if (decision.kind !== "pass") {
    return {
      commercialStateBefore,
      gate: { decision: decision.kind, ruleId: decision.ruleId, matchedBy: decision.matchedBy, response: decision.response, pauseHours: decision.kind === "transfer_human" ? decision.pauseHours : undefined },
    };
  }

  const registryInput: RunSimulationTurnInput = {
    flow: input.flow,
    engineState: input.engineState,
    event: input.event,
    registry: createSimulatedExecutorRegistry(input.overrides),
    tenantId: input.tenantId,
    flowId: input.flowId,
    flowVersionId: input.flowVersionId,
  };
  const turn = await runSimulationTurn(registryInput);

  return { commercialStateBefore, gate: { decision: "pass" }, turn };
}
