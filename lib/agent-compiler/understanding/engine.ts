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
import { UNDERSTANDING_CONTRACT_VERSION } from "@/lib/agent-compiler/understanding/contract";
import { TAXONOMY_VERSION } from "@/lib/agent-compiler/understanding/taxonomy";
import { HUMAN_REQUEST_PHRASES } from "@/lib/agent-compiler/runtime/guardrail-gate";
import { foldText } from "@/lib/agent-compiler/understanding/slots";
import type { PreparedContext } from "@/lib/agent-compiler/understanding/context";
import type { TemporalContext } from "@/lib/agent-compiler/understanding/temporal";
import { backoffDelay, callWithTimeout, DEFAULT_UNDERSTANDING_RETRY, realSleep, type UnderstandingRetryPolicy } from "@/lib/agent-compiler/understanding/resilience";

export interface UnderstandingEvent {
  tenantId: string;
  conversationId: string;
  agentId?: string;
  flowVersionId?: string;
  result: "understood" | "rejected" | "deterministic_handoff";
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
  /** FASE 7 — intentos usados (1 = sin reintento), motivo de la última falla y tokens de TODOS los intentos. */
  attempts?: number;
  failureReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface UnderstandingEngineDeps {
  provider: UnderstandingProvider;
  /** Única fuente de tiempo del turno. */
  clock?: UnderstandingClock;
  log?: (event: UnderstandingEvent) => void;
  /** FASE 7 — reintentos acotados (salida inválida o falla transitoria). Por defecto DEFAULT_UNDERSTANDING_RETRY. */
  retry?: UnderstandingRetryPolicy;
  /** Espera entre intentos (inyectable en tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Reloj monotónico para el presupuesto total (inyectable en tests). */
  monotonic?: () => number;
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

  const request = {
    tenantId: context.scope.tenantId,
    conversationId: context.scope.conversationId,
    instruction: buildUnderstandingInstruction({ context, temporal, slotCatalog }),
    userContent: buildUnderstandingUserContent(context),
    outputSchema: buildUnderstandingToolSchema(slotCatalog),
  };

  // FASE 7 — intentos acotados. Se reintenta SOLO una falla transitoria del proveedor o una salida que no pasa el
  // contrato; nunca un rechazo de alcance (tenant) ni una falla de autenticación. Sin salida válida, no hay acciones.
  const policy = deps.retry ?? DEFAULT_UNDERSTANDING_RETRY;
  const sleep = deps.sleep ?? realSleep;
  const mono = deps.monotonic ?? Date.now;
  const deadline = mono() + policy.totalBudgetMs;
  const usage = { inputTokens: 0, outputTokens: 0, reported: false };
  let lastError: BusinessAgentSafeError = safeError("EXTERNAL_SERVICE_ERROR", "understanding_provider_unavailable");
  let lastReason: string | undefined;
  let lastProvider: string = deps.provider.name;
  let lastLatency: number | undefined;
  let attempts = 0;
  const tokens = () => (usage.reported ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : {});

  for (let attempt = 1; attempt <= Math.max(1, policy.maxAttempts); attempt++) {
    const remaining = deadline - mono();
    if (remaining <= 0) {
      lastError = safeError("EXTERNAL_SERVICE_ERROR", "understanding_budget_exhausted");
      lastReason = "timeout";
      break;
    }
    attempts = attempt;
    const response = await callWithTimeout(deps.provider, request, Math.min(policy.attemptTimeoutMs, remaining));
    let retryable: boolean;
    if (!response.ok) {
      lastError = safeError(response.category, response.code);
      lastReason = response.reason;
      retryable = response.retryable === true && response.category !== "TENANT_ERROR";
    } else {
      lastProvider = response.provider;
      lastLatency = response.latencyMs;
      if (response.usage) {
        usage.reported = true;
        usage.inputTokens += response.usage.inputTokens ?? 0;
        usage.outputTokens += response.usage.outputTokens ?? 0;
      }
      const validated = validateAndNormalizeUnderstanding({
        raw: response.output,
        context,
        temporal,
        slotCatalog,
        provenance: { provider: response.provider, model: response.model, latencyMs: response.latencyMs, attempts: attempt, ...(usage.reported ? { usage: tokens() } : {}) },
      });
      if (validated.ok) {
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
          attempts,
          ...tokens(),
        });
        return { ok: true, understanding: u };
      }
      lastError = validated.error;
      lastReason = "output_invalid";
      retryable = true;
    }
    if (!retryable || attempt >= policy.maxAttempts) break;
    const wait = backoffDelay(policy, attempt);
    if (mono() + wait >= deadline) break;
    await sleep(wait);
  }

  // FASE 7 — sin IA, lo único que se reconoce es un pedido EXPLÍCITO de hablar con una persona (frases fijas, las mismas
  // del Gate). Así el cliente siempre puede llegar a una persona; ningún otro dato ni acción sale de aquí.
  if ((lastError.category === "EXTERNAL_SERVICE_ERROR" || lastError.category === "AI_OUTPUT_ERROR") && asksForHuman(context.message.text)) {
    log({ ...base, result: "deterministic_handoff", errorCategory: lastError.category, errorCode: lastError.code, provider: "deterministic", attempts, ...(lastReason ? { failureReason: lastReason } : {}), ...tokens() });
    return { ok: true, understanding: deterministicHandoffUnderstanding(context, temporal) };
  }
  log({ ...base, result: "rejected", errorCategory: lastError.category, errorCode: lastError.code, provider: lastProvider, latencyMs: lastLatency, attempts, ...(lastReason ? { failureReason: lastReason } : {}), ...tokens() });
  return { ok: false, error: lastError };
}

const HUMAN_PHRASES_FOLDED = HUMAN_REQUEST_PHRASES.map(foldText);

/** ¿Pide explícitamente hablar con una persona? Frases fijas; nunca interpretación libre. */
export function asksForHuman(text: string): boolean {
  const t = foldText(text);
  return HUMAN_PHRASES_FOLDED.some((p) => t.includes(p));
}

/** Entendimiento mínimo SIN modelo: solo la señal de handoff, sin datos, con procedencia "deterministic". */
export function deterministicHandoffUnderstanding(context: PreparedContext, temporal: TemporalContext): StructuredUnderstanding {
  return {
    contractVersion: UNDERSTANDING_CONTRACT_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    scope: { ...context.scope },
    language: "es",
    message: { normalization: context.message.normalization },
    intent: { primary: { intent: "HUMAN_HANDOFF", confidence: 1, band: "high" }, secondary: [] },
    slots: {},
    rejectedSlots: [],
    ambiguities: [],
    missingSlots: [],
    signals: { unknown: false, handoff: { requested: true, source: "deterministic" }, confirmation: null, cancellation: false, rescheduling: false, correction: false },
    temporal,
    provenance: { provider: "deterministic" },
  };
}
