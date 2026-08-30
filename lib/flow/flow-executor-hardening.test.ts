/**
 * Tests adversarial Fase 4.1.2 — hardening pre-Claude Executor.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FLOW_VALIDATION_CODES } from "@/lib/flow/constants";
import { createTestEffectExecutorFramework } from "@/lib/flow/executor-factory";
import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutionContext,
  type EffectExecutor,
} from "@/lib/flow/executor-types";
import { InternalActionExecutor } from "@/lib/flow/executors/internal-action-executor";
import type { ActivarPausaChatResult } from "@/lib/pausas-chat";
import type { GuardarLeadEnterpriseResult } from "@/lib/enterprise-leads";
import type { InternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import type { FlowDefinition } from "@/lib/flow/types";
import { validateSecurityRules } from "@/lib/flow/validate-security";

function pauseOk(pausadoHasta: string): ActivarPausaChatResult {
  return { ok: true, pausadoHasta };
}

function pauseFail(error: string): ActivarPausaChatResult {
  return { ok: false, error };
}

function leadOk(leadId: number): GuardarLeadEnterpriseResult {
  return { success: true, leadId };
}

function leadFail(error: string): GuardarLeadEnterpriseResult {
  return { success: false, error };
}

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function baseRequest(overrides: Partial<EffectDispatchRequest> = {}): EffectDispatchRequest {
  return {
    effectId: "fx-hardening",
    executionRowId: "exec-row-h",
    tenantId: TENANT_A,
    nodeId: "node-h",
    kind: "action",
    payload: {},
    attempt: 1,
    ...overrides,
  };
}

function permissiveAuthorizer(): InternalActionAuthorizer {
  return {
    assertActivacionOwnedByTenant: async () => true,
    assertPhoneNumberOwnedByTenant: async () => true,
  };
}

function denyingAuthorizer(): InternalActionAuthorizer {
  return {
    assertActivacionOwnedByTenant: async () => false,
    assertPhoneNumberOwnedByTenant: async () => false,
  };
}

function baseInternalDeps(
  overrides: Partial<ConstructorParameters<typeof InternalActionExecutor>[0]> = {},
) {
  return {
    supabase: {} as never,
    authorizer: permissiveAuthorizer(),
    guardarLeadEnterprise: async () => leadOk(99),
    activarPausaChat: async () => pauseOk("2026-09-02T10:00:00.000Z"),
    verificarDisponibilidad: async () => true,
    sugerirHorariosLibres: async () => [],
    crearCita: async () => null,
    readPausaUntil: async () => "2026-09-02T10:00:00.000Z",
    consultarDisponibilidadEspecialista: async () => ({
      ok: false as const,
      motivo: "servicio_no_manejado" as const,
      detalle: "stub",
    }),
    agendarCitaEspecialista: async () => ({
      ok: false as const,
      motivo: "servicio_no_manejado" as const,
      detalle: "stub",
    }),
    cancelarCitaEspecialista: async () => ({
      ok: false as const,
      motivo: "sin_cita_activa" as const,
      detalle: "stub",
    }),
    consultarCitasActivasEspecialista: async () => ({ cantidad: 0, citas: [] }),
    moverCitaEspecialista: async () => ({
      ok: false as const,
      motivo: "sin_cita_activa" as const,
      detalle: "stub",
    }),
    ...overrides,
  };
}

const conversation = { phoneNumberId: "123", telefonoCliente: "573001112233" };

function testExecutor(
  handler: (
    req: EffectDispatchRequest,
    ctx: EffectExecutionContext,
    signal?: AbortSignal,
  ) => Promise<EffectDispatchResult>,
): EffectExecutor {
  return {
    kind: "action",
    version: "test",
    capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
    dispatch: handler,
  };
}

describe("Fase 4.1.2 — hardening adversarial", () => {
  it("A. activarPausaChat falla → transferir_soporte NO success", async () => {
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        activarPausaChat: async () => pauseFail("db_error"),
        readPausaUntil: async () => "2026-09-02T10:00:00.000Z",
      }),
    );
    const result = await executor.dispatch(
      baseRequest({
        action: { actionType: "transferir_soporte", pauseDurationHours: 1 },
        conversation,
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.error, "pause_activation_failed");
  });

  it("B. readPausaUntil null → transferir_soporte NO success", async () => {
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        activarPausaChat: async () => pauseOk("2026-09-02T10:00:00.000Z"),
        readPausaUntil: async () => null,
      }),
    );
    const result = await executor.dispatch(
      baseRequest({
        action: { actionType: "transferir_soporte", pauseDurationHours: 1 },
        conversation,
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.error, "evidence_missing");
    assert.equal(result.data?.pausadoHasta, undefined);
  });

  it("C. lead insert sin leadId → NO success", async () => {
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        guardarLeadEnterprise: async () => leadFail("insert_failed"),
      }),
    );
    const result = await executor.dispatch(
      baseRequest({
        action: { actionType: "crear_lead_enterprise", params: {} },
        payload: { nombre: "Ana", correo: "a@test.com", empresa: "ACME", necesidad: "CRM" },
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.data?.leadPersisted, undefined);
    assert.equal(result.data?.leadId, undefined);
  });

  it("D. Tenant B intenta activacionId de Tenant A → SECURITY_REJECTED", async () => {
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        authorizer: denyingAuthorizer(),
      }),
    );
    const result = await executor.dispatch(
      baseRequest({
        tenantId: TENANT_B,
        action: {
          actionType: "webhook_http",
          url: "https://x.com",
          semanticTag: "consultar_disponibilidad",
        },
        payload: { activacionId: "999", fecha: "2026-09-01", hora: "10:00" },
      }),
      { tenantId: TENANT_B, internal: true },
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
    assert.equal(result.error, "tenant_resource_mismatch");
  });

  it("E. AI confirmation sin evidencia → publish rechazado", () => {
    const flow: FlowDefinition = {
      name: "AI confirmation blocked",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "ai",
          type: "ai",
          config: {
            instruction: "Confirma cita",
            mode: "respond",
            outputVariables: ["confirmationText"],
          },
        },
        {
          id: "msg",
          type: "message",
          config: {
            text: "{{confirmationText}}",
            messageRole: "external_assertion",
            asserts: ["appointment.reserved"],
          },
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
    assert.ok(r.errors.some((e) => e.code === FLOW_VALIDATION_CODES.UNVERIFIED_ASSERTION));
  });

  it("F. AI informational → publish permitido", () => {
    const flow: FlowDefinition = {
      name: "AI informational allowed",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "ai",
          type: "ai",
          config: {
            instruction: "Ayuda",
            mode: "respond",
            outputVariables: ["helpText"],
          },
        },
        {
          id: "msg",
          type: "message",
          config: {
            text: "{{helpText}}",
            messageRole: "informational",
          },
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
    assert.equal(r.valid, true, r.errors.map((e) => e.message).join("; "));
  });

  it("G. unknown executor exception → EXTERNAL_AMBIGUOUS", async () => {
    const framework = createTestEffectExecutorFramework({
      executors: [
        testExecutor(async () => {
          throw new Error("mystery failure");
        }),
      ],
    });
    const result = await framework.execute(
      baseRequest({ action: { actionType: "crear_lead_enterprise", params: {} } }),
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS);
  });

  it("H. timeout dispara AbortSignal", async () => {
    let signalWasAborted = false;
    const framework = createTestEffectExecutorFramework({
      overallTimeoutMs: 40,
      executors: [
        testExecutor(async (_req, _ctx, signal) => {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 500);
            signal?.addEventListener(
              "abort",
              () => {
                signalWasAborted = signal.aborted;
                clearTimeout(timer);
                reject(Object.assign(new Error("executor_timeout"), { name: "AbortError" }));
              },
              { once: true },
            );
          });
          return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS };
        }),
      ],
    });
    const result = await framework.execute(
      baseRequest({ action: { actionType: "crear_lead_enterprise", params: {} } }),
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT);
    assert.equal(signalWasAborted, true);
  });
});

describe("Fase 4.1.2 — classifyThrownError matrix", () => {
  async function classifyViaFramework(err: Error): Promise<EffectDispatchResult> {
    const framework = createTestEffectExecutorFramework({
      executors: [
        testExecutor(async () => {
          throw err;
        }),
      ],
    });
    return framework.execute(baseRequest({ action: { actionType: "crear_lead_enterprise", params: {} } }));
  }

  it("timeout → TIMEOUT", async () => {
    const r = await classifyViaFramework(
      Object.assign(new Error("executor_timeout"), { name: "AbortError" }),
    );
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT);
  });

  it("network error → EXTERNAL_AMBIGUOUS", async () => {
    const r = await classifyViaFramework(new Error("fetch failed"));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS);
  });

  it("validation error → VALIDATION_ERROR", async () => {
    const r = await classifyViaFramework(new Error("validation failed"));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR);
  });

  it("auth error → AUTH_ERROR", async () => {
    const r = await classifyViaFramework(new Error("unauthorized"));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR);
  });

  it("rate limit → RATE_LIMIT", async () => {
    const r = await classifyViaFramework(new Error("rate limit exceeded"));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.RATE_LIMIT);
  });
});

describe("Fase 4.1.2 — static params override runtime payload", () => {
  it("activacionId estático no puede ser sobrescrito por payload", async () => {
    let seenActivacionId = 0;
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        authorizer: {
          assertActivacionOwnedByTenant: async (_tenant, activacionId) => {
            seenActivacionId = activacionId;
            return activacionId === 1;
          },
          assertPhoneNumberOwnedByTenant: async () => true,
        },
        crearCita: async (_sb, input) => {
          seenActivacionId = input.activacionId;
          return {
            id: 1,
            activacion_id: 1,
            phone_number_id: "123",
            numero_cliente: "573001112233",
            nombre_cliente: null,
            fecha: "2026-09-01",
            hora_inicio: "10:00:00",
            duracion_min: 30,
            servicio: null,
            estado: "agendada",
            created_at: "",
            updated_at: "",
          };
        },
      }),
    );
    const result = await executor.dispatch(
      baseRequest({
        action: {
          actionType: "agendar_cita_marketplace",
          params: { activacionId: "1", fecha: "2026-09-01", hora: "10:00" },
        },
        payload: {
          activacionId: "999",
          fecha: "2026-09-01",
          hora: "10:00",
          duracionMin: "30",
          recursosDisponibles: "1",
        },
        conversation,
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal(seenActivacionId, 1);
  });
});
