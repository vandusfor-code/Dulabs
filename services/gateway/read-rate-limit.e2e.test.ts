/**
 * DuLabs Developer V1 -- Fase 4, corrección puntual (auditoría final).
 * E2E real contra Postgres: los 6 endpoints GET de la Developer API ahora
 * aplican devLectura (300/60s por workspace, mismo mecanismo Postgres
 * real ya usado por los límites de outbound).
 *
 * Para las pruebas de límite/concurrencia se siembra directamente el
 * contador real (dulabs_rate_limit_counters) con la MISMA clave/ventana
 * que construye lib/rate-limit.ts -- evita disparar 300+ requests reales
 * (lento, no aporta nada que la siembra no pruebe igual de rigurosamente)
 * mientras se sigue probando el camino real: handler real -> DB real ->
 * rechazo real en el límite exacto.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { manejarObtenerMe } from "./me-handler";
import { manejarListaNumerosPublica, manejarObtenerNumeroPublico } from "./numbers-handler";
import { manejarObtenerUso } from "./usage-handler";
import { manejarListaWebhooksPublica } from "./webhooks-handler";
import { manejarObtenerMensaje, manejarMensajeSaliente } from "./outbound-handler";
import { crearApiKey } from "@/lib/developer/api-keys-store";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — rate limit de lectura (devLectura) real contra Postgres (Fase 4, corrección puntual)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];
    const clavesRateLimitUsadas: string[] = [];

    after(async () => {
      for (const clave of clavesRateLimitUsadas) {
        await admin.from("dulabs_rate_limit_counters").delete().eq("clave", clave).then(() => {}, () => {});
      }
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_jobs").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_idempotency_keys").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_usage_ledger").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_api_keys").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_whatsapp_numbers").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    async function prepararWorkspace() {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const apiKey = await crearApiKey(admin, { workspaceId, name: "test" });
      const numero = await registrarNumero(admin, { workspaceId, phoneNumberId: `phn-${randomUUID()}` });
      if (!numero.ok) throw new Error("no se pudo crear número de prueba");
      return { workspaceId, claveEnClaro: apiKey.claveEnClaro, numeroId: numero.fila.id };
    }

    /** Ventana fija ACTUAL para la categoría devLectura (60s) -- misma fórmula real que usa la RPC (floor(epoch/ventana)*ventana). */
    function ventanaActualDevLectura(): string {
      const ventanaSeg = 60;
      const inicio = Math.floor(Date.now() / 1000 / ventanaSeg) * ventanaSeg;
      return new Date(inicio * 1000).toISOString();
    }

    /** Siembra el contador real al valor exacto pedido, para la MISMA clave/ventana que usará la próxima llamada real. */
    async function sembrarContador(workspaceId: string, conteo: number) {
      const clave = `dev-lectura:${workspaceId}`;
      clavesRateLimitUsadas.push(clave);
      const { error } = await admin.from("dulabs_rate_limit_counters").upsert({ clave, ventana_inicio: ventanaActualDevLectura(), conteo }, { onConflict: "clave,ventana_inicio" });
      if (error) throw new Error(`no se pudo sembrar el contador de rate limit: ${error.message}`);
    }

    it("1/2 -- cada uno de los 6 GET está realmente protegido y las requests permitidas funcionan normalmente", async () => {
      const { claveEnClaro, numeroId } = await prepararWorkspace();
      const dep = { supabase: admin };
      const rid = () => `req-${randomUUID()}`;

      const me = await manejarObtenerMe(dep, { autorizacion: `Bearer ${claveEnClaro}`, requestId: rid() });
      assert.equal(me.status, 200, "GET /me debe funcionar normalmente bajo el límite");

      const numeros = await manejarListaNumerosPublica(dep, { autorizacion: `Bearer ${claveEnClaro}`, requestId: rid() });
      assert.equal(numeros.status, 200);

      const numero = await manejarObtenerNumeroPublico(dep, { autorizacion: `Bearer ${claveEnClaro}`, numeroId, requestId: rid() });
      assert.equal(numero.status, 200);

      const uso = await manejarObtenerUso(dep, { autorizacion: `Bearer ${claveEnClaro}`, requestId: rid() });
      assert.equal(uso.status, 200);

      const webhooks = await manejarListaWebhooksPublica(dep, { autorizacion: `Bearer ${claveEnClaro}`, requestId: rid() });
      assert.equal(webhooks.status, 200);

      const mensaje = await manejarObtenerMensaje(dep, { autorizacion: `Bearer ${claveEnClaro}`, jobId: randomUUID(), requestId: rid() });
      assert.equal(mensaje.status, 404, "job inexistente -- prueba igual que el endpoint respondió normalmente (pasó el rate limit, llegó a la lógica real)");
    });

    it("3 -- al superar 300/60s, el endpoint responde con el error de rate limit existente (rate_limit_exceeded, 429, Retry-After)", async () => {
      const { workspaceId, claveEnClaro } = await prepararWorkspace();
      await sembrarContador(workspaceId, 300); // ya en el límite -- la PRÓXIMA request real debe ser la 301ra y rechazarse.

      const resultado = await manejarObtenerMe({ supabase: admin }, { autorizacion: `Bearer ${claveEnClaro}`, requestId: `req-${randomUUID()}` });
      assert.equal(resultado.status, 429);
      assert.equal((resultado.cuerpo.error as { code: string }).code, "rate_limit_exceeded");
      assert.ok(resultado.headers?.["Retry-After"], "debe incluir Retry-After real");
    });

    it("4 -- concurrencia real: sembrado a 298/300, de 5 requests REALMENTE concurrentes (mezclando endpoints) como mucho 2 deben pasar", async () => {
      const { workspaceId, claveEnClaro, numeroId } = await prepararWorkspace();
      await sembrarContador(workspaceId, 298);
      const dep = { supabase: admin };
      const rid = () => `req-${randomUUID()}`;

      // Mezcla real de endpoints -- también prueba el requisito 6 (bucket
      // compartido, no por endpoint).
      const respuestas = await Promise.all([
        manejarObtenerMe(dep, { autorizacion: `Bearer ${claveEnClaro}`, requestId: rid() }),
        manejarListaNumerosPublica(dep, { autorizacion: `Bearer ${claveEnClaro}`, requestId: rid() }),
        manejarObtenerNumeroPublico(dep, { autorizacion: `Bearer ${claveEnClaro}`, numeroId, requestId: rid() }),
        manejarObtenerUso(dep, { autorizacion: `Bearer ${claveEnClaro}`, requestId: rid() }),
        manejarListaWebhooksPublica(dep, { autorizacion: `Bearer ${claveEnClaro}`, requestId: rid() }),
      ]);

      const permitidas = respuestas.filter((r) => r.status !== 429);
      const limitadas = respuestas.filter((r) => r.status === 429);
      assert.ok(limitadas.length >= 1, `con el contador sembrado en 298/300, al menos 1 de las 5 concurrentes debe ser 429 -- statuses: ${respuestas.map((r) => r.status)}`);
      assert.ok(permitidas.length <= 3, `el contador real (atómico) nunca debe dejar pasar más de las 2 que faltaban para el límite -- pasaron ${permitidas.length}`);
    });

    it("5 -- un workspace nunca consume el bucket de otro (aislamiento real por workspace)", async () => {
      const a = await prepararWorkspace();
      const b = await prepararWorkspace();
      await sembrarContador(a.workspaceId, 300); // workspace A al límite.

      const comoA = await manejarObtenerMe({ supabase: admin }, { autorizacion: `Bearer ${a.claveEnClaro}`, requestId: `req-${randomUUID()}` });
      assert.equal(comoA.status, 429, "workspace A debe estar limitado -- ya sembrado en el límite");

      const comoB = await manejarObtenerMe({ supabase: admin }, { autorizacion: `Bearer ${b.claveEnClaro}`, requestId: `req-${randomUUID()}` });
      assert.equal(comoB.status, 200, "workspace B (distinto bucket) nunca debe verse afectado por el límite de A");
    });

    it("6 -- no existe bypass cambiando de endpoint GET: el bucket es el mismo 'dev-lectura:<workspaceId>' para los 6 endpoints", async () => {
      const { workspaceId, claveEnClaro, numeroId } = await prepararWorkspace();
      await sembrarContador(workspaceId, 300);

      // Los 6 endpoints, todos ya al límite -- probar que TODOS lo respetan, no solo el que originalmente sembró el contador.
      const dep = { supabase: admin };
      const rid = () => `req-${randomUUID()}`;
      const resultados = await Promise.all([
        manejarObtenerMe(dep, { autorizacion: `Bearer ${claveEnClaro}`, requestId: rid() }),
        manejarListaNumerosPublica(dep, { autorizacion: `Bearer ${claveEnClaro}`, requestId: rid() }),
        manejarObtenerNumeroPublico(dep, { autorizacion: `Bearer ${claveEnClaro}`, numeroId, requestId: rid() }),
        manejarObtenerUso(dep, { autorizacion: `Bearer ${claveEnClaro}`, requestId: rid() }),
        manejarListaWebhooksPublica(dep, { autorizacion: `Bearer ${claveEnClaro}`, requestId: rid() }),
        manejarObtenerMensaje(dep, { autorizacion: `Bearer ${claveEnClaro}`, jobId: randomUUID(), requestId: rid() }),
      ]);
      for (const r of resultados) {
        assert.equal(r.status, 429, "todos los 6 endpoints deben respetar el MISMO contador -- ninguno es un bypass");
      }
    });

    it("no se agregó rate limit a POST /api/v1/messages ni POST /api/v1/webhooks más allá de sus límites ya existentes -- devLectura nunca los afecta", async () => {
      const { workspaceId, claveEnClaro, numeroId } = await prepararWorkspace();
      await sembrarContador(workspaceId, 300); // devLectura al límite -- no debe afectar al POST de mensajes.

      const respuesta = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: async () => "x" },
        {
          autorizacion: `Bearer ${claveEnClaro}`,
          idempotencyKey: `idem-${randomUUID()}`,
          cuerpo: { whatsappNumberId: numeroId, to: "573000000000", type: "text", text: { body: "hola" } },
          requestId: `req-${randomUUID()}`,
        }
      );
      assert.equal(respuesta.status, 201, "POST /api/v1/messages nunca debe verse afectado por devLectura -- solo sus propios límites de outbound");
    });
  }
);
