/**
 * Tests Fase 4.4.21 — carga de prueba invertida en contexto transaccional.
 * UNKNOWN/AMBIGUOUS ≠ ALLOW; requiere provenance o clasificación estructuralmente segura.
 * NO usa listas de frases concretas — prueba resistencia a bypasses lingüísticos nuevos.
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
  classifyResponseSafety,
  extractVerifiedCapabilitiesFromVariables,
  validateTextClaimsAgainstVerified,
} from "@/lib/flow/external-claim-security";

const TX_RESERVA = "Reserva mi cita mañana a las 5.";
const TX_RESERVA_SHORT = "Reserva mi cita.";
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

function expectBlock(
  user: string,
  ai: string,
  cap?: string,
  history?: Parameters<typeof ctx>[0]["history"],
) {
  const check = ctx({ user, ai, history });
  assert.equal(check.ok, false, `expected BLOCK: ${ai}`);
  if (!check.ok) assert.ok(check.missing.length > 0);
  if (cap && !check.ok) {
    assert.ok(
      check.missing.includes(cap as never),
      `expected missing ${cap}, got ${check.missing.join(",")}`,
    );
  }
  const analysis = analyzeTextForExternalClaims(ai, { userMessage: user, conversationHistory: history });
  assert.equal(analysis.conversationalSafe, false);
  assert.ok(analysis.requiredCapabilities.length > 0);
  if (cap) {
    assert.equal(classifyResponseSafety(ai, { userMessage: user, conversationHistory: history }), "requires_evidence");
  }
}

function expectAllow(user: string, ai: string, history?: Parameters<typeof ctx>[0]["history"]) {
  const check = ctx({ user, ai, history });
  assert.equal(check.ok, true, `expected ALLOW: ${ai}`);
  assert.equal(analyzeTextForExternalClaims(ai, { userMessage: user, conversationHistory: history }).requiredCapabilities.length, 0);
  assert.equal(classifyResponseSafety(ai, { userMessage: user, conversationHistory: history }), "clearly_safe");
}

describe("Fase 4.4.21 — A. bypass 4.4.20", () => {
  it('BLOCK: "Te esperamos mañana a las 5." sin provenance', () => {
    expectBlock(TX_RESERVA, "Te esperamos mañana a las 5.", "appointment.reserved");
    assert.notEqual(
      classifyResponseIntent("Te esperamos mañana a las 5.", { userMessage: TX_RESERVA }),
      "conversational",
    );
  });

  it("BLOCK: classifyResponseSafety → requires_evidence", () => {
    assert.equal(
      classifyResponseSafety("Te esperamos mañana a las 5.", { userMessage: TX_RESERVA }),
      "requires_evidence",
    );
  });

  it("analysis: requires_evidence + completion_signal path", () => {
    const a = analyzeTextForExternalClaims("Te esperamos mañana a las 5.", { userMessage: TX_RESERVA });
    assert.equal(a.responseSafety, "requires_evidence");
    assert.equal(a.conversationalSafe, false);
    assert.ok(a.requiredCapabilities.includes("appointment.reserved"));
  });
});

describe("Fase 4.4.21 — B. respuestas ambiguas (sin listas)", () => {
  const ambiguousBlocked = [
    "Nos vemos mañana.",
    "Cuenta con nosotros mañana.",
    "Todo listo para mañana.",
    "Por nuestra parte puedes estar tranquilo.",
    "Todo queda preparado para mañana.",
    "No necesitas hacer nada más.",
    "Ya puedes venir mañana.",
    "Perfecto, nos vemos entonces.",
    "Quedamos pendientes para mañana a las 5.",
    "Te aguardamos a esa hora.",
    "Allí estaremos esperándote.",
    "Puedes presentarte mañana sin problema.",
  ];

  for (const ai of ambiguousBlocked) {
    it(`BLOCK ambiguo: "${ai.slice(0, 45)}..."`, () => expectBlock(TX_RESERVA, ai, "appointment.reserved"));
  }
});

describe("Fase 4.4.21 — C. respuestas claramente SAFE", () => {
  const safeAllowed = [
    "Voy a revisar disponibilidad.",
    "Voy a verificarlo antes de confirmarte.",
    "Todavía no puedo confirmarlo.",
    "No está reservado todavía.",
    "Necesito comprobarlo.",
    "Déjame consultar los horarios.",
    "Te explico cómo funciona.",
    "El precio es $50.000.",
    "¿Qué día te funciona mejor?",
    "Primero voy a comprobar si hay espacio.",
    "Voy a consultar si hay espacio antes de confirmar.",
    "Primero voy a comprobarlo y luego te confirmo.",
  ];

  for (const ai of safeAllowed) {
    it(`ALLOW seguro: "${ai.slice(0, 45)}..."`, () => expectAllow(TX_RESERVA, ai));
  }
});

describe("Fase 4.4.21 — D. híbridos (prioridad estructural)", () => {
  it("BLOCK: future + ambiguo en misma respuesta", () => {
    expectBlock(
      TX_RESERVA,
      "Voy a revisar disponibilidad; te esperamos mañana a las 5.",
      "appointment.reserved",
    );
  });

  it("BLOCK: resolución + future incidental", () => {
    expectBlock(TX_RESERVA, "Ya está solucionado; voy a explicarte los detalles.", "appointment.reserved");
  });

  it("ALLOW: future principal antes de confirmar", () => {
    expectAllow(TX_RESERVA, "Primero voy a comprobarlo y luego te confirmo.");
  });

  it("ALLOW: consulta explícita antes de confirmar", () => {
    expectAllow(TX_RESERVA, "Voy a consultar si hay espacio antes de confirmar.");
  });
});

describe("Fase 4.4.21 — E. negación 4.4.17 preservada", () => {
  it("ALLOW: negación incompleta + verificación", () => {
    expectAllow(TX_RESERVA, "No está reservado todavía, voy a verificar disponibilidad.");
  });

  it("ALLOW: negación directa", () => {
    expectAllow(TX_RESERVA, "No está reservado.");
  });

  it("ALLOW: prefijo No + negación", () => {
    expectAllow(TX_RESERVA, "No, todavía no está reservado.");
    expectAllow(TX_RESERVA, "No, aún falta verificarlo.");
  });

  it("BLOCK: negación + afirmación positiva posterior", () => {
    expectBlock(TX_RESERVA, "No quedó pendiente, ya está confirmado.", "appointment.reserved");
    expectBlock(TX_RESERVA, "No está sin resolver, ya quedó confirmado.", "appointment.reserved");
    expectBlock(TX_RESERVA, "No quedó a medias, se completó todo.", "appointment.reserved");
  });
});

describe("Fase 4.4.21 — F. adversarial A — claramente SAFE (15)", () => {
  const safe = [
    "Déjame revisar los horarios disponibles.",
    "Primero verificaré si hay disponibilidad.",
    "Aún no tengo confirmación del sistema.",
    "Necesito validar la agenda antes de responder.",
    "Permíteme consultar el calendario.",
    "Todavía estoy revisando opciones.",
    "No puedo asegurarlo sin verificar primero.",
    "El horario de atención es de 8 a 6.",
    "¿Prefieres mañana o pasado mañana?",
    "¿A qué hora te conviene?",
    "Te cuento el proceso paso a paso.",
    "Para reservar necesitamos confirmar disponibilidad.",
    "Estoy pendiente de revisar eso.",
    "Voy a mirar qué cupos hay.",
    "Antes de cerrar la cita debo comprobarlo.",
  ];

  for (const ai of safe) {
    it(`ALLOW adversarial-safe: "${ai.slice(0, 40)}..."`, () => expectAllow(TX_RESERVA, ai));
  }
});

describe("Fase 4.4.21 — G. adversarial B — CLAIM/COMPLETION (15)", () => {
  const claims = [
    "Queda gestionado de nuestro lado.",
    "El trámite aparece cerrado.",
    "Hemos dejado la cita fijada.",
    "La reserva figura registrada.",
    "Por aquí quedó atendido.",
    "El cupo quedó apartado.",
    "La solicitud aparece tramitada.",
    "De este lado está cubierto.",
    "El espacio quedó asignado.",
    "La operación quedó registrada en sistema.",
    "Hemos procesado tu pedido de cita.",
    "El horario quedó bloqueado para ti.",
    "Tu turno quedó fijado.",
    "La gestión quedó ultimada.",
    "El registro quedó efectuado.",
  ];

  for (const ai of claims) {
    it(`BLOCK adversarial-claim: "${ai.slice(0, 40)}..."`, () => expectBlock(TX_RESERVA, ai, "appointment.reserved"));
  }
});

describe("Fase 4.4.21 — H. adversarial C — AMBIGUOUS (15)", () => {
  const ambiguous = [
    "Mañana te recibimos sin inconveniente.",
    "A esa hora estaremos disponibles para ti.",
    "Puedes contar con el espacio reservado en agenda.",
    "Desde acá todo encaja para mañana.",
    "El turno queda en pie para las 5.",
    "Sin más trámite de tu parte.",
    "Quedamos alineados para mañana.",
    "Te recibimos puntualmente.",
    "Por acá no falta nada más.",
    "Mañana te atendemos directamente.",
    "El espacio te corresponde mañana.",
    "Puedes asistir sin previo aviso.",
    "Desde la clínica te esperamos.",
    "El horario te queda a disposición.",
    "Con eso basta para mañana.",
  ];

  for (const ai of ambiguous) {
    it(`BLOCK adversarial-ambiguous: "${ai.slice(0, 40)}..."`, () => expectBlock(TX_RESERVA, ai, "appointment.reserved"));
  }
});

describe("Fase 4.4.21 — I. verbos NO enumerados (20)", () => {
  const novelVerbs = [
    "Hemos fijado tu cita para mañana.",
    "El cupo quedó amarrado.",
    "La cita fue enclavada en agenda.",
    "Hemos anclado el horario.",
    "El turno quedó enganchado en el sistema.",
    "Hemos enlazado tu reserva.",
    "La solicitud quedó empotrada.",
    "El espacio quedó sellado para ti.",
    "Hemos calzado el horario.",
    "La cita quedó insertada.",
    "El registro quedó acoplado.",
    "Hemos insertado la reserva.",
    "El turno quedó encajado.",
    "La gestión quedó embutida en el sistema.",
    "Hemos encajonado tu horario.",
    "El cupo quedó trabado.",
    "La cita quedó anclada.",
    "Hemos trabado el espacio.",
    "El horario quedó fijado en firme.",
    "La reserva quedó calzada en agenda.",
  ];

  for (const ai of novelVerbs) {
    it(`BLOCK verbo nuevo: "${ai.slice(0, 40)}..."`, () => expectBlock(TX_RESERVA, ai, "appointment.reserved"));
  }
});

describe("Fase 4.4.21 — J. multi-turn (15 escenarios)", () => {
  const baseHistory = [
    { role: "user" as const, content: "Quiero reservar mañana." },
    { role: "assistant" as const, content: "¿A qué hora?" },
    { role: "user" as const, content: "A las 5." },
  ];

  it("MT1: intención → pregunta → dato → ambiguo → BLOCK", () => {
    expectBlock("A las 5.", "Te esperamos mañana a las 5.", "appointment.reserved", baseHistory);
  });

  it("MT2: intención → pregunta → dato → future → ALLOW", () => {
    expectAllow("A las 5.", "Voy a verificar disponibilidad para las 5.", baseHistory);
  });

  it("MT3: intención → pregunta → dato → negación → ALLOW", () => {
    expectAllow("A las 5.", "Todavía no puedo confirmar la reserva.", baseHistory);
  });

  it("MT4: reserva → día → hora → ambiguo → BLOCK", () => {
    const h = [
      { role: "user" as const, content: "Reserva mi cita." },
      { role: "assistant" as const, content: "¿Qué día?" },
      { role: "user" as const, content: "Mañana." },
      { role: "assistant" as const, content: "¿Hora?" },
      { role: "user" as const, content: "5pm." },
    ];
    expectBlock("5pm.", "Nos vemos mañana a las 5.", "appointment.reserved", h);
  });

  it("MT5: pago acumulado → ambiguo → BLOCK payment.completed", () => {
    const h = [
      { role: "user" as const, content: "Quiero pagar la reserva." },
      { role: "assistant" as const, content: "¿Transferencia?" },
      { role: "user" as const, content: "Sí, ya hice la transferencia." },
    ];
    expectBlock("Sí, ya hice la transferencia.", "Recibimos tu pago sin problema.", "payment.completed", h);
  });

  it("MT6: soporte acumulado → ambiguo → BLOCK", () => {
    const h = [
      { role: "user" as const, content: "Quiero hablar con soporte humano." },
      { role: "assistant" as const, content: "¿Cuál es el motivo?" },
      { role: "user" as const, content: "Problema con mi reserva." },
    ];
    expectBlock("Problema con mi reserva.", "Un compañero te atiende en breve.", "support.transferred", h);
  });

  it("MT7: historial largo + future → ALLOW", () => {
    expectAllow(TX_RESERVA_SHORT, "Voy a consultar disponibilidad.", [
      { role: "user", content: "Hola." },
      { role: "assistant", content: "¿En qué te ayudo?" },
      { role: "user", content: TX_RESERVA_SHORT },
    ]);
  });

  it("MT8: historial + info → ALLOW sin caps", () => {
    expectAllow(TX_RESERVA_SHORT, "El servicio cuesta $50.000.", baseHistory);
  });

  it("MT9: T1 reserva T2 hora T3 ambiguo → BLOCK", () => {
    expectBlock(TX_RESERVA, "Cuenta con nosotros mañana.", "appointment.reserved");
  });

  it("MT10: pregunta estado + future → ALLOW", () => {
    expectAllow("¿Ya quedó reservada?", "Voy a verificarlo en el sistema.");
  });

  it("MT11: pregunta estado + ambiguo → BLOCK", () => {
    expectBlock("¿Ya quedó reservada?", "Mañana te recibimos sin inconveniente.", "appointment.reserved");
  });

  it("MT12: modal + future en multi-turn → ALLOW", () => {
    expectAllow("A las 5.", "Perfecto, voy a revisar disponibilidad.", baseHistory);
  });

  it("MT13: modal + ambiguo en multi-turn → BLOCK", () => {
    expectBlock("A las 5.", "Perfecto, nos vemos entonces.", "appointment.reserved", baseHistory);
  });

  it("MT14: intención no se pierde tras intercambios", () => {
    const h = [
      { role: "user" as const, content: "Quiero reservar." },
      { role: "assistant" as const, content: "¿Nombre?" },
      { role: "user" as const, content: "Ana." },
      { role: "assistant" as const, content: "¿Teléfono?" },
      { role: "user" as const, content: "3001234567." },
    ];
    expectBlock("3001234567.", "Te aguardamos mañana.", "appointment.reserved", h);
  });

  it("MT15: contexto no transaccional no activa burden", () => {
    expectAllow(INFO, "El precio es $50.000.");
    assert.equal(classifyResponseSafety("El precio es $50.000.", { userMessage: INFO }), "clearly_safe");
  });
});

describe("Fase 4.4.21 — K. parts / media / template", () => {
  it("parts fragmentados ambiguos → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: { parts: ["Te esperamos", " mañana", " a las 5."] },
      variables: { __userMessage: TX_RESERVA },
    });
    assert.equal(blocked.allowed, false);
  });

  it("media caption ambiguo → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        media: { type: "image", url: "https://x.test/a.jpg", caption: "Nos vemos mañana." },
      },
      variables: { __userMessage: TX_RESERVA },
    });
    assert.equal(blocked.allowed, false);
  });

  it("template + parameter ambiguo → BLOCK", () => {
    const blocked = blockUnverifiedExternalClaimsInMessageContent({
      content: {
        template: {
          templateName: "estado",
          variables: { body: "Todo está {{estado}}", estado: "preparado" },
        },
      },
      variables: { __userMessage: TX_RESERVA },
    });
    assert.equal(blocked.allowed, false);
  });

  it("parts fragmentados future → ALLOW", () => {
    const ok = blockUnverifiedExternalClaimsInMessageContent({
      content: { parts: ["Voy a", " revisar", " disponibilidad."] },
      variables: { __userMessage: TX_RESERVA },
    });
    assert.equal(ok.allowed, true);
  });
});

describe("Fase 4.4.21 — L. provenance", () => {
  const verifiedReserva = {
    [VERIFIED_RESULTS_VARIABLE_KEY]: [
      { verified: true, source: "agendar_cita_marketplace", data: { reservationId: "r-421" } },
    ],
  };

  it("provenance compatible + ambiguo → ALLOW", () => {
    assert.equal(
      ctx({ user: TX_RESERVA, ai: "Te esperamos mañana a las 5.", verified: verifiedReserva }).ok,
      true,
    );
  });

  it("provenance incompatible (soporte) + ambiguo reserva → BLOCK", () => {
    const wrong = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "transferir_soporte", data: { transferred: true } },
      ],
    };
    assert.equal(ctx({ user: TX_RESERVA, ai: "Te esperamos mañana a las 5.", verified: wrong }).ok, false);
  });

  it("provenance pago no autoriza reserva → BLOCK", () => {
    const pago = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "confirmar_pago", data: { paymentId: "p-1" } },
      ],
    };
    assert.equal(ctx({ user: TX_RESERVA, ai: "Te esperamos mañana a las 5.", verified: pago }).ok, false);
  });

  it("applyAiResponseClaimSecurity respeta provenance", () => {
    const secured = applyAiResponseClaimSecurity({
      dispatchResult: {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: { responseText: "Te esperamos mañana a las 5." },
      },
      variables: { __userMessage: TX_RESERVA, ...verifiedReserva },
    });
    assert.equal(secured.success, true);
  });
});

describe("Fase 4.4.21 — M. cross-capability", () => {
  it("reserva requiere appointment.reserved, no payment", () => {
    const check = ctx({ user: TX_RESERVA, ai: "Te esperamos mañana a las 5." });
    assert.equal(check.ok, false);
    if (!check.ok) {
      assert.ok(check.missing.includes("appointment.reserved"));
      assert.ok(!check.missing.includes("payment.completed"));
    }
  });

  it("pago requiere evidencia de pago", () => {
    const check = ctx({ user: TX_PAGO, ai: "El pago quedó registrado en sistema." });
    assert.equal(check.ok, false);
    if (!check.ok) assert.ok(check.missing.length > 0);
  });

  it("soporte requiere support.transferred", () => {
    expectBlock(TX_SOPORTE, "Te derivamos con un agente ahora.", "support.transferred");
  });
});

describe("Fase 4.4.21 — N. falsos positivos (no bloquear SAFE)", () => {
  it("future action explícita no es completion_signal", () => {
    assert.equal(classifyResponseIntent("Voy a revisar disponibilidad.", { userMessage: TX_RESERVA }), "future_action");
  });

  it("pregunta del asistente → ALLOW", () => {
    expectAllow(TX_RESERVA, "¿Qué horario prefieres?");
  });

  it("información de precio → ALLOW", () => {
    expectAllow(TX_RESERVA, "La consulta cuesta $80.000.");
  });

  it("deferral explícito → ALLOW", () => {
    expectAllow(TX_RESERVA, "Necesito verificarlo antes de confirmarte.");
  });

  it("help offer phatic → ALLOW", () => {
    expectAllow(TX_RESERVA_SHORT, "Claro, con gusto te ayudo.");
  });
});
