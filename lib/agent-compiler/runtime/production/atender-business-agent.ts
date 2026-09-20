// DuLabs Business — Agent Compiler, Step 8 + Bloques 9/11 — BOUNDARY de ejecución.
//
// Frontera explícita entre el Runtime LEGACY y el Business Agent Runtime:
//
//   mensaje entrante
//     -> número bloqueado? (dulabs_clientes_config.ia_numeros_bloqueados,
//        mecanismo EXISTENTE reutilizado -- ver lib/blacklist-du.ts)
//        - sí -> handled:true, CERO LLM/tools/Flow/respuesta. STOP.
//     -> resolver Business Agent (tenant-scoped, fuente = dulabs_clientes_config)
//        - none  -> handled:false  => el llamador sigue por LEGACY (intacto)
//        - error del resolver -> handled:true, fail_closed (NUNCA propaga la
//          excepción ni cae a LEGACY en silencio)
//        - agent -> commercialState real (dulabs_flow_executions.current_node_id,
//          Bloque 11) -> Business Guardrail Gate -> orquestador REAL -> WhatsApp
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
import { resolveCommercialState } from "@/lib/agent-compiler/runtime/commercial-state-resolver";
import { esTelefonoBloqueado } from "@/lib/blacklist-du";

export interface BusinessAgentBoundaryResult {
  /** true = el Business Agent atendió (o bloqueó fail-closed/blacklist) el
   *  mensaje; el llamador NO debe seguir con LEGACY. false = no hay Business
   *  Agent para este número; el llamador sigue por LEGACY exactamente como
   *  antes. */
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

/**
 * Aviso fijo cuando el cliente manda algo que el Business Agent no entiende (audio, imagen, video, documento, sticker).
 * Texto del agente, no de la IA: nunca inventa qué contenía el archivo. Sin palabras de dominio (no afirma nada externo).
 */
export const MENSAJE_SOLO_TEXTO = "Por ahora solo puedo leer mensajes de texto. ¿Me cuentas por escrito lo que necesitas?";

export interface AtenderConBusinessAgentParams {
  supabase: SupabaseClient;
  cliente: ClienteConfig;
  telefonoCliente: string;
  texto: string;
  wamid: string;
  resolver: BusinessAgentResolver;
  /** Override SOLO para test. En producción se resuelve internamente desde
   *  la ejecución activa (Bloque 11) -- nunca confiar en un valor externo. */
  commercialState?: string;
  classifier?: SemanticClassifier;
  observer?: BusinessAgentObserver;
  overrides?: BusinessAgentBoundaryOverrides;
}

/**
 * Anti-invención — un mensaje que NO es texto (audio, imagen, video, documento, sticker) de un tenant con Business Agent.
 * El Business Agent es dueño de TODO mensaje de su número: ese archivo no debe caer al motor de flows hand-built (ni,
 * peor, a la IA legacy de texto libre) ni quedar en silencio. Responde el aviso fijo MENSAJE_SOLO_TEXTO SIN IA y SIN tocar la
 * ejecución en curso (el cliente retoma por escrito donde iba). Número bloqueado / error del resolver => silencio, y un
 * número sin Business Agent (`handled:false`) sigue por su camino de siempre, sin ningún cambio.
 */
export async function atenderMensajeNoTextoConBusinessAgent(
  params: Omit<AtenderConBusinessAgentParams, "texto" | "commercialState" | "classifier">,
): Promise<BusinessAgentBoundaryResult> {
  const started = Date.now();
  const { supabase, cliente, telefonoCliente, wamid } = params;
  const base: Partial<BusinessAgentTrace> = { tenantId: cliente.id_tenant, wamid, phoneNumberId: cliente.phone_number_id };
  const emit = (t: BusinessAgentTrace) => params.observer?.onTrace(t);

  if (esTelefonoBloqueado(cliente.ia_numeros_bloqueados, telefonoCliente)) {
    emit({ ...base, outcome: "blocked_number", llmInvoked: false, latencyMs: Date.now() - started } as BusinessAgentTrace);
    return { handled: true, outcome: "blocked_number" };
  }

  let resolution;
  try {
    resolution = await params.resolver.resolve(supabase, cliente);
  } catch (err) {
    emit({ ...base, outcome: "fail_closed", reason: "resolver_error", llmInvoked: false, latencyMs: Date.now() - started } as BusinessAgentTrace);
    console.error(`[business-agent] resolver_error tenant=${cliente.id_tenant} phone=${cliente.phone_number_id}:`, err instanceof Error ? err.message : String(err));
    return { handled: true, outcome: "fail_closed", reason: "resolver_error" };
  }
  if (resolution.kind === "none") {
    emit({ ...base, outcome: "no_business_agent", reason: resolution.reason, llmInvoked: false, latencyMs: Date.now() - started } as BusinessAgentTrace);
    return { handled: false, outcome: "no_business_agent", reason: resolution.reason };
  }
  if (resolution.tenantId !== cliente.id_tenant) {
    emit({ ...base, outcome: "fail_closed", reason: "tenant_mismatch", flowId: resolution.flowId, checksum: resolution.checksum, llmInvoked: false, latencyMs: Date.now() - started } as BusinessAgentTrace);
    return { handled: true, outcome: "fail_closed", reason: "tenant_mismatch" };
  }

  const gateSink = params.overrides?.gateSink ?? createWhatsAppGateSink(supabase, cliente);
  try {
    await gateSink.sendMessage({ tenantId: cliente.id_tenant, conversation: { phoneNumberId: cliente.phone_number_id, telefonoCliente }, wamid, text: MENSAJE_SOLO_TEXTO });
  } catch (err) {
    // Un fallo al avisar no cambia nada más: el mensaje ya es del Business Agent (nunca cae a LEGACY).
    console.error(`[business-agent] unsupported_message_notice_failed tenant=${cliente.id_tenant}:`, err instanceof Error ? err.message : String(err));
  }
  emit({ ...base, flowId: resolution.flowId, flowVersionId: resolution.flowVersionId, checksum: resolution.checksum, outcome: "unsupported_message", llmInvoked: false, latencyMs: Date.now() - started } as BusinessAgentTrace);
  return { handled: true, outcome: "unsupported_message" };
}

export async function atenderMensajeConBusinessAgent(
  params: AtenderConBusinessAgentParams,
): Promise<BusinessAgentBoundaryResult> {
  const started = Date.now();
  const { supabase, cliente, telefonoCliente, texto, wamid } = params;
  const base: Partial<BusinessAgentTrace> = { tenantId: cliente.id_tenant, wamid, phoneNumberId: cliente.phone_number_id };
  const emit = (t: BusinessAgentTrace) => params.observer?.onTrace(t);

  // 0) Bloque 9 -- número bloqueado (máxima prioridad, ANTES que cualquier
  // otra cosa: ni siquiera se resuelve si hay un Business Agent). Reutiliza
  // el mecanismo EXISTENTE (dulabs_clientes_config.ia_numeros_bloqueados +
  // lib/blacklist-du.ts), el MISMO que ya usa el webhook Legacy -- no se crea
  // una segunda blacklist. Defensa en profundidad: esta frontera no asume que
  // su caller ya hizo este chequeo (puede invocarse desde cualquier lugar).
  if (esTelefonoBloqueado(cliente.ia_numeros_bloqueados, telefonoCliente)) {
    emit({ ...base, outcome: "blocked_number", llmInvoked: false, latencyMs: Date.now() - started } as BusinessAgentTrace);
    return { handled: true, outcome: "blocked_number" };
  }

  // 1) Resolución tenant-scoped del Business Agent (fuente: fila real). Un
  // error real de infraestructura NUNCA propaga como excepción sin control
  // (eso dejaría al caller decidir un fallback ad-hoc) ni degrada
  // silenciosamente a "none"/LEGACY -- se convierte en fail_closed explícito
  // (§20: nunca dejar que el mensaje caiga a un bot incorrecto por un error).
  let resolution;
  try {
    resolution = await params.resolver.resolve(supabase, cliente);
  } catch (err) {
    emit({ ...base, outcome: "fail_closed", reason: "resolver_error", llmInvoked: false, latencyMs: Date.now() - started } as BusinessAgentTrace);
    console.error(`[business-agent] resolver_error tenant=${cliente.id_tenant} phone=${cliente.phone_number_id}:`, err instanceof Error ? err.message : String(err));
    return { handled: true, outcome: "fail_closed", reason: "resolver_error" };
  }

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

  // 3.5) Bloque 11 -- commercialState REAL, derivado de la ejecución activa
  // (nunca del LLM, nunca de params sin verificar salvo override explícito de
  // test). Un fallo resolviéndolo NO bloquea el turno (el Gate simplemente
  // evalúa condiciones que dependan de commercialState como "no coincide" --
  // fail-closed en ESE guardrail puntual, no en toda la conversación).
  const commercialState =
    params.commercialState ??
    (await resolveCommercialState(store, resolution.tenantId, { phoneNumberId: cliente.phone_number_id, telefonoCliente }).then((r) => r.commercialState));

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
      commercialState,
      // R4: el Business Agent NO siembra `dulabs_clientes_config.base_conocimiento`
      // (texto legacy, hasta 100 000 caracteres) en el bloque VARIABLES de cada llamada a
      // la IA: ese era el antipatrón "todo el PDF en el prompt" (falla con documentos
      // grandes, cuesta tokens en cada turno y diluye las reglas). El conocimiento del
      // Business Agent se RECUPERA por relevancia (FAQ + documentos indexados, acción
      // buscar_conocimiento) y solo llegan a la IA los fragmentos pertinentes.
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
