/**
 * Tests AI Runtime Bridge + cierre seguridad (Fase 4.3).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FLOW_EDGE_HANDLE, FLOW_VALIDATION_CODES } from "@/lib/flow/constants";
import { EFFECT_RESULT_CLASSIFICATIONS } from "@/lib/flow/executor-types";
import {
  bridgeAiDispatchResult,
  rejectFabricatedAiEvidence,
} from "@/lib/flow/ai-runtime/ai-proposal-bridge";
import { validateAiActionProposal } from "@/lib/flow/ai-runtime/ai-proposal-validator";
import {
  buildVerifiedActionEffectData,
  sanitizeProposalArguments,
} from "@/lib/flow/ai-runtime/verified-results";
import type { FlowEngineState } from "@/lib/flow/engine-types";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import {
  createExecutionOrchestrator,
  ORCHESTRATOR_OUTCOMES,
  type ConversationKey,
  type FlowOrchestratorStore,
  type NormalizedFlowEvent,
} from "@/lib/flow/flow-orchestrator";
import { createTestEffectExecutorFramework } from "@/lib/flow/executor-factory";
import { ClaudeExecutor } from "@/lib/flow/executors/claude-executor";
import type { ActionNodeConfig, AiNodeConfig, FlowDefinition } from "@/lib/flow/types";
import type { FlowExecutionRow } from "@/lib/flow/flow-store-types";
import { engineStateToExecutionUpdate } from "@/lib/flow/flow-store-types";
import { validateSecurityRules } from "@/lib/flow/validate-security";

const TENANT = "tenant-a";
const CONV: ConversationKey = { phoneNumberId: "123", telefonoCliente: "573001112233" };

function appointmentFlow(): FlowDefinition {
  return {
    name: "Appointment AI bridge",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "manual" } },
      {
        id: "ai-consult",
        type: "ai",
        config: {
          instruction: "Consulta disponibilidad",
          mode: "propose_action",
          allowedTools: ["consultar_disponibilidad"],
        },
      },
      {
        id: "act-consultar",
        type: "action",
        config: {
          actionType: "webhook_http",
          url: "https://api.example.com/consultar",
          semanticTag: "consultar_disponibilidad",
        },
      },
      {
        id: "ai-agendar",
        type: "ai",
        config: {
          instruction: "Agenda cita",
          mode: "propose_action",
          allowedTools: ["agendar_cita_marketplace"],
        },
      },
      {
        id: "act-agendar",
        type: "action",
        config: { actionType: "agendar_cita_marketplace", params: { activacionId: "1" } },
      },
      {
        id: "ai-respond",
        type: "ai",
        config: { instruction: "Confirma al usuario", mode: "respond" },
      },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "ai-consult" },
      { id: "e2", source: "ai-consult", target: "act-consultar", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e3", source: "act-consultar", target: "ai-agendar" },
      { id: "e4", source: "ai-agendar", target: "act-agendar", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e5", source: "act-agendar", target: "ai-respond" },
      { id: "e6", source: "ai-respond", target: "end", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
    ],
    variables: [{ key: "fecha", label: "Fecha", type: "string" }],
  };
}

describe("AI Runtime Bridge — validation", () => {
  it("proposal requires allowedTools", () => {
    const flow = appointmentFlow();
    const r = validateAiActionProposal({
      flow,
      aiNodeId: "ai-consult",
      aiConfig: { instruction: "x", mode: "propose_action", allowedTools: [] },
      proposal: { actionType: "consultar_disponibilidad" },
      tenantId: TENANT,
      executionTenantId: TENANT,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, "action_proposals_disabled");
  });

  it("unauthorized action → SECURITY_REJECTED", () => {
    const flow = appointmentFlow();
    const r = validateAiActionProposal({
      flow,
      aiNodeId: "ai-consult",
      aiConfig: {
        instruction: "x",
        mode: "propose_action",
        allowedTools: ["consultar_disponibilidad"],
      },
      proposal: { actionType: "webhook_http" },
      tenantId: TENANT,
      executionTenantId: TENANT,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, "action_proposal_not_allowed");
  });

  it("prohibited argument fields → VALIDATION_ERROR", () => {
    const flow = appointmentFlow();
    const r = validateAiActionProposal({
      flow,
      aiNodeId: "ai-consult",
      aiConfig: {
        instruction: "x",
        mode: "propose_action",
        allowedTools: ["consultar_disponibilidad"],
      },
      proposal: { actionType: "consultar_disponibilidad", arguments: { available: true } },
      tenantId: TENANT,
      executionTenantId: TENANT,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "VALIDATION_ERROR");
  });

  it("sanitize strips evidence from arguments", () => {
    const s = sanitizeProposalArguments({ fecha: "2026-09-01", appointmentId: "123", hora: "15:00" });
    assert.equal(s.fecha, "2026-09-01");
    assert.equal(s.appointmentId, undefined);
  });
});

describe("AI Runtime Bridge — adversarial", () => {
  it("A. fabricated available → rejected", () => {
    const r = rejectFabricatedAiEvidence({ available: true, responseText: "ok" });
    assert.ok(r);
    assert.equal(r!.error, "fabricated_evidence:available");
  });

  it("B. fabricated appointmentId → rejected", () => {
    const r = rejectFabricatedAiEvidence({ appointmentId: 123 });
    assert.ok(r);
  });

  it("C. fabricated leadId → rejected", () => {
    const r = rejectFabricatedAiEvidence({ leadId: 123 });
    assert.ok(r);
  });

  it("D. bridge rejects webhook proposal not in flow", () => {
    const bridged = bridgeAiDispatchResult({
      flow: appointmentFlow(),
      aiNodeId: "ai-consult",
      aiConfig: {
        instruction: "x",
        mode: "propose_action",
        allowedTools: ["consultar_disponibilidad"],
      },
      tenantId: TENANT,
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: {
          actionProposal: { actionType: "webhook_http", arguments: { url: "http://evil.com" } },
        },
      },
    });
    assert.equal(bridged.dispatchResult.success, false);
    assert.equal(bridged.dispatchResult.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
  });

  it("J. unauthorized agendar when not in allowedTools", () => {
    const bridged = bridgeAiDispatchResult({
      flow: appointmentFlow(),
      aiNodeId: "ai-consult",
      aiConfig: {
        instruction: "x",
        mode: "propose_action",
        allowedTools: ["consultar_disponibilidad"],
      },
      tenantId: TENANT,
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: {
          actionProposal: { actionType: "agendar_cita_marketplace" },
        },
      },
    });
    assert.equal(bridged.dispatchResult.success, false);
  });

  it("K. claim estático en MESSAGE con variable AI → blocked at publish", () => {
    const flow: FlowDefinition = {
      name: "Bypass closed",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "ai",
          type: "ai",
          config: { instruction: "x", mode: "respond", outputVariables: ["confirmationText"] },
        },
        {
          id: "msg",
          type: "message",
          config: { text: "Tu cita quedó confirmada: {{confirmationText}}", messageRole: "informational" },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "ai" },
        { id: "e2", source: "ai", target: "msg" },
        { id: "e3", source: "msg", target: "end" },
      ],
      variables: [],
    };
    const r = validateSecurityRules(flow);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.code === FLOW_VALIDATION_CODES.EXTERNAL_CLAIM_UNVERIFIED));
  });

  it("F. tenant A proposal vs tenant B execution → SECURITY_REJECTED", () => {
    const r = validateAiActionProposal({
      flow: appointmentFlow(),
      aiNodeId: "ai-consult",
      aiConfig: {
        instruction: "x",
        mode: "propose_action",
        allowedTools: ["consultar_disponibilidad"],
      },
      proposal: { actionType: "consultar_disponibilidad" },
      tenantId: "tenant-a",
      executionTenantId: "tenant-b",
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, "tenant_mismatch");
  });

  it("G. duplicate effect id → insert rejected", async () => {
    const effects = new Map<string, { status: string }>();

    const store = {
      insertEffectIdempotent: async (input: {
        tenantId: string;
        flowExecutionId: string;
        effectId: string;
        nodeId: string;
        kind: string;
      }) => {
        if (effects.has(input.effectId)) return { inserted: false as const, row: null };
        effects.set(input.effectId, { status: "pending" });
        return { inserted: true as const, row: null };
      },
    };

    const first = await store.insertEffectIdempotent({
      tenantId: TENANT,
      flowExecutionId: "exec-row-1",
      effectId: "fx-dup",
      nodeId: "ai-consult",
      kind: "ai",
    });
    effects.set("fx-dup", { status: "succeeded" });

    const second = await store.insertEffectIdempotent({
      tenantId: TENANT,
      flowExecutionId: "exec-row-1",
      effectId: "fx-dup",
      nodeId: "ai-consult",
      kind: "ai",
    });

    assert.equal(first.inserted, true);
    assert.equal(second.inserted, false);
  });

  it("informational AI helpText still allowed", () => {
    const flow: FlowDefinition = {
      name: "Help allowed",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "ai",
          type: "ai",
          config: { instruction: "x", mode: "respond", outputVariables: ["helpText"] },
        },
        {
          id: "msg",
          type: "message",
          config: { text: "{{helpText}}", messageRole: "informational" },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "ai" },
        { id: "e2", source: "ai", target: "msg" },
        { id: "e3", source: "msg", target: "end" },
      ],
      variables: [],
    };
    assert.equal(validateSecurityRules(flow).valid, true);
  });
});

describe("AI Runtime Bridge — verified results", () => {
  it("action result wrapped with provenance", () => {
    const data = buildVerifiedActionEffectData({
      action: { actionType: "agendar_cita_marketplace", params: {} },
      effectId: "fx-1",
      executionId: "exec-1",
      rawData: { appointmentId: 123, status: "agendada" },
    });
    assert.equal(data.appointmentId, 123);
    const verified = data.__verifiedResults as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(verified));
    assert.equal(verified[0]?.verified, true);
    assert.equal(verified[0]?.source, "agendar_cita_marketplace");
  });
});

describe("AI Runtime Bridge — E2E simulado", () => {
  it("full appointment chain — Claude never fabricates evidence", () => {
    const flow = appointmentFlow();
    const aiConsultCfg = flow.nodes.find((n) => n.id === "ai-consult")!.config as AiNodeConfig;
    const aiAgendarCfg = flow.nodes.find((n) => n.id === "ai-agendar")!.config as AiNodeConfig;
    const actConsultar = flow.nodes.find((n) => n.id === "act-consultar")!.config as ActionNodeConfig;
    const actAgendar = flow.nodes.find((n) => n.id === "act-agendar")!.config as ActionNodeConfig;

    const step1 = bridgeAiDispatchResult({
      flow,
      aiNodeId: "ai-consult",
      aiConfig: aiConsultCfg,
      tenantId: TENANT,
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: {
          mode: "propose_action",
          actionProposal: {
            actionType: "consultar_disponibilidad",
            arguments: { fecha: "2026-09-02", hora: "15:00" },
          },
        },
      },
    });
    assert.equal(step1.bridged, true);
    assert.equal(step1.variablesPatch?.fecha, "2026-09-02");
    assert.equal(step1.variablesPatch?.available, undefined);
    assert.equal(step1.dispatchResult.data?.actionProposal, undefined);

    const step2 = buildVerifiedActionEffectData({
      action: actConsultar,
      effectId: "fx-act-consult",
      executionId: "exec-1",
      rawData: { available: true, slots: ["15:00"], date: "2026-09-02" },
    });
    assert.equal(step2.available, true);
    const verifiedConsult = step2.__verifiedResults as Array<{ verified: boolean; source: string }>;
    assert.equal(verifiedConsult[0]?.verified, true);
    assert.equal(verifiedConsult[0]?.source, "consultar_disponibilidad");

    const step3 = bridgeAiDispatchResult({
      flow,
      aiNodeId: "ai-agendar",
      aiConfig: aiAgendarCfg,
      tenantId: TENANT,
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: {
          mode: "propose_action",
          actionProposal: {
            actionType: "agendar_cita_marketplace",
            arguments: { fecha: "2026-09-02", hora: "15:00" },
          },
        },
      },
    });
    assert.equal(step3.bridged, true);
    assert.equal(step3.variablesPatch?.appointmentId, undefined);

    const step4 = buildVerifiedActionEffectData({
      action: actAgendar,
      effectId: "fx-act-agendar",
      executionId: "exec-1",
      rawData: { appointmentId: 123, status: "agendada" },
    });
    assert.equal(step4.appointmentId, 123);

    assert.equal(
      rejectFabricatedAiEvidence({ mode: "respond", responseText: "Listo, tu cita quedó agendada." }),
      null,
    );
    assert.ok(rejectFabricatedAiEvidence({ available: true }));
    assert.ok(rejectFabricatedAiEvidence({ appointmentId: 123 }));
  });

  it("orchestrator integrates bridge — proposal sanitized, budget persisted", async () => {
    const flow = appointmentFlow();
    let claudeCalls = 0;

    const framework = createTestEffectExecutorFramework({
      executors: [
        new ClaudeExecutor({
          resolveApiKey: async () => "sk-test",
          anthropicClient: {
            async createMessage() {
              claudeCalls += 1;
              return {
                content: [{
                  type: "tool_use",
                  id: "t1",
                  name: "structured_ai_output",
                  input: {
                    mode: "propose_action",
                    actionProposal: {
                      actionType: "consultar_disponibilidad",
                      arguments: { fecha: "2026-09-02", hora: "15:00" },
                    },
                  },
                }],
                usage: { input_tokens: 10, output_tokens: 5 },
                model: "claude-sonnet-5",
              };
            },
          },
        }),
      ],
    });

    let executionRow: FlowExecutionRow | null = null;
    const effects = new Map<string, { status: string; applied?: Record<string, unknown> }>();

    const store = {
      getActiveExecution: async () => executionRow,
      getExecutionById: async () => executionRow,
      getFlow: async () => ({
        tenant_id: TENANT,
        id: "flow-1",
        slug: "appointment",
        name: "f",
        description: null,
        status: "published",
        published_version_id: "fv-1",
        created_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      getFlowVersion: async () => ({
        tenant_id: TENANT,
        id: "fv-1",
        flow_id: "flow-1",
        version_number: 1,
        definition_json: flow as unknown as Record<string, unknown>,
        published_at: new Date().toISOString(),
        retired_at: null,
        created_by: null,
        created_at: new Date().toISOString(),
      }),
      createExecution: async (input: {
        tenantId: string;
        flowId: string;
        flowVersionId: string;
        executionId: string;
        phoneNumberId: string;
        telefonoCliente: string;
        initialState: FlowEngineState;
      }) => {
        const { initialState, tenantId, flowId, flowVersionId, executionId, phoneNumberId, telefonoCliente } = input;
        executionRow = {
          tenant_id: tenantId,
          id: "exec-row-1",
          flow_id: flowId,
          flow_version_id: flowVersionId,
          execution_id: executionId,
          phone_number_id: phoneNumberId,
          telefono_cliente: telefonoCliente,
          status: initialState.status,
          current_node_id: initialState.currentNodeId,
          variables: initialState.variables,
          expected_input: initialState.expectedInput ?? null,
          pending_effect: initialState.pendingEffect ?? null,
          exports: initialState.exports,
          metadata: initialState.metadata,
          state_version: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_activity_at: new Date().toISOString(),
        };
        return { created: true, row: executionRow };
      },
      saveExecutionState: async (_t: string, _id: string, state: FlowEngineState, expectedVersion: number) => {
        if (!executionRow) throw new Error("no row");
        if (executionRow.state_version !== expectedVersion) {
          throw new Error("cas conflict");
        }
        const update = engineStateToExecutionUpdate(state);
        executionRow = {
          ...executionRow,
          ...update,
          state_version: expectedVersion + 1,
          updated_at: new Date().toISOString(),
        };
        return { stateVersion: executionRow.state_version };
      },
      insertEventIdempotent: async () => ({ inserted: true }),
      insertEffectIdempotent: async (input: { effectId: string }) => {
        const { effectId } = input;
        if (effects.has(effectId)) return { inserted: false };
        effects.set(effectId, { status: "pending" });
        return { inserted: true };
      },
      getEffectByEffectId: async (_t: string, _e: string, effectId: string) => {
        const fx = effects.get(effectId);
        if (!fx) return null;
        return {
          tenant_id: TENANT,
          id: 1,
          flow_execution_id: "exec-row-1",
          effect_id: effectId,
          node_id: "ai-consult",
          kind: "ai",
          status: fx.status === "succeeded" ? "succeeded" : "failed",
          result_payload_applied: fx.applied ?? null,
          result_payload_raw: fx.applied ?? null,
          integration_id: null,
          created_at: new Date().toISOString(),
          resolved_at: new Date().toISOString(),
        };
      },
      resolveEffectResult: async (input: {
        effectId: string;
        status: "succeeded" | "failed";
        resultPayloadApplied?: Record<string, unknown>;
      }) => {
        const { effectId, status, resultPayloadApplied } = input;
        const fx = effects.get(effectId)!;
        fx.status = status;
        fx.applied = resultPayloadApplied;
        return {
          ok: true,
          row: {
            tenant_id: TENANT,
            id: 1,
            flow_execution_id: "exec-row-1",
            effect_id: effectId,
            node_id: "ai-consult",
            kind: "ai",
            status: status === "succeeded" ? "succeeded" : "failed",
            result_payload_applied: resultPayloadApplied ?? null,
            result_payload_raw: resultPayloadApplied ?? null,
            integration_id: null,
            created_at: new Date().toISOString(),
            resolved_at: new Date().toISOString(),
          },
        };
      },
      recordNodeTransition: async () => {},
    };

    const orchestrator = createExecutionOrchestrator({
      store: store as unknown as FlowOrchestratorStore,
      engine: { createFlowEngineState, runFlowEngine },
      effectFramework: framework,
    });

    const result = await orchestrator.process({
      tenantId: TENANT,
      conversation: CONV,
      flowId: "flow-1",
      eventId: "evt-start",
      eventType: "start",
      payload: {},
      engineEvent: { type: "start" },
      receivedAt: new Date().toISOString(),
    });

    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.ok(claudeCalls >= 1);
    assert.equal(executionRow!.variables.available, undefined);
    assert.equal(executionRow!.variables.appointmentId, undefined);
    assert.ok(executionRow!.variables.__proposalBridged);
    assert.ok(executionRow!.metadata.aiBudget);
  });

  it("terminal state rejects late input", async () => {
    const executionRow: FlowExecutionRow = {
      tenant_id: TENANT,
      id: "exec-row-1",
      flow_id: "flow-1",
      flow_version_id: "fv-1",
      execution_id: "exec-1",
      phone_number_id: CONV.phoneNumberId,
      telefono_cliente: CONV.telefonoCliente,
      status: "completed",
      current_node_id: "end",
      variables: {},
      expected_input: null,
      pending_effect: null,
      exports: { lead: {}, custom_fields: {}, webhook_body: {} },
      metadata: {},
      state_version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    };

    const store = {
      getActiveExecution: async () => executionRow,
      getExecutionById: async () => executionRow,
      getFlow: async () => null,
      getFlowVersion: async () => null,
      createExecution: async () => ({ created: false, existing: executionRow }),
      saveExecutionState: async () => ({ stateVersion: 2 }),
      insertEventIdempotent: async () => ({ inserted: true }),
      insertEffectIdempotent: async () => ({ inserted: true }),
      getEffectByEffectId: async () => null,
      resolveEffectResult: async () => ({ ok: true, row: {} as never }),
      recordNodeTransition: async () => {},
    };

    const orchestrator = createExecutionOrchestrator({
      store: store as unknown as FlowOrchestratorStore,
      engine: { createFlowEngineState, runFlowEngine },
      effectFramework: createTestEffectExecutorFramework({ executors: [] }),
    });

    const result = await orchestrator.process({
      tenantId: TENANT,
      conversation: CONV,
      flowId: "flow-1",
      eventId: "evt-late",
      eventType: "text",
      payload: { text: "hola" },
      engineEvent: { type: "text", text: "hola" },
      receivedAt: new Date().toISOString(),
    });

    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.TERMINAL_NO_OP);
  });
});

describe("AI Runtime Bridge — duplicate idempotency", () => {
  it("duplicate event → no re-processing", async () => {
    const flow = appointmentFlow();
    let insertEventCalls = 0;
    const executionRow: FlowExecutionRow = {
      tenant_id: TENANT,
      id: "exec-row-1",
      flow_id: "flow-1",
      flow_version_id: "fv-1",
      execution_id: "exec-1",
      phone_number_id: CONV.phoneNumberId,
      telefono_cliente: CONV.telefonoCliente,
      status: "waiting_input",
      current_node_id: "start",
      variables: {},
      expected_input: "text",
      pending_effect: null,
      exports: { lead: {}, custom_fields: {}, webhook_body: {} },
      metadata: {},
      state_version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    };

    const store = {
      getActiveExecution: async () => executionRow,
      getExecutionById: async () => executionRow,
      getFlow: async () => ({
        tenant_id: TENANT,
        id: "flow-1",
        name: "f",
        published_version_id: "fv-1",
        created_at: "",
        updated_at: "",
      }),
      getFlowVersion: async () => ({
        tenant_id: TENANT,
        id: "fv-1",
        flow_id: "flow-1",
        version: 1,
        definition_json: flow,
        created_at: new Date().toISOString(),
      }),
      createExecution: async () => ({ created: false, existing: executionRow }),
      saveExecutionState: async () => ({ stateVersion: 2 }),
      insertEventIdempotent: async () => {
        insertEventCalls += 1;
        return { inserted: insertEventCalls === 1 };
      },
      insertEffectIdempotent: async () => ({ inserted: true }),
      getEffectByEffectId: async () => null,
      resolveEffectResult: async () => ({ ok: true, row: {} as never }),
      recordNodeTransition: async () => {},
    };

    const orchestrator = createExecutionOrchestrator({
      store: store as unknown as FlowOrchestratorStore,
      engine: { createFlowEngineState, runFlowEngine },
      effectFramework: createTestEffectExecutorFramework({ executors: [] }),
    });

    const evt: NormalizedFlowEvent = {
      tenantId: TENANT,
      conversation: CONV,
      flowId: "flow-1",
      eventId: "dup-evt",
      eventType: "text",
      payload: {},
      engineEvent: { type: "text", text: "hola" },
      receivedAt: new Date().toISOString(),
    };

    const first = await orchestrator.process(evt);
    const second = await orchestrator.process(evt);
    assert.equal(first.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(second.outcome, ORCHESTRATOR_OUTCOMES.DUPLICATE_EVENT);
  });
});
