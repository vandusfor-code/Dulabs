// DuLabs Business — Business Agent 2.0, FASE 4/5 — piezas de PRODUCCIÓN del runtime conversacional.
//
// Nada nuevo ni simulado: stores de Postgres (migraciones 20261123000000, 20261124000000 y 20261125000000), entendimiento
// con Gemini (FASE 2), pausa humana existente (dulabs_pausas_chat), handlers reales de InternalActionExecutor y el envío
// de WhatsApp existente del Gate.
//
// FASE 5 — UNA sola fuente de configuración: el ARTEFACTO publicado.
//   1. Si el agente tiene un Universal Business Model publicado (dulabs_ba_active_artifacts), se usa su artefacto.
//   2. Si no, el Spec legacy del flow publicado pasa por el adaptador (Spec → UBM) y el MISMO compilador.
//   Un artefacto corrupto, de otro tenant, o un modelo/Spec que no es publicable => el turno falla cerrado
//   (conversation_runtime_error en runAgentTurn); nunca se cae a otra fuente ni al grafo.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { createDefaultExecutorRegistry } from "@/lib/flow/executor-factory";
import type { ConversationTurnHandler, GateActionSink } from "@/lib/agent-compiler/runtime/agent-runtime";
import { understandMessage } from "@/lib/agent-compiler/understanding/engine";
import { productionUnderstandingProvider } from "@/lib/agent-compiler/understanding/resilience";
import { createPausaChatHumanControl, createSupabaseConversationStateStore } from "@/lib/agent-compiler/conversation/store-supabase";
import { createActionEngine } from "@/lib/agent-compiler/actions/engine";
import { createSupabaseActionExecutionStore } from "@/lib/agent-compiler/actions/store-supabase";
import { createConversationRuntime } from "@/lib/agent-compiler/runtime/production/conversation-runtime";
import { artifactRequirements, businessContextFromArtifact, type CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";
import { compileLegacySpec } from "@/lib/agent-compiler/business-model/compile";
import { loadActiveArtifact, type BusinessModelStore } from "@/lib/agent-compiler/business-model/store";
import { createSupabaseBusinessModelStore } from "@/lib/agent-compiler/business-model/store-supabase";
import { catalogPortForArtifact } from "@/lib/agent-compiler/conversation/entities";
import { createSupabaseServiceTableReader } from "@/lib/agent-compiler/runtime/production/catalog-supabase";
import { createNativeActionHandler } from "@/lib/agent-compiler/actions/native/handler";
import { createSupabaseLeadContactStore } from "@/lib/agent-compiler/actions/native/leads";
import { createSupabaseReminderStore } from "@/lib/agent-compiler/actions/native/reminders";
import type { ProductInventoryPort } from "@/lib/agent-compiler/actions/native/products";
import { createSupabaseCatalogStore } from "@/lib/business-agent-catalog-store";
import { sharedCircuits } from "@/lib/agent-compiler/runtime/production/circuits";
import { createSupabaseRateLimiter, withTenantAiLimit } from "@/lib/agent-compiler/runtime/production/operations";

/** FASE 8 — inventario REAL del tenant (dulabs_inventario_productos vía el store de catálogo del Business Agent). */
export function createSupabaseProductInventory(supabase: SupabaseClient): ProductInventoryPort {
  const store = createSupabaseCatalogStore(supabase);
  return {
    async list(tenantId) {
      const rows = await store.listarProductos(tenantId);
      return rows.map((r) => ({ name: r.nombre, price: r.precio, ...(typeof r.stock === "number" ? { stock: r.stock } : {}) }));
    },
  };
}

export interface ArtifactResolutionLog {
  tenantId: string;
  agentId: string;
  source: "business_model" | "legacy_spec" | "none";
  version: string | null;
  /** El modelo activo no corresponde a la versión servida por el registro: se usó la del registro. */
  artifactNotServed?: boolean;
  recompiled?: boolean;
  cached?: boolean;
  error?: string;
}

const LEGACY_CACHE_MAX = 200;
const legacyCache = new Map<string, CompiledAgentArtifact>();

/**
 * Artefacto que configura el turno. Lanza (fail-closed) si no hay una fuente publicable.
 * `flowChecksum` identifica el flow publicado: el artefacto legacy se compila UNA vez por versión, no por mensaje.
 */
export async function resolveConversationArtifact(input: {
  store: BusinessModelStore;
  tenantId: string;
  flowId: string;
  flowVersionId: string;
  flowChecksum: string;
  spec: BusinessAgentSpec | undefined;
  log?: (e: ArtifactResolutionLog) => void;
}): Promise<CompiledAgentArtifact> {
  const log = input.log ?? ((e: ArtifactResolutionLog) => console.info("[business-agent.artifact]", JSON.stringify(e)));
  const base = { tenantId: input.tenantId, agentId: input.flowId };
  const active = await loadActiveArtifact(input.store, { tenantId: input.tenantId, agentId: input.flowId });
  let linkedElsewhere = false;
  if (active.kind === "ok") {
    // FASE 6: el artefacto del modelo solo se usa si es el que se publicó JUNTO con la versión que el registro sirve
    // hoy. Si el registro sirve otra (rollback o edición en el editor avanzado), manda esa versión (vía el adaptador).
    let link: string | null | undefined;
    try {
      link = input.store.activeFlowVersionLink ? await input.store.activeFlowVersionLink(input.tenantId, input.flowId) : undefined;
    } catch {
      log({ ...base, source: "business_model", version: null, error: "store_unavailable" });
      throw new Error("business_model_artifact_store_unavailable");
    }
    if (link === undefined || link === input.flowVersionId) {
      log({ ...base, source: "business_model", version: active.artifact.version.ref, recompiled: active.recompiled, cached: active.cached });
      return active.artifact;
    }
    linkedElsewhere = true;
  }
  if (active.kind === "error") {
    log({ ...base, source: "business_model", version: null, error: active.issue });
    throw new Error(`business_model_artifact_${active.issue}`);
  }
  if (!input.spec) {
    log({ ...base, source: "none", version: null, error: "no_published_source" });
    throw new Error("business_model_artifact_no_source");
  }
  const key = `${input.tenantId}:${input.flowId}:${input.flowVersionId}:${input.flowChecksum}`;
  const hit = legacyCache.get(key);
  if (hit) {
    log({ ...base, source: "legacy_spec", version: hit.version.ref, cached: true, ...(linkedElsewhere ? { artifactNotServed: true } : {}) });
    return hit;
  }
  const r = compileLegacySpec(input.spec, { tenantId: input.tenantId, agentId: input.flowId, versionRef: input.flowVersionId, publishedVersion: null });
  if (!r.ok) {
    log({ ...base, source: "legacy_spec", version: input.flowVersionId, error: `rejected:${r.errors.map((e) => e.code).join(",")}` });
    throw new Error("business_model_artifact_legacy_rejected");
  }
  if (legacyCache.size >= LEGACY_CACHE_MAX) legacyCache.delete(legacyCache.keys().next().value!);
  legacyCache.set(key, r.artifact);
  log({ ...base, source: "legacy_spec", version: r.artifact.version.ref, cached: false, ...(linkedElsewhere ? { artifactNotServed: true } : {}) });
  return r.artifact;
}

export function createProductionConversationRuntime(input: {
  supabase: SupabaseClient;
  tenantId: string;
  flowId: string;
  flowVersionId: string;
  flowChecksum: string;
  phoneNumberId: string;
  telefonoCliente: string;
  wamid: string;
  spec: BusinessAgentSpec | undefined;
  gateSink: GateActionSink;
}): ConversationTurnHandler {
  return {
    async handle(turn) {
      const artifact = await resolveConversationArtifact({
        store: createSupabaseBusinessModelStore(input.supabase),
        tenantId: input.tenantId,
        flowId: input.flowId,
        flowVersionId: input.flowVersionId,
        flowChecksum: input.flowChecksum,
        spec: input.spec,
      });
      // FASE 9 — límites en Postgres (fallan abierto): llamadas de IA por tenant y escrituras por conversación.
      const limiter = createSupabaseRateLimiter(input.supabase);
      const provider = withTenantAiLimit(productionUnderstandingProvider(), limiter, input.tenantId);
      const reminders = createSupabaseReminderStore(input.supabase);
      const actionExecutor = createDefaultExecutorRegistry(input.supabase).resolve("action");
      const runtime = createConversationRuntime({
        service: {
          store: createSupabaseConversationStateStore(input.supabase),
          requirements: artifactRequirements(artifact),
          business: businessContextFromArtifact(artifact),
          understand: (u) => understandMessage({ provider }, u),
          humanControl: createPausaChatHumanControl(input.supabase),
          // FASE 7 — entidades contra el negocio real: servicios (tablas del tenant o modelo publicado) y horario.
          catalog: catalogPortForArtifact(artifact, createSupabaseServiceTableReader(input.supabase)),
          businessHours: artifact.booking?.businessHours ?? null,
        },
        engine: createActionEngine({
          store: createSupabaseActionExecutionStore(input.supabase),
          handler: (request, signal) => actionExecutor.dispatch(request, { tenantId: request.tenantId, internal: true }, signal),
          // FASE 8 — acciones nativas: solo se crean los puertos de lo que el artefacto publicado habilitó.
          native: createNativeActionHandler({
            ...(artifact.actions.ba_consultar_producto ? { products: createSupabaseProductInventory(input.supabase) } : {}),
            ...(artifact.actions.ba_guardar_lead ? { leads: createSupabaseLeadContactStore(input.supabase) } : {}),
            ...(artifact.actions.ba_programar_recordatorio ? { reminders } : {}),
          }),
          // FASE 9 — circuito por dependencia externa y tenant (calendario vía Nylas).
          circuits: sharedCircuits,
          limiter,
        }),
        artifact,
        limiter,
        ...(artifact.reminders.enabled
          ? {
              reminders: {
                appointmentCancelled: async (conversationId: string, anchor: string | null) => void (await reminders.cancel(input.tenantId, conversationId, anchor)),
                appointmentMoved: async (conversationId: string, anchor: string | null, start: string) => void (await reminders.reschedule(input.tenantId, conversationId, anchor, start, artifact.reminders.offsetMinutes)),
              },
            }
          : {}),
        send: (text) =>
          input.gateSink.sendMessage({ tenantId: input.tenantId, conversation: { phoneNumberId: input.phoneNumberId, telefonoCliente: input.telefonoCliente }, wamid: input.wamid, text }),
      });
      // La versión del estado conversacional es la del artefacto (ubm-vN o el flow_version del Spec legacy).
      return runtime.handle({ ...turn, agentVersion: artifact.version.ref });
    },
  };
}
