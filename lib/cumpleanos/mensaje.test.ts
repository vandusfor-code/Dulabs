import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderizarMensajeCumpleanos } from "./mensaje";

const MENSAJE_AMORE = `🎂✨ ¡Feliz cumpleaños, {{nombre}}!

Hoy queremos recordarte lo especial que eres y desearte un nuevo año lleno de amor, alegría y momentos inolvidables. 💗

Que tengas un día tan bonito como tú. ✨

Con cariño,
AMORE 💗`;

describe("renderizarMensajeCumpleanos (Fase 6A) -- Prueba 7: {{nombre}} renderiza correctamente", () => {
  it("sustituye {{nombre}} con el nombre real del cliente", () => {
    const resultado = renderizarMensajeCumpleanos(MENSAJE_AMORE, { nombre: "María Fernanda" });
    assert.ok(resultado.includes("¡Feliz cumpleaños, María Fernanda!"));
    assert.ok(!resultado.includes("{{nombre}}"));
  });

  it("nunca invita a reservar, vender ni ofrecer descuentos (mensaje EXACTO aprobado)", () => {
    const resultado = renderizarMensajeCumpleanos(MENSAJE_AMORE, { nombre: "Valentina" });
    for (const prohibido of ["reserva", "agenda tu cita", "descuento", "promoción", "%"]) {
      assert.ok(!resultado.toLowerCase().includes(prohibido), `no debe contener "${prohibido}"`);
    }
    assert.ok(resultado.includes("Con cariño,\nAMORE 💗"));
  });

  it("{{negocio}} se sustituye cuando la plantilla lo usa (variable opcional para otros tenants)", () => {
    const resultado = renderizarMensajeCumpleanos("Feliz cumpleaños de parte de {{negocio}}", { nombre: "X", negocio: "Otro Salón" });
    assert.equal(resultado, "Feliz cumpleaños de parte de Otro Salón");
  });

  it("{{negocio}} ausente se reemplaza por vacío, nunca revienta", () => {
    const resultado = renderizarMensajeCumpleanos("De parte de {{negocio}}.", { nombre: "X" });
    assert.equal(resultado, "De parte de .");
  });
});
