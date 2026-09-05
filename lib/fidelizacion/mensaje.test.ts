import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderizarMensajeFidelizacion } from "./mensaje";

const MENSAJE_PROVISIONAL = `Hola, {{nombre}} 💗

Hace unos días disfrutaste de {{servicio}} en AMORE y queríamos saber cómo has estado.

Cuando llegue el momento de volver a consentirte, aquí estaremos para ti. ✨

Con cariño,
AMORE`;

describe("renderizarMensajeFidelizacion (Fase 7) -- Prueba 11: variables renderizan correctamente", () => {
  it("sustituye {{nombre}}, {{servicio}} y {{dias}}", () => {
    const resultado = renderizarMensajeFidelizacion("Hola {{nombre}}, hace {{dias}} días de tu {{servicio}}.", {
      nombre: "Valentina",
      servicio: "Semipermanente manos",
      dias: 20,
    });
    assert.equal(resultado, "Hola Valentina, hace 20 días de tu Semipermanente manos.");
  });

  it("el mensaje provisional aprobado renderiza sin dejar llaves sin resolver", () => {
    const resultado = renderizarMensajeFidelizacion(MENSAJE_PROVISIONAL, { nombre: "Camila", servicio: "Uñas", dias: 20 });
    assert.ok(!resultado.includes("{{"));
    assert.ok(resultado.includes("Hola, Camila 💗"));
    assert.ok(resultado.includes("disfrutaste de Uñas en AMORE"));
  });

  it("nunca agrega descuentos, promociones ni botones de reserva por su cuenta", () => {
    const resultado = renderizarMensajeFidelizacion(MENSAJE_PROVISIONAL, { nombre: "X", servicio: "Y", dias: 1 });
    for (const prohibido of ["descuento", "promoción", "agenda tu cita", "%"]) {
      assert.ok(!resultado.toLowerCase().includes(prohibido));
    }
  });
});
