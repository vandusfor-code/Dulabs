/**
 * Tests Fase 4.4.17 — negación adversarial por proposición (no interruptor global).
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
  extractVerifiedCapabilitiesFromVariables,
  validateTextClaimsAgainstVerified,
} from "@/lib/flow/external-claim-security";

const TX = "Quiero reservar mañana a las 5.";

function ctx(input: {
  user?: string;
  ai: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  verified?: Record<string, unknown>;
}) {
  const variables: Record<string, unknown> = {
    ...(input.verified ?? {}),
    ...(input.user ? { __userMessage: input.user } : {}),
    ...(input.history ? { __conversationHistory: input.history } : {}),
  };
  return validateTextClaimsAgainstVerified(input.ai, extractVerifiedCapabilitiesFromVariables(variables), {
    userMessage: input.user,
    conversationHistory: input.history,
    source: "ai_response",
  });
}

describe("Fase 4.4.17 — ALLOW: negación simple legítima", () => {
  const allowed = [
    "No está reservado.",
    "No está confirmado.",
    "No quedó reservado.",
    "No se ha realizado el pago.",
    "Todavía no está reservado.",
    "No quedó completado.",
    "No está listo todavía.",
  ];

  for (const ai of allowed) {
    it(`A/I/J: "${ai}" → ALLOW`, () => {
      assert.equal(ctx({ user: TX, ai }).ok, true);
      assert.equal(analyzeTextForExternalClaims(ai, { userMessage: TX }).requiredCapabilities.length, 0);
    });
  }
});

describe("Fase 4.4.17 — BLOCK: negación + afirmación positiva posterior", () => {
  const blocked = [
    { ai: "No está reservado, ya quedó confirmado.", cap: "appointment.reserved" },
    { ai: "No quedó pendiente, ya está confirmado.", cap: "appointment.reserved" },
    { ai: "No, no quedó pendiente, ya está confirmado.", cap: "appointment.reserved" },
    { ai: "No quedó a medias, se completó todo.", cap: "appointment.reserved" },
    { ai: "No está sin resolver, ya quedó agendada.", cap: "appointment.reserved" },
    { ai: "No está incompleto, el pago ya fue procesado.", cap: "payment.completed" },
    { ai: "No, no quedó pendiente, la cita ya está reservada.", cap: "appointment.reserved" },
    { ai: "Claro, no quedó pendiente, ya gestionamos todo.", cap: "appointment.reserved" },
    { ai: "Claro, no quedó pendiente, ya está confirmado.", cap: "appointment.reserved" },
    {
      ai: "Entiendo, no quedó pendiente como pensábamos y además ya está confirmado, así que puedes continuar.",
      cap: "appointment.reserved",
    },
  ];

  for (const { ai, cap } of blocked) {
    it(`BLOCK: "${ai.slice(0, 55)}..."`, () => {
      const check = ctx({ user: TX, ai });
      assert.equal(check.ok, false);
      if (!check.ok) assert.ok(check.missing.includes(cap as never));
      assert.notEqual(classifyResponseIntent(ai, { userMessage: TX }), "conversational");
    });
  }
});

describe("Fase 4.4.17 — D/E/F/G/H dominios", () => {
  it("D: doble negación → BLOCK", () => {
    assert.equal(ctx({ user: TX, ai: "No está sin resolver, se completó todo." }).ok, false);
  });

  it("F: pago → BLOCK", () => {
    const check = ctx({ user: TX, ai: "No está pendiente, el pago ya fue procesado." });
    assert.equal(check.ok, false);
    if (!check.ok) assert.ok(check.missing.includes("payment.completed"));
  });

  it("G: cita → BLOCK", () => {
    assert.equal(ctx({ user: TX, ai: "No quedó pendiente, tu cita ya está agendada." }).ok, false);
  });

  it("H: soporte → BLOCK", () => {
    const check = ctx({ user: TX, ai: "No quedó pendiente, ya te transferimos con soporte." });
    assert.equal(check.ok, false);
    if (!check.ok) assert.ok(check.missing.includes("support.transferred"));
  });
});

describe("Fase 4.4.17 — K/L future vs claim", () => {
  it('K: "No está reservado todavía, voy a verificar disponibilidad." → ALLOW', () => {
    assert.equal(
      ctx({ user: TX, ai: "No está reservado todavía, voy a verificar disponibilidad." }).ok,
      true,
    );
    assert.equal(
      classifyResponseIntent("No está reservado todavía, voy a verificar disponibilidad.", {
        userMessage: TX,
      }),
      "future_action",
    );
  });

  it('L: future + afirmación posterior → BLOCK', () => {
    assert.equal(
      ctx({
        user: TX,
        ai: "Voy a verificar disponibilidad, pero la cita ya quedó reservada.",
      }).ok,
      false,
    );
  });
});

describe("Fase 4.4.17 — state_question", () => {
  it('G: "¿Ya quedó reservada?" + "Sí, puedes consultar después." → BLOCK', () => {
    assert.equal(
      ctx({ user: "¿Ya quedó reservada?", ai: "Sí, puedes consultar los detalles después." }).ok,
      false,
    );
  });

  it('H: "¿Ya quedó reservada?" + "Voy a verificarlo." → ALLOW', () => {
    assert.equal(ctx({ user: "¿Ya quedó reservada?", ai: "Voy a verificarlo." }).ok, true);
  });
});

describe("Fase 4.4.17 — O/P/Q parts media template", () => {
  it("O: parts fragmentados negación + afirmación → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: { parts: ["No quedó", " pendiente,", " ya está", " confirmado."] },
      variables: { __userMessage: TX },
    });
    assert.equal(blocked.allowed, false);
  });

  it("P: media caption → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        media: {
          type: "image",
          url: "https://x.test/a.jpg",
          caption: "No quedó pendiente, ya está confirmado.",
        },
      },
      variables: { __userMessage: TX },
    });
    assert.equal(blocked.allowed, false);
  });

  it("Q: template → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        template: {
          templateName: "t1",
          variables: { body: "No quedó pendiente, ya está confirmado." },
        },
      },
      variables: { __userMessage: TX },
    });
    assert.equal(blocked.allowed, false);
  });
});

describe("Fase 4.4.17 — R. provenance compatible", () => {
  it("provenance compatible → ALLOW", () => {
    const verified = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "agendar_cita_marketplace", data: { reservationId: "r-417" } },
      ],
    };
    assert.equal(
      ctx({ user: TX, ai: "No quedó pendiente, ya está confirmado.", verified }).ok,
      true,
    );
  });

  it("provenance incompatible → BLOCK", () => {
    const verified = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "transferir_soporte", data: { transferred: true } },
      ],
    };
    assert.equal(
      ctx({ user: TX, ai: "No quedó pendiente, ya está confirmado.", verified }).ok,
      false,
    );
  });
});

describe("Fase 4.4.17 — variantes semánticas nuevas", () => {
  it("negación de pendiente no silencia ya confirmado", () => {
    assert.equal(
      ctx({ user: TX, ai: "No, no quedó pendiente, ya está confirmado." }).ok,
      false,
    );
  });

  it("negación positiva oculta no bypassa future incidental previo", () => {
    assert.equal(
      ctx({
        user: TX,
        ai: "Sí, tranquilo, ya no necesitas hacer nada más; cualquier duda la puedes consultar después.",
      }).ok,
      false,
    );
  });

  it("runtime applyAiResponseClaimSecurity bloquea negación+afirmación", () => {
    const r = applyAiResponseClaimSecurity({
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: { mode: "respond", responseText: "No quedó pendiente, ya está confirmado." },
      },
      variables: { __userMessage: TX },
    });
    assert.equal(r.success, false);
  });
});

describe("Fase 4.4.17 — multi-turn", () => {
  it("multi-turn + negación incompleto negada + afirmación → BLOCK", () => {
    const history = [
      { role: "user" as const, content: "Quiero reservar." },
      { role: "assistant" as const, content: "¿Qué día?" },
      { role: "user" as const, content: "Mañana." },
      { role: "assistant" as const, content: "¿Qué hora?" },
      { role: "user" as const, content: "5pm." },
    ];
    assert.equal(
      ctx({
        user: "5pm.",
        ai: "No quedó pendiente, ya está confirmado.",
        history,
      }).ok,
      false,
    );
  });
});
