/**
 * WhatsApp Worker (Fase 9A/9B, autorizado) — integración REAL contra
 * Supabase (tenants descartables, randomUUID, nunca AMORE ni Daniela ni
 * Solo Talento) del manager (manager.ts) y del adaptador (adaptador.ts).
 *
 * SEGURIDAD: ninguna prueba de este archivo importa socket-baileys.ts ni
 * @whiskeysockets/baileys -- todas inyectan una FabricaSocket FALSA
 * (crearFabricaSocketFalsa) que nunca abre un WebSocket real ni toca los
 * servidores de WhatsApp. Los eventos de conexión (qr/conectado/
 * desconectado) se disparan a mano desde el test, igual que lo haría un
 * socket real, y se verifica el resultado con polling sobre
 * obtenerEstadoPublico (mismo mecanismo que usa el panel real).
 *
 * ADVERTENCIA (incidente real ya documentado) — recuperarSesionesPersistidas
 * es deliberadamente GLOBAL (barre TODOS los tenants con
 * estado in (conectando, conectado), no solo los descartables de este
 * archivo): correr este archivo contra Supabase REAL de producción puede
 * tocar sesiones reales de tenants reales (ya pasó una vez con AMORE). Este
 * archivo NUNCA debe ejecutarse contra credenciales de producción salvo en
 * un entorno de pruebas dedicado -- ver npm test en package.json.
 *
 * Requiere que la migración de Fase 9A ya se haya corrido
 * (dulabs_whatsapp_qr_sesiones) -- si no, el `before()` lo detecta y todo
 * el archivo se salta con un mensaje claro.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { iniciarConexion, obtenerEstadoPublico, obtenerConexionActiva, desconectar, recuperarSesionesPersistidas } from "./manager.js";
import { enviarPorWhatsAppQR } from "./adaptador.js";
import type { EventoConexion, FabricaSocket, SlotWhatsApp, SocketWhatsApp } from "./tipos.js";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

type ControlSocketFalso = {
  emitir(evento: EventoConexion): void;
  mensajesEnviados: { telefono: string; mensaje: string }[];
  cerradoLlamado: boolean;
  telefonoRecibido: string | undefined;
  slotRecibido: SlotWhatsApp | undefined;
};

function crearFabricaSocketFalsa(): { fabrica: FabricaSocket; llamadas: ControlSocketFalso[] } {
  const llamadas: ControlSocketFalso[] = [];
  const fabrica: FabricaSocket = async ({ slot, telefono }) => {
    let handler: ((evento: EventoConexion) => void) | null = null;
    const control: ControlSocketFalso = {
      emitir(evento) {
        handler?.(evento);
      },
      mensajesEnviados: [],
      cerradoLlamado: false,
      telefonoRecibido: telefono,
      slotRecibido: slot,
    };
    llamadas.push(control);
    const socket: SocketWhatsApp = {
      onEvento(cb) {
        handler = cb;
      },
      async enviarMensaje(telefono, mensaje) {
        control.mensajesEnviados.push({ telefono, mensaje });
      },
      async enviarAudio() {},
      async cerrar() {
        control.cerradoLlamado = true;
        handler?.({ tipo: "desconectado", motivoFinal: true });
      },
    };
    return socket;
  };
  return { fabrica, llamadas };
}

async function esperarHasta(condicion: () => Promise<boolean>, timeoutMs = 2000, pasoMs = 20): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (await condicion()) return;
    await new Promise((r) => setTimeout(r, pasoMs));
  }
  throw new Error(`Tiempo de espera agotado (${timeoutMs}ms) esperando la condición`);
}

describe(
  "WhatsApp Worker (Fase 9A/9B) — manager + adaptador, integración real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    let migracionesListas = false;
    const tenantsCreados: string[] = [];

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const sonda = await supabase.from("dulabs_whatsapp_qr_sesiones").select("id_tenant, slot").limit(1);
      migracionesListas = !sonda.error;
    });

    after(async () => {
      if (!HAS_SUPABASE || !migracionesListas || tenantsCreados.length === 0) return;
      await supabase.from("dulabs_whatsapp_qr_sesiones").delete().in("id_tenant", tenantsCreados);
    });

    function nuevoTenant(): string {
      const id = randomUUID();
      tenantsCreados.push(id);
      return id;
    }

    it("5. creación de sesión / un tenant puede iniciar conexión", async (t) => {
      if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
      const TENANT = nuevoTenant();
      const { fabrica } = crearFabricaSocketFalsa();
      const resultado = await iniciarConexion(supabase, TENANT, 1, fabrica);
      assert.equal(resultado.estado, "conectando");
    });

    it("7. estado connecting mientras se espera el escaneo (y llega el QR)", async (t) => {
      if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
      const TENANT = nuevoTenant();
      const { fabrica, llamadas } = crearFabricaSocketFalsa();
      const inicial = await iniciarConexion(supabase, TENANT, 1, fabrica);
      assert.equal(inicial.estado, "conectando");
      assert.equal(inicial.qr, null);

      llamadas[0].emitir({ tipo: "qr", qr: "2@fake-qr-contenido-1" });
      await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT, 1)).qr !== null);

      const conQr = await obtenerEstadoPublico(supabase, TENANT, 1);
      assert.equal(conQr.estado, "conectando");
      assert.ok(conQr.qr!.startsWith("data:image/png;base64,"));
    });

    it("'Vincular con número' (autorizado): iniciarConexion pasa el teléfono a la fábrica, y el código llega vía evento", async (t) => {
      if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
      const TENANT = nuevoTenant();
      const { fabrica, llamadas } = crearFabricaSocketFalsa();
      const inicial = await iniciarConexion(supabase, TENANT, 1, fabrica, { telefono: "573001112233" });
      assert.equal(inicial.estado, "conectando");
      assert.equal(inicial.codigoVinculacion, null);
      assert.equal(llamadas[0].telefonoRecibido, "573001112233");

      llamadas[0].emitir({ tipo: "codigo_vinculacion", codigo: "ABCD1234" });
      await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT, 1)).codigoVinculacion !== null);

      const conCodigo = await obtenerEstadoPublico(supabase, TENANT, 1);
      assert.equal(conCodigo.estado, "conectando");
      assert.equal(conCodigo.codigoVinculacion, "ABCD1234");
      assert.equal(conCodigo.qr, null, "el modo código nunca debe dejar un QR guardado a la vez");
    });

    it("QR y código de vinculación son mutuamente excluyentes: el que llega último limpia al otro", async (t) => {
      if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
      const TENANT = nuevoTenant();
      const { fabrica, llamadas } = crearFabricaSocketFalsa();
      await iniciarConexion(supabase, TENANT, 1, fabrica);

      llamadas[0].emitir({ tipo: "qr", qr: "2@fake-qr" });
      await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT, 1)).qr !== null);

      llamadas[0].emitir({ tipo: "codigo_vinculacion", codigo: "WXYZ9999" });
      await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT, 1)).codigoVinculacion !== null);
      let estado = await obtenerEstadoPublico(supabase, TENANT, 1);
      assert.equal(estado.codigoVinculacion, "WXYZ9999");
      assert.equal(estado.qr, null);

      llamadas[0].emitir({ tipo: "qr", qr: "2@fake-qr-2" });
      await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT, 1)).qr !== null);
      estado = await obtenerEstadoPublico(supabase, TENANT, 1);
      assert.ok(estado.qr);
      assert.equal(estado.codigoVinculacion, null);
    });

    it("el QR de un tenant nunca se mezcla con el de otro", async (t) => {
      if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
      const TENANT_A = nuevoTenant();
      const TENANT_B = nuevoTenant();
      const a = crearFabricaSocketFalsa();
      const b = crearFabricaSocketFalsa();
      await iniciarConexion(supabase, TENANT_A, 1, a.fabrica);
      await iniciarConexion(supabase, TENANT_B, 1, b.fabrica);

      a.llamadas[0].emitir({ tipo: "qr", qr: "2@contenido-tenant-a" });
      b.llamadas[0].emitir({ tipo: "qr", qr: "2@contenido-tenant-b-distinto" });
      await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT_A, 1)).qr !== null);
      await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT_B, 1)).qr !== null);

      const estadoA = await obtenerEstadoPublico(supabase, TENANT_A, 1);
      const estadoB = await obtenerEstadoPublico(supabase, TENANT_B, 1);
      assert.notEqual(estadoA.qr, estadoB.qr);
    });

    it("11. tenant sin sesión previa -> estado desconectado, sin excepción", async () => {
      const TENANT_NUEVO = nuevoTenant();
      const estado = await obtenerEstadoPublico(supabase, TENANT_NUEVO, 1);
      assert.equal(estado.estado, "desconectado");
      assert.equal(estado.qr, null);
      assert.equal(estado.numeroConectado, null);
      assert.equal(obtenerConexionActiva(TENANT_NUEVO, 1), undefined);
    });

    it("8. estado connected después del evento de conexión", async (t) => {
      if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
      const TENANT = nuevoTenant();
      const { fabrica, llamadas } = crearFabricaSocketFalsa();
      await iniciarConexion(supabase, TENANT, 1, fabrica);
      llamadas[0].emitir({ tipo: "conectado", numero: "573000000001" });
      await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT, 1)).estado === "conectado");

      const estado = await obtenerEstadoPublico(supabase, TENANT, 1);
      assert.equal(estado.numeroConectado, "573000000001");
      assert.ok(estado.conectadoEn);
      assert.equal(estado.qr, null);
    });

    it("9/12. desconexión real -> estado disconnected, limpia número y credenciales", async (t) => {
      if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
      const TENANT = nuevoTenant();
      const { fabrica, llamadas } = crearFabricaSocketFalsa();
      await iniciarConexion(supabase, TENANT, 1, fabrica);
      llamadas[0].emitir({ tipo: "conectado", numero: "573000000002" });
      await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT, 1)).estado === "conectado");

      const resultado = await desconectar(supabase, TENANT, 1);
      assert.equal(resultado.estado, "desconectado");
      assert.equal(resultado.numeroConectado, null);
      assert.equal(obtenerConexionActiva(TENANT, 1), undefined);

      const { data: fila } = await supabase
        .from("dulabs_whatsapp_qr_sesiones")
        .select("creds, claves")
        .eq("id_tenant", TENANT)
        .eq("slot", 1)
        .maybeSingle();
      assert.equal(fila?.creds, null);
      assert.deepEqual(fila?.claves, {});
    });

    it("10. reconexión automática ante una caída recuperable (motivoFinal=false)", async (t) => {
      if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
      const TENANT = nuevoTenant();
      const { fabrica, llamadas } = crearFabricaSocketFalsa();
      await iniciarConexion(supabase, TENANT, 1, fabrica);
      llamadas[0].emitir({ tipo: "conectado", numero: "573000000003" });
      await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT, 1)).estado === "conectado");

      llamadas[0].emitir({ tipo: "desconectado", motivoFinal: false, error: "caída de red simulada" });
      await esperarHasta(async () => llamadas.length === 2);
      await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT, 1)).estado === "conectando");

      llamadas[1].emitir({ tipo: "conectado", numero: "573000000003" });
      await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT, 1)).estado === "conectado");
      assert.equal(llamadas.length, 2, "debió reconectar creando un segundo socket, no reutilizar el primero");
    });

    it("6. recuperación de sesión persistida al reiniciar el worker", async (t) => {
      if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
      const TENANT_CONECTADO = nuevoTenant();
      const TENANT_DESCONECTADO = nuevoTenant();
      // Simula el estado que dejó una corrida ANTERIOR del worker antes de
      // reiniciarse -- nadie llamó iniciarConexion en este proceso todavía.
      await supabase
        .from("dulabs_whatsapp_qr_sesiones")
        .upsert({ id_tenant: TENANT_CONECTADO, slot: 1, estado: "conectado", numero_conectado: "573000000009" });
      await supabase.from("dulabs_whatsapp_qr_sesiones").upsert({ id_tenant: TENANT_DESCONECTADO, slot: 1, estado: "desconectado" });

      const { fabrica } = crearFabricaSocketFalsa();
      // recuperarSesionesPersistidas es GLOBAL a propósito (al arrancar de
      // verdad el worker no sabe de antemano qué tenants existen) -- en esta
      // suite comparten la misma tabla otras pruebas que también dejan
      // tenants en conectando/conectado, así que no se puede afirmar un
      // conteo exacto acá, solo que nuestro tenant conectado quedó
      // recuperado y el desconectado no.
      const { recuperadas } = await recuperarSesionesPersistidas(supabase, fabrica);

      assert.ok(recuperadas >= 1, "debe recuperar al menos el tenant que estaba conectado");
      assert.notEqual(obtenerConexionActiva(TENANT_CONECTADO, 1), undefined);
      assert.equal(obtenerConexionActiva(TENANT_DESCONECTADO, 1), undefined);
    });

    it("4. un tenant nunca puede afectar la sesión de otro", async (t) => {
      if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
      const TENANT_A = nuevoTenant();
      const TENANT_B = nuevoTenant();
      const a = crearFabricaSocketFalsa();
      const b = crearFabricaSocketFalsa();
      await iniciarConexion(supabase, TENANT_A, 1, a.fabrica);
      await iniciarConexion(supabase, TENANT_B, 1, b.fabrica);
      a.llamadas[0].emitir({ tipo: "conectado", numero: "573000000004" });
      b.llamadas[0].emitir({ tipo: "conectado", numero: "573000000005" });
      await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT_A, 1)).estado === "conectado");
      await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT_B, 1)).estado === "conectado");

      await desconectar(supabase, TENANT_A, 1);

      const estadoB = await obtenerEstadoPublico(supabase, TENANT_B, 1);
      assert.equal(estadoB.estado, "conectado", "desconectar a A jamás debe tocar a B");
      assert.equal(estadoB.numeroConectado, "573000000005");
    });

    it("el adaptador resuelve la sesión del tenant correcto, nunca la de otro", async (t) => {
      if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
      const TENANT_A = nuevoTenant();
      const TENANT_B = nuevoTenant();
      const a = crearFabricaSocketFalsa();
      const b = crearFabricaSocketFalsa();
      await iniciarConexion(supabase, TENANT_A, 1, a.fabrica);
      await iniciarConexion(supabase, TENANT_B, 1, b.fabrica);
      a.llamadas[0].emitir({ tipo: "conectado", numero: "573000000006" });
      b.llamadas[0].emitir({ tipo: "conectado", numero: "573000000007" });
      await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT_A, 1)).estado === "conectado");
      await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT_B, 1)).estado === "conectado");

      await enviarPorWhatsAppQR(TENANT_A, "573148127388", "prueba controlada Fase 9B");

      assert.equal(a.llamadas[0].mensajesEnviados.length, 1);
      assert.equal(a.llamadas[0].mensajesEnviados[0].mensaje, "prueba controlada Fase 9B");
      assert.equal(b.llamadas[0].mensajesEnviados.length, 0, "el mensaje de A jamás debe llegar al socket de B");
    });

    it("tenant sin sesión conectada -> error controlado, no rompe el proceso", async () => {
      const TENANT_SIN_SESION = nuevoTenant();
      await assert.rejects(() => enviarPorWhatsAppQR(TENANT_SIN_SESION, "573148127388", "no debería enviarse"));
    });

    it("maneja un error de la fábrica sin dejar una sesión colgada", async (t) => {
      if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
      const TENANT = nuevoTenant();
      const fabricaQueFalla: FabricaSocket = async () => {
        throw new Error("fallo simulado creando el socket");
      };
      const resultado = await iniciarConexion(supabase, TENANT, 1, fabricaQueFalla);
      assert.equal(resultado.estado, "desconectado");
      assert.equal(obtenerConexionActiva(TENANT, 1), undefined);
    });

    // WhatsApp multi-cuenta (autorizado, Fase Final) -- slot 1 y slot 2 son
    // conexiones 100% independientes para el MISMO tenant: nunca comparten
    // socket, fila de Supabase, ni credenciales. Mismos mocks/fakes de
    // siempre -- ningún test de este bloque toca WhatsApp real.
    describe("WhatsApp multi-cuenta -- slot 1 y slot 2 nunca se mezclan", () => {
      it("un tenant puede tener slot 1 Y slot 2 conectados a la vez, cada uno con su propio número", async (t) => {
        if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
        const TENANT = nuevoTenant();
        const principal = crearFabricaSocketFalsa();
        const secundario = crearFabricaSocketFalsa();
        await iniciarConexion(supabase, TENANT, 1, principal.fabrica);
        await iniciarConexion(supabase, TENANT, 2, secundario.fabrica);

        principal.llamadas[0].emitir({ tipo: "conectado", numero: "573000000010" });
        secundario.llamadas[0].emitir({ tipo: "conectado", numero: "573000000011" });
        await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT, 1)).estado === "conectado");
        await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT, 2)).estado === "conectado");

        const estado1 = await obtenerEstadoPublico(supabase, TENANT, 1);
        const estado2 = await obtenerEstadoPublico(supabase, TENANT, 2);
        assert.equal(estado1.numeroConectado, "573000000010");
        assert.equal(estado2.numeroConectado, "573000000011");
        assert.equal(estado1.slot, 1);
        assert.equal(estado2.slot, 2);
      });

      it("desconectar el slot 2 NUNCA afecta al slot 1 del mismo tenant (y viceversa)", async (t) => {
        if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
        const TENANT = nuevoTenant();
        const principal = crearFabricaSocketFalsa();
        const secundario = crearFabricaSocketFalsa();
        await iniciarConexion(supabase, TENANT, 1, principal.fabrica);
        await iniciarConexion(supabase, TENANT, 2, secundario.fabrica);
        principal.llamadas[0].emitir({ tipo: "conectado", numero: "573000000012" });
        secundario.llamadas[0].emitir({ tipo: "conectado", numero: "573000000013" });
        await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT, 1)).estado === "conectado");
        await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT, 2)).estado === "conectado");

        await desconectar(supabase, TENANT, 2);

        const estado1 = await obtenerEstadoPublico(supabase, TENANT, 1);
        const estado2 = await obtenerEstadoPublico(supabase, TENANT, 2);
        assert.equal(estado1.estado, "conectado", "desconectar el slot 2 jamás debe tocar el slot 1");
        assert.equal(estado1.numeroConectado, "573000000012");
        assert.equal(estado2.estado, "desconectado");
        assert.equal(obtenerConexionActiva(TENANT, 1), principal, "referencia en memoria del slot 1 intacta");
      });

      it("la fábrica recibe el slot correcto -- nunca confunde cuál cuenta está creando", async (t) => {
        if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
        const TENANT = nuevoTenant();
        const principal = crearFabricaSocketFalsa();
        const secundario = crearFabricaSocketFalsa();
        await iniciarConexion(supabase, TENANT, 1, principal.fabrica);
        await iniciarConexion(supabase, TENANT, 2, secundario.fabrica);
        assert.equal(principal.llamadas[0].slotRecibido, 1);
        assert.equal(secundario.llamadas[0].slotRecibido, 2);
      });

      it("el adaptador envía por el slot correcto -- un mensaje del slot 1 nunca sale por el socket del slot 2", async (t) => {
        if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
        const TENANT = nuevoTenant();
        const principal = crearFabricaSocketFalsa();
        const secundario = crearFabricaSocketFalsa();
        await iniciarConexion(supabase, TENANT, 1, principal.fabrica);
        await iniciarConexion(supabase, TENANT, 2, secundario.fabrica);
        principal.llamadas[0].emitir({ tipo: "conectado", numero: "573000000014" });
        secundario.llamadas[0].emitir({ tipo: "conectado", numero: "573000000015" });
        await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT, 1)).estado === "conectado");
        await esperarHasta(async () => (await obtenerEstadoPublico(supabase, TENANT, 2)).estado === "conectado");

        await enviarPorWhatsAppQR(TENANT, "573148127388", "mensaje del slot 1", undefined, 1);
        await enviarPorWhatsAppQR(TENANT, "573148127388", "mensaje del slot 2", undefined, 2);

        assert.deepEqual(principal.llamadas[0].mensajesEnviados, [{ telefono: "573148127388", mensaje: "mensaje del slot 1" }]);
        assert.deepEqual(secundario.llamadas[0].mensajesEnviados, [{ telefono: "573148127388", mensaje: "mensaje del slot 2" }]);
      });

      it("iniciar el slot 2 sin haber conectado el slot 1 funciona igual (independientes de verdad, no en cascada)", async (t) => {
        if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
        const TENANT = nuevoTenant();
        const secundario = crearFabricaSocketFalsa();
        const resultado = await iniciarConexion(supabase, TENANT, 2, secundario.fabrica);
        assert.equal(resultado.estado, "conectando");
        assert.equal(resultado.slot, 2);
        const estado1 = await obtenerEstadoPublico(supabase, TENANT, 1);
        assert.equal(estado1.estado, "desconectado", "el slot 1 nunca se crea solo porque se inició el slot 2");
      });
    });
  }
);
