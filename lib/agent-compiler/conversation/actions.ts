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
  product: "producto",
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

/**
 * FASE 8 — restricciones que el BACKEND deriva del estado para acciones concretas (nunca del texto del modelo):
 *   cancelar/reprogramar  → `cita`: id de la cita que el cliente eligió de la lista que mostró el backend
 *   consultar producto    → `contexto`: último producto resuelto ("¿hay talla M?" se busca también como "<producto> talla M")
 *   guardar lead          → `interes`: lo que el cliente consultó (si el negocio lo pidió)
 *   programar recordatorio → la cita anclada (inicio + referencia) que el agente agendó en esta conversación
 */
function derivedConstraints(state: ConversationState, req: AgentRequirements, action: string): Record<string, string> {
  const out: Record<string, string> = {};
  switch (action) {
    case "cancelar_cita_cliente":
    case "reprogramar_cita_cliente": {
      const cita = slotText(state, "appointment");
      if (cita) out.cita = cita;
      break;
    }
    case "ba_consultar_producto": {
      const ctx = state.focus?.product;
      if (ctx && ctx !== slotText(state, "product")) out.contexto = ctx.slice(0, 200);
      break;
    }
    case "ba_guardar_lead": {
      const interes = req.lead?.captureInterest ? (slotText(state, "product") ?? slotText(state, "service") ?? state.focus?.product ?? state.lastBooking?.service ?? undefined) : undefined;
      if (interes) out.interes = interes.slice(0, 200);
      break;
    }
    case "ba_programar_recordatorio": {
      const b = state.lastBooking;
      if (b) {
        out.citaInicio = b.start;
        out.citaRef = (b.appointmentRef ?? b.actionId).slice(0, 120);
        if (b.service) out.citaServicio = b.service.slice(0, 200);
      }
      break;
    }
  }
  return out;
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

  Object.assign(constraints, derivedConstraints(state, input.requirements, input.action));

  const customerData: Record<string, string> = {};
  for (const [slot, fieldKey] of Object.entries(input.requirements.customerFieldBySlot)) {
    const v = slotText(state, slot);
    if (v !== undefined) customerData[fieldKey] = v;
  }

  const artifactRef = input.requirements.artifactRef;
  // La versión del negocio (artefacto) es parte de la operación: otra versión = otra propuesta y otra confirmación.
  const simulation = input.requirements.simulation === true;
  // Una simulación nunca comparte identidad (ni idempotencia) con una operación real.
  const argsHash = sha(stableStringify({ action: input.action, args, constraints, customerData, ...(artifactRef ? { artifactRef } : {}), ...(simulation ? { simulation } : {}) }));
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
      ...(simulation ? { simulation: true as const } : {}),
    },
  };
}
