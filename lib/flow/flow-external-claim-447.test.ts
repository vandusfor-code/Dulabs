/**
 * Tests Fase 4.4.7 — eliminación bypass cierres cortos (clasificación estructural).
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
  classifyResponseIntent,
  extractVerifiedCapabilitiesFromVariables,
  inferCapabilitiesFromConversationContext,
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

describe("Fase 4.4.7 — A. ACKNOWLEDGEMENT (no implica reserva)", () => {
  const acks = ["Claro.", "Sí.", "Entiendo.", "De acuerdo.", "Perfecto."];
  for (const ack of acks) {
    it(`acknowledgement "${ack}" sin intención transaccional → ALLOW`, () => {
      assert.equal(classifyResponseIntent(ack, { userMessage: "¿Cuál es el precio?" }), "acknowledgement");
      assert.equal(ctx({ user: "¿Cuál es el precio?", ai: ack }).ok, true);
    });
  }
});

describe("Fase 4.4.7 — B. TRANSACTIONAL ACK", () => {
  it("Quiero reservar + Claro → BLOCK sin evidencia (4.4.11)", () => {
    assert.equal(
      classifyResponseIntent("Claro.", { userMessage: "Quiero reservar mañana a las 5." }),
      "completion_signal",
    );
    assert.equal(ctx({ user: "Quiero reservar mañana a las 5.", ai: "Claro." }).ok, false);
  });

  it("Quiero reservar + ¡Claro! → BLOCK sin evidencia (4.4.11)", () => {
    assert.equal(ctx({ user: "Quiero reservar mañana.", ai: "¡Claro!" }).ok, false);
  });
});

describe("Fase 4.4.7 — C. COMPLETION sin evidencia → BLOCK", () => {
  const completions = [
    "Ya quedó.",
    "Está confirmado.",
    "Quedó reservado.",
    "Lo dejamos listo.",
    "Listo, ya quedó reservado.",
  ];
  for (const phrase of completions) {
    it(`completion "${phrase}" → BLOCK`, () => {
      assert.equal(ctx({ user: "Quiero reservar mañana.", ai: phrase }).ok, false);
    });
  }
});

describe("Fase 4.4.7 — D. FUTURE ACTION → ALLOW", () => {
  const futures = [
    "Voy a revisar.",
    "Déjame consultar.",
    "Voy a verificar disponibilidad.",
    "Perfecto, voy a revisar disponibilidad.",
  ];
  for (const phrase of futures) {
    it(`future "${phrase}" → ALLOW`, () => {
      assert.equal(ctx({ user: "Quiero reservar mañana.", ai: phrase }).ok, true);
    });
  }
});

describe("Fase 4.4.7 — E. EXTERNAL CLAIM → BLOCK", () => {
  const claims = [
    "Tu espacio está asegurado.",
    "Ya tienes el turno.",
    "Ya está reservado.",
    "Tu cita quedó confirmada.",
  ];
  for (const phrase of claims) {
    it(`external "${phrase}" → BLOCK`, () => {
      assert.equal(ctx({ user: "Quiero reservar.", ai: phrase }).ok, false);
    });
  }
});

describe("Fase 4.4.7 — F. PARÁFRASIS NUEVAS (no en tests previos)", () => {
  const novelBlocked = [
    "Hecho.",
    "Quedó gestionado.",
    "Procedemos con tu reserva.",
    "Tu solicitud quedó procesada.",
    "Confirmado el horario.",
    "Agendado para mañana.",
    "Reservado sin problema.",
    "El turno es tuyo.",
    "Operación exitosa.",
    "Todo en orden con tu cita.",
    "Registramos tu pedido.",
    "Transferencia completada.",
    "Pago recibido.",
    "Lead creado en el sistema.",
    "Comunicado con soporte.",
    "Enviado correctamente.",
    "Tu compra fue procesada.",
    "Cita confirmada en el sistema.",
    "Horario bloqueado a tu nombre.",
    "Ya tienes cupo asegurado.",
  ];

  for (const phrase of novelBlocked) {
    it(`bloquea paráfrasis: "${phrase}"`, () => {
      assert.equal(ctx({ user: "Quiero reservar mañana.", ai: phrase }).ok, false);
    });
  }

  const novelClosureBlocked = ["Correcto.", "Anotado.", "Dicho.", "Aprobado.", "Va.", "¡Listo!"];
  for (const phrase of novelClosureBlocked) {
    it(`cierre estructural en contexto transaccional: "${phrase}" → BLOCK`, () => {
      assert.equal(ctx({ user: "Quiero reservar mañana a las 5.", ai: phrase }).ok, false);
    });
  }
});

describe("Fase 4.4.7 — G. CONTEXTO conversacional", () => {
  it("pregunta + Claro → ALLOW", () => {
    assert.equal(ctx({ user: "¿Cómo funciona el servicio?", ai: "Claro." }).ok, true);
  });

  it("agradecimiento + Listo → ALLOW", () => {
    assert.equal(ctx({ user: "Gracias.", ai: "Listo." }).ok, true);
  });

  it("cancelación + Listo → ALLOW sin appointment.reserved", () => {
    const caps = inferCapabilitiesFromConversationContext({ userMessage: "Quiero cancelar mi cita." });
    assert.equal(caps.includes("appointment.reserved"), false);
    assert.equal(ctx({ user: "Quiero cancelar mi cita.", ai: "Listo." }).ok, true);
  });

  it("disponibilidad + Listo → requiere appointment.available", () => {
    const check = ctx({ user: "¿Hay disponibilidad el lunes?", ai: "Listo." });
    assert.equal(check.ok, false);
    if (!check.ok) assert.ok(check.missing.includes("appointment.available"));
  });
});

describe("Fase 4.4.7 — H. MULTI-TURN", () => {
  it("historial acumula intención transaccional", () => {
    const history = [
      { role: "user" as const, content: "Quiero reservar mañana." },
      { role: "assistant" as const, content: "¿A qué hora?" },
      { role: "user" as const, content: "A las 5." },
    ];
    const caps = inferCapabilitiesFromConversationContext({ userMessage: "A las 5.", conversationHistory: history });
    assert.ok(caps.includes("appointment.reserved"));
    assert.equal(ctx({ user: "A las 5.", ai: "Listo.", history }).ok, false);
  });

  it("multi-turn con evidencia verificada → ALLOW reserva", () => {
    const verified = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        {
          verified: true,
          source: "agendar_cita_marketplace",
          data: { reservationId: "r-99" },
        },
      ],
    };
    assert.equal(
      ctx({
        user: "A las 5.",
        ai: "Listo.",
        history: [
          { role: "user", content: "Quiero reservar mañana." },
          { role: "assistant", content: "¿A qué hora?" },
        ],
        verified,
      }).ok,
      true,
    );
  });
});

describe("Fase 4.4.7 — I/J/K parts media template", () => {
  it("parts fragmentados con claim → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: { parts: ["Tu espacio", " ", "está asegurado"] },
      variables: { __userMessage: "Quiero reservar." },
    });
    assert.equal(blocked.allowed, false);
  });

  it("media caption → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        media: { type: "image", url: "https://x.test/a.jpg", caption: "Ya tienes el turno." },
      },
      variables: { __userMessage: "Quiero reservar." },
    });
    assert.equal(blocked.allowed, false);
  });

  it("template params → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        template: { templateName: "t1", variables: { body: "Quedó reservado." } },
      },
      variables: { __userMessage: "Quiero reservar." },
    });
    assert.equal(blocked.allowed, false);
  });
});

describe("Fase 4.4.7 — L/M provenance", () => {
  it("evidencia verificada satisface claim", () => {
    const verified = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "agendar_cita_marketplace", data: { reservationId: "1" } },
      ],
    };
    assert.equal(
      ctx({ user: "Quiero reservar.", ai: "Tu cita quedó agendada.", verified }).ok,
      true,
    );
  });

  it("evidencia fabricada no cuenta", () => {
    assert.equal(
      ctx({
        user: "Quiero reservar.",
        ai: "Tu cita quedó agendada.",
        verified: { appointmentId: "fake", verified: true },
      }).ok,
      false,
    );
  });

  it("runtime bloquea responseText no verificado", () => {
    const r = applyAiResponseClaimSecurity({
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: { mode: "respond", responseText: "¡Listo!" },
      },
      variables: { __userMessage: "Quiero reservar mañana a las 5." },
    });
    assert.equal(r.success, false);
  });
});

describe("Fase 4.4.7 — capability identity", () => {
  it("consultar_disponibilidad ≠ appointment.reserved", () => {
    const caps = extractVerifiedCapabilitiesFromVariables({
      [VERIFIED_RESULTS_VARIABLE_KEY]: [{ verified: true, source: "consultar_disponibilidad", data: { available: true } }],
    });
    assert.ok(caps.has("appointment.available"));
    assert.equal(caps.has("appointment.reserved"), false);
  });
});
