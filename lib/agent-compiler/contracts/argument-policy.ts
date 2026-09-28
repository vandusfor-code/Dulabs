// DuLabs Business — Business Agent 2.0, FASE 1 — aplicación de los contratos de acción a lo que propone la IA.
//
// Implementa ProposalArgumentPolicy (lib/flow/ai-runtime/ai-proposal-bridge.ts). El Flow Engine la invoca
// cuando una propuesta de la IA ya pasó la allowlist del nodo (validateAiActionProposal) y ANTES de que sus
// argumentos se escriban en las variables de la ejecución:
//
//   argumento fuera del contrato          -> se descarta (not_in_contract)
//   argumento que choca con una variable  -> se descarta (protected:<categoría>)
//   protegida (capturada, configurada, derivada)
//   valor inválido para el contrato       -> se rechaza la propuesta (VALIDATION_ERROR -> rama de fallo del nodo)
//   acción sin contrato / sin tenant      -> se rechaza (SECURITY_REJECTED): un Business Agent no ejecuta
//                                            acciones sin contrato
//
// Descartar (en vez de rechazar) lo que sobra es deliberado: la acción sigue con los datos que controla el
// sistema, y el descarte queda registrado (trazas + dulabs_flow_effects) sin exponer valores.

import type { ProposalArgumentPolicy, ProposalArgumentPolicyInput, ProposalArgumentPolicyResult } from "@/lib/flow/ai-runtime/ai-proposal-bridge";
import { getActionContract, llmArgumentKeys } from "@/lib/agent-compiler/contracts/action-contracts";
import { buildFlowVariablePolicy, protectionFor } from "@/lib/agent-compiler/contracts/variable-policy";
import { categorizeEffectFailure } from "@/lib/agent-compiler/contracts/errors";
import { EFFECT_RESULT_CLASSIFICATIONS } from "@/lib/flow/executor-types";

export interface ActionContractEvent {
  event: "business_agent.action_contract";
  tenantId: string;
  flowId?: string;
  flowVersionId?: string;
  executionRowId?: string;
  nodeId: string;
  action: string;
  contractVersion: string | null;
  outcome: "accepted" | "accepted_with_drops" | "rejected";
  dropped: Array<{ key: string; reason: string }>;
  errorCategory?: string;
  error?: string;
}

export type ActionContractLogger = (event: ActionContractEvent) => void;

const consoleLogger: ActionContractLogger = (event) => {
  console.log("[business-agent.action-contract]", JSON.stringify(event));
};

export function createBusinessAgentArgumentPolicy(opts: { log?: ActionContractLogger } = {}): ProposalArgumentPolicy {
  const log = opts.log ?? consoleLogger;

  return {
    apply(input: ProposalArgumentPolicyInput): ProposalArgumentPolicyResult {
      const base = {
        tenantId: input.tenantId,
        flowId: input.context?.flowId,
        flowVersionId: input.context?.flowVersionId,
        executionRowId: input.context?.executionRowId,
        nodeId: input.aiNodeId,
        action: input.actionType,
      };
      const reject = (
        code: "SECURITY_REJECTED" | "VALIDATION_ERROR",
        error: string,
        dropped: Array<{ key: string; reason: string }>,
        contract?: { action: string; version: string },
      ): ProposalArgumentPolicyResult => {
        const errorCategory = categorizeEffectFailure({
          kind: "action",
          classification: code === "SECURITY_REJECTED" ? EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED : EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
          error,
        });
        log({ event: "business_agent.action_contract", ...base, contractVersion: contract?.version ?? null, outcome: "rejected", dropped, errorCategory, error });
        return { ok: false, code, error, dropped, contract };
      };

      if (!input.tenantId) return reject("SECURITY_REJECTED", "action_contract_tenant_missing", []);

      const contract = getActionContract(input.actionType);
      if (!contract) return reject("SECURITY_REJECTED", "action_contract_missing", []);
      const ref = { action: contract.action, version: contract.version };

      const variables = buildFlowVariablePolicy(input.flow);
      const permitidos = new Set(llmArgumentKeys(contract));
      const candidatos: Record<string, string> = {};
      const dropped: Array<{ key: string; reason: string }> = [];

      for (const [key, value] of Object.entries(input.arguments)) {
        // Un campo vacío equivale a "no lo propuso" (no invalida toda la propuesta).
        if (value.trim() === "") continue;
        if (!permitidos.has(key)) {
          dropped.push({ key, reason: "not_in_contract" });
          continue;
        }
        const proteccion = protectionFor(variables, key, contract.action);
        if (proteccion) {
          dropped.push({ key, reason: `protected:${proteccion}` });
          continue;
        }
        candidatos[key] = value;
      }

      const parsed = contract.llmArguments.safeParse(candidatos);
      if (!parsed.success) return reject("VALIDATION_ERROR", "action_contract_invalid_arguments", dropped, ref);

      const argumentos: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed.data)) {
        if (typeof value === "string") argumentos[key] = value;
      }
      log({ event: "business_agent.action_contract", ...base, contractVersion: contract.version, outcome: dropped.length > 0 ? "accepted_with_drops" : "accepted", dropped });
      return { ok: true, arguments: argumentos, dropped, contract: ref };
    },
  };
}
