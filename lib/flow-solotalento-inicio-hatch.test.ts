import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { esMensajeInicioSolotalento } from "@/lib/flow-solotalento-inicio-hatch";

describe("esMensajeInicioSolotalento — reconocimiento determinista, sin IA", () => {
  it("reconoce el mensaje EXACTO de la página de WhatsApp Ads", () => {
    const texto =
      "Hola, Solotalento. Quiero conocer cómo pueden ayudar a mi organización a fortalecer su gestión, cumplimiento y desempeño. Me gustaría recibir información sobre sus soluciones y conversar sobre la que más se ajusta a nuestras necesidades.";
    assert.equal(esMensajeInicioSolotalento(texto), true);
  });

  it("no distingue mayúsculas/minúsculas", () => {
    assert.equal(esMensajeInicioSolotalento("SOLOTALENTO, QUIERO CONOCER sus servicios"), true);
  });

  it("NO reconoce un dígito de menú normal (1-7)", () => {
    for (const digito of ["1", "2", "3", "4", "5", "6", "7"]) {
      assert.equal(esMensajeInicioSolotalento(digito), false, `"${digito}" no debe reconocerse como inicio`);
    }
  });

  it("NO reconoce texto libre que no menciona ambas frases distintivas", () => {
    assert.equal(esMensajeInicioSolotalento("quiero conocer los precios"), false, "falta 'solotalento'");
    assert.equal(esMensajeInicioSolotalento("hola solotalento, necesito ayuda"), false, "falta 'quiero conocer'");
    assert.equal(esMensajeInicioSolotalento("hablar con un asesor"), false);
  });
});
