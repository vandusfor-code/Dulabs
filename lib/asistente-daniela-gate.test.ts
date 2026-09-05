/**
 * Fase 8A (piloto controlado) — gate de activación del nuevo asistente en el
 * webhook real, y despacho de atenderConAsistenteDanielaIA.
 *
 * REGLA ABSOLUTA DE ESTA SUITE (instrucción explícita de la Fase 8A, tras el
 * incidente real de la Fase 7): el ÚNICO destinatario permitido para un
 * envío real de WhatsApp en toda esta fase es 573148127388. Ningún test de
 * este archivo intenta enviar nada real -- todos los ClienteConfig de
 * prueba usan meta_permanent_token: null (enviarWhatsApp hace un no-op
 * silencioso sin token, ver lib/whatsapp-outbound.ts), y además se verifica
 * explícitamente el guard asegurarDestinatarioAutorizadoParaPruebas.
 *
 * E/F/G/H del pedido (link/catálogo/disponibilidad/transferencia, todos
 * aislados por tenant) YA están cubiertos exhaustivamente por
 * lib/asistente-daniela-ia.test.ts (Fase 7) -- no se duplican aquí.
 *
 * N/O/P/Q (consulta de precio, servicio inexistente, recomendación,
 * contexto conversacional) dependen del JUICIO real del modelo -- este
 * entorno no tiene ANTHROPIC_API_KEY configurada (ver informe de la Fase
 * 7), así que no se pueden aserting de forma determinista aquí. Quedan para
 * la prueba manual real (Paso 15) contra el único número autorizado.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  debeUsarAsistenteDanielaIA,
  asegurarDestinatarioAutorizadoParaPruebas,
  NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP,
} from "@/lib/asistente-daniela-gate";
import { atenderConAsistenteDanielaIA } from "@/lib/asistente-daniela-ia";
import { DANIELA_BUTTON_IDS } from "@/lib/flows/daniela-button-ids";
import type { ClienteConfig } from "@/lib/supabase";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const ID_TENANT_DANIELA_REAL = "c64fac97-eff8-45f2-b691-30b3449da524";
const PHONE_DANIELA_REAL = "1282448611609227";
const OTRO_TENANT = { id_tenant: "otro-tenant-uuid", phone_number_id: "otro-phone-id" };
const DANIELA = { id_tenant: ID_TENANT_DANIELA_REAL, phone_number_id: PHONE_DANIELA_REAL };

describe("debeUsarAsistenteDanielaIA — gate (puro, las 4 condiciones)", () => {
  it("A. gate OFF -> false sin importar el resto (comportamiento legacy)", () => {
    assert.equal(debeUsarAsistenteDanielaIA(DANIELA, NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP, { pilotoActivo: false }), false);
  });

  it("B. gate ON + tenant/número de Daniela + sender autorizado -> true", () => {
    assert.equal(debeUsarAsistenteDanielaIA(DANIELA, NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP, { pilotoActivo: true }), true);
  });

  it("C. gate ON + tenant/número de Daniela + sender NO autorizado -> false (nunca entra una clienta real)", () => {
    assert.equal(debeUsarAsistenteDanielaIA(DANIELA, "573000000000", { pilotoActivo: true }), false);
  });

  it("D. gate ON + sender autorizado, pero OTRO tenant -> false", () => {
    assert.equal(debeUsarAsistenteDanielaIA(OTRO_TENANT, NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP, { pilotoActivo: true }), false);
  });

  it("defensa extra: id_tenant de Daniela pero phone_number_id distinto -> false (deben coincidir AMBOS)", () => {
    assert.equal(
      debeUsarAsistenteDanielaIA({ id_tenant: ID_TENANT_DANIELA_REAL, phone_number_id: "otro-numero" }, NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP, {
        pilotoActivo: true,
      }),
      false
    );
  });

  it("defensa extra: phone_number_id de Daniela pero id_tenant distinto -> false", () => {
    assert.equal(
      debeUsarAsistenteDanielaIA({ id_tenant: "otro-tenant", phone_number_id: PHONE_DANIELA_REAL }, NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP, {
        pilotoActivo: true,
      }),
      false
    );
  });

  it("sin `opts` (como lo llama el webhook real), usa la constante real del módulo -- documenta el comportamiento real de producción", () => {
    // No afirma cuál es (podría cambiar), solo que es un boolean determinista
    // y que responde false ante un tenant/número que definitivamente no es Daniela.
    const resultado = debeUsarAsistenteDanielaIA(OTRO_TENANT, "573000000000");
    assert.equal(resultado, false);
  });
});

describe("I/J. Guard de destinatario para pruebas (Fase 8A, tras el incidente real de la Fase 7)", () => {
  it("J. rechaza cualquier número que no sea el autorizado", () => {
    assert.throws(() => asegurarDestinatarioAutorizadoParaPruebas("573000000000"));
    assert.throws(() => asegurarDestinatarioAutorizadoParaPruebas(""));
  });

  it("J. permite EXCLUSIVAMENTE el número autorizado", () => {
    assert.doesNotThrow(() => asegurarDestinatarioAutorizadoParaPruebas(NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP));
    assert.equal(NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP, "573148127388");
  });
});

// Cliente de prueba SIN token real de Meta -- enviarWhatsApp/enviarBotonesWhatsApp
// hacen no-op silencioso (ver lib/whatsapp-outbound.ts), así que estos tests
// de despacho NUNCA pueden disparar un envío real, sin importar el
// destinatario que se les pase.
const CLIENTE_PRUEBA_SIN_TOKEN = {
  id: 1,
  id_tenant: ID_TENANT_DANIELA_REAL,
  phone_number_id: PHONE_DANIELA_REAL,
  nombre_negocio: "TEST_8A_asistente",
  meta_permanent_token: null,
  api_key_ia: null,
} as unknown as ClienteConfig;

describe(
  "atenderConAsistenteDanielaIA — despacho (K/L/M del pedido, sin envíos reales)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (manejarBotonProductos escribe una pausa real vía activarPausaChat)" },
  () => {
    let supabase: SupabaseClient;

    before(() => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    });

    // manejarBotonProductos SIEMPRE escribe una fila real en dulabs_pausas_chat
    // (activarPausaChat no depende de tener token de Meta) -- se limpia acá.
    // Se usa el phone_number_id REAL de Daniela (para probar de verdad el
    // camino del gate) pero el telefono_cliente es el ÚNICO número
    // autorizado de esta fase -- nunca un cliente real.
    after(async () => {
      if (!HAS_SUPABASE) return;
      await supabase
        .from("dulabs_pausas_chat")
        .delete()
        .eq("phone_number_id", PHONE_DANIELA_REAL)
        .eq("telefono_cliente", NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP);
    });

    it("K. primer mensaje (historial vacío, sin botón) -> saludo determinista", async () => {
      asegurarDestinatarioAutorizadoParaPruebas(NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP);
      const accion = await atenderConAsistenteDanielaIA({
        supabase,
        cliente: CLIENTE_PRUEBA_SIN_TOKEN,
        telefonoRemitente: NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP,
        mensaje: { text: { body: "Hola" } },
        historial: [],
      });
      assert.equal(accion, "saludo");
    });

    it("L. botón 'Servicios de Spa' -> rama determinista, nunca la conversación libre", async () => {
      asegurarDestinatarioAutorizadoParaPruebas(NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP);
      const accion = await atenderConAsistenteDanielaIA({
        supabase,
        cliente: CLIENTE_PRUEBA_SIN_TOKEN,
        telefonoRemitente: NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP,
        mensaje: { interactive: { type: "button_reply", button_reply: { id: DANIELA_BUTTON_IDS.SERVICIOS_SPA } } },
        historial: [{ role: "assistant", content: "saludo previo" }],
      });
      assert.equal(accion, "boton_servicios_spa");
    });

    it("L. botón 'Productos' -> rama determinista de traspaso (escribe una pausa real, destinatario == único número autorizado)", async () => {
      asegurarDestinatarioAutorizadoParaPruebas(NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP);
      const accion = await atenderConAsistenteDanielaIA({
        supabase,
        cliente: CLIENTE_PRUEBA_SIN_TOKEN,
        telefonoRemitente: NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP,
        mensaje: { interactive: { type: "button_reply", button_reply: { id: DANIELA_BUTTON_IDS.PRODUCTOS } } },
        historial: [{ role: "assistant", content: "saludo previo" }],
      });
      assert.equal(accion, "boton_productos");

      const { data: pausa } = await supabase
        .from("dulabs_pausas_chat")
        .select("id")
        .eq("phone_number_id", PHONE_DANIELA_REAL)
        .eq("telefono_cliente", NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP)
        .maybeSingle();
      assert.ok(pausa, "el botón Productos debe activar la pausa real (mecanismo existente, reutilizado tal cual)");
    });

    it("M. intención directa en texto libre ('Quiero una cita', con historial ya existente) -> se despacha a la conversación con herramientas, nunca al saludo", async () => {
      const accion = await atenderConAsistenteDanielaIA({
        supabase,
        cliente: CLIENTE_PRUEBA_SIN_TOKEN,
        telefonoRemitente: NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP,
        mensaje: { text: { body: "Quiero una cita" } },
        historial: [{ role: "assistant", content: "¿en qué te ayudo?" }],
      });
      // Sin ANTHROPIC_API_KEY en este entorno, generarRespuestaAsistenteDaniela
      // devuelve null de inmediato (registrando el fallo) -- lo que sí prueba
      // esta aserción es que el DESPACHO fue a la conversación, no al saludo
      // ni a un botón. El juicio real del modelo (M completo) se valida en la
      // prueba manual del Paso 15 contra 573148127388.
      assert.equal(accion, "conversacion");
    });

    it("sin texto y sin botón (ej. una imagen) con historial existente -> no revienta, no envía nada", async () => {
      const accion = await atenderConAsistenteDanielaIA({
        supabase,
        cliente: CLIENTE_PRUEBA_SIN_TOKEN,
        telefonoRemitente: NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP,
        mensaje: {},
        historial: [{ role: "assistant", content: "algo" }],
      });
      assert.equal(accion, "sin_texto");
    });
  }
);
