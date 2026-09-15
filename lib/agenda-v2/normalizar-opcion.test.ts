import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizarNumeroDeOpcion } from "@/lib/agenda-v2/normalizar-opcion";

describe("normalizarNumeroDeOpcion -- reconoce variantes reales de puntuación/prefijo alrededor de un número", () => {
  it("Test A/B (obligatorios) -- formatos reales que deben resolver el mismo número", () => {
    for (const texto of ["4", "4.", "4)", " 4", "4 ", " 4 ", "opción 4", "opcion 4", "la 4", "OPCIÓN 4", "La 4"]) {
      assert.equal(normalizarNumeroDeOpcion(texto), 4, `"${texto}" debe resolver el número 4`);
    }
  });

  it("otros números y otros prefijos/sufijos reales", () => {
    assert.equal(normalizarNumeroDeOpcion("1"), 1);
    assert.equal(normalizarNumeroDeOpcion("12"), 12);
    assert.equal(normalizarNumeroDeOpcion("el 2"), 2);
    assert.equal(normalizarNumeroDeOpcion("numero 3"), 3);
    assert.equal(normalizarNumeroDeOpcion("número 3"), 3);
    assert.equal(normalizarNumeroDeOpcion("7,"), 7);
  });

  it("Test G (obligatorio) -- un número dentro de una frase libre NUNCA se interpreta como opción", () => {
    for (const texto of ["Tengo disponibilidad a las 4.", "son las 4", "el 4 de julio", "somos 4 personas"]) {
      assert.equal(normalizarNumeroDeOpcion(texto), null, `"${texto}" nunca debe resolver un número de opción`);
    }
  });

  it("nunca acepta más de un prefijo encadenado", () => {
    assert.equal(normalizarNumeroDeOpcion("la opción 4"), null);
  });

  it("texto vacío, no numérico, o dígitos en medio de otra palabra -> null", () => {
    for (const texto of ["", "   ", "hola", "999abc", "cuatro", "4to"]) {
      assert.equal(normalizarNumeroDeOpcion(texto), null, `"${texto}" nunca debe resolver`);
    }
  });
});
