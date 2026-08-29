/**
 * Tests adversariales Fase 4.4.1 — Blockers CRITICAL A + B.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyAiResponseClaimSecurity,
  blockUnverifiedExternalClaimsInText,
  filterClaimSecuredEffects,
} from "@/lib/flow/ai-runtime/ai-response-security";
import { VERIFIED_RESULTS_VARIABLE_KEY } from "@/lib/flow/ai-runtime/verified-results";
import { FLOW_EDGE_HANDLE, FLOW_VALIDATION_CODES } from "@/lib/flow/constants";
import { EFFECT_RESULT_CLASSIFICATIONS } from "@/lib/flow/executor-types";
import {
  detectExternalClaimsInMessageTemplate,
  detectExternalClaimsInText,
  extractVerifiedCapabilitiesFromVariables,
  isConversationalIntentOnly,
  resolveMessageTextForClaimValidation,
  validateTextClaimsAgainstVerified,
} from "@/lib/flow/external-claim-security";
import type { FlowDefinition } from "@/lib/flow/types";
import { validateSecurityRules } from "@/lib/flow/validate-security";

const NEUTRAL_VAR_NAMES = [
  "resumen",
  "info",
  "texto",
  "respuesta",
  "data",
  "resultado",
  "detalle",
  "mensaje",
  "salida",
  "x",
];

function aiMessageFlow(input: {
  aiVar: string;
  messageText: string;
  withVerifiedReserve?: boolean;
}): FlowDefinition {
  const nodes: FlowDefinition["nodes"] = [
    { id: "start", type: "start", config: { triggerType: "manual" } },
    {
      id: "ai",
      type: "ai",
      config: { instruction: "Responde", mode: "respond", outputVariables: [input.aiVar] },
    },
    {
      id: "msg",
      type: "message",
      config: { text: input.messageText, messageRole: "informational" },
    },
    { id: "end", type: "end", config: {} },
  ];

  const edges: FlowDefinition["edges"] = [
    { id: "e1", source: "start", target: "ai" },
    { id: "e2", source: "ai", target: "msg", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
    { id: "e3", source: "msg", target: "end" },
  ];

  if (input.withVerifiedReserve) {
    nodes.splice(1, 0, {
      id: "act",
      type: "action",
      config: { actionType: "agendar_cita_marketplace", params: {} },
    });
    nodes.splice(2, 0, { id: "fail", type: "message", config: { text: "No se pudo agendar" } });
    edges[0] = { id: "e1", source: "start", target: "act" };
    edges.unshift(
      { id: "e0", source: "act", target: "ai" },
      { id: "e0f", source: "act", target: "fail", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
    );
  }

  return { name: "claim-test", nodes, edges, variables: [] };
}

function verifiedReserveVariables() {
  return {
    [VERIFIED_RESULTS_VARIABLE_KEY]: [
      {
        verified: true,
        source: "agendar_cita_marketplace",
        data: { appointmentId: 123, status: "agendada", verified: true },
      },
    ],
  };
}

function verifiedAvailableVariables() {
  return {
    [VERIFIED_RESULTS_VARIABLE_KEY]: [
      {
        verified: true,
        source: "consultar_disponibilidad",
        data: { available: true, verified: true },
      },
    ],
  };
}

describe("Blocker A — AI responseText runtime", () => {
  it("A. respond afirmando reserva sin crearCita → RECHAZADO", () => {
    const r = applyAiResponseClaimSecurity({
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: { mode: "respond", responseText: "Perfecto, tu cita quedó reservada" },
      },
      variables: {},
    });
    assert.equal(r.success, false);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
    assert.equal(r.data?.responseText, undefined);
  });

  it("B. respond afirmando transferencia sin acción → RECHAZADO", () => {
    const r = applyAiResponseClaimSecurity({
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: { mode: "respond", responseText: "Ya te transferimos con soporte." },
      },
      variables: {},
    });
    assert.equal(r.success, false);
  });

  it("C. classify + responseText afirmando reserva sin evidencia → RECHAZADO", () => {
    const r = applyAiResponseClaimSecurity({
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: {
          mode: "classify",
          classification: "booking",
          responseText: "Listo, tu cita quedó agendada.",
        },
      },
      variables: {},
    });
    assert.equal(r.success, false);
  });

  it("G. conversación normal → PERMITIDO", () => {
    const r = applyAiResponseClaimSecurity({
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: { mode: "respond", responseText: "Claro, puedo ayudarte a buscar horarios." },
      },
      variables: {},
    });
    assert.equal(r.success, true);
    assert.equal(r.data?.responseText, "Claro, puedo ayudarte a buscar horarios.");
  });

  it("H. conversación pidiendo datos → PERMITIDO", () => {
    assert.ok(isConversationalIntentOnly("Para reservar necesito tu nombre."));
    const r = applyAiResponseClaimSecurity({
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: { mode: "respond", responseText: "Para reservar necesito tu nombre." },
      },
      variables: {},
    });
    assert.equal(r.success, true);
  });

  it("I. con verified available → puede comunicar disponibilidad", () => {
    const r = applyAiResponseClaimSecurity({
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: { mode: "respond", responseText: "Hay disponibilidad para mañana a las 3." },
      },
      variables: verifiedAvailableVariables(),
    });
    assert.equal(r.success, true);
  });

  it("J. con verified appointmentId → puede confirmar reserva", () => {
    const r = applyAiResponseClaimSecurity({
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: { mode: "respond", responseText: "Tu cita quedó agendada correctamente." },
      },
      variables: verifiedReserveVariables(),
    });
    assert.equal(r.success, true);
  });

  it("K. Claude fabrica evidencia en payload → claim block", () => {
    const r = applyAiResponseClaimSecurity({
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: {
          mode: "respond",
          responseText: "Tu cita quedó reservada",
          appointmentId: "fake",
          verified: true,
        },
      },
      variables: {},
    });
    assert.equal(r.success, false);
  });

  it("send_message filter bloquea texto IA no verificado", () => {
    const effects = filterClaimSecuredEffects(
      [{
        type: "send_message",
        nodeId: "ai",
        content: { text: "Perfecto, tu cita quedó reservada" },
        executionId: "exec-1",
        effectId: "fx-msg-1",
      }],
      {},
    );
    assert.equal(effects.length, 0);
  });
});

describe("Blocker B — publish claim analysis", () => {
  it("D. resumen + claim estático → RECHAZADO", () => {
    const flow = aiMessageFlow({
      aiVar: "resumen",
      messageText: "Tu cita quedó agendada: {{resumen}}",
    });
    const r = validateSecurityRules(flow);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.code === FLOW_VALIDATION_CODES.EXTERNAL_CLAIM_UNVERIFIED));
  });

  it("E. info + claim de pago → RECHAZADO", () => {
    const flow = aiMessageFlow({
      aiVar: "info",
      messageText: "El pago fue realizado: {{info}}",
    });
    const r = validateSecurityRules(flow);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.code === FLOW_VALIDATION_CODES.EXTERNAL_CLAIM_UNVERIFIED));
  });

  it("F. x + claim de registro → RECHAZADO", () => {
    const flow = aiMessageFlow({
      aiVar: "x",
      messageText: "Ya registramos tu solicitud: {{x}}",
    });
    const r = validateSecurityRules(flow);
    assert.equal(r.valid, false);
  });

  it("L. evasión por 10 nombres neutrales → todos RECHAZADOS", () => {
    for (const varName of NEUTRAL_VAR_NAMES) {
      const flow = aiMessageFlow({
        aiVar: varName,
        messageText: `Tu cita quedó agendada: {{${varName}}}`,
      });
      const r = validateSecurityRules(flow);
      assert.equal(r.valid, false, `debe fallar con variable neutra "${varName}"`);
    }
  });

  it("con evidencia verificada en camino → PERMITIDO", () => {
    const flow = aiMessageFlow({
      aiVar: "resumen",
      messageText: "Tu cita quedó agendada: {{resumen}}",
      withVerifiedReserve: true,
    });
    const r = validateSecurityRules(flow);
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  it("M. variaciones lingüísticas sin evidencia → RECHAZADO", () => {
    const phrases = [
      "Tu cita está confirmada.",
      "Listo, quedó agendada.",
      "Ya reservamos tu horario.",
      "Tu reserva fue realizada.",
      "El pago ya se procesó.",
      "Ya te comunicamos con soporte.",
    ];
    for (const phrase of phrases) {
      const claims = detectExternalClaimsInText(phrase);
      assert.ok(claims.length > 0, `debe detectar claim en: ${phrase}`);
      const check = validateTextClaimsAgainstVerified(phrase, new Set());
      assert.equal(check.ok, false);
    }
  });
});

describe("Blocker B — runtime interpolación", () => {
  it("plantilla con variable neutra + claim estático → bloqueado", () => {
    const resolved = resolveMessageTextForClaimValidation(
      { text: "Tu cita quedó agendada: {{resumen}}" },
      { resumen: "detalle interno" },
    );
    const blocked = blockUnverifiedExternalClaimsInText({ text: resolved, variables: {} });
    assert.equal(blocked.allowed, false);
  });

  it("solo variable AI — runtime valida contenido interpolado", () => {
    const resolved = resolveMessageTextForClaimValidation(
      { text: "{{resumen}}" },
      { resumen: "Perfecto, tu cita quedó reservada" },
    );
    const blocked = blockUnverifiedExternalClaimsInText({ text: resolved, variables: {} });
    assert.equal(blocked.allowed, false);
  });

  it("detectExternalClaimsInMessageTemplate ignora nombre de variable", () => {
    const claims = detectExternalClaimsInMessageTemplate({
      text: "Tu cita quedó agendada: {{resumen}}",
      messageRole: "informational",
    });
    assert.ok(claims.includes("appointment.reserved"));
  });
});

describe("Provenance", () => {
  it("solo __verifiedResults cuenta como evidencia", () => {
    const caps = extractVerifiedCapabilitiesFromVariables({
      available: true,
      appointmentId: 123,
      [VERIFIED_RESULTS_VARIABLE_KEY]: [],
    });
    assert.equal(caps.size, 0);
  });

  it("verified results de executor aportan capabilities", () => {
    const caps = extractVerifiedCapabilitiesFromVariables(verifiedReserveVariables());
    assert.ok(caps.has("appointment.reserved"));
  });
});
