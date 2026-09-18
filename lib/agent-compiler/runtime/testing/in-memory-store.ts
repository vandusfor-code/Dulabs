// DuLabs Business — Agent Compiler, Step 7 — Store en memoria (SOLO tests).
//
// Implementación fiel de FlowOrchestratorStore (multi-tenant, multi-ejecución)
// para ejercitar el ORQUESTADOR REAL (createExecutionOrchestrator) sin tocar
// Supabase ni la red. Replica el contrato observado en
// lib/flow/flow-orchestrator.test.ts: CAS por state_version, idempotencia de
// eventos/efectos, y aislamiento por tenant. NUNCA se usa en producción.

import { randomUUID } from "node:crypto";
import { FlowExecutionConcurrencyConflictError } from "@/lib/flow/flow-store-errors";
import { engineStateToExecutionUpdate } from "@/lib/flow/flow-store-types";
import type {
  FlowEffectRow,
  FlowExecutionRow,
  FlowRow,
  FlowVersionRow,
} from "@/lib/flow/flow-store-types";
import type { ConversationKey, FlowOrchestratorStore } from "@/lib/flow/flow-orchestrator";
import type { FlowDefinition } from "@/lib/flow/types";

const ACTIVE_STATUSES = new Set(["running", "waiting_input", "waiting_effect"]);

export interface NodeTransitionRecord {
  tenantId: string;
  flowExecutionId: string;
  eventId?: string;
  fromNodeId: string | null;
  toNodeId: string;
}

export interface InMemoryOrchestratorStore extends FlowOrchestratorStore {
  /** Publica un flow (dulabs_flows + dulabs_flow_versions publicada). */
  publishFlow(input: { tenantId: string; slug?: string; flowId?: string; definition: FlowDefinition }): {
    flowId: string;
    versionId: string;
  };
  /** Lecturas para aserciones de test (observabilidad/persistencia). */
  getExecutionRow(tenantId: string, id: string): FlowExecutionRow | undefined;
  listExecutions(tenantId: string): FlowExecutionRow[];
  listTransitions(): NodeTransitionRecord[];
  listEffects(): FlowEffectRow[];
  eventCount(): number;
}

const k = (tenantId: string, id: string) => `${tenantId}::${id}`;

export function createInMemoryOrchestratorStore(): InMemoryOrchestratorStore {
  const flows = new Map<string, FlowRow>();
  const versions = new Map<string, FlowVersionRow>();
  const executions = new Map<string, FlowExecutionRow>();
  const events = new Set<string>();
  const effects = new Map<string, FlowEffectRow>();
  const transitions: NodeTransitionRecord[] = [];

  function activeFor(tenantId: string, conv: ConversationKey): FlowExecutionRow | null {
    for (const row of executions.values()) {
      if (
        row.tenant_id === tenantId &&
        row.phone_number_id === conv.phoneNumberId &&
        row.telefono_cliente === conv.telefonoCliente &&
        ACTIVE_STATUSES.has(row.status)
      ) {
        return row;
      }
    }
    return null;
  }

  const store: InMemoryOrchestratorStore = {
    publishFlow({ tenantId, slug, flowId, definition }) {
      const fId = flowId ?? randomUUID();
      const vId = randomUUID();
      const now = new Date().toISOString();
      versions.set(k(tenantId, vId), {
        tenant_id: tenantId,
        id: vId,
        flow_id: fId,
        version_number: 1,
        definition_json: definition as unknown as Record<string, unknown>,
        published_at: now,
        retired_at: null,
        created_by: null,
        created_at: now,
      });
      flows.set(k(tenantId, fId), {
        tenant_id: tenantId,
        id: fId,
        slug: slug ?? `flow-${fId.slice(0, 8)}`,
        name: definition.name ?? "Flow",
        description: definition.description ?? null,
        status: "published",
        published_version_id: vId,
        created_by: null,
        created_at: now,
        updated_at: now,
      });
      return { flowId: fId, versionId: vId };
    },

    getExecutionRow(tenantId, id) {
      return executions.get(k(tenantId, id));
    },
    listExecutions(tenantId) {
      return [...executions.values()].filter((r) => r.tenant_id === tenantId);
    },
    listTransitions() {
      return [...transitions];
    },
    listEffects() {
      return [...effects.values()];
    },
    eventCount() {
      return events.size;
    },

    async getActiveExecution(tenantId, conv) {
      return activeFor(tenantId, conv);
    },

    async getExecutionById(tenantId, id) {
      return executions.get(k(tenantId, id)) ?? null;
    },

    async getFlow(tenantId, flowId) {
      return flows.get(k(tenantId, flowId)) ?? null;
    },

    async getFlowVersion(tenantId, versionId) {
      return versions.get(k(tenantId, versionId)) ?? null;
    },

    async createExecution(input) {
      // Colisión de execution_id lógico (idempotencia de creación concurrente).
      for (const row of executions.values()) {
        if (row.tenant_id === input.tenantId && row.execution_id === input.executionId) {
          return { created: false, reason: "active_execution_exists", existing: row };
        }
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      const row: FlowExecutionRow = {
        tenant_id: input.tenantId,
        id,
        flow_id: input.flowId,
        flow_version_id: input.flowVersionId,
        execution_id: input.executionId,
        phone_number_id: input.phoneNumberId,
        telefono_cliente: input.telefonoCliente,
        state_version: 0,
        created_at: now,
        updated_at: now,
        ...engineStateToExecutionUpdate(input.initialState),
        last_activity_at: now,
      };
      executions.set(k(input.tenantId, id), row);
      return { created: true, row };
    },

    async saveExecutionState(tenantId, executionRowId, engineState, expectedVersion) {
      const key = k(tenantId, executionRowId);
      const current = executions.get(key);
      if (!current) {
        throw new FlowExecutionConcurrencyConflictError({ tenantId, executionRowId, expectedStateVersion: expectedVersion });
      }
      if (current.state_version !== expectedVersion) {
        // CAS real: otra escritura ganó la carrera.
        throw new FlowExecutionConcurrencyConflictError({ tenantId, executionRowId, expectedStateVersion: expectedVersion });
      }
      const updated: FlowExecutionRow = {
        ...current,
        ...engineStateToExecutionUpdate(engineState),
        state_version: expectedVersion + 1,
        updated_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      };
      executions.set(key, updated);
      return { stateVersion: updated.state_version };
    },

    async insertEventIdempotent(input) {
      const key = `${input.tenantId}::${input.flowExecutionId}::${input.eventId}`;
      if (events.has(key)) return { inserted: false, row: null };
      events.add(key);
      return { inserted: true, row: null };
    },

    async insertEffectIdempotent(input) {
      const key = `${input.tenantId}::${input.flowExecutionId}::${input.effectId}`;
      const existing = effects.get(key);
      if (existing) return { inserted: false, row: existing };
      const now = new Date().toISOString();
      const row: FlowEffectRow = {
        id: effects.size + 1,
        tenant_id: input.tenantId,
        flow_execution_id: input.flowExecutionId,
        effect_id: input.effectId,
        node_id: input.nodeId,
        kind: input.kind,
        integration_id: input.integrationId ?? null,
        status: "pending",
        requested_at: now,
        resolved_at: null,
        result_payload_raw: null,
        result_payload_applied: null,
        provider: null,
        provider_model: null,
        created_at: now,
      };
      effects.set(key, row);
      return { inserted: true, row };
    },

    async getEffectByEffectId(tenantId, execId, effectId) {
      return effects.get(`${tenantId}::${execId}::${effectId}`) ?? null;
    },

    async resolveEffectResult(input) {
      const key = `${input.tenantId}::${input.flowExecutionId}::${input.effectId}`;
      const existing = effects.get(key);
      if (!existing) return { ok: false, reason: "not_found" };
      if (existing.tenant_id !== input.tenantId) return { ok: false, reason: "tenant_mismatch" };
      if (existing.status === "succeeded" || existing.status === "failed") {
        if (existing.status === input.status) return { ok: true, row: existing, alreadyResolved: true };
        return { ok: false, reason: "invalid_transition" };
      }
      if (existing.status !== "pending") return { ok: false, reason: "invalid_transition" };
      const updated: FlowEffectRow = {
        ...existing,
        status: input.status,
        result_payload_raw: input.resultPayloadRaw ?? null,
        result_payload_applied: input.resultPayloadApplied ?? null,
        resolved_at: input.resolvedAt ?? new Date().toISOString(),
      };
      effects.set(key, updated);
      return { ok: true, row: updated, alreadyResolved: false };
    },

    async recordNodeTransition(input) {
      transitions.push({
        tenantId: input.tenantId,
        flowExecutionId: input.flowExecutionId,
        eventId: input.eventId,
        fromNodeId: input.fromNodeId ?? null,
        toNodeId: input.toNodeId,
      });
    },
  };

  return store;
}
