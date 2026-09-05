import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderizarMensajeComunicacion, formatearFechaComunicacion } from "./mensaje";

const CONFIRMACION = `¡Tu cita ha sido confirmada! 💗

Te esperamos para consentirte y disfrutar juntas de este momento especial.

Servicio: {{servicio}}
Profesional: {{profesional}}
Fecha: {{fecha}}
Hora: {{hora}}

Con cariño,
AMORE 💗`;

const RECORDATORIO = `Hola, {{nombre}} 💗

Queremos recordarte que mañana tienes una cita en AMORE.

Servicio: {{servicio}}
Profesional: {{profesional}}
Fecha: {{fecha}}
Hora: {{hora}}

Te esperamos. ✨

AMORE 💗`;

describe("renderizarMensajeComunicacion (Fase 8) -- Prueba 11: variables renderizan correctamente", () => {
  it("confirmación: sustituye servicio/profesional/fecha/hora", () => {
    const resultado = renderizarMensajeComunicacion(CONFIRMACION, {
      nombre: "", servicio: "Balayage + Corte", profesional: "Mary", fecha: "sábado, 21 de marzo", hora: "10:00 a. m.",
    });
    assert.ok(!resultado.includes("{{"));
    assert.ok(resultado.includes("Servicio: Balayage + Corte"));
    assert.ok(resultado.includes("Profesional: Mary"));
    assert.ok(resultado.includes("Fecha: sábado, 21 de marzo"));
    assert.ok(resultado.includes("Hora: 10:00 a. m."));
  });

  it("recordatorio: además sustituye {{nombre}}", () => {
    const resultado = renderizarMensajeComunicacion(RECORDATORIO, {
      nombre: "Valentina", servicio: "Uñas", profesional: "Cristal", fecha: "viernes, 20 de marzo", hora: "3:00 p. m.",
    });
    assert.ok(resultado.includes("Hola, Valentina 💗"));
    assert.ok(!resultado.includes("{{"));
  });

  it("nunca agrega descuentos, promociones ni botones de reserva por su cuenta", () => {
    const resultado = renderizarMensajeComunicacion(CONFIRMACION + RECORDATORIO, {
      nombre: "X", servicio: "Y", profesional: "Z", fecha: "F", hora: "H",
    });
    for (const prohibido of ["descuento", "promoción", "%"]) {
      assert.ok(!resultado.toLowerCase().includes(prohibido));
    }
  });
});

describe("formatearFechaComunicacion (Fase 8)", () => {
  it("siempre en hora de Colombia, nunca UTC crudo", () => {
    // 2026-03-16T01:30:00Z -- en America/Bogota (UTC-5) todavía es 15 de marzo, 8:30 p.m.
    const { fecha, hora } = formatearFechaComunicacion("2026-03-16T01:30:00Z");
    assert.ok(fecha.includes("15"));
    assert.ok(hora.includes("8:30"));
  });
});
