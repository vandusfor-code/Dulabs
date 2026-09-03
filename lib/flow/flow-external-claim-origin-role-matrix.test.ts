/**
 * Corrección Claim Security, Fase 3 (autorizada) — matriz origin/messageRole
 * en filterClaimSecuredEffects (lib/flow/ai-runtime/ai-response-security.ts).
 *
 * REGLA DE SEGURIDAD CRÍTICA verificada en toda esta suite: messageRole
 * NUNCA es, por sí solo, una autorización para saltarse Claim Security --
 * detectDomainCapabilities SIEMPRE corre para contenido estático
 * (informational/intent_offer), y ai_generated/system/flow_static_interpolated
 * SIEMPRE usan el pipeline morfológico completo, sin excepción.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { filterClaimSecuredEffects } from "@/lib/flow/ai-runtime/ai-response-security";
import { VERIFIED_RESULTS_VARIABLE_KEY } from "@/lib/flow/ai-runtime/verified-results";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import type { EngineEffect } from "@/lib/flow/engine-types";
import type { FlowDefinition, MessageOrigin, MessageRole, AssertionCapability } from "@/lib/flow/types";

function sendMessage(input: {
  text: string;
  origin: MessageOrigin;
  messageRole?: MessageRole;
  asserts?: AssertionCapability[];
}): EngineEffect {
  return {
    type: "send_message",
    nodeId: "n1",
    content: { text: input.text, messageRole: input.messageRole, asserts: input.asserts },
    executionId: "exec-1",
    effectId: "fx-1",
    origin: input.origin,
  };
}

function allowed(effect: EngineEffect, variables: Record<string, unknown> = {}): boolean {
  return filterClaimSecuredEffects([effect], variables).length === 1;
}

function verifiedFor(source: string, data: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [VERIFIED_RESULTS_VARIABLE_KEY]: [{ verified: true, source, data: { ...data, verified: true } }],
  };
}

// ---------------------------------------------------------------------------
// Casos 1-16 exactos
// ---------------------------------------------------------------------------

describe("Matriz origin/role — casos 1-16", () => {
  it("1. Trigger Router lab, flow_static/informational -> ALLOW", () => {
    const e = sendMessage({
      text: "👋 Hola. La prueba del Trigger Router de DuLabs está funcionando correctamente.",
      origin: "flow_static",
      messageRole: "informational",
    });
    assert.equal(allowed(e), true);
  });

  it("2. Bienvenida Solotalento, flow_static/informational -> ALLOW", () => {
    const e = sendMessage({ text: "¡Bienvenido a SOLOTALENTO SAS!", origin: "flow_static", messageRole: "informational" });
    assert.equal(allowed(e), true);
  });

  it("3. Pregunta genérica, flow_static/informational -> ALLOW", () => {
    const e = sendMessage({ text: "¿En qué podemos ayudarte?", origin: "flow_static", messageRole: "informational" });
    assert.equal(allowed(e), true);
  });

  it("4. Cita confirmada, flow_static/informational, SIN capability -> BLOCK (appointment.reserved)", () => {
    const e = sendMessage({ text: "Tu cita fue confirmada.", origin: "flow_static", messageRole: "informational" });
    assert.equal(allowed(e), false);
  });

  it("5. Pago procesado, flow_static/informational, SIN capability -> BLOCK (payment.completed)", () => {
    const e = sendMessage({ text: "Tu pago fue procesado.", origin: "flow_static", messageRole: "informational" });
    assert.equal(allowed(e), false);
  });

  it("6. Lead registrado, flow_static/informational, SIN capability -> BLOCK (lead.created)", () => {
    const e = sendMessage({ text: "Tu solicitud fue registrada como lead.", origin: "flow_static", messageRole: "informational" });
    assert.equal(allowed(e), false);
  });

  it("7. 'Nuestro equipo ya recibió tu caso.', flow_static/informational, SIN capability -> BLOCK (support.transferred)", () => {
    const e = sendMessage({ text: "Nuestro equipo ya recibió tu caso.", origin: "flow_static", messageRole: "informational" });
    assert.equal(allowed(e), false);
  });

  it("8. Misma frase de #7, ai_generated -> BLOCK", () => {
    const e = sendMessage({ text: "Nuestro equipo ya recibió tu caso.", origin: "ai_generated" });
    assert.equal(allowed(e), false);
  });

  it("9. 'Perfecto, está confirmado.', ai_generated -> BLOCK", () => {
    const e = sendMessage({ text: "Perfecto, está confirmado.", origin: "ai_generated" });
    assert.equal(allowed(e), false);
  });

  it("10. 'Ya quedó.', ai_generated -> BLOCK", () => {
    const e = sendMessage({ text: "Ya quedó.", origin: "ai_generated" });
    assert.equal(allowed(e), false);
  });

  it("11. 'Ahora te comunicaremos con nuestra asesora...', flow_static/informational -> ALLOW", () => {
    const e = sendMessage({
      text: "Ahora te comunicaremos con nuestra asesora para brindarte una orientación personalizada.",
      origin: "flow_static",
      messageRole: "informational",
    });
    assert.equal(allowed(e), true);
  });

  // DISCREPANCIA ENCONTRADA (reportada, no resuelta silenciosamente): el
  // pedido original esperaba ALLOW acá, pero DOMAIN_CAPABILITY_RULES (regla
  // PREEXISTENTE `disponib\w+|cupos?\b`, sin tocar por REGLA ABSOLUTA #4)
  // matchea "disponible" y lo clasifica como appointment.available, sin
  // distinguir "el equipo/soporte está disponible" de "hay un cupo/horario
  // disponible". El comportamiento verificado es BLOCK sin capability
  // verificada -- documentado tal cual está HOY, ver el reporte de esta fase.
  it("12. 'Nuestro equipo está disponible.', flow_static/informational -> BLOCK hoy (discrepancia con el pedido, ver reporte)", () => {
    const e = sendMessage({ text: "Nuestro equipo está disponible.", origin: "flow_static", messageRole: "informational" });
    assert.equal(allowed(e, {}), false, "domainCaps detecta appointment.available vía la regla preexistente 'disponib\\\\w+', sin relación con esta fase");
    assert.equal(allowed(e, verifiedFor("consultar_disponibilidad")), true, "con la capability verificada, sí se permite");
  });

  it("13. 'Nuestro equipo puede ayudarte.', flow_static/informational -> ALLOW", () => {
    const e = sendMessage({ text: "Nuestro equipo puede ayudarte.", origin: "flow_static", messageRole: "informational" });
    assert.equal(allowed(e), true);
  });

  it("14. 'Cuéntanos tu caso.', flow_static/informational -> ALLOW", () => {
    const e = sendMessage({ text: "Cuéntanos tu caso.", origin: "flow_static", messageRole: "informational" });
    assert.equal(allowed(e), true);
  });

  it("15. Cita confirmada, flow_static/informational, SIN capability verificada -> BLOCK", () => {
    const e = sendMessage({ text: "Tu cita fue confirmada.", origin: "flow_static", messageRole: "informational" });
    assert.equal(allowed(e, {}), false);
  });

  it("16. Cita confirmada, flow_static/informational, CON appointment.reserved verificada -> ALLOW", () => {
    const e = sendMessage({ text: "Tu cita fue confirmada.", origin: "flow_static", messageRole: "informational" });
    assert.equal(allowed(e, verifiedFor("agendar_cita_marketplace", { reservationId: "r-1", status: "agendada" })), true);
  });
});

// ---------------------------------------------------------------------------
// Cobertura de las 7 capabilities (dominio detectado -> exige verificación,
// bloqueado sin ella, permitido con ella) -- flow_static + informational.
// ---------------------------------------------------------------------------

describe("Matriz origin/role — cobertura de las 7 capabilities", () => {
  const CASES: Array<{ cap: AssertionCapability; text: string; source: string }> = [
    { cap: "appointment.reserved", text: "Tu cita fue confirmada.", source: "agendar_cita_marketplace" },
    { cap: "appointment.available", text: "Hay disponibilidad para mañana.", source: "consultar_disponibilidad" },
    { cap: "appointment.cancelled", text: "Tu cita fue cancelada.", source: "cancelar_cita_especialista" },
    { cap: "appointment.rescheduled", text: "Tu cita fue reagendada.", source: "mover_cita_especialista" },
    { cap: "payment.completed", text: "Tu pago fue procesado.", source: "consultar_pago" },
    { cap: "lead.created", text: "Tu solicitud fue registrada como lead.", source: "crear_lead_enterprise" },
    { cap: "support.transferred", text: "Nuestro equipo ya recibió tu caso.", source: "transferir_soporte" },
  ];

  for (const c of CASES) {
    it(`${c.cap}: bloqueado sin verificar, permitido con capability verificada (flow_static/informational)`, () => {
      const e = sendMessage({ text: c.text, origin: "flow_static", messageRole: "informational" });
      assert.equal(allowed(e, {}), false, `debe bloquear sin evidencia: ${c.text}`);
      assert.equal(allowed(e, verifiedFor(c.source)), true, `debe permitir con ${c.source} verificado: ${c.text}`);
    });
  }
});

// ---------------------------------------------------------------------------
// Interpolación — NUNCA usa la ruta simplificada, ni con messageRole informational.
// ---------------------------------------------------------------------------

describe("Matriz origin/role — flow_static_interpolated nunca usa la ruta simplificada", () => {
  it("'El resultado de tu solicitud es {{resultado}}' con variable NO verificada -> BLOCK", () => {
    const e = sendMessage({
      text: "El resultado de tu solicitud es {{resultado}}",
      origin: "flow_static_interpolated",
      messageRole: "informational",
    });
    const blocked = filterClaimSecuredEffects([e], { resultado: "tu cita quedó confirmada" });
    assert.equal(blocked.length, 0, "una variable con un claim no verificado NUNCA debe evadir Claim Security");
  });

  it("variable con afirmación sensible no verificada -> BLOCK, aunque origin sea flow_static_interpolated + informational", () => {
    const e = sendMessage({
      text: "Actualización: {{estado}}",
      origin: "flow_static_interpolated",
      messageRole: "informational",
    });
    const blocked = filterClaimSecuredEffects([e], { estado: "tu pago fue procesado exitosamente" });
    assert.equal(blocked.length, 0);
  });

  it("variable con capability verificada respaldándola -> ALLOW", () => {
    const e = sendMessage({
      text: "Actualización: {{estado}}",
      origin: "flow_static_interpolated",
      messageRole: "informational",
    });
    const allowed_ = filterClaimSecuredEffects(
      [e],
      { estado: "tu cita quedó confirmada", ...verifiedFor("agendar_cita_marketplace") },
    );
    assert.equal(allowed_.length, 1);
  });

  it("texto genérico interpolado sin claim -> ALLOW (el pipeline completo también permite texto no ambiguo real)", () => {
    const e = sendMessage({
      text: "Hola {{nombre}}, gracias por escribirnos.",
      origin: "flow_static_interpolated",
      messageRole: "informational",
    });
    assert.equal(allowed(e, { nombre: "Ana" }), true);
  });
});

// ---------------------------------------------------------------------------
// external_assertion — el camino MÁS estricto, nunca un atajo.
// ---------------------------------------------------------------------------

describe("Matriz origin/role — external_assertion nunca es un bypass", () => {
  it("flow_static + external_assertion CON asserts pero SIN capability verificada -> BLOCK", () => {
    const e = sendMessage({
      text: "Tu cita fue confirmada.",
      origin: "flow_static",
      messageRole: "external_assertion",
      asserts: ["appointment.reserved"],
    });
    assert.equal(allowed(e, {}), false);
  });

  it("flow_static + external_assertion CON asserts Y capability verificada -> ALLOW", () => {
    const e = sendMessage({
      text: "Tu cita fue confirmada.",
      origin: "flow_static",
      messageRole: "external_assertion",
      asserts: ["appointment.reserved"],
    });
    assert.equal(allowed(e, verifiedFor("agendar_cita_marketplace")), true);
  });

  it("flow_static + external_assertion SIN asserts declarado y sin dominio detectable -> BLOCK (fail-closed, no 'seguro por defecto')", () => {
    const e = sendMessage({
      text: "Mensaje genérico sin ningún claim.",
      origin: "flow_static",
      messageRole: "external_assertion",
    });
    assert.equal(allowed(e, {}), false);
  });

  it("external_assertion NUNCA es más permisivo que informational para el mismo texto de dominio", () => {
    const textoCita = "Tu cita fue confirmada.";
    const informationalResult = allowed(sendMessage({ text: textoCita, origin: "flow_static", messageRole: "informational" }), {});
    const assertionResult = allowed(sendMessage({ text: textoCita, origin: "flow_static", messageRole: "external_assertion", asserts: ["appointment.reserved"] }), {});
    assert.equal(informationalResult, false);
    assert.equal(assertionResult, false);
  });
});

// ---------------------------------------------------------------------------
// Adversariales A-F
// ---------------------------------------------------------------------------

describe("Adversariales — messageRole no puede usarse para evadir Claim Security", () => {
  it("A. 'Tu cita fue confirmada.' role=informational -> BLOCK", () => {
    assert.equal(allowed(sendMessage({ text: "Tu cita fue confirmada.", origin: "flow_static", messageRole: "informational" })), false);
  });

  it("B. 'Tu pago fue procesado.' role=informational -> BLOCK", () => {
    assert.equal(allowed(sendMessage({ text: "Tu pago fue procesado.", origin: "flow_static", messageRole: "informational" })), false);
  });

  it("C. 'Ya quedó.' origin=ai_generated, role=informational (IA no puede declarar role) -> BLOCK", () => {
    assert.equal(allowed(sendMessage({ text: "Ya quedó.", origin: "ai_generated", messageRole: "informational" })), false);
  });

  it("D. 'Operación completada.' origin=ai_generated -> BLOCK", () => {
    assert.equal(allowed(sendMessage({ text: "Operación completada.", origin: "ai_generated" })), false);
  });

  it("E. 'Todo quedó confirmado.' origin=ai_generated -> BLOCK", () => {
    assert.equal(allowed(sendMessage({ text: "Todo quedó confirmado.", origin: "ai_generated" })), false);
  });

  it("F. mensaje estático + variable de IA no verificada -> BLOCK", () => {
    const e = sendMessage({
      text: "Estado actual: {{estadoDesdeIA}}",
      origin: "flow_static_interpolated",
      messageRole: "informational",
    });
    const blocked = filterClaimSecuredEffects([e], { estadoDesdeIA: "tu solicitud fue registrada como lead" });
    assert.equal(blocked.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Origin — calculado por el Engine, nunca aceptado como input externo.
// ---------------------------------------------------------------------------

describe("Origin calculado por el Engine (flow-engine.ts)", () => {
  function runStart(def: FlowDefinition) {
    const state = createFlowEngineState(def);
    return runFlowEngine(def, state, { type: "start", text: "hola" });
  }

  function sendMessageEffects(result: ReturnType<typeof runStart>): Extract<EngineEffect, { type: "send_message" }>[] {
    return result.effects.filter((e): e is Extract<EngineEffect, { type: "send_message" }> => e.type === "send_message");
  }

  it("message sin {{}} -> flow_static", () => {
    const def: FlowDefinition = {
      name: "t",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "msg", type: "message", config: { text: "Hola, bienvenido." } },
        { id: "end", type: "end", config: {} },
      ],
      edges: [{ id: "e1", source: "start", target: "msg" }, { id: "e2", source: "msg", target: "end" }],
      variables: [],
    };
    const effects = sendMessageEffects(runStart(def));
    assert.equal(effects[0]?.origin, "flow_static");
  });

  it("message con {{}} -> flow_static_interpolated", () => {
    const def: FlowDefinition = {
      name: "t",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "msg", type: "message", config: { text: "Hola {{nombre}}." } },
        { id: "end", type: "end", config: {} },
      ],
      edges: [{ id: "e1", source: "start", target: "msg" }, { id: "e2", source: "msg", target: "end" }],
      variables: [],
    };
    const effects = sendMessageEffects(runStart(def));
    assert.equal(effects[0]?.origin, "flow_static_interpolated");
  });

  it("question sin {{}} -> flow_static", () => {
    const def: FlowDefinition = {
      name: "t",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "q", type: "question", config: { text: "¿Cuál es tu nombre?", variableKey: "nombre", required: true, validation: { kind: "text" } } },
      ],
      edges: [{ id: "e1", source: "start", target: "q" }],
      variables: [],
    };
    const effects = sendMessageEffects(runStart(def));
    assert.equal(effects[0]?.origin, "flow_static");
  });

  it("question con {{}} -> flow_static_interpolated", () => {
    const def: FlowDefinition = {
      name: "t",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "q", type: "question", config: { text: "Hola {{nombre}}, ¿confirmas?", variableKey: "r", required: true, validation: { kind: "text" } } },
      ],
      edges: [{ id: "e1", source: "start", target: "q" }],
      variables: [],
    };
    const effects = sendMessageEffects(runStart(def));
    assert.equal(effects[0]?.origin, "flow_static_interpolated");
  });

  it("buttons sin {{}} -> flow_static", () => {
    const def: FlowDefinition = {
      name: "t",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "b", type: "buttons", config: { text: "¿Confirmas?", buttons: [{ id: "si", label: "Sí" }, { id: "no", label: "No" }] } },
      ],
      edges: [{ id: "e1", source: "start", target: "b" }],
      variables: [],
    };
    const effects = sendMessageEffects(runStart(def));
    assert.equal(effects[0]?.origin, "flow_static");
  });

  it("buttons con {{}} -> flow_static_interpolated", () => {
    const def: FlowDefinition = {
      name: "t",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "b", type: "buttons", config: { text: "Hola {{nombre}}, ¿confirmas?", buttons: [{ id: "si", label: "Sí" }, { id: "no", label: "No" }] } },
      ],
      edges: [{ id: "e1", source: "start", target: "b" }],
      variables: [],
    };
    const effects = sendMessageEffects(runStart(def));
    assert.equal(effects[0]?.origin, "flow_static_interpolated");
  });

  it("human sin {{}} -> flow_static", () => {
    const def: FlowDefinition = {
      name: "t",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "h", type: "human", config: { message: "Te transferimos con un humano.", pauseDurationHours: 24 } },
      ],
      edges: [{ id: "e1", source: "start", target: "h" }],
      variables: [],
    };
    const effects = sendMessageEffects(runStart(def));
    assert.equal(effects[0]?.origin, "flow_static");
  });

  it("human con {{}} -> flow_static_interpolated", () => {
    const def: FlowDefinition = {
      name: "t",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "h", type: "human", config: { message: "Hola {{nombre}}, te transferimos.", pauseDurationHours: 24 } },
      ],
      edges: [{ id: "e1", source: "start", target: "h" }],
      variables: [],
    };
    const effects = sendMessageEffects(runStart(def));
    assert.equal(effects[0]?.origin, "flow_static_interpolated");
  });

  it("end sin {{}} -> flow_static", () => {
    const def: FlowDefinition = {
      name: "t",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "e", type: "end", config: { message: "Gracias por escribirnos." } },
      ],
      edges: [{ id: "e1", source: "start", target: "e" }],
      variables: [],
    };
    const effects = sendMessageEffects(runStart(def));
    assert.equal(effects[0]?.origin, "flow_static");
  });

  it("end con {{}} -> flow_static_interpolated", () => {
    const def: FlowDefinition = {
      name: "t",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "e", type: "end", config: { message: "Gracias {{nombre}}." } },
      ],
      edges: [{ id: "e1", source: "start", target: "e" }],
      variables: [],
    };
    const effects = sendMessageEffects(runStart(def));
    assert.equal(effects[0]?.origin, "flow_static_interpolated");
  });

  it("AI respond -> ai_generated", () => {
    const def: FlowDefinition = {
      name: "t",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "ai", type: "ai", config: { mode: "respond", instruction: "x" } },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "ai" },
        { id: "e2", source: "ai", target: "end" },
      ],
      variables: [],
    };
    const state = createFlowEngineState(def);
    const started = runFlowEngine(def, state, { type: "start", text: "hola" });
    const result = runFlowEngine(def, started.state, {
      type: "effect_result",
      success: true,
      effectId: started.state.pendingEffect?.effectId,
      data: { mode: "respond", responseText: "Hola, ¿en qué te ayudo?" },
    });
    const effects = sendMessageEffects(result);
    assert.equal(effects[0]?.origin, "ai_generated");
  });

  it("AI classify -> ai_generated", () => {
    const def: FlowDefinition = {
      name: "t",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "ai", type: "ai", config: { mode: "classify", instruction: "x", classifications: ["a", "b"] } },
        { id: "end-a", type: "end", config: {} },
        { id: "end-b", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "ai" },
        { id: "e2", source: "ai", target: "end-a", sourceHandle: "class:a" },
        { id: "e3", source: "ai", target: "end-b", sourceHandle: "class:b" },
      ],
      variables: [],
    };
    const state = createFlowEngineState(def);
    const started = runFlowEngine(def, state, { type: "start", text: "hola" });
    const result = runFlowEngine(def, started.state, {
      type: "effect_result",
      success: true,
      effectId: started.state.pendingEffect?.effectId,
      data: { mode: "classify", classification: "a", responseText: "Entendido." },
    });
    const effects = sendMessageEffects(result);
    assert.equal(effects[0]?.origin, "ai_generated");
  });

  it("mensaje de error de validación del Engine -> system", () => {
    const def: FlowDefinition = {
      name: "t",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "q", type: "question", config: { text: "¿Cuál es tu edad?", variableKey: "edad", required: true, validation: { kind: "number" } } },
      ],
      edges: [{ id: "e1", source: "start", target: "q" }],
      variables: [],
    };
    const state = createFlowEngineState(def);
    const started = runFlowEngine(def, state, { type: "start", text: "hola" });
    const result = runFlowEngine(def, started.state, { type: "text", text: "no soy un número" });
    const effects = sendMessageEffects(result);
    assert.equal(effects.length, 1, "debe haber exactamente el mensaje de error de validación");
    assert.equal(effects[0]?.origin, "system");
  });
});
