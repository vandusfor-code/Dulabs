/**
 * Tests Fase 4.4.5 — Blockers CRITICAL participios + contextual closure.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyAiResponseClaimSecurity,
  blockUnverifiedExternalClaimsInMessageContent,
} from "@/lib/flow/ai-runtime/ai-response-security";
import { VERIFIED_RESULTS_VARIABLE_KEY } from "@/lib/flow/ai-runtime/verified-results";
import { EFFECT_RESULT_CLASSIFICATIONS } from "@/lib/flow/executor-types";
import {
  analyzeTextForExternalClaims,
  classifyResponseIntent,
  detectDomainCapabilities,
  extractVerifiedCapabilitiesFromVariables,
  scoreCompletionMorphology,
  validateTextClaimsAgainstVerified,
} from "@/lib/flow/external-claim-security";

function isStandaloneClosureStructure(text: string): boolean {
  return classifyResponseIntent(text) === "completion_signal" ||
    /^(list|perfect|correct|anotad)/i.test(text.replace(/[^a-z]/gi, "").toLowerCase());
}

function ctx(user: string, ai: string) {
  return validateTextClaimsAgainstVerified(ai, new Set(), {
    userMessage: user,
    source: "ai_response",
  });
}

function runtime(user: string, ai: string) {
  return applyAiResponseClaimSecurity({
    dispatchResult: {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data: { mode: "respond", responseText: ai },
    },
    variables: { __userMessage: user },
  });
}

describe("Fase 4.4.5 — casos obligatorios", () => {
  it("1. Gracias + Ya quedó reservado → BLOCK", () => {
    assert.equal(ctx("Gracias.", "Ya quedó reservado.").ok, false);
    assert.equal(runtime("Gracias.", "Ya quedó reservado.").success, false);
  });

  it("2. Gracias + Ya quedó agendado → BLOCK", () => {
    assert.equal(ctx("Gracias.", "Ya quedó agendado.").ok, false);
  });

  it("3. reservar + Listo → BLOCK", () => {
    assert.equal(ctx("Quiero reservar mañana a las 5.", "Listo.").ok, false);
    assert.ok(isStandaloneClosureStructure("Listo."));
  });

  it("4. reservar + Perfecto → BLOCK (request_action transaccional, Fase 4.4.11)", () => {
    assert.equal(ctx("Quiero reservar mañana a las 5.", "Perfecto.").ok, false);
  });

  it("5. reservar + Voy a revisar disponibilidad → ALLOW", () => {
    assert.equal(ctx("Quiero reservar mañana a las 5.", "Voy a revisar disponibilidad.").ok, true);
  });

  it("6. cuánto cuesta + Perfecto → ALLOW", () => {
    assert.equal(ctx("¿Cuánto cuesta?", "Perfecto.").ok, true);
  });

  it("7. Gracias + Listo → ALLOW", () => {
    assert.equal(ctx("Gracias.", "Listo.").ok, true);
  });

  it("8. Gracias + Tu cita está confirmada → BLOCK", () => {
    assert.equal(ctx("Gracias.", "Tu cita está confirmada.").ok, false);
  });

  it("9. Gracias + Ya nos encargamos → ALLOW (sin intención transaccional)", () => {
    assert.equal(ctx("Gracias.", "Ya nos encargamos.").ok, true);
  });

  it("10. cancelar cita + Listo → ALLOW sin appointment.reserved", () => {
    const analysis = analyzeTextForExternalClaims("Listo.", {
      userMessage: "Quiero cancelar mi cita.",
    });
    assert.equal(analysis.requiredCapabilities.includes("appointment.reserved"), false);
    assert.equal(ctx("Quiero cancelar mi cita.", "Listo.").ok, true);
  });
});

describe("Fase 4.4.5 — participios y morfología", () => {
  const participles = [
    "reservado",
    "reservada",
    "reservados",
    "reservadas",
    "agendado",
    "agendada",
    "agendados",
    "agendadas",
  ];

  for (const form of participles) {
    it(`detecta dominio en participio "${form}"`, () => {
      const caps = detectDomainCapabilities(`Ya quedó ${form}.`);
      assert.ok(caps.includes("appointment.reserved"), form);
    });
  }

  it("participio + acentos/mayúsculas/emojis", () => {
    assert.equal(ctx("Gracias.", "✅ YA QUEDÓ RESERVADO.").ok, false);
    assert.equal(ctx("Gracias.", "Ya quedó agendado!!!").ok, false);
  });

  it("score morfológico detecta quedó + participio", () => {
    assert.ok(scoreCompletionMorphology("Ya quedó reservado.") >= 2);
  });
});

describe("Fase 4.4.5 — cierre contextual transaccional", () => {
  it("Ya nos encargamos tras intención de reserva → BLOCK", () => {
    assert.equal(ctx("Quiero reservar para el viernes.", "Ya nos encargamos.").ok, false);
  });

  it("Puedes contar con ello tras pago → BLOCK payment.completed", () => {
    const check = ctx("Quiero pagar ahora.", "Puedes contar con ello.");
    assert.equal(check.ok, false);
    if (!check.ok) assert.ok(check.missing.includes("payment.completed"));
  });

  it("consultar disponibilidad no exige reserva", () => {
    assert.equal(ctx("¿Hay disponibilidad el lunes?", "Listo.").ok, false);
    const caps = analyzeTextForExternalClaims("Listo.", {
      userMessage: "¿Hay disponibilidad el lunes?",
    }).requiredCapabilities;
    assert.ok(caps.includes("appointment.available"));
    assert.equal(caps.includes("appointment.reserved"), false);
  });
});

describe("Fase 4.4.5 — provenance y capability identity intactos", () => {
  it("consultar_disponibilidad ≠ appointment.reserved", () => {
    const caps = extractVerifiedCapabilitiesFromVariables({
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "consultar_disponibilidad", data: { available: true } },
      ],
    });
    assert.ok(caps.has("appointment.available"));
    assert.equal(caps.has("appointment.reserved"), false);
  });

  it("cancelar_cita con id no otorga appointment.reserved", () => {
    const caps = extractVerifiedCapabilitiesFromVariables({
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "cancelar_cita", data: { id: "123" } },
      ],
    });
    assert.equal(caps.size, 0);
  });

  it("variables neutrales + participio en parts → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: { parts: ["Ya quedó", "{{x}}", "reservado"] },
      variables: { x: "!" },
    });
    assert.equal(blocked.allowed, false);
  });

  it("media caption con participio → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        media: { type: "image", url: "https://x.test/a.jpg", caption: "Ya quedó agendado." },
      },
      variables: {},
    });
    assert.equal(blocked.allowed, false);
  });

  it("template con participio → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        template: {
          templateName: "confirmacion",
          variables: { body: "Tu horario quedó reservado." },
        },
      },
      variables: {},
    });
    assert.equal(blocked.allowed, false);
  });
});
