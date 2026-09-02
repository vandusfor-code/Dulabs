/**
 * Regresiones de los Bugs raíz #2 y #3 (Claim Security), auditoría E2E Daniela.
 *
 * BUG #2 — pregunta ≠ afirmación de confirmación.
 *   Causa raíz: una proposición INTERROGATIVA no estaba exenta de la detección
 *   de "completitud positiva". Verbos morfológicamente ambiguos entre presente
 *   y pretérito en 1ª pers. plural (confirmamos/reservamos/agendamos) hacían
 *   que PAST_COMPLETION_PATTERN leyera la PREGUNTA "¿Confirmamos la cita?" como
 *   la AFIRMACIÓN "confirmamos la cita" y exigiera appointment.reserved.
 *   Fix: isPropositionPositiveCompletion retorna false si la proposición es
 *   interrogativa (¿/? conservados por normalizeText).
 *
 * BUG #3 — capabilities dedicadas de cancelar/mover.
 *   Causa raíz: cancelar_cita_especialista / mover_cita_especialista no estaban
 *   en SOURCE_TO_ACTION ni declaraban verifiesOnSuccess -> una operación real y
 *   exitosa no otorgaba NINGUNA capability, así que la afirmación veraz "tu cita
 *   fue cancelada"/"quedó reagendada" quedaba bloqueada para siempre.
 *   Fix: capabilities dedicadas appointment.cancelled / appointment.rescheduled,
 *   cableadas por verifiesOnSuccess + SOURCE_TO_ACTION, con reglas de dominio de
 *   participio que exigen la capability CORRECTA (nunca reserved/available).
 *
 * BUG #4 — propuesta condicional ("sería") no es afirmación de reserva.
 *   Causa raíz: isHypotheticalOrPossibilityFrame solo reconoce "sería/podría/tal
 *   vez" cuando ENCABEZAN la cláusula. La propuesta real de Daniela dice
 *   "Tu cita SERÍA: [datos]. ¿Confirmas?" -- el condicional va DESPUÉS del
 *   sujeto, así que ninguna categoría de isPropositionClearlySafe lo reconocía,
 *   y "cita" disparaba appointment.reserved sin que existiera evidencia de
 *   reserva (solo había evidencia de disponibilidad consultada).
 *   Fix: isConditionalProposalFrame reconoce el condicional de "ser"
 *   (sería/serían) en CUALQUIER posición de la proposición -- morfológico, no
 *   una frase exacta -- con la MISMA guarda que toda otra categoría "clearly
 *   safe" del archivo: dejar de ser segura si la proposición TAMBIÉN afirma un
 *   estado terminal en otra parte (hasTerminalStateTokens).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { VERIFIED_RESULTS_VARIABLE_KEY } from "@/lib/flow/ai-runtime/verified-results";
import {
  analyzeTextForExternalClaims,
  classifyResponseSafety,
  detectDomainCapabilities,
  extractVerifiedCapabilitiesFromVariables,
  validateTextClaimsAgainstVerified,
  type ClaimSecurityContext,
} from "@/lib/flow/external-claim-security";
import type { AssertionCapability } from "@/lib/flow/types";

// Contexto transaccional real: la clienta pidió agendar. Es el contexto EXACTO
// en el que la IA responde con "¿Deseas confirmar la cita?" o "Tu cita quedó
// confirmada." -- por eso requiresEvidenceForModalAck está activo.
const AGENDAR_CTX: ClaimSecurityContext = {
  userMessage: "Quiero agendar una cita de manos el miércoles a las 5",
  source: "ai_response",
};
const CANCELAR_CTX: ClaimSecurityContext = { userMessage: "Quiero cancelar mi cita", source: "ai_response" };
const MOVER_CTX: ClaimSecurityContext = {
  userMessage: "Quiero cambiar mi cita para el viernes a las 5",
  source: "ai_response",
};

function verified(source: string, data: Record<string, unknown>) {
  return { [VERIFIED_RESULTS_VARIABLE_KEY]: [{ verified: true, source, data }] };
}

function caps(source: string, data: Record<string, unknown>): Set<AssertionCapability> {
  return extractVerifiedCapabilitiesFromVariables(verified(source, data));
}

// ============================================================================
// BUG #2 — pregunta ≠ afirmación
// ============================================================================
describe("Bug raíz #2 — pregunta de confirmación NO es afirmación de confirmación", () => {
  const PREGUNTAS = [
    "¿Deseas confirmar la cita?",
    "¿Quieres confirmar la cita?",
    "¿Deseas confirmar tu cita?",
    "¿Confirmamos la cita?", // <- caso que fallaba (homógrafo presente/pretérito)
    "¿Reservamos el miércoles a las 5?", // <- mismo homógrafo
    "¿Agendamos para el viernes?", // <- mismo homógrafo
    "¿Quieres que confirme tu cita?",
    "¿Te gustaría confirmar la cita?",
  ];

  for (const pregunta of PREGUNTAS) {
    it(`PREGUNTA no exige evidencia: "${pregunta}"`, () => {
      assert.equal(classifyResponseSafety(pregunta, AGENDAR_CTX), "clearly_safe");
      const a = analyzeTextForExternalClaims(pregunta, AGENDAR_CTX);
      assert.equal(a.conversationalSafe, true, "una pregunta nunca afirma una reserva");
      assert.deepEqual(a.requiredCapabilities, []);
    });
  }

  const AFIRMACIONES = [
    "Tu cita quedó confirmada.",
    "La cita está confirmada.",
    "He confirmado tu cita.",
    "Tu cita fue confirmada correctamente.",
  ];

  for (const afirmacion of AFIRMACIONES) {
    it(`AFIRMACIÓN sigue exigiendo appointment.reserved: "${afirmacion}"`, () => {
      assert.equal(classifyResponseSafety(afirmacion, AGENDAR_CTX), "requires_evidence");
      const a = analyzeTextForExternalClaims(afirmacion, AGENDAR_CTX);
      assert.equal(a.conversationalSafe, false);
      assert.deepEqual(a.requiredCapabilities, ["appointment.reserved"]);
    });
  }

  it("AFIRMACIÓN protegida se DESBLOQUEA con evidencia real de reserva", () => {
    const ok = validateTextClaimsAgainstVerified(
      "Tu cita quedó confirmada.",
      caps("agendar_cita_especialista", { citaId: 1, status: "confirmada" }),
      AGENDAR_CTX,
    );
    assert.equal(ok.ok, true);
  });

  it("PREGUNTA + AFIRMACIÓN en una misma respuesta: la cláusula afirmativa sigue exigiendo evidencia (no fail-open)", () => {
    const texto = "¿Qué hora prefieres? Tu cita quedó confirmada.";
    const a = analyzeTextForExternalClaims(texto, AGENDAR_CTX);
    assert.equal(a.conversationalSafe, false, "la 2ª cláusula NO es pregunta: afirma una reserva");
    assert.deepEqual(a.requiredCapabilities, ["appointment.reserved"]);
  });

  it("PREGUNTA interrogada sin evidencia NO se bloquea aunque el verbo sea homógrafo", () => {
    // Sin fix, "confirmamos" (pretérito = presente) disparaba requires_evidence.
    const v = validateTextClaimsAgainstVerified("¿Confirmamos la cita?", new Set(), AGENDAR_CTX);
    assert.equal(v.ok, true);
  });
});

// ============================================================================
// BUG #3 — capabilities dedicadas cancelar/mover
// ============================================================================
describe("Bug raíz #3 — evidencia y capabilities dedicadas de cancelar/mover", () => {
  it("cancelar_cita_especialista verificada otorga SOLO appointment.cancelled", () => {
    const c = caps("cancelar_cita_especialista", { citaId: 1, cancelada: true });
    assert.equal(c.has("appointment.cancelled"), true);
    assert.equal(c.has("appointment.reserved"), false, "cancelar NO genera evidencia de creación");
    assert.equal(c.has("appointment.available"), false);
    assert.equal(c.has("appointment.rescheduled"), false);
    assert.equal(c.size, 1);
  });

  it("mover_cita_especialista verificada otorga SOLO appointment.rescheduled", () => {
    const c = caps("mover_cita_especialista", { citaId: 1, movida: true, inicio: "2027-01-01T10:00:00" });
    assert.equal(c.has("appointment.rescheduled"), true);
    assert.equal(c.has("appointment.reserved"), false);
    assert.equal(c.has("appointment.available"), false, "mover NO genera evidencia de disponibilidad");
    assert.equal(c.has("appointment.cancelled"), false);
    assert.equal(c.size, 1);
  });

  it("verified:false NO otorga ninguna capability (cancelar/mover)", () => {
    const cancel = extractVerifiedCapabilitiesFromVariables({
      [VERIFIED_RESULTS_VARIABLE_KEY]: [{ verified: false, source: "cancelar_cita_especialista", data: { citaId: 1, cancelada: true } }],
    });
    const mover = extractVerifiedCapabilitiesFromVariables({
      [VERIFIED_RESULTS_VARIABLE_KEY]: [{ verified: false, source: "mover_cita_especialista", data: { citaId: 1, movida: true } }],
    });
    assert.equal(cancel.size, 0);
    assert.equal(mover.size, 0);
  });

  it("afirmación de cancelación exige appointment.cancelled (participio y pretérito, NO infinitivo/imperativo)", () => {
    assert.deepEqual(detectDomainCapabilities("Tu cita fue cancelada"), ["appointment.cancelled"]);
    assert.deepEqual(detectDomainCapabilities("Cancelé tu cita"), ["appointment.cancelled"]);
    assert.deepEqual(detectDomainCapabilities("Tu cita quedó cancelada"), ["appointment.cancelled"]);
    // Infinitivo / imperativo NO afirman un hecho consumado -> no exigen nada.
    assert.deepEqual(detectDomainCapabilities("No pude cancelar tu cita"), []);
    assert.deepEqual(detectDomainCapabilities("¿Quieres cancelar la cita?"), []);
  });

  it("afirmación de reagendamiento exige appointment.rescheduled (participios), nunca reserved/available", () => {
    for (const t of [
      "Tu cita quedó reagendada para el viernes",
      "Tu cita fue movida al viernes",
      "Tu cita quedó cambiada",
      "Tu cita fue reprogramada",
    ]) {
      assert.deepEqual(detectDomainCapabilities(t), ["appointment.rescheduled"], t);
    }
  });

  it("CANCELAR: exitosa -> la afirmación 'tu cita fue cancelada' se permite; sin evidencia o con evidencia ajena se bloquea", () => {
    const claim = "Tu cita fue cancelada.";
    assert.deepEqual(analyzeTextForExternalClaims(claim, CANCELAR_CTX).requiredCapabilities, ["appointment.cancelled"]);
    assert.equal(validateTextClaimsAgainstVerified(claim, caps("cancelar_cita_especialista", { citaId: 1, cancelada: true }), CANCELAR_CTX).ok, true);
    assert.equal(validateTextClaimsAgainstVerified(claim, new Set(), CANCELAR_CTX).ok, false);
    assert.equal(validateTextClaimsAgainstVerified(claim, caps("agendar_cita_especialista", { citaId: 1, status: "confirmada" }), CANCELAR_CTX).ok, false, "evidencia de creación no satisface una cancelación");
    assert.equal(validateTextClaimsAgainstVerified(claim, caps("mover_cita_especialista", { citaId: 1, movida: true }), CANCELAR_CTX).ok, false, "evidencia de movimiento no satisface una cancelación");
  });

  it("MOVER: exitosa -> la afirmación 'tu cita quedó reagendada' se permite; sin evidencia o con evidencia ajena se bloquea", () => {
    const claim = "Tu cita quedó reagendada para el viernes a las 5.";
    assert.deepEqual(analyzeTextForExternalClaims(claim, MOVER_CTX).requiredCapabilities, ["appointment.rescheduled"]);
    assert.equal(validateTextClaimsAgainstVerified(claim, caps("mover_cita_especialista", { citaId: 1, movida: true }), MOVER_CTX).ok, true);
    assert.equal(validateTextClaimsAgainstVerified(claim, new Set(), MOVER_CTX).ok, false);
    assert.equal(validateTextClaimsAgainstVerified(claim, caps("cancelar_cita_especialista", { citaId: 1, cancelada: true }), MOVER_CTX).ok, false, "evidencia de cancelación no satisface un reagendamiento");
    assert.equal(validateTextClaimsAgainstVerified(claim, caps("agendar_cita_especialista", { citaId: 1, status: "confirmada" }), MOVER_CTX).ok, false, "evidencia de creación no satisface un reagendamiento");
  });

  it("una CREACIÓN real no puede afirmarse con evidencia de cancelación (aislamiento inverso)", () => {
    const ok = validateTextClaimsAgainstVerified(
      "Tu cita quedó agendada para el viernes.",
      caps("cancelar_cita_especialista", { citaId: 1, cancelada: true }),
      AGENDAR_CTX,
    );
    assert.equal(ok.ok, false);
    if (!ok.ok) assert.ok(ok.missing.includes("appointment.reserved"));
  });
});

// ============================================================================
// BUG #4 — propuesta condicional ("sería") no es afirmación de reserva
// ============================================================================
describe("Bug raíz #4 — propuesta condicional ('sería') vs. afirmación real de reserva", () => {
  // Texto real del nodo q-confirmar-cita (daniela-agendar-cita.flow.ts),
  // interpolado con datos de ejemplo -- ver ese archivo para el original.
  const PROPUESTA_REAL =
    "Perfecto 💚 Tu cita sería:\n\n" +
    "💅 Semipermanente\n" +
    "📅 2026-09-05\n" +
    "🕓 16:00\n" +
    "👩 Carla\n\n" +
    "¿Confirmas tu cita?";

  it("1. CASO POSITIVO -- la propuesta ('sería' + pregunta de confirmación) NO exige appointment.reserved", () => {
    const a = analyzeTextForExternalClaims(PROPUESTA_REAL, AGENDAR_CTX);
    assert.equal(classifyResponseSafety(PROPUESTA_REAL, AGENDAR_CTX), "clearly_safe");
    assert.equal(a.conversationalSafe, true, "una propuesta no afirma una reserva ya hecha");
    assert.deepEqual(a.requiredCapabilities, []);
  });

  it("2. la propuesta se puede mostrar tras consultar disponibilidad, incluso SIN evidencia de reserva", () => {
    // Evidencia real disponible en ese punto del flow: solo se consultó
    // disponibilidad (listar_horarios_disponibles_especialista) -- todavía
    // NO existe ninguna fila real en dulabs_citas_especialista.
    const conEvidenciaDisponibilidad = caps("listar_horarios_disponibles_especialista", {
      horariosDisponibles: ["16:00", "17:00"],
    });
    assert.equal(validateTextClaimsAgainstVerified(PROPUESTA_REAL, conEvidenciaDisponibilidad, AGENDAR_CTX).ok, true);
    // Ni siquiera hace falta esa evidencia -- la propuesta es segura por
    // estructura, no porque "tome prestada" una capability que no le
    // corresponde (appointment.available nunca sustituye a reserved; acá
    // simplemente no se exige NINGUNA).
    assert.equal(validateTextClaimsAgainstVerified(PROPUESTA_REAL, new Set(), AGENDAR_CTX).ok, true);
  });

  it("3. CASO NEGATIVO (control) -- una afirmación REAL de reserva sigue bloqueada sin evidencia, aunque también use 'sería' en otra cláusula", () => {
    // Adversarial: "sería" aparece en el texto, pero OTRA cláusula del mismo
    // mensaje afirma un hecho consumado ("quedó confirmada de una vez") --
    // la propuesta condicional NUNCA debe servir de cobertura para colar una
    // afirmación real sin evidencia.
    const mezcla = "Tu cita sería a las 4, pero ya te cuento que quedó confirmada de una vez.";
    const a = analyzeTextForExternalClaims(mezcla, AGENDAR_CTX);
    assert.equal(classifyResponseSafety(mezcla, AGENDAR_CTX), "requires_evidence");
    assert.equal(a.conversationalSafe, false, "la cláusula de completitud real sigue exigiendo evidencia");
    assert.deepEqual(a.requiredCapabilities, ["appointment.reserved"]);
    assert.equal(validateTextClaimsAgainstVerified(mezcla, new Set(), AGENDAR_CTX).ok, false);
    // Tampoco basta evidencia de disponibilidad -- acá SÍ hace falta reserved real.
    assert.equal(
      validateTextClaimsAgainstVerified(
        mezcla,
        caps("listar_horarios_disponibles_especialista", { horariosDisponibles: ["16:00"] }),
        AGENDAR_CTX,
      ).ok,
      false,
    );
    assert.equal(
      validateTextClaimsAgainstVerified(mezcla, caps("agendar_cita_especialista", { citaId: 1, status: "confirmada" }), AGENDAR_CTX)
        .ok,
      true,
      "con evidencia REAL de reserva sí se permite",
    );
  });

  it("4. CASO NEGATIVO (control) -- afirmaciones directas sin ningún condicional siguen exigiendo evidencia (no se debilitó nada más)", () => {
    for (const claim of [
      "Tu cita quedó confirmada.",
      "La cita está confirmada.",
      "Tu cita fue confirmada correctamente.",
    ]) {
      assert.equal(classifyResponseSafety(claim, AGENDAR_CTX), "requires_evidence", claim);
      assert.deepEqual(analyzeTextForExternalClaims(claim, AGENDAR_CTX).requiredCapabilities, ["appointment.reserved"], claim);
    }
  });

  it("5. 'sería' con estado terminal en la MISMA proposición (no en otra cláusula) tampoco se rescata", () => {
    // Un condicional pegado a un participio en la misma proposición no es
    // incertidumbre genuina -- sigue exigiendo evidencia real.
    const claim = "Tu cita sería la confirmada de las 4.";
    assert.equal(classifyResponseSafety(claim, AGENDAR_CTX), "requires_evidence");
  });

  it("6. forma plural del condicional ('serían') también se reconoce como propuesta -- no solo 'sería' singular", () => {
    const claim = "Las citas que tengo disponibles para esa hora serían estas. ¿Cuál te sirve?";
    // detectDomainCapabilities NO cambia -- "citas"/"disponibles" siguen
    // disparando ambas capabilities por presencia de palabra, como siempre.
    // Lo que cambia es que, con el condicional plural reconocido, ninguna
    // capability queda EXIGIDA: la propuesta es segura por estructura.
    assert.deepEqual(detectDomainCapabilities(claim).slice().sort(), ["appointment.available", "appointment.reserved"]);
    assert.equal(classifyResponseSafety(claim, AGENDAR_CTX), "clearly_safe");
    assert.deepEqual(analyzeTextForExternalClaims(claim, AGENDAR_CTX).requiredCapabilities, []);
  });
});
