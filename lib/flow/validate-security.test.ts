/**
 * Tests de validación de seguridad para publicación (Fase 2.7).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import { FLOW_VALIDATION_CODES } from "@/lib/flow/constants";
import type { FlowDefinition } from "@/lib/flow/types";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { validateSecurityRules } from "@/lib/flow/validate-security";

function baseFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    name: "Security test",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "manual" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [{ id: "e-end", source: "start", target: "end" }],
    variables: [],
    ...overrides,
  };
}

function webhookAction(
  id: string,
  tag: string,
  url = "https://api.example.com/hook",
): FlowDefinition["nodes"][number] {
  return {
    id,
    type: "action",
    config: { actionType: "webhook_http", semanticTag: tag, url },
  };
}

function withFailureAndSuccess(
  actionId: string,
  successTarget: string,
  failureTarget: string,
): FlowDefinition["edges"] {
  return [
    { id: `${actionId}-ok`, source: actionId, target: successTarget },
    {
      id: `${actionId}-fail`,
      source: actionId,
      target: failureTarget,
      sourceHandle: FLOW_EDGE_HANDLE.aiFailure,
    },
  ];
}

function assertSecurityInvalid(flow: FlowDefinition, code: string) {
  const r = validateSecurityRules(flow);
  assert.equal(r.valid, false, r.errors.map((e) => e.message).join("; "));
  assert.ok(r.errors.some((e) => e.code === code), `expected ${code}, got ${JSON.stringify(r.errors)}`);
}

function assertSecurityValid(flow: FlowDefinition) {
  const r = validateSecurityRules(flow);
  assert.equal(r.valid, true, r.errors.map((e) => e.message).join("; "));
}

describe("validate-security — publicación", () => {
  it("1. AI → informational → válido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "ai",
          type: "ai",
          config: { instruction: "Saluda", mode: "respond" },
        },
        {
          id: "msg",
          type: "message",
          config: { text: "Hola", messageRole: "informational" },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "ai" },
        { id: "e2", source: "ai", target: "msg" },
        { id: "e3", source: "msg", target: "end" },
      ],
    });
    assertSecurityValid(flow);
  });

  it("2. AI → intent_offer → válido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "ai",
          type: "ai",
          config: { instruction: "Ofrece", mode: "respond" },
        },
        {
          id: "msg",
          type: "message",
          config: {
            text: "Puedo ayudarte a reservar",
            messageRole: "intent_offer",
          },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "ai" },
        { id: "e2", source: "ai", target: "msg" },
        { id: "e3", source: "msg", target: "end" },
      ],
    });
    assertSecurityValid(flow);
  });

  it("3. AI → external_assertion → inválido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "ai",
          type: "ai",
          config: { instruction: "Clasifica", mode: "classify", classifications: ["ok"] },
        },
        {
          id: "msg",
          type: "message",
          config: {
            text: "Disponible",
            messageRole: "external_assertion",
            asserts: ["appointment.available"],
          },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "ai" },
        { id: "e2", source: "ai", target: "msg", sourceHandle: FLOW_EDGE_HANDLE.aiDefault },
        { id: "e3", source: "msg", target: "end" },
      ],
    });
    assertSecurityInvalid(flow, FLOW_VALIDATION_CODES.UNVERIFIED_ASSERTION);
  });

  it("4. ACTION consultar → CONDITION available → válido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        webhookAction("consultar", "consultar_disponibilidad"),
        {
          id: "cond",
          type: "condition",
          config: {
            match: "all",
            rules: [{ field: "available", operator: "equals", value: true }],
          },
        },
        { id: "end-yes", type: "end", config: {} },
        { id: "end-no", type: "end", config: {} },
        { id: "fail-msg", type: "message", config: { text: "Error" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "consultar" },
        ...withFailureAndSuccess("consultar", "cond", "fail-msg"),
        { id: "e4", source: "cond", target: "end-yes", sourceHandle: "true" },
        { id: "e5", source: "cond", target: "end-no", sourceHandle: "false" },
        { id: "e6", source: "fail-msg", target: "end-no" },
      ],
      variables: [
        { key: "available", label: "Disponible", type: "boolean", linkedCapability: "appointment.available" },
      ],
    });
    assertSecurityValid(flow);
  });

  it("5. ACTION reservar → success → assertion reserved → válido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        webhookAction("reservar", "reservar_cita"),
        {
          id: "confirm",
          type: "message",
          config: {
            text: "Reservado",
            messageRole: "external_assertion",
            asserts: ["appointment.reserved"],
          },
        },
        { id: "end", type: "end", config: {} },
        { id: "fail", type: "message", config: { text: "Falló" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "reservar" },
        ...withFailureAndSuccess("reservar", "confirm", "fail"),
        { id: "e4", source: "confirm", target: "end" },
        { id: "e5", source: "fail", target: "end" },
      ],
    });
    assertSecurityValid(flow);
  });

  it("6. ACTION reservar → failure → alternativa → válido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        webhookAction("reservar", "reservar_cita"),
        {
          id: "confirm",
          type: "message",
          config: {
            text: "Reservado",
            messageRole: "external_assertion",
            asserts: ["appointment.reserved"],
          },
        },
        {
          id: "alt",
          type: "message",
          config: { text: "Intenta otro horario", messageRole: "informational" },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "reservar" },
        ...withFailureAndSuccess("reservar", "confirm", "alt"),
        { id: "e4", source: "confirm", target: "end" },
        { id: "e5", source: "alt", target: "end" },
      ],
    });
    assertSecurityValid(flow);
  });

  it("7. AI classification available → confirm → inválido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "ai",
          type: "ai",
          config: {
            instruction: "Clasifica",
            mode: "classify",
            classifications: ["available", "other"],
          },
        },
        {
          id: "confirm",
          type: "message",
          config: {
            text: "Confirmado",
            messageRole: "external_assertion",
            asserts: ["appointment.available"],
          },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "ai" },
        {
          id: "e2",
          source: "ai",
          target: "confirm",
          sourceHandle: FLOW_EDGE_HANDLE.aiClass("available"),
        },
        { id: "e3", source: "confirm", target: "end" },
      ],
    });
    assertSecurityInvalid(flow, FLOW_VALIDATION_CODES.UNVERIFIED_ASSERTION);
  });

  it("8. AI output available → CONDITION → inválido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "ai",
          type: "ai",
          config: {
            instruction: "Extrae",
            mode: "extract",
            outputVariables: ["available"],
          },
        },
        {
          id: "cond",
          type: "condition",
          config: {
            match: "all",
            rules: [{ field: "available", operator: "equals", value: true }],
          },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "ai" },
        { id: "e2", source: "ai", target: "cond" },
        { id: "e3", source: "cond", target: "end", sourceHandle: "true" },
      ],
      variables: [
        { key: "available", label: "Disponible", type: "boolean", linkedCapability: "appointment.available" },
      ],
    });
    const r = validateSecurityRules(flow);
    assert.equal(r.valid, false);
    assert.ok(
      r.errors.some(
        (e) =>
          e.code === FLOW_VALIDATION_CODES.AI_AS_SOURCE_OF_TRUTH ||
          e.code === FLOW_VALIDATION_CODES.CONDITION_ON_UNVERIFIED,
      ),
    );
  });

  it("9. ACTION verified → CONDITION → válido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        webhookAction("consultar", "consultar_disponibilidad"),
        {
          id: "cond",
          type: "condition",
          config: {
            match: "all",
            rules: [{ field: "available", operator: "equals", value: true }],
          },
        },
        { id: "end", type: "end", config: {} },
        { id: "fail", type: "message", config: { text: "Error" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "consultar" },
        ...withFailureAndSuccess("consultar", "cond", "fail"),
        { id: "e4", source: "cond", target: "end", sourceHandle: "true" },
        { id: "e5", source: "fail", target: "end" },
      ],
      variables: [
        { key: "available", label: "Disponible", type: "boolean", linkedCapability: "appointment.available" },
      ],
    });
    assertSecurityValid(flow);
  });

  it("10. webhook HTTP → inválido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "wh",
          type: "action",
          config: {
            actionType: "webhook_http",
            semanticTag: "consultar_disponibilidad",
            url: "http://api.example.com/insecure",
          },
        },
        { id: "end", type: "end", config: {} },
        { id: "fail", type: "message", config: { text: "x" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "wh" },
        ...withFailureAndSuccess("wh", "end", "fail"),
      ],
    });
    assertSecurityInvalid(flow, FLOW_VALIDATION_CODES.WEBHOOK_INSECURE);
  });

  it("11. webhook HTTPS sin semanticTag → inválido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "wh",
          type: "action",
          config: {
            actionType: "webhook_http",
            url: "https://api.example.com/hook",
          },
        },
        { id: "end", type: "end", config: {} },
        { id: "fail", type: "message", config: { text: "x" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "wh" },
        ...withFailureAndSuccess("wh", "end", "fail"),
      ],
    });
    assertSecurityInvalid(flow, FLOW_VALIDATION_CODES.WEBHOOK_NOT_ALLOWLISTED);
  });

  it("12. webhook HTTPS + semanticTag allowlisted → válido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        webhookAction("wh", "consultar_disponibilidad"),
        { id: "end", type: "end", config: {} },
        { id: "fail", type: "message", config: { text: "x" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "wh" },
        ...withFailureAndSuccess("wh", "end", "fail"),
      ],
    });
    assertSecurityValid(flow);
  });

  it("13. critical action sin failure → inválido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "act",
          type: "action",
          config: { actionType: "agendar_cita_marketplace" },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [{ id: "e1", source: "start", target: "act" }, { id: "e2", source: "act", target: "end" }],
    });
    assertSecurityInvalid(flow, FLOW_VALIDATION_CODES.CRITICAL_ACTION_NO_FAILURE);
  });

  it("14. FAQ simple → válido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "msg", type: "message", config: { text: "Preguntas frecuentes" } },
        {
          id: "q",
          type: "question",
          config: {
            text: "¿Qué necesitas?",
            variableKey: "tema",
            required: true,
            validation: { kind: "text" },
          },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "msg" },
        { id: "e2", source: "msg", target: "q" },
        { id: "e3", source: "q", target: "end" },
      ],
      variables: [{ key: "tema", label: "Tema", type: "string" }],
    });
    assert.equal(validateFlowForPublish(flow).valid, true);
  });

  it("15. comercial simple → válido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        {
          id: "ai",
          type: "ai",
          config: {
            instruction: "Clasifica lead",
            mode: "classify",
            classifications: ["commercial", "support"],
          },
        },
        { id: "msg", type: "message", config: { text: "Rama comercial", messageRole: "informational" } },
        { id: "msg-support", type: "message", config: { text: "Rama soporte", messageRole: "informational" } },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "ai" },
        {
          id: "e2",
          source: "ai",
          target: "msg",
          sourceHandle: FLOW_EDGE_HANDLE.aiClass("commercial"),
        },
        {
          id: "e3",
          source: "ai",
          target: "msg-support",
          sourceHandle: FLOW_EDGE_HANDLE.aiClass("support"),
        },
        { id: "e4", source: "msg", target: "end" },
        { id: "e5", source: "msg-support", target: "end" },
      ],
    });
    assert.equal(validateFlowForPublish(flow).valid, true);
  });

  it("16. dos caminos, solo uno verificado → inválido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "cond",
          type: "condition",
          config: {
            match: "all",
            rules: [{ field: "x", operator: "equals", value: 1 }],
          },
        },
        webhookAction("consultar", "consultar_disponibilidad"),
        {
          id: "assert-msg",
          type: "message",
          config: {
            text: "Hay cupo",
            messageRole: "external_assertion",
            asserts: ["appointment.available"],
          },
        },
        { id: "end", type: "end", config: {} },
        { id: "fail", type: "message", config: { text: "err" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "cond" },
        { id: "e2", source: "cond", target: "consultar", sourceHandle: "true" },
        { id: "e3", source: "cond", target: "assert-msg", sourceHandle: "false" },
        ...withFailureAndSuccess("consultar", "assert-msg", "fail"),
        { id: "e6", source: "assert-msg", target: "end" },
        { id: "e7", source: "fail", target: "end" },
      ],
      variables: [{ key: "x", label: "X", type: "number", defaultValue: 0 }],
    });
    assertSecurityInvalid(flow, FLOW_VALIDATION_CODES.UNVERIFIED_ASSERTION);
  });

  it("17. save_data copiando variable AI → assertion → inválido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "ai",
          type: "ai",
          config: { instruction: "x", mode: "extract", outputVariables: ["available"] },
        },
        {
          id: "save",
          type: "save_data",
          config: { mappings: [{ variable: "available", target: "lead" }] },
        },
        {
          id: "msg",
          type: "message",
          config: {
            text: "Disponible",
            messageRole: "external_assertion",
            asserts: ["appointment.available"],
          },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "ai" },
        { id: "e2", source: "ai", target: "save" },
        { id: "e3", source: "save", target: "msg" },
        { id: "e4", source: "msg", target: "end" },
      ],
      variables: [
        { key: "available", label: "Disponible", type: "boolean", linkedCapability: "appointment.available" },
      ],
    });
    assertSecurityInvalid(flow, FLOW_VALIDATION_CODES.UNVERIFIED_ASSERTION);
  });

  it("18. assertion con capability parcialmente cubierta → inválido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        webhookAction("consultar", "consultar_disponibilidad"),
        {
          id: "msg",
          type: "message",
          config: {
            text: "Todo listo",
            messageRole: "external_assertion",
            asserts: ["appointment.available", "appointment.reserved"],
          },
        },
        { id: "end", type: "end", config: {} },
        { id: "fail", type: "message", config: { text: "err" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "consultar" },
        ...withFailureAndSuccess("consultar", "msg", "fail"),
        { id: "e4", source: "msg", target: "end" },
        { id: "e5", source: "fail", target: "end" },
      ],
    });
    assertSecurityInvalid(flow, FLOW_VALIDATION_CODES.UNVERIFIED_ASSERTION);
  });

  it("19. múltiples assertions, todas verificadas → válido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        webhookAction("consultar", "consultar_disponibilidad"),
        webhookAction("reservar", "reservar_cita"),
        {
          id: "msg",
          type: "message",
          config: {
            text: "Listo",
            messageRole: "external_assertion",
            asserts: ["appointment.available", "appointment.reserved"],
          },
        },
        { id: "end", type: "end", config: {} },
        { id: "f1", type: "message", config: { text: "e1" } },
        { id: "f2", type: "message", config: { text: "e2" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "consultar" },
        ...withFailureAndSuccess("consultar", "reservar", "f1"),
        ...withFailureAndSuccess("reservar", "msg", "f2"),
        { id: "e6", source: "msg", target: "end" },
        { id: "e7", source: "f1", target: "end" },
        { id: "e8", source: "f2", target: "end" },
      ],
    });
    assertSecurityValid(flow);
  });

  it("20. múltiples assertions, una no verificada → inválido", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        webhookAction("reservar", "reservar_cita"),
        {
          id: "msg",
          type: "message",
          config: {
            text: "Listo",
            messageRole: "external_assertion",
            asserts: ["appointment.reserved", "appointment.available"],
          },
        },
        { id: "end", type: "end", config: {} },
        { id: "fail", type: "message", config: { text: "err" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "reservar" },
        ...withFailureAndSuccess("reservar", "msg", "fail"),
        { id: "e4", source: "msg", target: "end" },
        { id: "e5", source: "fail", target: "end" },
      ],
    });
    assertSecurityInvalid(flow, FLOW_VALIDATION_CODES.UNVERIFIED_ASSERTION);
  });

  it("21. AI critical claim en MESSAGE informational → EXTERNAL_CLAIM_UNVERIFIED", () => {
    const flow = baseFlow({
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "ai",
          type: "ai",
          config: { instruction: "Confirma", mode: "respond", outputVariables: ["confirmationText"] },
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
    });
    assertSecurityInvalid(flow, FLOW_VALIDATION_CODES.EXTERNAL_CLAIM_UNVERIFIED);
  });
});
