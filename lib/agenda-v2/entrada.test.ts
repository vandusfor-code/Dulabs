import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { esInicioDeAgendaV2, detectarIntencionGestionCitas } from "@/lib/agenda-v2/entrada";
import { CODIGO_ESCENARIO_AGENDAMIENTO, type EscenarioRow } from "@/lib/bot-escenarios/tipos";
import { AMORE_ESCENARIOS_SEED } from "@/lib/bot-escenarios/seed-amore";

const TENANT = "amore-test";
const ESCENARIOS: EscenarioRow[] = AMORE_ESCENARIOS_SEED.map((s, i) => ({ ...s, id: `e${i}`, tenantId: TENANT }));

describe("esInicioDeAgendaV2 -- reutiliza EXACTAMENTE las variantes reales de 070_agendamiento", () => {
  it("coincide con las 6 variantes reales sembradas", () => {
    for (const frase of ["quiero agendar", "quiero reservar", "quiero una cita", "necesito cita", "quiero sacar cita", "quiero separar"]) {
      assert.equal(esInicioDeAgendaV2(frase, ESCENARIOS), true, `"${frase}" debía disparar Agenda V2`);
    }
  });

  it("coincide en medio de una frase real (contains, no exact)", () => {
    assert.equal(esInicioDeAgendaV2("Hola, quiero una cita, necesito hacerme las uñas", ESCENARIOS), true);
    assert.equal(esInicioDeAgendaV2("Buenas, quiero agendar por favor", ESCENARIOS), true);
  });

  it("NUNCA falsos positivos con preguntas sobre citas (sección 4 del pedido)", () => {
    for (const frase of ["¿Cuánto cuesta una cita?", "¿Tienen citas?", "¿Cómo funciona lo de las citas?", "¿Qué es el Dipping?", "Hola", "cumpleaños", "cualquier cosa"]) {
      assert.equal(esInicioDeAgendaV2(frase, ESCENARIOS), false, `"${frase}" NUNCA debía disparar Agenda V2`);
    }
  });

  it("insensible a mayúsculas/acentos (mismo normalizeText que el resto del proyecto)", () => {
    assert.equal(esInicioDeAgendaV2("QUIERO UNA CITA", ESCENARIOS), true);
    assert.equal(esInicioDeAgendaV2("Necesito Cita urgente", ESCENARIOS), true);
  });

  it("si el tenant NO tiene sembrado el escenario de agendamiento, nunca activa Agenda V2 (multi-tenant, sección 15)", () => {
    const sinAgendamiento = ESCENARIOS.filter((e) => e.codigo !== CODIGO_ESCENARIO_AGENDAMIENTO);
    assert.equal(esInicioDeAgendaV2("quiero una cita", sinAgendamiento), false);
  });

  it("si el escenario de agendamiento existe pero está inactivo, nunca activa Agenda V2", () => {
    const inactivo = ESCENARIOS.map((e) => (e.codigo === CODIGO_ESCENARIO_AGENDAMIENTO ? { ...e, activo: false } : e));
    assert.equal(esInicioDeAgendaV2("quiero una cita", inactivo), false);
  });
});

describe("FASE 8 (autorizado) -- detectarIntencionGestionCitas: triggers FIJOS y controlados, nunca IA/fuzzy", () => {
  it("reconoce las 5 frases reales de ejemplo para CONSULTAR", () => {
    for (const frase of ["consultar mi cita", "ver mi cita", "qué cita tengo", "cuando tengo mi cita", "quiero ver mi cita"]) {
      assert.equal(detectarIntencionGestionCitas(frase), "consultar", `"${frase}" debía detectar consultar`);
    }
  });

  it("reconoce las 3 frases reales de ejemplo para CANCELAR", () => {
    for (const frase of ["cancelar mi cita", "quiero cancelar mi cita", "cancelar cita"]) {
      assert.equal(detectarIntencionGestionCitas(frase), "cancelar", `"${frase}" debía detectar cancelar`);
    }
  });

  it("reconoce las 5 frases reales de ejemplo para REPROGRAMAR", () => {
    for (const frase of ["reprogramar mi cita", "quiero cambiar mi cita", "cambiar mi cita", "quiero cambiar la fecha", "quiero cambiar el horario"]) {
      assert.equal(detectarIntencionGestionCitas(frase), "reprogramar", `"${frase}" debía detectar reprogramar`);
    }
  });

  it("coincide en medio de una frase real (contains), insensible a mayúsculas/acentos", () => {
    assert.equal(detectarIntencionGestionCitas("Hola, quiero cancelar mi cita porfa"), "cancelar");
    assert.equal(detectarIntencionGestionCitas("QUIERO VER MI CITA"), "consultar");
    assert.equal(detectarIntencionGestionCitas("Buenas, quiero cambiar la fecha de mi cita"), "reprogramar");
  });

  it("nunca usa IA semántica ni fuzzy: un mensaje que NO calza con ninguna frase controlada -> null", () => {
    for (const frase of ["Hola", "¿Cuánto cuesta?", "quiero una cita", "sí", "no sé", "gracias", "cumpleaños"]) {
      assert.equal(detectarIntencionGestionCitas(frase), null, `"${frase}" NUNCA debía disparar gestión de citas`);
    }
  });
});
