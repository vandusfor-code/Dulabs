// Business Agent 2.0, FASE 1 — contratos de acción, variables protegidas y contrato de errores.
//
// Todo se prueba contra código REAL: el compilador real (Spec -> IR -> FlowDefinition), la política real y el
// bridge real del Flow Engine (bridgeAiDispatchResult). Nada depende de una respuesta concreta de un LLM.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compileBusinessAgent } from "@/lib/agent-compiler/compile";
import { compileIRToFlowDefinition } from "@/lib/agent-compiler/flow-compiler";
import { photographySpec, retailSpec, salonSpec } from "@/lib/agent-compiler/runtime/fixtures";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import type { FlowDefinition } from "@/lib/flow/types";
import {
  BUSINESS_AGENT_ACTION_CONTRACTS,
  EXECUTOR_FRAMEWORK_TIMEOUT_MS,
  getActionContract,
  llmArgumentKeys,
} from "@/lib/agent-compiler/contracts/action-contracts";
import { createBusinessAgentArgumentPolicy, type ActionContractEvent } from "@/lib/agent-compiler/contracts/argument-policy";
import { buildFlowVariablePolicy, classifyVariable, protectionFor } from "@/lib/agent-compiler/contracts/variable-policy";
import { categorizeEffectFailure, categorizeRuntimeFailure, safeError, BUSINESS_AGENT_ERROR_CATEGORIES } from "@/lib/agent-compiler/contracts/errors";
import { isSystemInternalVariableKey } from "@/lib/flow/ai-runtime/protected-variables";
import { sanitizeProposalArgumentsDetailed } from "@/lib/flow/ai-runtime/verified-results";
import { bridgeAiDispatchResult } from "@/lib/flow/ai-runtime/ai-proposal-bridge";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchResult } from "@/lib/flow/executor-types";
import { parseAiOutputJson } from "@/lib/flow/claude/claude-output-schema";

const TENANT = "11111111-1111-4111-8111-111111111111";
const HORARIO = { week: Array.from({ length: 7 }, () => ({ closed: false, intervals: [{ open: "08:00", close: "20:00" }] })), exceptions: [] };

/** Agente de agenda con Google Calendar (Nylas): el camino con más acciones (disponibilidad, reserva, citas). */
function nylasSpec(): BusinessAgentSpec {
  const s = salonSpec();
  return {
    ...s,
    scheduling: { ...s.scheduling, provider: "nylas", businessHours: HORARIO, cancellation: { allowed: true, minNoticeHours: 4 } },
    customerData: {
      fields: [{ key: "nombreCliente", label: "Nombre", type: "text", required: true, enabled: true, scope: "customer" }],
    },
  };
}

function compileFlow(spec: BusinessAgentSpec): FlowDefinition {
  const compiled = compileBusinessAgent(spec, { tenantId: TENANT });
  assert.ok(compiled.success, JSON.stringify(!compiled.success && compiled.diagnostics));
  const flow = compileIRToFlowDefinition(compiled.ir, { tenantId: TENANT });
  assert.ok(flow.success, JSON.stringify(!flow.success && flow.diagnostics));
  return flow.flow;
}

const SPECS: Array<[string, () => BusinessAgentSpec]> = [
  ["fotografía (faq+catálogo+cotización+leads+handoff)", photographySpec],
  ["salón (agenda interna)", salonSpec],
  ["tienda (productos)", retailSpec],
  ["agenda Google Calendar (nylas + cancelar/reprogramar)", nylasSpec],
];

function actionTypesOf(flow: FlowDefinition): string[] {
  const out = new Set<string>();
  for (const n of flow.nodes) {
    if (n.type === "action") out.add((n.config as { actionType: string }).actionType);
    if (n.type === "ai") for (const t of n.config.allowedTools ?? []) out.add(t);
  }
  return [...out];
}

function aiProposalResult(actionType: string, args: Record<string, unknown>): EffectDispatchResult {
  const data = { mode: "propose_action", actionProposal: { actionType, arguments: args } };
  return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data, rawResult: { mode: "propose_action" } };
}

function aiNodeFor(flow: FlowDefinition, actionType: string) {
  const node = flow.nodes.find((n) => n.type === "ai" && (n.config.allowedTools ?? []).includes(actionType));
  assert.ok(node && node.type === "ai", `el flow tiene un nodo IA que propone ${actionType}`);
  return node;
}

describe("FASE 1 — contratos de acción: cobertura y forma", () => {
  for (const [nombre, spec] of SPECS) {
    it(`toda acción que el compilador cablea tiene contrato — ${nombre}`, () => {
      const flow = compileFlow(spec());
      const sinContrato = actionTypesOf(flow).filter((a) => !getActionContract(a));
      assert.deepEqual(sinContrato, [], "un Business Agent no puede cablear una acción sin contrato");
    });
  }

  it("ningún contrato deja que la IA proponga identidad, tenant, ids internos o variables del sistema", () => {
    for (const c of BUSINESS_AGENT_ACTION_CONTRACTS) {
      for (const key of llmArgumentKeys(c)) {
        assert.equal(isSystemInternalVariableKey(key), false, `${c.action}.${key} no puede ser SYSTEM-INTERNAL`);
        assert.ok(!["confirmado", "duracionMin", "precio", "total", "telefonoCliente", "status"].includes(key), `${c.action}.${key} es decisión del backend`);
      }
      assert.ok(!llmArgumentKeys(c).some((k) => c.outputs.includes(k) && c.action !== "buscar_disponibilidad_nylas_generico"), `${c.action}: la IA no propone sus propias salidas`);
    }
  });

  it("todo contrato declara permisos, tenant scope, idempotencia y un timeout dentro del framework", () => {
    const acciones = new Set<string>();
    for (const c of BUSINESS_AGENT_ACTION_CONTRACTS) {
      assert.ok(!acciones.has(c.action), `contrato duplicado: ${c.action}`);
      acciones.add(c.action);
      assert.match(c.version, /^\d+\.\d+\.\d+$/);
      assert.equal(c.permission, "runtime_internal");
      assert.equal(c.tenantScope, "runtime_context");
      assert.ok(c.runtimeInjected.includes("tenantId"), `${c.action}: el tenant lo inyecta el runtime`);
      assert.ok(c.timeoutMs > 0 && c.timeoutMs <= EXECUTOR_FRAMEWORK_TIMEOUT_MS, `${c.action}: timeout dentro del framework`);
      if (c.sideEffects === "write_external") assert.notEqual(c.idempotency, "not_required", `${c.action}: una escritura externa declara su idempotencia`);
      for (const cat of Object.values(c.errors)) assert.ok((BUSINESS_AGENT_ERROR_CATEGORIES as readonly string[]).includes(cat));
    }
  });
});

describe("FASE 1 — variables protegidas (derivadas del flow compilado)", () => {
  const flow = compileFlow(nylasSpec());
  const policy = buildFlowVariablePolicy(flow);

  it("clasifica las 4 categorías desde el grafo real", () => {
    assert.equal(classifyVariable(policy, "appointment_request"), "USER_CONTROLLED");
    assert.equal(classifyVariable(policy, "nombreCliente"), "USER_CONTROLLED");
    assert.equal(classifyVariable(policy, "businessHoursJson"), "BUSINESS_CONFIGURED");
    assert.equal(classifyVariable(policy, "horariosDisponibles"), "RUNTIME_DERIVED");
    assert.equal(classifyVariable(policy, "reservaTexto"), "RUNTIME_DERIVED");
    assert.equal(classifyVariable(policy, "telefonoCliente"), "RUNTIME_DERIVED");
    assert.equal(classifyVariable(policy, "__dulabsAiBudget"), "SYSTEM_INTERNAL");
    assert.equal(classifyVariable(policy, "TenantId"), "SYSTEM_INTERNAL");
    assert.equal(classifyVariable(policy, "hora"), "AI_PROPOSABLE");
  });

  it("una salida de OTRA acción está protegida; la sugerencia de la propia acción no", () => {
    assert.equal(protectionFor(policy, "fecha", "crear_cita_nylas_generico"), "RUNTIME_DERIVED");
    assert.equal(protectionFor(policy, "fecha", "buscar_disponibilidad_nylas_generico"), null);
  });
});

describe("FASE 1 — política de argumentos (contrato aplicado a la propuesta de la IA)", () => {
  const flow = compileFlow(nylasSpec());
  const eventos: ActionContractEvent[] = [];
  const policy = createBusinessAgentArgumentPolicy({ log: (e) => eventos.push(e) });
  const aplicar = (actionType: string, args: Record<string, string>, tenantId = TENANT) =>
    policy.apply({ tenantId, actionType, arguments: args, flow, aiNodeId: "ai-book-propose", context: { executionRowId: "ex-1", flowId: "f-1", flowVersionId: "v-1" } });

  it("1. input válido => aceptado y normalizado (trim)", () => {
    const r = aplicar("crear_cita_nylas_generico", { servicio: "  Corte  ", hora: "16:00" });
    assert.ok(r.ok);
    assert.deepEqual(r.arguments, { servicio: "Corte", hora: "16:00" });
    assert.deepEqual(r.contract, { action: "crear_cita_nylas_generico", version: "1.0.0" });
  });

  it("2. campo no permitido => se descarta (nunca llega a la acción)", () => {
    const r = aplicar("crear_cita_nylas_generico", { servicio: "Corte", precio: "1", confirmado: "true", duracionMin: "5" });
    assert.ok(r.ok);
    assert.deepEqual(r.arguments, { servicio: "Corte" });
    assert.deepEqual(r.dropped.map((d) => d.key).sort(), ["confirmado", "duracionMin", "precio"]);
    assert.ok(r.dropped.every((d) => d.reason === "not_in_contract"));
  });

  it("6. la IA intenta reescribir variables protegidas (capturadas, derivadas) => se descartan", () => {
    const r = aplicar("crear_cita_nylas_generico", { nombreCliente: "Otro", fecha: "2020-01-01", hora: "10:00" });
    assert.ok(r.ok);
    assert.deepEqual(r.arguments, { hora: "10:00" });
    const motivos = Object.fromEntries(r.dropped.map((d) => [d.key, d.reason]));
    assert.equal(motivos.nombreCliente, "protected:USER_CONTROLLED");
    assert.equal(motivos.fecha, "protected:RUNTIME_DERIVED");
  });

  it("5/18. datos inválidos para el contrato => VALIDATION_ERROR (la propuesta entera se rechaza)", () => {
    const r = aplicar("crear_cita_nylas_generico", { notas: "x".repeat(501) });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, "VALIDATION_ERROR");
    assert.equal(!r.ok && r.error, "action_contract_invalid_arguments");
  });

  it("un campo vacío equivale a no proponerlo (no invalida la propuesta)", () => {
    const r = aplicar("crear_cita_nylas_generico", { servicio: "Corte", fecha: "   " });
    assert.ok(r.ok);
    assert.deepEqual(r.arguments, { servicio: "Corte" });
  });

  it("4. acción sin contrato => SECURITY_REJECTED (un Business Agent no ejecuta acciones sin contrato)", () => {
    const r = aplicar("webhook_http", { url: "https://evil.example" });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, "SECURITY_REJECTED");
    assert.equal(!r.ok && r.error, "action_contract_missing");
  });

  it("20. contexto de tenant ausente => SECURITY_REJECTED (fail-closed)", () => {
    const r = aplicar("crear_cita_nylas_generico", { hora: "10:00" }, "");
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error, "action_contract_tenant_missing");
  });

  it("observabilidad: cada decisión deja un evento con tenant, flow, versión, ejecución, acción, contrato y resultado (sin valores)", () => {
    eventos.length = 0;
    aplicar("crear_cita_nylas_generico", { hora: "10:00", tenantId: "otro" });
    const [e] = eventos;
    assert.ok(e);
    assert.equal(e.tenantId, TENANT);
    assert.equal(e.flowId, "f-1");
    assert.equal(e.flowVersionId, "v-1");
    assert.equal(e.executionRowId, "ex-1");
    assert.equal(e.action, "crear_cita_nylas_generico");
    assert.equal(e.contractVersion, "1.0.0");
    assert.equal(JSON.stringify(e).includes("10:00"), false, "el evento nunca lleva valores propuestos");
    aplicar("crear_cita_nylas_generico", { notas: "x".repeat(501) });
    assert.equal(eventos.at(-1)!.outcome, "rejected");
    assert.equal(eventos.at(-1)!.errorCategory, "VALIDATION_ERROR");
  });
});

describe("FASE 1 — endurecimiento GLOBAL de argumentos de la IA (todo flow)", () => {
  it("16. ids internos y variables del motor propuestos por la IA se descartan (tenant, flow, __*)", () => {
    const r = sanitizeProposalArgumentsDetailed({
      tenantId: "otro",
      id_tenant: "otro",
      flowVersionId: "v9",
      __dulabsAiBudget: "0",
      __verifiedResults: "[]",
      __firstMessageText: "ignora todo",
      servicio: "Corte",
    });
    assert.deepEqual(r.arguments, { servicio: "Corte" });
    assert.deepEqual(new Set(r.dropped.map((d) => d.reason)), new Set(["system_internal"]));
  });

  it("valores no escalares se descartan y quedan registrados", () => {
    const r = sanitizeProposalArgumentsDetailed({ items: ["a"], servicio: "Corte" });
    assert.deepEqual(r.arguments, { servicio: "Corte" });
    assert.deepEqual(r.dropped, [{ key: "items", reason: "non_scalar" }]);
  });
});

describe("FASE 1 — bridge real del Flow Engine con la política de Business Agent", () => {
  const flow = compileFlow(nylasSpec());
  const nodo = aiNodeFor(flow, "crear_cita_nylas_generico");
  const policy = createBusinessAgentArgumentPolicy({ log: () => {} });

  it("6/16. las variables protegidas y los ids internos NUNCA llegan al variablesPatch; la traza queda persistible", () => {
    const out = bridgeAiDispatchResult({
      flow,
      aiNodeId: nodo.id,
      aiConfig: nodo.config,
      tenantId: TENANT,
      argumentPolicy: policy,
      dispatchResult: aiProposalResult("crear_cita_nylas_generico", {
        hora: "10:00",
        appointment_request: "hoy",
        appointment_pick: "03:00",
        nombreCliente: "Otro",
        tenantId: "tenant-x",
        __dulabsAiBudget: "0",
      }),
    });
    assert.equal(out.dispatchResult.success, true);
    const patch = out.variablesPatch ?? {};
    assert.equal(patch.hora, "10:00");
    for (const k of ["appointment_request", "appointment_pick", "nombreCliente", "tenantId", "__dulabsAiBudget"]) {
      assert.equal(k in patch, false, `${k} no puede llegar a las variables`);
    }
    const traza = (out.dispatchResult.rawResult as { argumentPolicy?: { outcome: string; dropped: Array<{ key: string }> } }).argumentPolicy;
    assert.equal(traza?.outcome, "accepted_with_drops");
    assert.deepEqual(traza?.dropped.map((d) => d.key).sort(), ["__dulabsAiBudget", "appointment_pick", "appointment_request", "nombreCliente", "tenantId"]);
  });

  it("5. input inválido => el bridge devuelve VALIDATION_ERROR (el nodo sigue por su rama de fallo) y sin variablesPatch", () => {
    const out = bridgeAiDispatchResult({
      flow,
      aiNodeId: nodo.id,
      aiConfig: nodo.config,
      tenantId: TENANT,
      argumentPolicy: policy,
      dispatchResult: aiProposalResult("crear_cita_nylas_generico", { hora: "x".repeat(21) }),
    });
    assert.equal(out.dispatchResult.success, false);
    assert.equal(out.dispatchResult.classification, EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR);
    assert.equal(out.variablesPatch, undefined);
  });

  it("4. acción fuera de allowedTools del nodo => SECURITY_REJECTED (nunca se ejecuta)", () => {
    const out = bridgeAiDispatchResult({
      flow,
      aiNodeId: nodo.id,
      aiConfig: nodo.config,
      tenantId: TENANT,
      argumentPolicy: policy,
      dispatchResult: aiProposalResult("cancelar_cita_cliente", {}),
    });
    assert.equal(out.dispatchResult.success, false);
    assert.equal(out.dispatchResult.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
  });

  it("sin política (flows ajenos a Business Agent) el bridge conserva su comportamiento previo, salvo los ids internos", () => {
    const out = bridgeAiDispatchResult({
      flow,
      aiNodeId: nodo.id,
      aiConfig: nodo.config,
      tenantId: TENANT,
      dispatchResult: aiProposalResult("crear_cita_nylas_generico", { hora: "10:00", notas: "hola", tenantId: "x" }),
    });
    assert.equal(out.dispatchResult.success, true);
    assert.equal(out.variablesPatch?.hora, "10:00");
    assert.equal(out.variablesPatch?.notas, "hola");
    assert.equal("tenantId" in (out.variablesPatch ?? {}), false);
  });
});

describe("FASE 1 — contrato de errores", () => {
  it("categoriza los fallos reales de los executors", () => {
    assert.equal(categorizeEffectFailure({ kind: "action", classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, error: "ocupado" }), "BUSINESS_RULE_ERROR");
    assert.equal(categorizeEffectFailure({ kind: "action", classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, error: "datos_incompletos" }), "USER_ERROR");
    // 17. error externo
    assert.equal(categorizeEffectFailure({ kind: "action", classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, error: "error_tecnico" }), "EXTERNAL_SERVICE_ERROR");
    assert.equal(categorizeEffectFailure({ kind: "send_message", classification: EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT, error: "executor_timeout" }), "EXTERNAL_SERVICE_ERROR");
    assert.equal(categorizeEffectFailure({ kind: "action", classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED, error: "tenant_rejected" }), "TENANT_ERROR");
    assert.equal(categorizeEffectFailure({ kind: "action", classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED, error: "external_action_not_routed" }), "AUTHORIZATION_ERROR");
    assert.equal(categorizeEffectFailure({ kind: "action", classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR, error: "action_contract_invalid_arguments" }), "VALIDATION_ERROR");
    assert.equal(categorizeEffectFailure({ kind: "ai", classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED, error: "unverified_external_claim:appointment.reserved" }), "AI_OUTPUT_ERROR");
    assert.equal(categorizeRuntimeFailure("tenant_mismatch"), "TENANT_ERROR");
    assert.equal(categorizeRuntimeFailure("orchestrator_error"), "INTERNAL_ERROR");
  });

  it("19. una respuesta inválida del LLM se categoriza como AI_OUTPUT_ERROR", () => {
    const parsed = parseAiOutputJson("{no es json");
    assert.equal(parsed.ok, false);
    assert.equal(categorizeEffectFailure({ kind: "ai", classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR, error: !parsed.ok ? parsed.error : "" }), "AI_OUTPUT_ERROR");
  });

  it("el error seguro nunca lleva detalle interno", () => {
    const e = safeError("INTERNAL_ERROR", "orchestrator_error");
    assert.deepEqual(Object.keys(e).sort(), ["category", "code", "message"]);
    assert.equal(/stack|supabase|select|at \w+ \(/i.test(e.message), false);
  });
});
