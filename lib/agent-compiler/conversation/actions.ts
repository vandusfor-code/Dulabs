// DuLabs Business — Business Agent 2.0, FASE 3 — frontera STATE MACHINE → ACTION ENGINE (FASE 4).
//
// La máquina de estados NO ejecuta acciones: cuando el backend decide que una operación puede hacerse, emite una
// ActionRequest. Sus argumentos salen de slots USABLES del estado (nunca de texto del modelo) y se validan con el MISMO
// schema Zod del contrato de FASE 1 (`llmArguments`): una solicitud que no cumple el contrato no se emite. La ejecución,
// autorización, idempotencia real y resultado son responsabilidad del Action Engine (FASE 4), que reporta de vuelta con
// ACTION_STARTED / ACTION_SUCCEEDED / ACTION_FAILED.

import { createHash } from "node:crypto";
import { getActionContract, llmArgumentKeys } from "@/lib/agent-compiler/contracts/action-contracts";
import { slotDisplayValue } from "@/lib/agent-compiler/understanding/validate";
import { isSlotUsable, type ActionPurpose, type ActionRequest, type ConversationState } from "@/lib/agent-compiler/conversation/model";
import type { AgentRequirements } from "@/lib/agent-compiler/conversation/requirements";

/** Slot universal → argumento de los contratos de FASE 1 (los nombres de argumento ya existen en el runtime). */
const SLOT_TO_ARGUMENT: Readonly<Record<string, string>> = {
  service: "servicio",
  date: "fecha",
  time: "hora",
  customer_name: "nombreCliente",
  notes: "notas",
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha(value: string, length = 32): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function slotText(state: ConversationState, name: string): string | undefined {
  const slot = state.slots[name];
  return isSlotUsable(slot) ? slotDisplayValue(slot.value) : undefined;
}

export type BuildActionResult = { ok: true; request: ActionRequest; argsHash: string } | { ok: false; code: "action_contract_missing" | "action_arguments_invalid" };

export function buildActionRequest(input: {
  state: ConversationState;
  requirements: AgentRequirements;
  action: string;
  purpose: ActionPurpose;
  requiresConfirmation: boolean;
  confirmationId: string | null;
  now: string;
}): BuildActionResult {
  const contract = getActionContract(input.action);
  if (!contract) return { ok: false, code: "action_contract_missing" };
  const { state } = input;

  const args: Record<string, string> = {};
  const accepted = new Set(llmArgumentKeys(contract));
  for (const [slot, arg] of Object.entries(SLOT_TO_ARGUMENT)) {
    const v = slotText(state, slot);
    if (v !== undefined && accepted.has(arg)) args[arg] = v;
  }
  if (accepted.has("items")) {
    const item = slotText(state, "product") ?? slotText(state, "service");
    const qty = slotText(state, "quantity");
    if (item) args.items = qty ? `${qty} ${item}` : item;
  }
  const parsed = contract.llmArguments.safeParse(args);
  if (!parsed.success) return { ok: false, code: "action_arguments_invalid" };

  // Restricciones que el contrato no recibe como argumento: las aplica el Action Engine.
  const constraints: Record<string, string> = {};
  const range = state.slots.time_range;
  if (isSlotUsable(range)) constraints.franjaHoraria = slotDisplayValue(range.value);
  if (!accepted.has("fecha") && slotText(state, "date")) constraints.fecha = slotText(state, "date")!;
  if (!accepted.has("hora") && slotText(state, "time")) constraints.hora = slotText(state, "time")!;

  const customerData: Record<string, string> = {};
  for (const [slot, fieldKey] of Object.entries(input.requirements.customerFieldBySlot)) {
    const v = slotText(state, slot);
    if (v !== undefined) customerData[fieldKey] = v;
  }

  const artifactRef = input.requirements.artifactRef;
  // La versión del negocio (artefacto) es parte de la operación: otra versión = otra propuesta y otra confirmación.
  const argsHash = sha(stableStringify({ action: input.action, args, constraints, customerData, ...(artifactRef ? { artifactRef } : {}) }));
  const goalId = state.goal?.id ?? null;
  const id = sha([state.scope.tenantId, state.scope.conversationId, goalId ?? "-", input.action, input.purpose, argsHash].join("|"));
  return {
    ok: true,
    argsHash,
    request: {
      id,
      action: input.action,
      contractVersion: contract.version,
      purpose: input.purpose,
      arguments: args,
      constraints,
      customerData,
      sideEffects: contract.sideEffects,
      requiresConfirmation: input.requiresConfirmation,
      confirmationId: input.confirmationId,
      goalId,
      status: "requested",
      requestedAt: input.now,
      ...(artifactRef ? { artifactRef } : {}),
    },
  };
}
