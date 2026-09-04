/**
 * SOLOTALENTO (autorizado) — hatch de reinicio determinista para el mensaje
 * automático de la página de WhatsApp Ads (lib/flow-solotalento-inicio-hatch.ts
 * + lib/flow-runtime-bridge.ts::intentarInicioSolotalento).
 *
 * Capa 1: gate puro (sin DB) -- confirma que CUALQUIER tenant que no sea
 * SOLOTALENTO nunca dispara este hatch, ni siquiera toca el store.
 * Capa 2: integración real, pero SIEMPRE contra el tenant/phone_number_id
 * REALES de SOLOTALENTO SAS (el hatch está gateado por ese
 * phone_number_id exacto -- no hay forma de probarlo con un tenant
 * descartable) usando SIEMPRE un telefono_cliente FALSO (nunca un número
 * real) y sendMessageDepsOverride (enviarTexto fake) para que NUNCA salga
 * un WhatsApp real, sin importar que el token guardado sea válido. No se
 * modifica la fila real de dulabs_clientes_config -- solo se crean/borran
 * filas de dulabs_flow_executions/eventos para el telefono_cliente falso.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { atenderMensajeConFlowConFallback } from "@/lib/flow-runtime-bridge";
import type { ClienteConfig } from "@/lib/supabase";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const MENSAJE_PAGINA =
  "Hola, Solotalento. Quiero conocer cómo pueden ayudar a mi organización a fortalecer su gestión, cumplimiento y desempeño. Me gustaría recibir información sobre sus soluciones y conversar sobre la que más se ajusta a nuestras necesidades.";

describe(
  "SOLOTALENTO — hatch de inicio: aislamiento de otros tenants",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    it("el MISMO texto exacto, para un tenant que NO es SOLOTALENTO (phone_number_id distinto), nunca toma el camino 'inicio_solotalento'", async () => {
      const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const otroTenant: ClienteConfig & { flow_activo: true; flow_id: string } = {
        id_tenant: randomUUID(),
        phone_number_id: `test-otro-tenant-${Date.now()}`,
        nombre_negocio: "OTRO_TENANT",
        flow_activo: true,
        flow_id: randomUUID(),
      } as ClienteConfig & { flow_activo: true; flow_id: string };

      const resultado = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: otroTenant,
        telefonoCliente: `test-otro-cliente-${Date.now()}`,
        texto: MENSAJE_PAGINA,
        wamid: `wamid-otro-${Date.now()}`,
      });

      assert.notEqual(resultado.motivo, "inicio_solotalento", "el hatch de SOLOTALENTO nunca debe activarse para otro tenant");
    });
  },
);

const SOLOTALENTO_TENANT_ID = "11ccf0a3-726b-4d4b-9f7d-2deb8441d6a9";
const SOLOTALENTO_PHONE_NUMBER_ID = "1321997104321708";
const SOLOTALENTO_FLOW_ID = "cd2d7ce7-b30a-4ec8-be0b-dce1e713822f";

describe(
  "SOLOTALENTO — hatch de inicio: integración real (tenant/phone REALES, telefono_cliente FALSO, sin WhatsApp real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const telefonosFalsos: string[] = [];

    function nuevoTelefonoFalso(): string {
      const t = `test-inicio-hatch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      telefonosFalsos.push(t);
      return t;
    }

    after(async () => {
      if (!HAS_SUPABASE) return;
      supabase = supabase ?? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      for (const telefono of telefonosFalsos) {
        await supabase
          .from("dulabs_flow_executions")
          .delete()
          .eq("tenant_id", SOLOTALENTO_TENANT_ID)
          .eq("phone_number_id", SOLOTALENTO_PHONE_NUMBER_ID)
          .eq("telefono_cliente", telefono);
      }
    });

    const clienteSolotalento: ClienteConfig & { flow_activo: true; flow_id: string } = {
      id_tenant: SOLOTALENTO_TENANT_ID,
      phone_number_id: SOLOTALENTO_PHONE_NUMBER_ID,
      nombre_negocio: "Solo talento",
      flow_activo: true,
      flow_id: SOLOTALENTO_FLOW_ID,
    } as ClienteConfig & { flow_activo: true; flow_id: string };

    const enviarTextoFake = async () => ({ wamid: "fake-wamid-test" });

    it("mensaje de la página como PRIMER mensaje de una conversación nueva -> bienvenida + menú (sin necesitar el hatch, pero no debe romperse)", async () => {
      supabase = supabase ?? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const telefono = nuevoTelefonoFalso();

      const resultado = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: clienteSolotalento,
        telefonoCliente: telefono,
        texto: MENSAJE_PAGINA,
        wamid: `wamid-${telefono}-1`,
        sendMessageDepsOverride: { enviarTexto: enviarTextoFake },
      });

      assert.equal(resultado.handled, true);
      assert.equal(resultado.motivo, "inicio_solotalento");
      const textos = (resultado.result?.effects ?? [])
        .filter((e) => e.type === "send_message")
        .map((e) => (e as { content: { text?: string } }).content.text ?? "");
      assert.ok(textos.some((t) => t.includes("¡Bienvenido a SOLOTALENTO SAS")), "debe reenviar la bienvenida");
      assert.ok(textos.some((t) => t.includes("¿En qué podemos ayudarte?")), "debe reenviar el menú principal");
      assert.ok(!textos.some((t) => t.includes("no cumple el formato esperado")), "nunca debe verse como respuesta inválida");
    });

    it("mensaje de la página llega MIENTRAS ya hay una ejecución activa esperando un dígito -> cierra y reinicia (welcome + menú), en vez de 'La respuesta no cumple el formato esperado.'", async () => {
      supabase = supabase ?? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const telefono = nuevoTelefonoFalso();

      // 1. Primer mensaje normal -> queda esperando un dígito en q-main-menu.
      const primero = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: clienteSolotalento,
        telefonoCliente: telefono,
        texto: "hola",
        wamid: `wamid-${telefono}-1`,
        sendMessageDepsOverride: { enviarTexto: enviarTextoFake },
      });
      assert.equal(primero.handled, true);

      // 2. Llega el mensaje de la página EN VEZ de un dígito.
      const segundo = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: clienteSolotalento,
        telefonoCliente: telefono,
        texto: MENSAJE_PAGINA,
        wamid: `wamid-${telefono}-2`,
        sendMessageDepsOverride: { enviarTexto: enviarTextoFake },
      });

      assert.equal(segundo.handled, true);
      assert.equal(segundo.motivo, "inicio_solotalento", "debe reconocerse como reinicio, no como respuesta inválida al menú");
      const textos = (segundo.result?.effects ?? [])
        .filter((e) => e.type === "send_message")
        .map((e) => (e as { content: { text?: string } }).content.text ?? "");
      assert.ok(textos.some((t) => t.includes("¡Bienvenido a SOLOTALENTO SAS")), "debe reenviar la bienvenida");
      assert.ok(textos.some((t) => t.includes("¿En qué podemos ayudarte?")), "debe reenviar el menú principal");
      assert.ok(!textos.some((t) => t.includes("no cumple el formato esperado")), "NUNCA debe caer en la validación regex del menú");

      // 3. Después del reinicio, un dígito normal sigue funcionando (no quedó roto).
      const tercero = await atenderMensajeConFlowConFallback({
        supabase,
        cliente: clienteSolotalento,
        telefonoCliente: telefono,
        texto: "7",
        wamid: `wamid-${telefono}-3`,
        sendMessageDepsOverride: { enviarTexto: enviarTextoFake },
      });
      assert.equal(tercero.handled, true);
      const textosTercero = (tercero.result?.effects ?? [])
        .filter((e) => e.type === "send_message")
        .map((e) => (e as { content: { text?: string } }).content.text ?? "");
      assert.ok(
        textosTercero.some((t) => t.includes("Claro que sí")),
        "la opción 7 (hablar con nuestra asesora) debe seguir funcionando normalmente tras el reinicio",
      );
    });
  },
);
