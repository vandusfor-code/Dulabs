/**
 * DuLabs Developer V1 -- Fase 6 (autorizado). E2E real contra Postgres del
 * Worker inbound reescrito: entrega NORMALIZADA (message.received /
 * message.status) al webhook del Developer con reintentos/DLQ (D2),
 * correlación de status por wamid con guarda multi-tenant + monotonicidad,
 * y resolución de reconciliation_pending (Opción 1: solo si hay wamid).
 *
 * REQUIERE la migración 20261012000000 (Fase 6) aplicada.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { procesarMensajeInbound } from "./handler";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";
import { configurarWebhook } from "@/lib/developer/webhook-config-store";
import { registrarEvento } from "@/lib/developer/events-store";
import { crearJobConIdempotencia, obtenerJobDelWorkspace } from "@/lib/developer/jobs-store";
import { obtenerLedgerDelJob } from "@/lib/developer/usage-ledger";
import type { FuncionLookupDns } from "@/lib/developer/ssrf-guard";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const lookupPublico: FuncionLookupDns = async () => [{ address: "93.184.216.34", family: 4 }];

describe(
  "DuLabs Developer V1 — worker-inbound handler real contra Postgres (Fase 6)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspaces: string[] = [];
    const claveOriginal = process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    before(() => { process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64"); });
    after(() => { if (claveOriginal === undefined) delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY; else process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveOriginal; });
    after(async () => {
      for (const ws of workspaces) {
        for (const t of ["dulabs_dev_events", "dulabs_dev_usage_ledger", "dulabs_dev_jobs", "dulabs_dev_idempotency_keys", "dulabs_dev_webhook_configs", "dulabs_dev_whatsapp_numbers"]) {
          await admin.from(t).delete().eq("workspace_id", ws).then(() => {}, () => {});
        }
      }
    });

    async function prepararNumero(ws: string, opts: { conWebhook?: boolean } = {}) {
      const phoneNumberId = `1055500${Math.floor(Math.random() * 1_000_000)}`;
      const numero = await registrarNumero(admin, { workspaceId: ws, phoneNumberId, metaToken: "EAAtoken" });
      if (!numero.ok) throw new Error("no se pudo crear número");
      if (opts.conWebhook ?? true) {
        const wh = await configurarWebhook(admin, { workspaceId: ws, whatsappNumberId: numero.fila.id, url: "https://example.com/dev-webhook" });
        if (!wh.ok) throw new Error("no se pudo configurar webhook");
      }
      return { numeroId: numero.fila.id, phoneNumberId };
    }

    function payloadMensaje(phoneNumberId: string) {
      return { entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ from: "573148127388", id: "wamid.INBOUND" + randomUUID().replace(/-/g, ""), timestamp: "1789500000", type: "text", text: { body: "hola inbound" } }] } }] }] };
    }
    function payloadStatus(phoneNumberId: string, wamid: string, status: string) {
      return { entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, statuses: [{ id: wamid, status, timestamp: "1789500100", recipient_id: "573148127388" }] } }] }] };
    }

    async function persistir(ws: string, tipo: string, payload: Record<string, unknown>) {
      const r = await registrarEvento(admin, { eventId: randomUUID(), workspaceId: ws, tipo: tipo as "received", payload });
      if (!r.registrado) throw new Error("no se registró el evento");
      return r.fila.id;
    }
    const leerEvento = async (id: number) => (await admin.from("dulabs_dev_events").select("entrega_estado,entrega_intentos,entrega_next_attempt_at").eq("id", id).single()).data!;

    it("mensaje entrante -> entrega NORMALIZADA (message.received) firmada, entrega_estado=entregado", async () => {
      const ws = randomUUID(); workspaces.push(ws);
      const { numeroId, phoneNumberId } = await prepararNumero(ws);
      const eventoId = await persistir(ws, "received", payloadMensaje(phoneNumberId));

      let posts = 0; let bodyEnviado: any = null; let headers: any = null;
      const fetchFix = (async (_u: string, init?: RequestInit) => { posts++; bodyEnviado = JSON.parse(init!.body as string); headers = init!.headers; return new Response("ok", { status: 200 }); }) as typeof fetch;

      const r = await procesarMensajeInbound({ supabase: admin, fetchImpl: fetchFix, lookupDnsFn: lookupPublico }, { eventoId });
      assert.equal(r.httpStatus, 200);
      assert.equal(r.motivo, "entregado:message.received");
      assert.equal(posts, 1);
      assert.equal(bodyEnviado.event_type, "message.received");
      assert.equal(bodyEnviado.from, "573148127388");
      assert.equal(bodyEnviado.text, "hola inbound");
      assert.equal(bodyEnviado.whatsapp_number_id, numeroId);
      assert.ok(bodyEnviado.raw, "debe incluir el raw de Meta");
      assert.ok(headers["X-DuLabs-Signature"] && headers["X-DuLabs-Event-ID"], "firmado con HMAC + event id");
      assert.equal((await leerEvento(eventoId)).entrega_estado, "entregado");
    });

    it("redelivery de Pub/Sub -> idempotente: cero segundo POST (entrega ya terminal)", async () => {
      const ws = randomUUID(); workspaces.push(ws);
      const { phoneNumberId } = await prepararNumero(ws);
      const eventoId = await persistir(ws, "received", payloadMensaje(phoneNumberId));
      let posts = 0;
      const fetchFix = (async () => { posts++; return new Response("ok", { status: 200 }); }) as typeof fetch;
      const deps = { supabase: admin, fetchImpl: fetchFix, lookupDnsFn: lookupPublico };
      await procesarMensajeInbound(deps, { eventoId });
      const r2 = await procesarMensajeInbound(deps, { eventoId });
      assert.equal(posts, 1, "exactamente 1 entrega real pese a 2 entregas");
      assert.match(r2.motivo, /^entrega_ya_terminal:entregado/);
    });

    it("sin webhook configurado -> sin_webhook, cero POST", async () => {
      const ws = randomUUID(); workspaces.push(ws);
      const { phoneNumberId } = await prepararNumero(ws, { conWebhook: false });
      const eventoId = await persistir(ws, "received", payloadMensaje(phoneNumberId));
      let posts = 0;
      const r = await procesarMensajeInbound({ supabase: admin, fetchImpl: (async () => { posts++; return new Response("ok"); }) as typeof fetch, lookupDnsFn: lookupPublico }, { eventoId });
      assert.equal(posts, 0);
      assert.equal(r.motivo, "sin_webhook_configurado_o_pausado");
      assert.equal((await leerEvento(eventoId)).entrega_estado, "sin_webhook");
    });

    it("SEGURIDAD (DNS rebinding) -- webhook que resuelve a IP interna al momento del envío -> DLQ, cero POST", async () => {
      const ws = randomUUID(); workspaces.push(ws);
      const { phoneNumberId } = await prepararNumero(ws);
      const eventoId = await persistir(ws, "received", payloadMensaje(phoneNumberId));
      let posts = 0;
      const lookupInterno: FuncionLookupDns = async () => [{ address: "169.254.169.254", family: 4 }];
      const r = await procesarMensajeInbound({ supabase: admin, fetchImpl: (async () => { posts++; return new Response("ok"); }) as typeof fetch, lookupDnsFn: lookupInterno }, { eventoId });
      assert.equal(posts, 0, "jamás se toca la IP interna");
      assert.match(r.motivo, /^webhook_destino_no_seguro:/);
      assert.equal((await leerEvento(eventoId)).entrega_estado, "dlq");
    });

    it("D2 -- 5xx del Developer es REINTENTABLE (fallido + backoff), luego un 200 entrega y cierra", async () => {
      const ws = randomUUID(); workspaces.push(ws);
      const { phoneNumberId } = await prepararNumero(ws);
      const eventoId = await persistir(ws, "received", payloadMensaje(phoneNumberId));
      const r1 = await procesarMensajeInbound({ supabase: admin, fetchImpl: (async () => new Response("boom", { status: 502 })) as typeof fetch, lookupDnsFn: lookupPublico }, { eventoId });
      assert.match(r1.motivo, /^entrega_reintentable:http_502$/);
      let ev = await leerEvento(eventoId);
      assert.equal(ev.entrega_estado, "fallido");
      assert.equal(ev.entrega_intentos, 1);
      assert.ok(new Date(ev.entrega_next_attempt_at!).getTime() > Date.now(), "backoff futuro");

      // Simula que venció el backoff (mismo patrón que outbound/lease).
      await admin.from("dulabs_dev_events").update({ entrega_next_attempt_at: new Date(Date.now() - 1_000).toISOString() }).eq("id", eventoId);
      const r2 = await procesarMensajeInbound({ supabase: admin, fetchImpl: (async () => new Response("ok", { status: 200 })) as typeof fetch, lookupDnsFn: lookupPublico }, { eventoId });
      assert.equal(r2.motivo, "entregado:message.received");
      assert.equal((await leerEvento(eventoId)).entrega_estado, "entregado");
    });

    it("D2 -- 4xx del Developer (400) es TERMINAL -> DLQ, sin reintento", async () => {
      const ws = randomUUID(); workspaces.push(ws);
      const { phoneNumberId } = await prepararNumero(ws);
      const eventoId = await persistir(ws, "received", payloadMensaje(phoneNumberId));
      const r = await procesarMensajeInbound({ supabase: admin, fetchImpl: (async () => new Response("bad", { status: 400 })) as typeof fetch, lookupDnsFn: lookupPublico }, { eventoId });
      assert.match(r.motivo, /^entrega_dlq:http_400$/);
      assert.equal((await leerEvento(eventoId)).entrega_estado, "dlq");
    });

    async function prepararJobConWamid(ws: string, numeroId: string, wamid: string, extra: Record<string, unknown> = {}) {
      const job = await crearJobConIdempotencia(admin, { workspaceId: ws, whatsappNumberId: numeroId, idempotencyKey: `idem-${randomUUID()}`, payload: { whatsappNumberId: numeroId, to: "573148127388", type: "text", text: { body: "x" } } });
      if (job.resultado === "conflicto_payload_distinto") throw new Error("conflicto");
      await admin.from("dulabs_dev_jobs").update({ wamid, ...extra }).eq("id", job.jobId);
      return job.jobId;
    }

    it("status delivered -> correlaciona delivery_status del Job por wamid + entrega el status normalizado", async () => {
      const ws = randomUUID(); workspaces.push(ws);
      const { numeroId, phoneNumberId } = await prepararNumero(ws);
      const wamid = "wamid.OUTBOUND" + randomUUID().replace(/-/g, "");
      const jobId = await prepararJobConWamid(ws, numeroId, wamid);

      let bodyEnviado: any = null;
      const fetchFix = (async (_u: string, init?: RequestInit) => { bodyEnviado = JSON.parse(init!.body as string); return new Response("ok", { status: 200 }); }) as typeof fetch;
      const eventoId = await persistir(ws, "delivered", payloadStatus(phoneNumberId, wamid, "delivered"));
      const r = await procesarMensajeInbound({ supabase: admin, fetchImpl: fetchFix, lookupDnsFn: lookupPublico }, { eventoId });
      assert.equal(r.motivo, "entregado:message.status");

      const job = await obtenerJobDelWorkspace(admin, { workspaceId: ws, jobId });
      assert.equal(job!.delivery_status, "delivered");
      assert.equal(job!.delivery_status_rank, 2);
      assert.equal(bodyEnviado.event_type, "message.status");
      assert.equal(bodyEnviado.status, "delivered");
      assert.equal(bodyEnviado.wamid, wamid);
    });

    it("MONOTONICIDAD -- un status atrasado (delivered) nunca retrocede un delivery_status ya en 'read'", async () => {
      const ws = randomUUID(); workspaces.push(ws);
      const { numeroId, phoneNumberId } = await prepararNumero(ws);
      const wamid = "wamid.OUTBOUND" + randomUUID().replace(/-/g, "");
      const jobId = await prepararJobConWamid(ws, numeroId, wamid);
      const fetchFix = (async () => new Response("ok", { status: 200 })) as typeof fetch;

      const evRead = await persistir(ws, "read", payloadStatus(phoneNumberId, wamid, "read"));
      await procesarMensajeInbound({ supabase: admin, fetchImpl: fetchFix, lookupDnsFn: lookupPublico }, { eventoId: evRead });
      const evDelivered = await persistir(ws, "delivered", payloadStatus(phoneNumberId, wamid, "delivered"));
      await procesarMensajeInbound({ supabase: admin, fetchImpl: fetchFix, lookupDnsFn: lookupPublico }, { eventoId: evDelivered });

      const job = await obtenerJobDelWorkspace(admin, { workspaceId: ws, jobId });
      assert.equal(job!.delivery_status, "read", "delivered NO debe pisar un read ya alcanzado");
      assert.equal(job!.delivery_status_rank, 3);
    });

    it("reconciliation_pending CON wamid (Opción 1) -> un status sent lo resuelve a success_confirmed + usage confirmado, sin blind resend", async () => {
      const ws = randomUUID(); workspaces.push(ws);
      const { numeroId, phoneNumberId } = await prepararNumero(ws);
      const wamid = "wamid.OUTBOUND" + randomUUID().replace(/-/g, "");
      // Seed: job en reconciliation_pending pero CON wamid (escenario seguro donde SÍ hay correlación).
      const jobId = await prepararJobConWamid(ws, numeroId, wamid, { status: "reconciliation_pending", physical_outcome: "uncertain", network_attempts: 1 });
      assert.equal((await obtenerLedgerDelJob(admin, { workspaceId: ws, jobId }))!.estado, "reservado");

      const eventoId = await persistir(ws, "sent", payloadStatus(phoneNumberId, wamid, "sent"));
      await procesarMensajeInbound({ supabase: admin, fetchImpl: (async () => new Response("ok", { status: 200 })) as typeof fetch, lookupDnsFn: lookupPublico }, { eventoId });

      const job = await obtenerJobDelWorkspace(admin, { workspaceId: ws, jobId });
      assert.equal(job!.status, "success_confirmed", "resuelto por el status webhook, sin endpoint ficticio");
      assert.equal(job!.network_attempts, 1, "cero intento físico nuevo -- no blind resend");
      assert.equal((await obtenerLedgerDelJob(admin, { workspaceId: ws, jobId }))!.estado, "confirmado");
    });

    it("CROSS-TENANT -- un status cuyo wamid pertenece a un Job de OTRO workspace NO contamina (job_no_encontrado_por_wamid en el workspace del número)", async () => {
      const wsA = randomUUID(); workspaces.push(wsA);
      const wsB = randomUUID(); workspaces.push(wsB);
      const a = await prepararNumero(wsA);
      const b = await prepararNumero(wsB);
      const wamid = "wamid.OUTBOUND" + randomUUID().replace(/-/g, "");
      const jobA = await prepararJobConWamid(wsA, a.numeroId, wamid); // el wamid vive en el job de A

      // Llega un status por el número de B con ESE wamid (ataque cross-tenant).
      const eventoId = await persistir(wsB, "delivered", payloadStatus(b.phoneNumberId, wamid, "delivered"));
      await procesarMensajeInbound({ supabase: admin, fetchImpl: (async () => new Response("ok", { status: 200 })) as typeof fetch, lookupDnsFn: lookupPublico }, { eventoId });

      const job = await obtenerJobDelWorkspace(admin, { workspaceId: wsA, jobId: jobA });
      assert.equal(job!.delivery_status, null, "el Job de A NUNCA debe ser tocado por un status llegado por el número de B");
    });
  }
);
