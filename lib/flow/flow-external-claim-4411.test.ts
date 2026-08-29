/**
 * Tests Fase 4.4.11 — bypass request_action + modal corto en contexto transaccional.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VERIFIED_RESULTS_VARIABLE_KEY } from "@/lib/flow/ai-runtime/verified-results";
import {
  analyzeTextForExternalClaims,
  analyzeUserContext,
  classifyResponseIntent,
  detectDomainCapabilities,
  extractVerifiedCapabilitiesFromVariables,
  inferStateQuestionCapabilities,
  validateTextClaimsAgainstVerified,
} from "@/lib/flow/external-claim-security";

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

describe("Fase 4.4.11 — A. BLOCKER auditoría: request_action transaccional + modal corto", () => {
  const blockerUser = "Reserva mi cita para mañana a las 5pm.";
  const shortModals = ["Sí.", "Claro.", "Ok.", "Vale.", "Perfecto.", "Entiendo.", "¡Sí!", "OK!"];

  it("contexto request_action exige evidencia para modal corto", () => {
    const userCtx = analyzeUserContext({ userMessage: blockerUser });
    assert.equal(userCtx.kind, "request_action");
    assert.equal(userCtx.requiresEvidenceForModalAck, true);
    assert.ok(userCtx.transactionalCaps.includes("appointment.reserved"));
  });

  for (const ai of shortModals) {
    it(`"${blockerUser}" → "${ai}" → BLOCK`, () => {
      const check = ctx({ user: blockerUser, ai });
      assert.equal(check.ok, false);
      if (!check.ok) assert.ok(check.missing.includes("appointment.reserved"));
      const a = analyzeTextForExternalClaims(ai, { userMessage: blockerUser });
      assert.equal(a.conversationalSafe, false);
      assert.equal(a.responseIntent, "completion_signal");
    });
  }
});

describe("Fase 4.4.11 — B. ALLOW respuesta futura en request_action", () => {
  const user = "Reserva mi cita para mañana a las 5pm.";
  const futures = [
    "Sí, voy a revisar disponibilidad.",
    "Claro, primero voy a consultar horarios.",
    "Perfecto, voy a consultar horarios.",
    "Entiendo, voy a verificar disponibilidad.",
  ];

  for (const ai of futures) {
    it(`"${user}" → "${ai}" → ALLOW`, () => {
      assert.equal(ctx({ user, ai }).ok, true);
      assert.equal(classifyResponseIntent(ai, { userMessage: user }), "future_action");
    });
  }
});

describe("Fase 4.4.11 — C. ALLOW request no transaccional", () => {
  it('"Quiero información sobre el servicio." + "Sí." → ALLOW', () => {
    const user = "Quiero información sobre el servicio.";
    const userCtx = analyzeUserContext({ userMessage: user });
    assert.equal(userCtx.kind, "information");
    assert.equal(userCtx.requiresEvidenceForModalAck, false);
    assert.equal(ctx({ user, ai: "Sí." }).ok, true);
  });
});

describe("Fase 4.4.11 — D. state_question y confirmation_request intactos", () => {
  it('"¿Ya quedó reservada?" + "Sí." → BLOCK', () => {
    assert.equal(ctx({ user: "¿Ya quedó reservada?", ai: "Sí." }).ok, false);
  });

  it('"¿Me confirmas que quedó reservada?" + "Sí." → BLOCK', () => {
    assert.equal(ctx({ user: "¿Me confirmas que quedó reservada?", ai: "Sí." }).ok, false);
  });
});

describe("Fase 4.4.11 — E. MULTI-TURN scheduling + modal corto", () => {
  it('día → hora → "Sí." → BLOCK', () => {
    const history = [
      { role: "user" as const, content: "Quiero reservar" },
      { role: "assistant" as const, content: "¿Qué día?" },
      { role: "user" as const, content: "Mañana" },
      { role: "assistant" as const, content: "¿Qué hora?" },
      { role: "user" as const, content: "5pm" },
    ];
    assert.equal(ctx({ user: "5pm", ai: "Sí.", history }).ok, false);
  });
});

describe("Fase 4.4.11 — F. PROVENANCE real satisface request_action", () => {
  it("request_action + Sí con appointment.reserved verificado → ALLOW", () => {
    const verified = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "agendar_cita_marketplace", data: { reservationId: "r-4411" } },
      ],
    };
    assert.equal(
      ctx({ user: "Reserva mi cita para mañana a las 5pm.", ai: "Sí.", verified }).ok,
      true,
    );
  });
});

describe("Fase 4.4.11 — G. transferencia: semántica unificada payment vs support", () => {
  it('state question "¿Se hizo la transferencia?" → payment.completed', () => {
    const caps = inferStateQuestionCapabilities("¿Se hizo la transferencia?");
    assert.ok(caps.includes("payment.completed"));
    assert.equal(caps.includes("support.transferred"), false);
  });

  it('state question "¿Ya me pasaron con soporte?" → support.transferred', () => {
    const caps = inferStateQuestionCapabilities("¿Ya me pasaron con soporte?");
    assert.ok(caps.includes("support.transferred"));
    assert.equal(caps.includes("payment.completed"), false);
  });

  it('domain claim "Tu transferencia fue realizada" → payment.completed', () => {
    const caps = detectDomainCapabilities("Tu transferencia fue realizada");
    assert.ok(caps.includes("payment.completed"));
    assert.equal(caps.includes("support.transferred"), false);
  });

  it('domain claim "Te transferimos con soporte" → support.transferred', () => {
    const caps = detectDomainCapabilities("Te transferimos con soporte");
    assert.ok(caps.includes("support.transferred"));
  });
});
