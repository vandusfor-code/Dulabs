/**
 * El bot de traspaso de Soluciones Financieras (Charlotte) está DESACTIVADO por solicitud suya: mismo criterio de guarda estructural que
 * blacklist-orden.test.ts (procesarCambio no se puede ejecutar aislada). Se verifica que el interruptor exista, esté apagado y sea lo
 * PRIMERO que evalúa la función, y que el resto del bot siga intacto (reactivarlo = poner `true`).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fuente = readFileSync(join(__dirname, "route.ts"), "utf8").replace(/\r\n/g, "\n");

describe("Soluciones Financieras -- bot desactivado (interruptor)", () => {
  it("el interruptor existe y está apagado", () => {
    assert.match(fuente, /const BOT_SOLUCIONES_FINANCIERAS_ACTIVO = false;/);
  });

  it("es la PRIMERA condición de atenderMensajeSolucionesFinancieras (antes de cualquier lectura o envío)", () => {
    const inicio = fuente.indexOf("async function atenderMensajeSolucionesFinancieras(");
    assert.notEqual(inicio, -1);
    const cuerpo = fuente.slice(inicio);
    const posInterruptor = cuerpo.indexOf("if (!BOT_SOLUCIONES_FINANCIERAS_ACTIVO) return false;");
    assert.notEqual(posInterruptor, -1, "falta el chequeo del interruptor");
    for (const marcador of ["supabaseAdmin()", "enviarWhatsApp(", "activarPausaChat(", "crearSolicitudProducto("]) {
      assert.ok(posInterruptor < cuerpo.indexOf(marcador), `el interruptor debe evaluarse antes de ${marcador}`);
    }
  });

  it("el resto de la cascada sigue: la función se sigue invocando en el mismo lugar (solo devuelve false)", () => {
    assert.match(fuente, /if \(await atenderMensajeSolucionesFinancieras\(cliente, mensaje, telefonoRemitente, destinoWhatsApp\)\) return;/);
  });
});
