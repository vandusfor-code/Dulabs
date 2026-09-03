/**
 * Tests Fase 4.4.13 — eliminación bypass tokenCount en modal ack / cierre contextual.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyAiResponseClaimSecurity,
  blockUnverifiedExternalClaimsInMessageContent,
  filterClaimSecuredEffects,
} from "@/lib/flow/ai-runtime/ai-response-security";
import { VERIFIED_RESULTS_VARIABLE_KEY } from "@/lib/flow/ai-runtime/verified-results";
import { EFFECT_RESULT_CLASSIFICATIONS } from "@/lib/flow/executor-types";
import {
  analyzeTextForExternalClaims,
  analyzeUserContext,
  classifyResponseIntent,
  extractVerifiedCapabilitiesFromVariables,
  validateTextClaimsAgainstVerified,
} from "@/lib/flow/external-claim-security";

const TX_USER = "Reserva mi cita.";

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

describe("Fase 4.4.13 — A. BLOCKER tokenCount: modal + cierre en request_action", () => {
  const blocked = [
    "Por supuesto, listo.",
    "Claro que sí.",
    "De acuerdo, listo.",
    "Sí, perfecto.",
    "Perfecto entonces.",
    "Sí, adelante.",
    "Claro, procedemos.",
    "Por supuesto.",
    "De acuerdo, podemos hacerlo.",
    "¡POR SUPUESTO, LISTO!",
    "👍 Por supuesto, listo.",
  ];

  for (const ai of blocked) {
    it(`A: "${TX_USER}" → "${ai}" → BLOCK`, () => {
      const check = ctx({ user: TX_USER, ai });
      assert.equal(check.ok, false);
      if (!check.ok) assert.ok(check.missing.includes("appointment.reserved"));
      const a = analyzeTextForExternalClaims(ai, { userMessage: TX_USER });
      assert.equal(a.conversationalSafe, false);
      assert.notEqual(a.responseIntent, "acknowledgement");
    });
  }
});

describe("Fase 4.4.13 — B/C. ALLOW future action (longitud variable)", () => {
  const allowed = [
    "Sí, voy a revisar disponibilidad.",
    "Claro, primero voy a consultar horarios.",
    "Por supuesto, primero verificaré los horarios.",
    "De acuerdo, déjame comprobarlo.",
    "Claro, podemos revisar las opciones.",
    "Sí, procedamos a consultar disponibilidad.",
    "Sí, todavía voy a revisar disponibilidad.",
  ];

  for (const ai of allowed) {
    it(`ALLOW: "${TX_USER}" → "${ai}"`, () => {
      assert.equal(ctx({ user: TX_USER, ai }).ok, true);
      assert.equal(classifyResponseIntent(ai, { userMessage: TX_USER }), "future_action");
    });
  }
});

describe("Fase 4.4.13 — D. completion explícito → external_claim", () => {
  it(`"${TX_USER}" → "Claro, quedó reservada." → BLOCK`, () => {
    assert.equal(ctx({ user: TX_USER, ai: "Claro, quedó reservada." }).ok, false);
    assert.equal(
      classifyResponseIntent("Claro, quedó reservada.", { userMessage: TX_USER }),
      "external_claim",
    );
  });
});

describe("Fase 4.4.13 — E. pure acknowledgement non-transactional", () => {
  const infoCases = [
    { user: "¿Cuánto cuesta?", ai: "Claro." },
    { user: "¿Cómo funciona?", ai: "Sí." },
    { user: "Quiero información sobre el servicio.", ai: "Por supuesto." },
  ];

  for (const { user, ai } of infoCases) {
    it(`ALLOW info: "${user}" → "${ai}"`, () => {
      assert.equal(ctx({ user, ai }).ok, true);
      assert.equal(analyzeTextForExternalClaims(ai, { userMessage: user }).requiredCapabilities.length, 0);
    });
  }
});

describe("Fase 4.4.13 — F/G/H. state_question", () => {
  it("G: ¿Ya quedó reservada? + Sí. → BLOCK", () => {
    assert.equal(ctx({ user: "¿Ya quedó reservada?", ai: "Sí." }).ok, false);
  });

  it("H: ¿Ya quedó reservada? + Sí, claro. → BLOCK", () => {
    assert.equal(ctx({ user: "¿Ya quedó reservada?", ai: "Sí, claro." }).ok, false);
  });

  it("I: ¿Ya quedó reservada? + Voy a verificarlo. → ALLOW", () => {
    assert.equal(ctx({ user: "¿Ya quedó reservada?", ai: "Voy a verificarlo." }).ok, true);
    assert.equal(
      classifyResponseIntent("Voy a verificarlo.", { userMessage: "¿Ya quedó reservada?" }),
      "future_action",
    );
  });
});

describe("Fase 4.4.13 — J. MULTI-TURN", () => {
  const history = [
    { role: "user" as const, content: "Quiero reservar una cita." },
    { role: "assistant" as const, content: "Claro. ¿Qué día?" },
    { role: "user" as const, content: "Mañana." },
    { role: "assistant" as const, content: "¿Qué hora?" },
    { role: "user" as const, content: "5 pm." },
  ];

  const multiBlocked = [
    "Por supuesto, listo.",
    "Claro que sí.",
    "De acuerdo, listo.",
    "Sí, perfecto.",
    "Perfecto entonces.",
  ];

  for (const ai of multiBlocked) {
    it(`multi-turn → "${ai}" → BLOCK`, () => {
      assert.equal(ctx({ user: "5 pm.", ai, history }).ok, false);
    });
  }
});

describe("Fase 4.4.13 — K. parts / media / template", () => {
  it("parts fragmentados modal+cierre → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: { parts: ["Por supuesto", ", ", "listo."] },
      variables: { __userMessage: TX_USER },
    });
    assert.equal(blocked.allowed, false);
  });

  it("media caption → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        media: { type: "image", url: "https://x.test/a.jpg", caption: "De acuerdo, listo." },
      },
      variables: { __userMessage: TX_USER },
    });
    assert.equal(blocked.allowed, false);
  });

  it("template body → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        template: { templateName: "t1", variables: { body: "Claro que sí." } },
      },
      variables: { __userMessage: TX_USER },
    });
    assert.equal(blocked.allowed, false);
  });
});

describe("Fase 4.4.13 — L. provenance + cross-capability", () => {
  it("provenance compatible → ALLOW", () => {
    const verified = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "agendar_cita_marketplace", data: { reservationId: "r-13" } },
      ],
    };
    assert.equal(ctx({ user: TX_USER, ai: "Por supuesto, listo.", verified }).ok, true);
  });

  it("provenance incompatible → BLOCK", () => {
    const verified = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "transferir_soporte", data: { transferred: true } },
      ],
    };
    const check = ctx({ user: TX_USER, ai: "Por supuesto, listo.", verified });
    assert.equal(check.ok, false);
    if (!check.ok) assert.ok(check.missing.includes("appointment.reserved"));
  });

  it("evidencia fabricada fuera __verifiedResults → BLOCK", () => {
    assert.equal(
      ctx({
        user: TX_USER,
        ai: "Por supuesto, listo.",
        verified: { appointmentId: "fake", verified: true },
      }).ok,
      false,
    );
  });
});

describe("Fase 4.4.13 — M. runtime send_message barrier", () => {
  it("applyAiResponseClaimSecurity bloquea modal+cierre", () => {
    const r = applyAiResponseClaimSecurity({
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: { mode: "respond", responseText: "Por supuesto, listo." },
      },
      variables: { __userMessage: TX_USER },
    });
    assert.equal(r.success, false);
  });

  it("filterClaimSecuredEffects elimina send_message peligroso", () => {
    const effects = filterClaimSecuredEffects(
      [
        {
          type: "send_message",
          nodeId: "msg-1",
          content: { text: "De acuerdo, listo." },
          executionId: "exec-1",
          effectId: "fx-1",
          origin: "ai_generated",
        },
      ],
      { __userMessage: TX_USER },
    );
    assert.equal(effects.length, 0);
  });
});

describe("Fase 4.4.13 — N. longitud NO cambia decisión de seguridad", () => {
  it("misma semántica modal+cierre con distinta longitud → mismo BLOCK", () => {
    const variants = ["Listo.", "Sí, listo.", "Por supuesto, listo.", "Por supuesto, listo, gracias."];
    for (const ai of variants) {
      const check = ctx({ user: TX_USER, ai });
      if (ai === "Listo.") {
        assert.equal(check.ok, false);
      } else if (ai.includes("Por supuesto") || ai.includes("Sí,")) {
        assert.equal(check.ok, false, `expected BLOCK for "${ai}"`);
      }
    }
  });

  it("requiresEvidenceForModalAck no depende de tokenCount", () => {
    const userCtx = analyzeUserContext({ userMessage: TX_USER });
    assert.equal(userCtx.requiresEvidenceForModalAck, true);
    assert.equal(ctx({ user: TX_USER, ai: "Por supuesto, listo, gracias." }).ok, false);
  });
});
