/**
 * Cobros manuales — guarda estructural del webhook de Meta: mismo criterio que blacklist-orden.test.ts y migracion-amore-orden.test.ts (procesarCambio() no está exportada y está
 * acoplada a Supabase/Meta reales, así que se verifica su FORMA: la posición relativa de los marcadores reales en el código fuente).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const fuente = readFileSync(join(__dirname, "route.ts"), "utf8");

function posicion(marcador: string): number {
  const i = fuente.indexOf(marcador);
  assert.notEqual(i, -1, `no se encontró el marcador "${marcador}" en route.ts -- ¿se movió o se renombró?`);
  return i;
}

describe("webhook de Meta — suspensión por falta de pago (guarda estructural)", () => {
  const MARCADOR = "await tenantSuspendidoPorPago(supabaseAdmin(), cliente.id_tenant)";
  const posSuspension = posicion(MARCADOR);

  it("se evalúa DESPUÉS de la lista negra y del aviso de migración de AMORE, y ANTES de encuestas, campañas, soluciones financieras, onboarding, pausa de IA y restricción", () => {
    assert.ok(posicion("esTelefonoBloqueado(cliente.ia_numeros_bloqueados, telefonoRemitente)") < posSuspension, "la lista negra sigue siendo lo primero");
    assert.ok(posicion("await atenderMensajeMigracionAmore(cliente, telefonoRemitente, destinoWhatsApp)") < posSuspension, "el aviso de migración de AMORE no es el bot: sigue saliendo");
    for (const marcador of [
      "await atenderMensajeEncuesta(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "await atenderMensajeCampaña(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "await atenderMensajeSolucionesFinancieras(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "await atenderMensajeOnboarding(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "if (cliente.ia_pausada) {",
      "if (cliente.ia_restringida_a) {",
      "await intentarAgenteConversacionalSiAplica(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "await atenderMensajeConFlowConFallback(",
    ]) {
      assert.ok(posSuspension < posicion(marcador), `la suspensión por pago debe evaluarse antes de: ${marcador}`);
    }
  });

  it("corta con `return` (el mensaje queda registrado arriba; no se responde nada) y solo si el negocio tiene tenant", () => {
    const bloque = fuente.slice(posSuspension - 40, posSuspension + 300);
    assert.match(bloque, /if \(cliente\.id_tenant && \(await tenantSuspendidoPorPago\(supabaseAdmin\(\), cliente\.id_tenant\)\)\) \{/);
    assert.match(bloque, /return;/);
  });

  it("usa el helper que FALLA ABIERTO (lib/cobros/suspension), nunca una consulta directa que pudiera cortar el servicio si falla", () => {
    assert.match(fuente, /import \{ tenantSuspendidoPorPago \} from "@\/lib\/cobros\/suspension";/);
    assert.doesNotMatch(fuente, /suspendida_por_pago_at/, "el webhook no debe consultar la columna a mano");
  });

  it("el mensaje entrante se registra ANTES de la suspensión (para que una persona del negocio pueda verlo y responderlo a mano)", () => {
    assert.ok(posicion("registrarMensaje(") < posSuspension, "el mensaje se guarda antes de decidir si el bot responde");
  });
});
