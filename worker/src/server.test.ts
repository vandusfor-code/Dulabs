/**
 * WhatsApp Worker (Fase 9B, autorizado) — pruebas HTTP de extremo a extremo
 * del servidor (server.ts). Usa una FabricaSocket FALSA (nunca
 * @whiskeysockets/baileys) y Supabase real con tenants descartables
 * (randomUUID) -- mismo criterio que manager.test.ts. Ninguna prueba abre
 * una conexión real a WhatsApp ni envía un mensaje real.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { crearServidor } from "./server.js";
import type { EventoConexion, FabricaSocket, SocketWhatsApp } from "./whatsapp-qr/tipos.js";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const SECRETO = "secreto-de-prueba-fase-9b";

function crearFabricaSocketFalsa(): { fabrica: FabricaSocket; llamadas: { emitir(e: EventoConexion): void }[] } {
  const llamadas: { emitir(e: EventoConexion): void }[] = [];
  const fabrica: FabricaSocket = async () => {
    let handler: ((evento: EventoConexion) => void) | null = null;
    const control = { emitir: (evento: EventoConexion) => handler?.(evento) };
    llamadas.push(control);
    const socket: SocketWhatsApp = {
      onEvento(cb) {
        handler = cb;
      },
      async enviarMensaje() {},
      async cerrar() {
        handler?.({ tipo: "desconectado", motivoFinal: true });
      },
    };
    return socket;
  };
  return { fabrica, llamadas };
}

async function levantarServidor(supabase: SupabaseClient, fabrica: FabricaSocket): Promise<{ url: string; cerrar: () => Promise<void> }> {
  const servidor = crearServidor({ supabase, fabricaSocket: fabrica, secreto: SECRETO });
  await new Promise<void>((resolve) => servidor.listen(0, resolve));
  const puerto = (servidor.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${puerto}`,
    cerrar: () => new Promise<void>((resolve) => servidor.close(() => resolve())),
  };
}

describe(
  "WhatsApp Worker (Fase 9B) — servidor HTTP",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    let migracionesListas = false;
    const tenantsCreados: string[] = [];

    before(async () => {
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const sonda = await supabase.from("dulabs_whatsapp_qr_sesiones").select("id_tenant").limit(1);
      migracionesListas = !sonda.error;
    });

    after(async () => {
      if (tenantsCreados.length === 0) return;
      await supabase.from("dulabs_whatsapp_qr_sesiones").delete().in("id_tenant", tenantsCreados);
    });

    function nuevoTenant(): string {
      const id = randomUUID();
      tenantsCreados.push(id);
      return id;
    }

    it("1. el worker inicia y responde su healthcheck sin autenticación", async () => {
      const { fabrica } = crearFabricaSocketFalsa();
      const { url, cerrar } = await levantarServidor(supabase, fabrica);
      try {
        const r = await fetch(`${url}/salud`);
        assert.equal(r.status, 200);
        assert.deepEqual(await r.json(), { status: "ok" });
      } finally {
        await cerrar();
      }
    });

    it("2. una solicitud autenticada recibe el estado del tenant", async () => {
      const TENANT = nuevoTenant();
      const { fabrica } = crearFabricaSocketFalsa();
      const { url, cerrar } = await levantarServidor(supabase, fabrica);
      try {
        const r = await fetch(`${url}/tenants/${TENANT}/estado`, { headers: { Authorization: `Bearer ${SECRETO}` } });
        assert.equal(r.status, 200);
        const body = (await r.json()) as { estado: string; idTenant: string };
        assert.equal(body.estado, "desconectado");
        assert.equal(body.idTenant, TENANT);
      } finally {
        await cerrar();
      }
    });

    it("3. una solicitud sin autenticación (o con secreto incorrecto) es rechazada", async () => {
      const TENANT = nuevoTenant();
      const { fabrica } = crearFabricaSocketFalsa();
      const { url, cerrar } = await levantarServidor(supabase, fabrica);
      try {
        const sinHeader = await fetch(`${url}/tenants/${TENANT}/estado`);
        assert.equal(sinHeader.status, 401);

        const secretoMalo = await fetch(`${url}/tenants/${TENANT}/estado`, {
          headers: { Authorization: "Bearer secreto-incorrecto" },
        });
        assert.equal(secretoMalo.status, 401);
      } finally {
        await cerrar();
      }
    });

    it("un idTenant que no es UUID nunca llega al manager -> 404", async () => {
      const { fabrica } = crearFabricaSocketFalsa();
      const { url, cerrar } = await levantarServidor(supabase, fabrica);
      try {
        const r = await fetch(`${url}/tenants/no-es-un-uuid/estado`, { headers: { Authorization: `Bearer ${SECRETO}` } });
        assert.equal(r.status, 404);
      } finally {
        await cerrar();
      }
    });

    it("flujo completo por HTTP: iniciar -> QR -> conectado -> desconectar", async (t) => {
      if (!migracionesListas) return t.skip("falta la migración dulabs_whatsapp_qr_sesiones");
      const TENANT = nuevoTenant();
      const { fabrica, llamadas } = crearFabricaSocketFalsa();
      const { url, cerrar } = await levantarServidor(supabase, fabrica);
      const auth = { Authorization: `Bearer ${SECRETO}` };
      try {
        const iniciar = (await (await fetch(`${url}/tenants/${TENANT}/iniciar`, { method: "POST", headers: auth })).json()) as {
          estado: string;
        };
        assert.equal(iniciar.estado, "conectando");

        llamadas[0].emitir({ tipo: "conectado", numero: "573000000099" });
        let estado: { estado: string } = { estado: "" };
        for (let i = 0; i < 50 && estado.estado !== "conectado"; i++) {
          await new Promise((r) => setTimeout(r, 40));
          estado = (await (await fetch(`${url}/tenants/${TENANT}/estado`, { headers: auth })).json()) as { estado: string };
        }
        assert.equal(estado.estado, "conectado");

        const enviarSinSesionOtroTenant = await fetch(`${url}/tenants/${nuevoTenant()}/enviar`, {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ telefono: "573148127388", mensaje: "no debería enviarse" }),
        });
        assert.equal(enviarSinSesionOtroTenant.status, 409);

        const desconectarBody = (await (
          await fetch(`${url}/tenants/${TENANT}/desconectar`, { method: "POST", headers: auth })
        ).json()) as { estado: string };
        assert.equal(desconectarBody.estado, "desconectado");
      } finally {
        await cerrar();
      }
    });
  }
);
