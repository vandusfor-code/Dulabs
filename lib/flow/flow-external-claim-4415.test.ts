/**
 * Tests Fase 4.4.15 — detectDeferredFutureAction semántico (no presencia léxica incidental).
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
  classifyResponseIntent,
  extractVerifiedCapabilitiesFromVariables,
  validateTextClaimsAgainstVerified,
} from "@/lib/flow/external-claim-security";

const TX = "Reserva mi cita.";

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

describe("Fase 4.4.15 — A/B/C. BLOCK: future incidental no oculta completitud", () => {
  const blocked = [
    {
      user: TX,
      ai: "Sí, tranquilo, ya no necesitas hacer nada más; cualquier duda la puedes consultar después.",
    },
    { user: TX, ai: "Claro, quedó reservada; puedes revisar los detalles después." },
    { user: TX, ai: "Perfecto, ya quedó; puedes verificarlo luego." },
    { user: TX, ai: "Sí, ya está todo listo; cualquier duda la puedes consultar después." },
    { user: TX, ai: "Claro, quedó reservado; puedes revisar más tarde." },
    { user: TX, ai: "De acuerdo, está gestionado; puedes comprobarlo luego." },
    { user: TX, ai: "Sí, ya está confirmado; cualquier duda la puedes consultar." },
  ];

  for (const { user, ai } of blocked) {
    it(`BLOCK: "${ai.slice(0, 55)}..."`, () => {
      const check = ctx({ user, ai });
      assert.equal(check.ok, false);
      const a = analyzeTextForExternalClaims(ai, { userMessage: user });
      assert.equal(a.conversationalSafe, false);
      assert.notEqual(a.responseIntent, "future_action");
    });
  }
});

describe("Fase 4.4.15 — D/E/F. ALLOW: future action principal del agente", () => {
  const allowed = [
    "Claro, voy a consultar disponibilidad.",
    "Sí, primero voy a revisar horarios.",
    "Por supuesto, déjame verificar los horarios.",
    "Voy a comprobar si hay disponibilidad.",
    "Podemos revisar las opciones antes de reservar.",
    "Primero consultaremos disponibilidad.",
    "Sí, todavía voy a revisar disponibilidad.",
  ];

  for (const ai of allowed) {
    it(`ALLOW: "${ai}"`, () => {
      assert.equal(ctx({ user: TX, ai }).ok, true);
      assert.equal(classifyResponseIntent(ai, { userMessage: TX }), "future_action");
    });
  }
});

describe("Fase 4.4.15 — G/H. state_question + future incidental", () => {
  it('G: "¿Ya quedó reservada?" + "Sí, puedes consultar después." → BLOCK', () => {
    assert.equal(
      ctx({ user: "¿Ya quedó reservada?", ai: "Sí, puedes consultar los detalles después." }).ok,
      false,
    );
  });

  it('H: "¿Ya quedó reservada?" + "Voy a verificarlo." → ALLOW', () => {
    assert.equal(ctx({ user: "¿Ya quedó reservada?", ai: "Voy a verificarlo." }).ok, true);
    assert.equal(
      classifyResponseIntent("Voy a verificarlo.", { userMessage: "¿Ya quedó reservada?" }),
      "future_action",
    );
  });
});

describe("Fase 4.4.15 — I. MULTI-TURN", () => {
  const history = [
    { role: "user" as const, content: "Quiero reservar." },
    { role: "assistant" as const, content: "Claro. ¿Qué día?" },
    { role: "user" as const, content: "Mañana." },
    { role: "assistant" as const, content: "¿Qué hora?" },
    { role: "user" as const, content: "5pm." },
  ];

  it("multi-turn + future incidental → BLOCK", () => {
    const ai =
      "Sí, tranquilo, ya no necesitas hacer nada más; cualquier duda la puedes consultar después.";
    assert.equal(ctx({ user: "5pm.", ai, history }).ok, false);
  });

  it("multi-turn T2 voy a consultar → ALLOW", () => {
    assert.equal(
      ctx({
        user: "Quiero reservar.",
        ai: "Voy a consultar disponibilidad.",
        history: [{ role: "user", content: "Quiero reservar." }],
      }).ok,
      true,
    );
  });

  it('T4 "Sí, voy a revisarlo" → ALLOW', () => {
    const h = [
      { role: "user" as const, content: "Quiero reservar." },
      { role: "assistant" as const, content: "Voy a consultar disponibilidad." },
      { role: "user" as const, content: "¿Hay cupo?" },
    ];
    assert.equal(ctx({ user: "¿Hay cupo?", ai: "Sí, voy a revisarlo.", history: h }).ok, true);
  });
});

describe("Fase 4.4.15 — J/K. PROVENANCE", () => {
  it("J: provenance compatible + future incidental → ALLOW", () => {
    const verified = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "agendar_cita_marketplace", data: { reservationId: "r-15" } },
      ],
    };
    assert.equal(
      ctx({
        user: TX,
        ai: "Perfecto, ya quedó; puedes verificarlo luego.",
        verified,
      }).ok,
      true,
    );
  });

  it("K: provenance incompatible → BLOCK", () => {
    const verified = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "transferir_soporte", data: { transferred: true } },
      ],
    };
    const check = ctx({
      user: TX,
      ai: "Sí, tranquilo, ya no necesitas hacer nada más; puedes consultar después.",
      verified,
    });
    assert.equal(check.ok, false);
    if (!check.ok) assert.ok(check.missing.includes("appointment.reserved"));
  });
});

describe("Fase 4.4.15 — L/M/N. parts / media / template", () => {
  it("L: parts con completitud + future incidental → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        parts: ["Ya quedó reservada", "; puedes ", "consultar después."],
      },
      variables: { __userMessage: TX },
    });
    assert.equal(blocked.allowed, false);
  });

  it("M: media caption → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        media: {
          type: "image",
          url: "https://x.test/a.jpg",
          caption: "Sí, ya no necesitas hacer nada; puedes consultar después.",
        },
      },
      variables: { __userMessage: TX },
    });
    assert.equal(blocked.allowed, false);
  });

  it("N: template → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        template: {
          templateName: "t1",
          variables: { body: "Claro, quedó reservada; puedes revisar luego." },
        },
      },
      variables: { __userMessage: TX },
    });
    assert.equal(blocked.allowed, false);
  });
});

describe("Fase 4.4.15 — O. NEGACIÓN", () => {
  const negated = [
    "No, todavía no está reservado.",
    "No se ha realizado todavía.",
    "No, aún falta verificarlo.",
  ];

  for (const ai of negated) {
    it(`negación no es claim positivo: "${ai}" → ALLOW`, () => {
      assert.equal(ctx({ user: TX, ai }).ok, true);
    });
  }

  it("negación no oculta claim positivo en cláusula principal", () => {
    assert.equal(
      ctx({
        user: TX,
        ai: "No hay problema, ya quedó reservado; puedes consultar después.",
      }).ok,
      false,
    );
  });
});

describe("Fase 4.4.15 — P. cross-capability + runtime", () => {
  it("cross-capability payment vs appointment → BLOCK", () => {
    const verified = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "consultar_pago", data: { paymentId: "p-1" } },
      ],
    };
    assert.equal(
      ctx({ user: TX, ai: "Claro, quedó reservada; puedes consultar después.", verified }).ok,
      false,
    );
  });

  it("applyAiResponseClaimSecurity bloquea bypass incidental", () => {
    const r = applyAiResponseClaimSecurity({
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: {
          mode: "respond",
          responseText:
            "Sí, tranquilo, ya no necesitas hacer nada más; cualquier duda la puedes consultar después.",
        },
      },
      variables: { __userMessage: TX },
    });
    assert.equal(r.success, false);
  });

  it("filterClaimSecuredEffects elimina send_message", () => {
    const effects = filterClaimSecuredEffects(
      [{ type: "send_message", nodeId: "msg-1", content: { text: "Perfecto, ya quedó; puedes verificar luego." }, executionId: "exec-1", effectId: "fx-1", origin: "ai_generated" }],
      { __userMessage: TX },
    );
    assert.equal(effects.length, 0);
  });
});

describe("Fase 4.4.15 — Q. variantes semánticas nuevas", () => {
  const novelBlocked = [
    "Entendido, ya lo gestionamos; si quieres puedes verificarlo.",
    "Listo, no queda nada pendiente; puedes revisar cuando quieras.",
    "Confirmado, ya está; puedes comprobar los detalles más tarde.",
  ];

  for (const ai of novelBlocked) {
    it(`nuevo BLOCK: "${ai.slice(0, 50)}..."`, () => {
      assert.equal(ctx({ user: TX, ai }).ok, false);
    });
  }

  const novelAllowed = [
    "Déjame comprobar los horarios disponibles.",
    "Vamos a consultar la agenda antes de confirmarte.",
    "Iré a verificar la disponibilidad ahora.",
  ];

  for (const ai of novelAllowed) {
    it(`nuevo ALLOW: "${ai}"`, () => {
      assert.equal(ctx({ user: TX, ai }).ok, true);
      assert.equal(classifyResponseIntent(ai, { userMessage: TX }), "future_action");
    });
  }
});

describe("Fase 4.4.15 — R. frases ambiguas contextuales", () => {
  it('"Claro, podemos hacerlo." en request_action → BLOCK', () => {
    assert.equal(ctx({ user: TX, ai: "Claro, podemos hacerlo." }).ok, false);
  });

  it('"Sí, adelante." en request_action → BLOCK', () => {
    assert.equal(ctx({ user: TX, ai: "Sí, adelante." }).ok, false);
  });

  it('"Claro, podemos revisar las opciones." → ALLOW (future principal)', () => {
    assert.equal(ctx({ user: TX, ai: "Claro, podemos revisar las opciones." }).ok, true);
  });
});
