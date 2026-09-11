/**
 * AMORE — migración de número (autorizado): mismo criterio EXACTO que
 * blacklist-orden.test.ts -- procesarCambio() no está exportada y está
 * fuertemente acoplada a Supabase/Meta reales, así que en vez de ejecutar
 * el flujo se verifica su FORMA: posición relativa de los marcadores reales
 * en el código fuente, y el contenido exacto del mensaje/función.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RUTA_WEBHOOK = join(__dirname, "route.ts");
const fuente = readFileSync(RUTA_WEBHOOK, "utf8");

function posicion(marcador: string): number {
  const i = fuente.indexOf(marcador);
  assert.notEqual(i, -1, `no se encontró el marcador "${marcador}" en route.ts -- ¿se movió o se renombró?`);
  return i;
}

describe("AMORE migración de número -- guarda estructural", () => {
  const posMigracion = posicion("await atenderMensajeMigracionAmore(cliente, telefonoRemitente, destinoWhatsApp)");

  it("se evalúa ANTES que encuestas/campañas/soluciones-financieras/onboarding/ia_pausada/ia_restringida_a (aplica sin excepción a quien escriba)", () => {
    const marcadoresPosteriores = [
      "await atenderMensajeEncuesta(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "await atenderMensajeCampaña(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "await atenderMensajeSolucionesFinancieras(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "await atenderMensajeOnboarding(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "if (cliente.ia_pausada) {",
      "if (cliente.ia_restringida_a) {",
    ];
    for (const marcador of marcadoresPosteriores) {
      const pos = posicion(marcador);
      assert.ok(posMigracion < pos, `atenderMensajeMigracionAmore debe evaluarse antes de: ${marcador}`);
    }
  });

  it("solo la lista negra (blacklist) tiene prioridad por encima -- nunca al revés", () => {
    const posBlacklist = posicion("esTelefonoBloqueado(cliente.ia_numeros_bloqueados, telefonoRemitente)");
    assert.ok(posBlacklist < posMigracion, "la lista negra sigue siendo lo primero, incluso sobre el aviso de migración");
  });

  it("la función SIEMPRE envía el aviso (sin condicionar a 'primer contacto' ni a ninguna otra condición) y siempre devuelve true (nunca deja pasar a otro flujo)", () => {
    const posFuncion = posicion("async function atenderMensajeMigracionAmore(");
    const posCierre = fuente.indexOf("\n}", posFuncion);
    const cuerpo = fuente.slice(posFuncion, posCierre);
    assert.doesNotMatch(cuerpo, /esPrimerContacto/, "no debe depender de esPrimerContacto -- se envía SIEMPRE que alguien escriba");
    assert.match(cuerpo, /await enviarWhatsAppPartes\(cliente, destinoWhatsApp, MENSAJE_MIGRACION_AMORE\);/);
    assert.match(cuerpo, /return true;/);
  });

  it("gateado EXCLUSIVAMENTE por phone_number_id -- ningún otro tenant/número se ve afectado", () => {
    const posFuncion = posicion("async function atenderMensajeMigracionAmore(");
    const cuerpo = fuente.slice(posFuncion, posFuncion + 300);
    assert.match(cuerpo, /if \(cliente\.phone_number_id !== PHONE_NUMBER_ID_AMORE_MIGRACION\) return false;/);
  });

  it("el texto del mensaje es EXACTAMENTE el aprobado, incluidos el número nuevo y el link de wa.me", () => {
    const posMensaje = posicion("const MENSAJE_MIGRACION_AMORE =");
    const bloque = fuente.slice(posMensaje, posMensaje + 900);
    assert.match(bloque, /Estamos migrando nuestro servicio a un nuevo número de WhatsApp/);
    assert.match(bloque, /301 227 6334/);
    assert.match(bloque, /https:\/\/wa\.me\/573012276334/);
    assert.match(bloque, /Guárdanos en tus contactos/);
  });
});
