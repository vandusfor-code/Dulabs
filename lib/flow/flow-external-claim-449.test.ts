/**
 * Tests Fase 4.4.9 — corrección bypass modal acknowledgement contextual.
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
  analyzeUserContext,
  classifyResponseIntent,
  extractVerifiedCapabilitiesFromVariables,
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

function analysis(user: string | undefined, ai: string, history?: Array<{ role: "user" | "assistant"; content: string }>) {
  return analyzeTextForExternalClaims(ai, { userMessage: user, conversationHistory: history, source: "ai_response" });
}

describe("Fase 4.4.9 — A. STATE QUESTION + modal corto → BLOCK", () => {
  const stateCases: Array<{ user: string; cap: string }> = [
    { user: "¿Ya quedó reservada mi cita?", cap: "appointment.reserved" },
    { user: "¿Ya está confirmado?", cap: "appointment.reserved" },
    { user: "¿Se hizo la transferencia?", cap: "payment.completed" },
    { user: "¿Ya me pasaron con soporte?", cap: "support.transferred" },
    { user: "¿Ya quedó registrado?", cap: "lead.created" },
    { user: "¿Quedó agendada la cita?", cap: "appointment.reserved" },
    { user: "¿Fue realizada la transferencia de $50000?", cap: "payment.completed" },
    { user: "¿Está confirmada mi reserva?", cap: "appointment.reserved" },
  ];

  const modalVariants = ["Sí.", "Claro.", "Ok.", "Vale.", "Perfecto.", "¡Sí!", "SÍ.", "OK!", "👍 Sí"];

  for (const { user, cap } of stateCases) {
    for (const ai of modalVariants) {
      it(`"${user}" → "${ai}" → BLOCK sin ${cap}`, () => {
        const check = ctx({ user, ai });
        assert.equal(check.ok, false, `expected BLOCK for "${ai}"`);
        if (!check.ok) assert.ok(check.missing.includes(cap as never), `missing ${cap}`);
        const a = analysis(user, ai);
        assert.equal(a.conversationalSafe, false);
        assert.ok(a.requiredCapabilities.includes(cap as never));
        assert.notEqual(a.responseIntent, "acknowledgement");
      });
    }
  }
});

describe("Fase 4.4.9 — B. INFORMATION QUESTION + modal → ALLOW (no external claim)", () => {
  const infoCases = [
    { user: "¿Cuánto cuesta?", ai: "Sí." },
    { user: "¿Cómo funciona?", ai: "Claro." },
    { user: "¿Qué horarios tienen?", ai: "Ok." },
    { user: "¿Qué incluye el plan?", ai: "Vale." },
    { user: "Información sobre precios", ai: "Entiendo." },
  ];

  for (const { user, ai } of infoCases) {
    it(`"${user}" → "${ai}" → no external claim`, () => {
      const check = ctx({ user, ai });
      assert.equal(check.ok, true);
      const a = analysis(user, ai);
      assert.equal(a.requiredCapabilities.length, 0);
      assert.equal(a.conversationalSafe, true);
    });
  }
});

describe("Fase 4.4.9 — C. REQUEST FOR ACTION + future action → ALLOW", () => {
  const futures = [
    "Claro, voy a revisar disponibilidad.",
    "Perfecto, voy a consultar horarios.",
    "Sí, déjame consultar los horarios.",
    "Entiendo, voy a verificar disponibilidad.",
  ];

  for (const ai of futures) {
    it(`"Quiero reservar." → "${ai}" → ALLOW`, () => {
      assert.equal(ctx({ user: "Quiero reservar.", ai }).ok, true);
      assert.equal(analysis("Quiero reservar.", ai).requiredCapabilities.length, 0);
    });
  }
});

describe("Fase 4.4.9 — D. REQUEST FOR ACTION transaccional + modal corto → BLOCK (4.4.11)", () => {
  const requestUser = "Quiero reservar.";
  const shortModals = ["Sí.", "Claro.", "Ok.", "Vale.", "Perfecto.", "Entiendo.", "¡Sí!", "OK!"];

  for (const ai of shortModals) {
    it(`"${requestUser}" → "${ai}" → BLOCK (completion_signal, requiere evidencia)`, () => {
      const userCtx = analyzeUserContext({ userMessage: requestUser });
      assert.equal(userCtx.kind, "request_action");
      assert.equal(userCtx.requiresEvidenceForModalAck, true);

      const intent = classifyResponseIntent(ai, { userMessage: requestUser });
      assert.equal(intent, "completion_signal");

      const check = ctx({ user: requestUser, ai });
      assert.equal(check.ok, false);

      const a = analysis(requestUser, ai);
      assert.ok(a.requiredCapabilities.includes("appointment.reserved"));
      assert.equal(a.conversationalSafe, false);
    });
  }
});

describe("Fase 4.4.9 — E. CONFIRMATION REQUEST + modal corto → contexto peligroso BLOCK", () => {
  const confirmUsers = [
    "Quiero reservar mañana a las 5, ¿me lo confirmas?",
    "Necesito agendar, ¿puedes confirmar?",
    "Quiero hacer la transferencia, ¿lo confirmas?",
  ];
  const modals = ["Sí.", "Claro.", "Ok.", "Vale.", "Perfecto."];

  for (const user of confirmUsers) {
    for (const ai of modals) {
      it(`"${user}" → "${ai}" → BLOCK`, () => {
        const userCtx = analyzeUserContext({ userMessage: user });
        assert.equal(userCtx.kind, "confirmation_request");
        assert.equal(userCtx.requiresEvidenceForModalAck, true);

        const check = ctx({ user, ai });
        assert.equal(check.ok, false);
        assert.equal(check.ok, false);
        if (!check.ok) assert.ok(check.missing.length > 0);
      });
    }
  }
});

describe("Fase 4.4.9 — F. EXTERNAL CLAIM directo sigue BLOCK", () => {
  const claims = [
    "Ya quedó reservada.",
    "Está confirmado.",
    "Tu cita está agendada.",
    "Tu transferencia fue realizada.",
    "Ya estás con soporte.",
    "Quedó registrado en el sistema.",
  ];

  for (const ai of claims) {
    it(`claim directo "${ai}" → BLOCK`, () => {
      assert.equal(ctx({ user: "Quiero reservar.", ai }).ok, false);
    });
  }
});

describe("Fase 4.4.9 — G. MULTI-TURN", () => {
  it("reserva acumulada + Sí corto → BLOCK", () => {
    const history = [
      { role: "user" as const, content: "Quiero reservar." },
      { role: "assistant" as const, content: "¿Qué día?" },
      { role: "user" as const, content: "Mañana." },
      { role: "assistant" as const, content: "¿Qué hora?" },
      { role: "user" as const, content: "5 pm." },
    ];
    assert.equal(ctx({ user: "5 pm.", ai: "Sí.", history }).ok, false);
  });

  it("state question multi-turn T1 pregunta T2 Sí → BLOCK", () => {
    const history = [{ role: "user" as const, content: "¿Ya quedó reservada?" }];
    assert.equal(ctx({ user: "¿Ya quedó reservada?", ai: "Sí.", history }).ok, false);
  });

  it("info multi-turn no genera claim", () => {
    const history = [
      { role: "user" as const, content: "¿Cuánto cuesta?" },
      { role: "assistant" as const, content: "¿Te refieres al plan básico?" },
    ];
    assert.equal(ctx({ user: "Sí.", ai: "Sí.", history }).ok, true);
  });

  it("request + scheduling follow-up + modal corto tras hora → BLOCK", () => {
    const history = [
      { role: "user" as const, content: "Quiero reservar." },
      { role: "assistant" as const, content: "¿Qué día?" },
      { role: "user" as const, content: "Mañana." },
      { role: "assistant" as const, content: "¿Qué hora?" },
    ];
    assert.equal(ctx({ user: "A las 5.", ai: "Listo.", history }).ok, false);
  });
});

describe("Fase 4.4.9 — H. PARTS / MEDIA / TEMPLATE con state question", () => {
  it("parts fragmentados modal ack en state question → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: { parts: ["S", "í", "."] },
      variables: { __userMessage: "¿Ya quedó reservada mi cita?" },
    });
    assert.equal(blocked.allowed, false);
  });

  it("media caption modal ack en payment state question → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        media: { type: "image", url: "https://x.test/a.jpg", caption: "Claro." },
      },
      variables: { __userMessage: "¿Se hizo la transferencia?" },
    });
    assert.equal(blocked.allowed, false);
  });

  it("template body modal ack en support state question → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        template: { templateName: "t1", variables: { body: "Sí." } },
      },
      variables: { __userMessage: "¿Ya me pasaron con soporte?" },
    });
    assert.equal(blocked.allowed, false);
  });

  it("template info question + modal → ALLOW", () => {
    const allowed = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        template: { templateName: "t1", variables: { body: "Claro." } },
      },
      variables: { __userMessage: "¿Cómo funciona?" },
    });
    assert.equal(allowed.allowed, true);
  });
});

describe("Fase 4.4.9 — I. PROVENANCE + cross-capability", () => {
  it("state question + Sí con evidencia appointment → ALLOW", () => {
    const verified = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "agendar_cita_marketplace", data: { reservationId: "r-1" } },
      ],
    };
    assert.equal(ctx({ user: "¿Ya quedó reservada?", ai: "Sí.", verified }).ok, true);
  });

  it("state question payment + evidencia appointment NO satisface → BLOCK", () => {
    const verified = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "agendar_cita_marketplace", data: { reservationId: "r-1" } },
      ],
    };
    const check = ctx({ user: "¿Se hizo la transferencia?", ai: "Sí.", verified });
    assert.equal(check.ok, false);
    if (!check.ok) assert.ok(check.missing.includes("payment.completed"));
  });

  it("evidencia fabricada fuera de __verifiedResults no cuenta", () => {
    assert.equal(
      ctx({
        user: "¿Ya quedó reservada?",
        ai: "Sí.",
        verified: { appointmentId: "fake", verified: true, transferred: true },
      }).ok,
      false,
    );
  });

  it("runtime bloquea responseText modal en state question", () => {
    const r = applyAiResponseClaimSecurity({
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: { mode: "respond", responseText: "Sí." },
      },
      variables: { __userMessage: "¿Ya quedó reservada mi cita?" },
    });
    assert.equal(r.success, false);
  });
});

describe("Fase 4.4.9 — J. VARIANTES NUEVAS adversariales", () => {
  const novelBlocked = [
    { user: "¿Ya fue procesado el pago?", ai: "Correcto.", cap: "payment.completed" },
    { user: "¿Quedó la solicitud registrada?", ai: "Afirmativo.", cap: "lead.created" },
    { user: "¿Me comunicaron con un agente?", ai: "Por supuesto.", cap: "support.transferred" },
    { user: "¿Está hecha la reserva?", ai: "Naturalmente.", cap: "appointment.reserved" },
    { user: "Quiero reservar el viernes, confírmame por favor", ai: "De acuerdo.", cap: "appointment.reserved" },
  ];

  for (const { user, ai, cap } of novelBlocked) {
    it(`nuevo: "${user}" → "${ai}" → BLOCK (${cap})`, () => {
      const check = ctx({ user, ai });
      assert.equal(check.ok, false);
      if (!check.ok) assert.ok(check.missing.includes(cap as never));
    });
  }

  const novelAllowed = [
    { user: "¿A qué hora?", ai: "Sí." },
  ];

  for (const { user, ai } of novelAllowed) {
    it(`nuevo safe: "${user}" → "${ai}" → ALLOW`, () => {
      assert.equal(ctx({ user, ai }).ok, true);
    });
  }
});
