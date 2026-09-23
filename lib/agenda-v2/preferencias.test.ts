import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buscarFechaEnFrase,
  leerPreferencias,
  valorPreferencias,
  combinarPreferencias,
  hayPreferencias,
  detectarPreguntaDeCatalogo,
  pareceUnaPregunta,
} from "@/lib/agenda-v2/preferencias";

// Miércoles 23 de septiembre de 2026.
const HOY = "2026-09-23";

describe("buscarFechaEnFrase -- fecha concreta DENTRO de una frase, con el parser determinista de siempre", () => {
  it("encuentra la fecha en cualquier posición", () => {
    assert.equal(buscarFechaEnFrase("¿tienes disponibilidad mañana?", HOY), "2026-09-24");
    assert.equal(buscarFechaEnFrase("quiero con Cristal el viernes", HOY), "2026-09-25");
    assert.equal(buscarFechaEnFrase("uñas para el 30 de septiembre porfa", HOY), "2026-09-30");
    assert.equal(buscarFechaEnFrase("hoy mismo si se puede", HOY), HOY);
    assert.equal(buscarFechaEnFrase("pasado mañana", HOY), "2026-09-25");
  });

  it("'en la mañana' es la franja, no el día de mañana; sin fecha -> null", () => {
    assert.equal(buscarFechaEnFrase("prefiero en la mañana", HOY), null);
    assert.equal(buscarFechaEnFrase("por la mañana", HOY), null);
    assert.equal(buscarFechaEnFrase("quiero con Cristal", HOY), null);
    assert.equal(buscarFechaEnFrase("el dipping", HOY), null);
    assert.equal(buscarFechaEnFrase("a las 3", HOY), null, "un número suelto nunca es una fecha");
  });
});

describe("preferencias guardadas en slot_seleccionado", () => {
  it("ida y vuelta, y el slot real de S5 nunca se confunde con preferencias", () => {
    const guardado = valorPreferencias({ profesionalNombre: "Cristal", fechaIso: "2026-09-25" });
    assert.deepEqual(leerPreferencias(guardado), { profesionalNombre: "Cristal", fechaIso: "2026-09-25" });
    assert.deepEqual(leerPreferencias({ fechaIso: "2026-09-25", hora: "15:00" }), {});
    assert.deepEqual(leerPreferencias(null), {});
    assert.deepEqual(leerPreferencias({ preferencias: { fechaIso: "no-es-fecha" } }), {});
    assert.equal(valorPreferencias({}), null);
  });

  it("combinar: lo más reciente gana y nunca se borra un dato con uno vacío", () => {
    assert.deepEqual(combinarPreferencias({ profesionalNombre: "Mary", fechaIso: "2026-09-24" }, { profesionalNombre: "Cristal" }), {
      profesionalNombre: "Cristal",
      fechaIso: "2026-09-24",
    });
    assert.equal(hayPreferencias({}), false);
    assert.equal(hayPreferencias({ horaMencion: "a las 4" }), true);
  });
});

describe("preguntas durante la reserva (solo deciden si vale la pena responder; nunca eligen nada)", () => {
  it("precio y duración", () => {
    assert.equal(detectarPreguntaDeCatalogo("¿Cuánto cuesta el dipping?"), "precio");
    assert.equal(detectarPreguntaDeCatalogo("y el precio?"), "precio");
    assert.equal(detectarPreguntaDeCatalogo("¿cuánto demora?"), "duracion");
    assert.equal(detectarPreguntaDeCatalogo("cuanto tiempo se demora"), "duracion");
    assert.equal(detectarPreguntaDeCatalogo("el viernes"), null);
  });

  it("forma de pregunta", () => {
    assert.equal(pareceUnaPregunta("¿qué incluye?"), true);
    assert.equal(pareceUnaPregunta("cuanto vale"), true);
    assert.equal(pareceUnaPregunta("hacen keratina"), true);
    assert.equal(pareceUnaPregunta("el viernes"), false);
    assert.equal(pareceUnaPregunta("2"), false);
    assert.equal(pareceUnaPregunta("sí"), false);
  });
});
