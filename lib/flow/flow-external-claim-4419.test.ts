/**
 * Tests Fase 4.4.19 — detección estructural de resolución/completitud operacional.
 * No depende de listas cerradas de verbos (resuelto, solucionado, etc.).
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

const TX = "Quiero reservar mañana a las 5.";
const TX_RESERVA = "Reserva mi cita.";
const TX_PAGO = "Quiero hacer la transferencia.";
const TX_SOPORTE = "Quiero hablar con soporte.";
const INFO = "¿Cuánto cuesta el servicio?";

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

function expectBlock(user: string, ai: string, cap?: string) {
  const check = ctx({ user, ai });
  assert.equal(check.ok, false, `expected BLOCK: ${ai}`);
  if (!check.ok) assert.ok(check.missing.length > 0);
  if (cap && !check.ok) {
    assert.ok(
      check.missing.includes(cap as never),
      `expected missing ${cap}, got ${check.missing.join(",")}`,
    );
  }
  const analysis = analyzeTextForExternalClaims(ai, { userMessage: user });
  assert.equal(analysis.conversationalSafe, false);
  assert.ok(analysis.requiredCapabilities.length > 0);
}

function expectAllow(user: string, ai: string) {
  const check = ctx({ user, ai });
  assert.equal(check.ok, true, `expected ALLOW: ${ai}`);
  assert.equal(analyzeTextForExternalClaims(ai, { userMessage: user }).requiredCapabilities.length, 0);
}

describe("Fase 4.4.19 — A. bypass original", () => {
  it('BLOCK: "de nuestra parte tenemos todo resuelto"', () => {
    expectBlock(
      TX,
      "No hay ningún inconveniente, de nuestra parte tenemos todo resuelto.",
      "appointment.reserved",
    );
    assert.notEqual(
      classifyResponseIntent("No hay ningún inconveniente, de nuestra parte tenemos todo resuelto.", {
        userMessage: TX,
      }),
      "conversational",
    );
  });
});

describe("Fase 4.4.19 — B. variantes estructurales", () => {
  const blocked = [
    "Contamos con todo listo.",
    "La gestión está finalizada.",
    "El proceso se encuentra completado.",
    "Hemos dejado todo preparado.",
    "Todo está en orden.",
    "La solicitud está gestionada.",
    "De nuestra parte tenemos todo listo.",
  ];

  for (const ai of blocked) {
    it(`BLOCK: "${ai}"`, () => expectBlock(TX_RESERVA, ai));
  }
});

describe("Fase 4.4.19 — C. verbos morfológicos diversos", () => {
  const blocked = [
    "De nuestra parte dejamos el trámite culminado.",
    "Contamos con la solicitud tramitada.",
    "El asunto se encuentra zanjado.",
    "Hemos dejado la gestión cubierta.",
    "Por nuestra parte quedó el proceso ultimado.",
    "La operación aparece concluida de nuestro lado.",
  ];

  for (const ai of blocked) {
    it(`BLOCK: "${ai.slice(0, 50)}..."`, () => expectBlock(TX, ai));
  }
});

describe("Fase 4.4.19 — D. negación + afirmación (4.4.17)", () => {
  it("BLOCK: negación incompleta + confirmación", () => {
    expectBlock(TX, "No quedó pendiente, ya está confirmado.", "appointment.reserved");
  });
  it("BLOCK: doble cláusula resolución", () => {
    expectBlock(TX, "No quedó a medias, se completó todo.", "appointment.reserved");
  });
  it("ALLOW: negación legítima sin afirmación posterior", () => {
    expectAllow(TX, "No está reservado.");
  });
});

describe("Fase 4.4.19 — E. futuro vs completitud incidental", () => {
  it("ALLOW: future action principal", () => {
    expectAllow(TX_RESERVA, "Voy a consultar disponibilidad.");
  });
  it("BLOCK: resolución + consulta incidental", () => {
    expectBlock(
      TX,
      "Ya tenemos todo resuelto; si quieres puedes consultar después.",
      "appointment.reserved",
    );
  });
  it("BLOCK: completitud en cláusula principal + futuro en secundaria", () => {
    expectBlock(
      TX,
      "Voy a verificar disponibilidad, pero la cita ya quedó reservada.",
      "appointment.reserved",
    );
  });
});

describe("Fase 4.4.19 — F. modales", () => {
  it("ALLOW: Claro tras pregunta informativa", () => {
    expectAllow(INFO, "Claro.");
  });
  it("BLOCK: Por supuesto, listo tras solicitud transaccional", () => {
    expectBlock(TX_RESERVA, "Por supuesto, listo.", "appointment.reserved");
  });
  it("ALLOW: modal + future action", () => {
    expectAllow(TX_RESERVA, "Claro, voy a consultar disponibilidad.");
  });
  it("BLOCK: modal + completitud explícita", () => {
    expectBlock(TX_RESERVA, "Claro, quedó reservada.", "appointment.reserved");
  });
});

describe("Fase 4.4.19 — G/H/I parts, media, template", () => {
  it("G: parts fragmentados resolución → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: { parts: ["De nuestra parte", " tenemos todo", " resuelto."] },
      variables: { __userMessage: TX },
    });
    assert.equal(blocked.allowed, false);
  });

  it("H: media caption resolución → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        media: {
          type: "image",
          url: "https://x.test/a.jpg",
          caption: "Contamos con todo listo.",
        },
      },
      variables: { __userMessage: TX },
    });
    assert.equal(blocked.allowed, false);
  });

  it("I: template resolución → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        template: {
          templateName: "resolucion",
          variables: { body: "De nuestra parte tenemos todo resuelto." },
        },
      },
      variables: { __userMessage: TX },
    });
    assert.equal(blocked.allowed, false);
  });
});

describe("Fase 4.4.19 — J. multi-turn", () => {
  it("BLOCK: resolución tras request en historial", () => {
    expectBlock(TX, "De nuestra parte tenemos todo resuelto.", "appointment.reserved");
  });

  it("ALLOW: future tras request en historial", () => {
    expectAllow(TX, "Voy a revisar disponibilidad para continuar.");
  });
});

describe("Fase 4.4.19 — K/L provenance", () => {
  const verifiedOk = {
    [VERIFIED_RESULTS_VARIABLE_KEY]: [
      { verified: true, source: "agendar_cita_marketplace", data: { reservationId: "r-419" } },
    ],
  };

  it("K: provenance compatible → ALLOW", () => {
    assert.equal(
      ctx({ user: TX, ai: "De nuestra parte tenemos todo resuelto.", verified: verifiedOk }).ok,
      true,
    );
  });

  it("L: provenance fabricado/incompatible → BLOCK", () => {
    const wrong = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "transferir_soporte", data: { transferred: true } },
      ],
    };
    assert.equal(
      ctx({ user: TX, ai: "De nuestra parte tenemos todo resuelto.", verified: wrong }).ok,
      false,
    );
  });
});

describe("Fase 4.4.19 — M. cross-capability", () => {
  it("BLOCK: resolución en contexto pago", () => {
    expectBlock(TX_PAGO, "De nuestra parte tenemos el pago resuelto.", "payment.completed");
  });
  it("BLOCK: resolución en contexto soporte", () => {
    expectBlock(TX_SOPORTE, "De nuestra parte tenemos la transferencia resuelta.");
  });
});

describe("Fase 4.4.19 — N. informativas permitidas", () => {
  const allowed = [
    "Claro, con gusto te ayudo.",
    "Te explico cómo funciona el servicio.",
    "Puedo ayudarte con información general.",
  ];

  for (const ai of allowed) {
    it(`ALLOW info: "${ai}"`, () => expectAllow(INFO, ai));
  }
});

describe("Fase 4.4.19 — O. futuras permitidas", () => {
  const allowed = [
    "Voy a revisar disponibilidad.",
    "Déjame comprobar los horarios.",
    "Primero consultaremos disponibilidad.",
    "No está reservado todavía, voy a verificar disponibilidad.",
  ];

  for (const ai of allowed) {
    it(`ALLOW future: "${ai}"`, () => expectAllow(TX_RESERVA, ai));
  }
});

describe("Fase 4.4.19 — P. ambiguas / hipótesis", () => {
  it("ALLOW: posibilidad podemos tener", () => {
    expectAllow(TX_RESERVA, "Podemos tener todo listo antes de confirmar.");
  });
  it("ALLOW: podemos revisar (acción colaborativa)", () => {
    expectAllow(TX_RESERVA, "Podemos revisar las opciones antes de reservar.");
  });
  it("ALLOW: negación temporal + futuro", () => {
    assert.equal(
      classifyResponseIntent("No está reservado todavía, voy a verificar disponibilidad.", {
        userMessage: TX,
      }),
      "future_action",
    );
  });
});

describe("Fase 4.4.19 — Q. puntuación y acentos", () => {
  it("BLOCK: mayúsculas", () => {
    expectBlock(TX, "DE NUESTRA PARTE TENEMOS TODO RESUELTO.", "appointment.reserved");
  });
  it("BLOCK: sin acentos", () => {
    expectBlock(TX, "La gestion esta finalizada.", "appointment.reserved");
  });
  it("BLOCK: puntuación variada", () => {
    expectBlock(TX, "Contamos con todo listo — de nuestra parte.", "appointment.reserved");
  });
});

describe("Fase 4.4.19 — R. cláusula secundaria", () => {
  it("BLOCK: resolución escondida al final", () => {
    expectBlock(
      TX,
      "Entiendo tu solicitud y revisé los detalles; de nuestra parte tenemos todo resuelto.",
    );
  });
  it("BLOCK: resolución en cláusula tras conector", () => {
    expectBlock(
      TX,
      "Gracias por esperar, pero la gestión ya está finalizada.",
      "appointment.reserved",
    );
  });
});

describe("Fase 4.4.19 — runtime applyAiResponseClaimSecurity", () => {
  it("SECURITY_REJECTED sin provenance", () => {
    const result = applyAiResponseClaimSecurity({
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: { responseText: "De nuestra parte tenemos todo resuelto." },
      },
      variables: { __userMessage: TX },
    });
    assert.equal(result.success, false);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
  });
});

describe("Fase 4.4.19 — filterClaimSecuredEffects", () => {
  it("filtra send_message con resolución no verificada", () => {
    const effects = filterClaimSecuredEffects(
      [
        {
          type: "send_message",
          nodeId: "n1",
          executionId: "e1",
          effectId: "f1",
          content: { text: "Contamos con todo listo." },
          origin: "ai_generated",
        },
      ],
      { __userMessage: TX },
    );
    assert.equal(effects.length, 0);
  });
});

/** 20 paráfrasis adversariales NO presentes en los ejemplos originales del blocker. */
describe("Fase 4.4.19 — paráfrasis adversariales arquitectura", () => {
  const adversarialBlock = [
    "De nuestra parte dejamos el trámite culminado.",
    "Contamos con la solicitud tramitada.",
    "Hemos llevado el proceso a término y quedó concluido.",
    "La operación aparece concluida de nuestro lado.",
    "Tenemos el caso encaminado por completo.",
    "Dejamos el pedido atendido sin pendientes.",
    "El asunto se encuentra zanjado.",
    "Hemos dejado la gestión cubierta.",
    "Todo el trámite está debidamente finalizado.",
    "Por nuestra parte quedó el proceso ultimado.",
    "De nuestro lado dejamos la operación terminada.",
    "Contamos con el expediente debidamente procesado.",
    "Hemos dejado el requerimiento satisfecho por completo.",
    "La petición se encuentra debidamente atendida.",
    "De nuestra parte quedó el encargo ejecutado.",
    "Tenemos la gestión debidamente concluida.",
    "El trámite fue dejado completamente atendido.",
    "De nuestra parte tenemos la operación encaminada.",
    "Contamos con el proceso debidamente ultimado.",
    "Hemos dejado la solicitud debidamente resuelta.",
  ];

  for (const ai of adversarialBlock) {
    it(`ADV BLOCK: "${ai.slice(0, 52)}..."`, () => {
      expectBlock(TX, ai);
    });
  }

  const adversarialAllow = [
    "Podemos tener todo listo si confirmas los datos.",
    "Voy a verificar si queda algún pendiente.",
    "Te explico el procedimiento paso a paso.",
    "Claro, con gusto te ayudo con la reserva.",
  ];

  for (const ai of adversarialAllow) {
    it(`ADV ALLOW: "${ai}"`, () => expectAllow(TX_RESERVA, ai));
  }
});
