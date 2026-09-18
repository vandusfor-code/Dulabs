// DuLabs Business — Agent Compiler, Step 8 — BOUNDARY de ejecución.
//
// Frontera explícita entre el Runtime LEGACY y el Business Agent Runtime:
//
//   mensaje entrante
//     -> resolver Business Agent (tenant-scoped, fuente = dulabs_clientes_config)
//        - none  -> handled:false  => el llamador sigue por LEGACY (intacto)
//        - agent -> Business Guardrail Gate -> orquestador REAL -> WhatsApp
//
// Reglas: el tenant nunca proviene del mensaje/LLM; ante cualquier duda o error
// crítico se FAIL-CLOSED (bloquea sin efectos, sin ceder a LEGACY ni dejar que
// la IA improvise). Reutiliza el orquestador/executors/puertos existentes (no
// duplica motores ni infraestructura). No modifica lib/flow/*.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteConfig } from "@/lib/supabase";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import {
  createExecutionOrchestrator,
  type FlowOrchestratorStore,
  type NormalizedFlowEvent,
  type OrchestratorResult,
} from "@/lib/flow/flow-orchestrator";
import { createSupabaseFlowOrchestratorStore } from "@/lib/flow/flow-orchestrator-store-supabase";
import { createDefaultEffectExecutorFramework } from "@/lib/flow/executor-factory";
import { getIntegrationById, getIntegrationCredentials } from "@/lib/flow/flow-store";
import {
  runAgentTurn,
  type GateActionSink,
  type GateIdempotencyStore,
} from "@/lib/agent-compiler/runtime/agent-runtime";
import type { SemanticClassifier } from "@/lib/agent-compiler/runtime/guardrail-gate";
import type { BusinessAgentResolver } from "@/lib/agent-compiler/runtime/production/business-agent-resolver";
import { createWhatsAppGateSink, createClaudeSemanticClassifier } from "@/lib/agent-compiler/runtime/production/ports";
import { type BusinessAgentObserver, type BusinessAgentTrace } from "@/lib/agent-compiler/runtime/production/observability";

export interface BusinessAgentBoundaryResult {
  /** true = el Business Agent atendió (o bloqueó fail-closed) el mensaje; el
   *  llamador NO debe seguir con LEGACY. false = no hay Business Agent para este
   *  número; el llamador sigue por LEGACY exactamente como antes. */
  handled: boolean;
  outcome: BusinessAgentTrace["outcome"];
  reason?: string;
}

/** Overrides SOLO para test (inyectan orquestador/store/puertos sin red real). */
export interface BusinessAgentBoundaryOverrides {
  orchestrator?: { process(event: NormalizedFlowEvent): Promise<OrchestratorResult> };
  store?: Pick<FlowOrchestratorStore, "getActiveExecution">;
  gateSink?: GateActionSink;
  idempotency?: GateIdempotencyStore;
  now?: () => string;
}

export interface AtenderConBusinessAgentParams {
  supabase: SupabaseClient;
  cliente: ClienteConfig;
  telefonoCliente: string;
  texto: string;
  wamid: string;
  resolver: BusinessAgentResolver;
  /** Estado comercial actual (autoridad del Runtime, nunca del LLM). */
  commercialState?: string;
  classifier?: SemanticClassifier;
  observer?: BusinessAgentObserver;
  overrides?: BusinessAgentBoundaryOverrides;
}

export async function atenderMensajeConBusinessAgent(
  params: AtenderConBusinessAgentParams,
): Promise<BusinessAgentBoundaryResult> {
  const started = Date.now();
  const { supabase, cliente, telefonoCliente, texto, wamid } = params;
  const base: Partial<BusinessAgentTrace> = { tenantId: cliente.id_tenant, wamid, phoneNumberId: cliente.phone_number_id };
  const emit = (t: BusinessAgentTrace) => params.observer?.onTrace(t);

  // 1) Resolución tenant-scoped del Business Agent (fuente: fila real).
  const resolution = await params.resolver.resolve(supabase, cliente);
  if (resolution.kind === "none") {
    emit({ ...base, outcome: "no_business_agent", reason: resolution.reason, llmInvoked: false, latencyMs: Date.now() - started } as BusinessAgentTrace);
    return { handled: false, outcome: "no_business_agent", reason: resolution.reason };
  }

  // 2) Fail-closed multi-tenant: el artefacto DEBE ser del tenant del número.
  if (resolution.tenantId !== cliente.id_tenant) {
    emit({ ...base, outcome: "fail_closed", reason: "tenant_mismatch", flowId: resolution.flowId, checksum: resolution.checksum, llmInvoked: false, latencyMs: Date.now() - started } as BusinessAgentTrace);
    return { handled: true, outcome: "fail_closed", reason: "tenant_mismatch" };
  }

  // 3) Store + orquestador REAL (mismos executors que el Flow path existente).
  const store: Pick<FlowOrchestratorStore, "getActiveExecution"> =
    params.overrides?.store ?? createSupabaseFlowOrchestratorStore(supabase);
  const orchestrator =
    params.overrides?.orchestrator ??
    createExecutionOrchestrator({
      store: createSupabaseFlowOrchestratorStore(supabase),
      engine: { createFlowEngineState, runFlowEngine },
      effectFramework: createDefaultEffectExecutorFramework({
        supabase,
        store: {
          getIntegrationById: (tenantId, integrationId) => getIntegrationById(supabase, tenantId, integrationId),
          getIntegrationCredentials: (tenantId, integrationId) => getIntegrationCredentials(supabase, tenantId, integrationId),
        },
      }),
    });

  const gateSink = params.overrides?.gateSink ?? createWhatsAppGateSink(supabase, cliente);
  const classifier = params.classifier ?? createClaudeSemanticClassifier({ tenantId: resolution.tenantId });

  // 4) Ejecución vía Gate + orquestador. Observabilidad puenteada.
  let captured: BusinessAgentTrace["gateDecision"] | undefined;
  let matchedRuleId: string | undefined;
  let matchedBy: "deterministic" | "semantic" | undefined;
  let orchestratorOutcome: string | undefined;

  const result = await runAgentTurn(
    {
      tenantId: resolution.tenantId,
      gateRules: resolution.gateRules,
      flowId: resolution.flowId,
      orchestrator,
      store,
      gateSink,
      classifier,
      idempotency: params.overrides?.idempotency,
      now: params.overrides?.now,
      observer: {
        onTrace: (t) => {
          captured = t.gateDecision;
          matchedRuleId = t.matchedRuleId;
          matchedBy = t.matchedBy;
          orchestratorOutcome = t.orchestratorOutcome;
        },
      },
    },
    {
      tenantId: cliente.id_tenant,
      conversation: { phoneNumberId: cliente.phone_number_id, telefonoCliente },
      wamid,
      text: texto,
      commercialState: params.commercialState,
      baseConocimiento: cliente.base_conocimiento ?? undefined,
    },
  );

  const outcome: BusinessAgentTrace["outcome"] =
    result.kind === "guardrail_blocked"
      ? "guardrail_blocked"
      : result.kind === "duplicate"
        ? "duplicate"
        : result.kind === "fail_closed"
          ? "fail_closed"
          : "flow";

  emit({
    ...base,
    flowId: resolution.flowId,
    flowVersionId: resolution.flowVersionId,
    checksum: resolution.checksum,
    gateDecision: captured,
    matchedRuleId,
    matchedBy,
    orchestratorOutcome,
    outcome,
    reason: result.kind === "fail_closed" ? result.reason : undefined,
    // LLM sólo puede haberse invocado si el Gate PASÓ al Flow.
    llmInvoked: result.kind === "flow",
    latencyMs: Date.now() - started,
  } as BusinessAgentTrace);

  // Un Business Agent SIEMPRE es dueño de su mensaje: nunca cae a LEGACY (ni
  // ante fail-closed) para no dejar que la IA legacy contradiga el estado real.
  return { handled: true, outcome, reason: result.kind === "fail_closed" ? result.reason : undefined };
}
