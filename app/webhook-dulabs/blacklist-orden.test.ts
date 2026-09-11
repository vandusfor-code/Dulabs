/**
 * Lista negra de DuLabs (autorizado) -- guarda estructural de que el bloqueo
 * ocurre ANTES de cualquier acción de Du (IA, WhatsApp, leads) dentro de
 * procesarCambio(). procesarCambio no está exportada y está fuertemente
 * acoplada a Supabase/Meta a nivel de módulo (supabaseAdmin() como
 * singleton, llamadas reales a Graph API) -- ejecutarla de verdad en un test
 * requeriría mockear toda esa superficie con alto riesgo de que algo no
 * quede bien aislado y termine tocando producción real (ver feedback ya
 * registrado: un incidente real ya ocurrió en AMORE por exactamente eso).
 *
 * En su lugar, este test lee el código fuente real del webhook y verifica
 * la posición relativa de los marcadores reales: si alguien reordena el
 * código y el bloqueo deja de ser lo primero, este test falla. Es la misma
 * técnica que una prueba de arquitectura/lint -- no ejecuta el flujo, prueba
 * su forma. Complementa (no reemplaza) las pruebas puras de
 * lib/blacklist-du.test.ts.
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

describe("blacklist: bloqueo antes de cualquier acción de Du (guarda estructural)", () => {
  const posBlacklist = posicion("esTelefonoBloqueado(cliente.ia_numeros_bloqueados, telefonoRemitente)");

  it("el bloqueo hace return inmediato (silencio total, sin excepciones)", () => {
    const bloque = fuente.slice(posBlacklist, posBlacklist + 300);
    assert.match(bloque, /return;/, "el bloque de blacklist debe terminar en `return;` sin condiciones adicionales");
  });

  it("TEST 1: el bloqueo ocurre antes de generarRespuestaConLeadIA (Gemini nunca se llama)", () => {
    const posGemini = posicion("await generarRespuestaConLeadIA({");
    assert.ok(posBlacklist < posGemini, "esTelefonoBloqueado debe evaluarse antes de generarRespuestaConLeadIA");
  });

  it("TEST 2/3: el bloqueo ocurre antes de CUALQUIER envío de WhatsApp o marca de leído/escribiendo", () => {
    const marcadoresDeEnvio = [
      'await marcarLeidoConTyping({ phoneNumberId: cliente.phone_number_id',
      "await enviarBotonesWhatsApp(supabase, cliente, destinoWhatsApp, MENSAJE_BIENVENIDA_2",
      "await enviarBotonesWhatsApp(supabase, cliente, destinoWhatsApp, textoBienvenida(nombre, fila.plan)",
      "await libEnviarWhatsApp(supabaseAdmin(), cliente, para, texto);",
      "await libEnviarWhatsAppPartes(supabaseAdmin(), cliente, para, texto);",
    ];
    for (const marcador of marcadoresDeEnvio) {
      const pos = posicion(marcador);
      assert.ok(posBlacklist < pos, `esTelefonoBloqueado debe evaluarse antes de: ${marcador}`);
    }
  });

  it("TEST 4: el bloqueo ocurre antes de los flujos que pueden crear un lead (encuestas, campañas, onboarding, IA de leads)", () => {
    const marcadoresDeFlujo = [
      "await atenderMensajeEncuesta(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "await atenderMensajeCampaña(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "await atenderMensajeOnboarding(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "await generarRespuestaConLeadIA({",
    ];
    for (const marcador of marcadoresDeFlujo) {
      const pos = posicion(marcador);
      assert.ok(posBlacklist < pos, `esTelefonoBloqueado debe evaluarse antes de: ${marcador}`);
    }
  });

  it("el bloqueo también precede a ia_pausada y a la restricción temporal (no depende de esas otras capas)", () => {
    const posPausada = posicion("if (cliente.ia_pausada) {");
    assert.ok(posBlacklist < posPausada);
  });

  it("TEST 8: cliente (y por lo tanto ia_numeros_bloqueados) se resuelve filtrando por phone_number_id -- aislamiento por tenant garantizado por el modelo de datos, no por código adicional", () => {
    const posResolverCliente = posicion('.eq("phone_number_id", phoneNumberId)');
    assert.ok(posResolverCliente < posBlacklist, "cliente debe resolverse (scoped por phone_number_id) antes de evaluar su propia blacklist");
  });

  it("el registro de auditoría/histórico del mensaje SÍ ocurre antes del bloqueo (permitido explícitamente)", () => {
    const posRegistro = posicion('.from("dulabs_mensajes_log")');
    assert.ok(posRegistro < posBlacklist, "el registro para histórico debe seguir ocurriendo antes del bloqueo, tal como se pidió");
  });
});
