// DuLabs Business — Business Agent 2.0, FASE 2 — Understanding Engine.
//
//   USER MESSAGE -> NORMALIZATION -> UNDERSTANDING (proveedor) -> VALIDATION -> STRUCTURED UNDERSTANDING
//
// El resultado es una ENTRADA para la decisión del backend (FASE 3); este módulo no decide, no responde, no ejecuta
// ni cambia estado. Toda falla es fail-closed y categorizada con el contrato de errores de FASE 1.
//
// Punto de integración (FASE 3): runtime/agent-runtime.ts::runAgentTurn, después del Gate PRE-LLM (que sigue siendo
// la barrera determinista) y antes del orquestador. Hoy no está conectado: activarlo agrega una llamada al modelo por
// mensaje y es una decisión de la FASE 3.

import type { BusinessAgentSafeError } from "@/lib/agent-compiler/contracts/errors";
import { safeError } from "@/lib/agent-compiler/contracts/errors";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { buildUnderstandingToolSchema, type StructuredUnderstanding } from "@/lib/agent-compiler/understanding/contract";
import { prepareUnderstandingContext, type BusinessContextInput, type UnderstandingInput } from "@/lib/agent-compiler/understanding/context";
import { buildUnderstandingInstruction, buildUnderstandingUserContent } from "@/lib/agent-compiler/understanding/prompt";
import type { UnderstandingProvider } from "@/lib/agent-compiler/understanding/provider";
import { buildSlotCatalog, businessSlotsFromSpec } from "@/lib/agent-compiler/understanding/slots";
import { buildTemporalContext, systemClock, type UnderstandingClock } from "@/lib/agent-compiler/understanding/temporal";
import { validateAndNormalizeUnderstanding } from "@/lib/agent-compiler/understanding/validate";

export interface UnderstandingEvent {
  tenantId: string;
  conversationId: string;
  agentId?: string;
  flowVersionId?: string;
  result: "understood" | "rejected";
  errorCategory?: string;
  errorCode?: string;
  primaryIntent?: string;
  secondaryIntents?: string[];
  /** Nombres de slots, NUNCA valores. */
  slots?: string[];
  rejectedSlots?: string[];
  ambiguities?: string[];
  provider?: string;
  latencyMs?: number;
}

export interface UnderstandingEngineDeps {
  provider: UnderstandingProvider;
  /** Única fuente de tiempo del turno. */
  clock?: UnderstandingClock;
  log?: (event: UnderstandingEvent) => void;
}

export type UnderstandingResult =
  | { ok: true; understanding: StructuredUnderstanding }
  | { ok: false; error: BusinessAgentSafeError };

function defaultLog(event: UnderstandingEvent): void {
  console.info("[business-agent.understanding]", JSON.stringify(event));
}

/** Contexto del negocio desde el Spec publicado (nombre, zona, slots propios). La oferta la aporta quien llama. */
export function businessContextFromSpec(
  spec: Pick<BusinessAgentSpec, "identity" | "customerData">,
  input: { tenantId: string; agentId?: string; offerings?: string[] },
): BusinessContextInput {
  return {
    tenantId: input.tenantId,
    agentId: input.agentId,
    businessName: spec.identity.businessName,
    businessTimezone: spec.identity.timezone,
    offerings: input.offerings,
    businessSlots: businessSlotsFromSpec(spec),
  };
}

export async function understandMessage(deps: UnderstandingEngineDeps, input: UnderstandingInput): Promise<UnderstandingResult> {
  const log = deps.log ?? defaultLog;
  const base = {
    tenantId: input.scope?.tenantId ?? "",
    conversationId: input.scope?.conversationId ?? "",
    agentId: input.scope?.agentId,
    flowVersionId: input.scope?.flowVersionId,
  };

  const prepared = prepareUnderstandingContext(input);
  if (!prepared.ok) {
    log({ ...base, result: "rejected", errorCategory: prepared.error.category, errorCode: prepared.error.code });
    return { ok: false, error: prepared.error };
  }
  const context = prepared.context;

  // Un solo instante por turno: el prompt y la normalización ven el MISMO "hoy".
  const temporal = buildTemporalContext((deps.clock ?? systemClock)(), context.business.businessTimezone);
  const slotCatalog = buildSlotCatalog(context.business.businessSlots);

  const response = await deps.provider.understand({
    tenantId: context.scope.tenantId,
    conversationId: context.scope.conversationId,
    instruction: buildUnderstandingInstruction({ context, temporal, slotCatalog }),
    userContent: buildUnderstandingUserContent(context),
    outputSchema: buildUnderstandingToolSchema(slotCatalog),
  });
  if (!response.ok) {
    const error = safeError(response.category, response.code);
    log({ ...base, result: "rejected", errorCategory: error.category, errorCode: error.code, provider: deps.provider.name });
    return { ok: false, error };
  }

  const validated = validateAndNormalizeUnderstanding({
    raw: response.output,
    context,
    temporal,
    slotCatalog,
    provenance: { provider: response.provider, model: response.model, latencyMs: response.latencyMs },
  });
  if (!validated.ok) {
    log({ ...base, result: "rejected", errorCategory: validated.error.category, errorCode: validated.error.code, provider: response.provider, latencyMs: response.latencyMs });
    return { ok: false, error: validated.error };
  }

  const u = validated.understanding;
  log({
    ...base,
    result: "understood",
    primaryIntent: u.intent.primary.intent,
    secondaryIntents: u.intent.secondary.map((s) => s.intent),
    slots: Object.keys(u.slots),
    rejectedSlots: u.rejectedSlots.map((r) => r.name),
    ambiguities: u.ambiguities.map((a) => a.kind),
    provider: response.provider,
    latencyMs: response.latencyMs,
  });
  return { ok: true, understanding: u };
}
