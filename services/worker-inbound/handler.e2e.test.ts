/**
 * DuLabs Developer V1 -- Fase 3 (autorizado). E2E real contra Postgres para
 * el handler del Worker inbound -- prueba real de que recibir el MISMO
 * evento dos veces (redelivery de Pub/Sub) no reenvía dos veces al
 * Developer Webhook (idempotencia real, no solo dedupe de persistencia).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { procesarMensajeInbound } from "./handler";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";
import { configurarWebhook } from "@/lib/developer/webhook-config-store";
import { registrarEvento } from "@/lib/developer/events-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — worker-inbound handler real contra Postgres (Fase 3)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];

    const claveOriginal = process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    before(() => {
      process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    });
    after(() => {
      if (claveOriginal === undefined) delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
      else process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveOriginal;
    });

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_events").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_webhook_configs").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_whatsapp_numbers").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    async function prepararEvento(workspaceId: string) {
      const phoneNumberId = `phn-${randomUUID()}`;
      const numero = await registrarNumero(admin, { workspaceId, phoneNumberId });
      if (!numero.ok) throw new Error("no se pudo crear número");
      const webhook = await configurarWebhook(admin, { workspaceId, whatsappNumberId: numero.fila.id, url: "https://example.com/developer-webhook" });
      if (!webhook.ok) throw new Error("no se pudo configurar webhook");

      const payload = { entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId } } }] }] };
      const registro = await registrarEvento(admin, { eventId: randomUUID(), workspaceId, tipo: "received", payload });
      if (!registro.registrado) throw new Error("no se pudo registrar evento");
      return registro.fila.id;
    }

    it("procesa un evento nuevo: reenvía al Developer Webhook exactamente una vez, queda marcado procesado", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const eventoId = await prepararEvento(workspaceId);

      let reenvios = 0;
      const fetchFixture = (async () => {
        reenvios++;
        return new Response("ok", { status: 200 });
      }) as typeof fetch;

      const resultado = await procesarMensajeInbound({ supabase: admin, fetchImpl: fetchFixture }, { eventoId });
      assert.equal(resultado.httpStatus, 200);
      assert.equal(reenvios, 1);

      const { data } = await admin.from("dulabs_dev_events").select("procesado_en").eq("id", eventoId).single();
      assert.ok(data!.procesado_en, "debe quedar marcado como procesado");
    });

    it("IDEMPOTENCIA REAL: recibir el MISMO evento dos veces (simulando redelivery de Pub/Sub) -- solo UN reenvío real al Developer Webhook, la segunda es un no-op seguro", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const eventoId = await prepararEvento(workspaceId);

      let reenvios = 0;
      const fetchFixture = (async () => {
        reenvios++;
        return new Response("ok", { status: 200 });
      }) as typeof fetch;
      const deps = { supabase: admin, fetchImpl: fetchFixture };

      const r1 = await procesarMensajeInbound(deps, { eventoId });
      const r2 = await procesarMensajeInbound(deps, { eventoId });

      assert.equal(r1.httpStatus, 200);
      assert.equal(r2.httpStatus, 200);
      assert.equal(r2.motivo, "ya_procesado_por_otra_entrega");
      assert.equal(reenvios, 1, "cero efectos secundarios duplicados -- exactamente un reenvío real, pese a 2 entregas");
    });

    it("IDEMPOTENCIA bajo concurrencia real: dos entregas SIMULTÁNEAS del mismo evento -- exactamente un reenvío real (CAS real, no una condición de carrera)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const eventoId = await prepararEvento(workspaceId);

      let reenvios = 0;
      const fetchFixture = (async () => {
        reenvios++;
        await new Promise((r) => setTimeout(r, 30));
        return new Response("ok", { status: 200 });
      }) as typeof fetch;
      const deps = { supabase: admin, fetchImpl: fetchFixture };

      const [r1, r2] = await Promise.all([procesarMensajeInbound(deps, { eventoId }), procesarMensajeInbound(deps, { eventoId })]);
      assert.equal(r1.httpStatus, 200);
      assert.equal(r2.httpStatus, 200);
      assert.equal(reenvios, 1, `exactamente 1 reenvío real bajo concurrencia real, hubo ${reenvios}`);
    });

    it("evento inexistente: ACK sin lanzar", async () => {
      const resultado = await procesarMensajeInbound({ supabase: admin, fetchImpl: (async () => new Response("ok")) as typeof fetch }, { eventoId: 999_999_999 });
      assert.equal(resultado.httpStatus, 200);
      assert.equal(resultado.motivo, "evento_no_encontrado");
    });
  }
);
