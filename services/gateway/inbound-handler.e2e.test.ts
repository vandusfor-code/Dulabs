/**
 * DuLabs Developer V1 -- Fase 3 (autorizado). E2E real contra Postgres para
 * el handler inbound de Meta del Gateway -- firma real, dedupe real,
 * event_id determinista real (sección A del documento de infraestructura).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { manejarVerificacionMeta, manejarWebhookMeta } from "./inbound-handler";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — gateway inbound-handler real contra Postgres (Fase 3)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const appSecret = "app-secret-de-prueba";
    const verifyToken = "verify-token-de-prueba";
    const workspacesUsados: string[] = [];

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_events").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_whatsapp_numbers").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    function firmar(cuerpo: string): string {
      return "sha256=" + createHmac("sha256", appSecret).update(cuerpo).digest("hex");
    }

    async function crearNumero(workspaceId: string, phoneNumberId: string) {
      const r = await registrarNumero(admin, { workspaceId, phoneNumberId });
      if (!r.ok) throw new Error("no se pudo crear número de prueba");
      return r.fila.id;
    }

    function payloadStatus(phoneNumberId: string, status: string, timestamp: string) {
      return JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ id: "waba-1", changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, statuses: [{ id: "wamid.X", status, timestamp }] } }] }],
      });
    }

    it("GET: hub.verify_token correcto -> 200 con el hub.challenge exacto", () => {
      const r = manejarVerificacionMeta({ supabase: admin, topicInbound: "x", metaAppSecret: appSecret, metaVerifyToken: verifyToken }, { hubMode: "subscribe", hubVerifyToken: verifyToken, hubChallenge: "reto-123" });
      assert.equal(r.status, 200);
      assert.equal(r.cuerpo, "reto-123");
    });

    it("GET: hub.verify_token incorrecto -> 403", () => {
      const r = manejarVerificacionMeta({ supabase: admin, topicInbound: "x", metaAppSecret: appSecret, metaVerifyToken: verifyToken }, { hubMode: "subscribe", hubVerifyToken: "otro", hubChallenge: "reto-123" });
      assert.equal(r.status, 403);
    });

    it("POST: firma inválida -> 403, NADA se persiste", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const phoneNumberId = `phn-${randomUUID()}`;
      await crearNumero(workspaceId, phoneNumberId);
      const cuerpo = payloadStatus(phoneNumberId, "sent", "1000");

      const r = await manejarWebhookMeta(
        { supabase: admin, topicInbound: "x", metaAppSecret: appSecret, metaVerifyToken: verifyToken, publicar: async () => "msg-id" },
        { firmaHeader: "sha256=firmainvalida", cuerpoCrudo: cuerpo }
      );
      assert.equal(r.status, 403);

      const { count } = await admin.from("dulabs_dev_events").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
      assert.equal(count, 0);
    });

    it("POST: firma válida, número no registrado -> 200, nada persistido (no hay a quién atribuírselo)", async () => {
      const cuerpo = payloadStatus(`phn-inexistente-${randomUUID()}`, "sent", "1000");
      const r = await manejarWebhookMeta(
        { supabase: admin, topicInbound: "x", metaAppSecret: appSecret, metaVerifyToken: verifyToken, publicar: async () => "msg-id" },
        { firmaHeader: firmar(cuerpo), cuerpoCrudo: cuerpo }
      );
      assert.equal(r.status, 200);
      assert.equal((r.cuerpo as { procesado: boolean }).procesado, false);
    });

    it("MISMO webhook enviado DOS VECES -> un solo evento lógico (dedupe real por event_id, UNIQUE en Postgres)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const phoneNumberId = `phn-${randomUUID()}`;
      await crearNumero(workspaceId, phoneNumberId);
      const cuerpo = payloadStatus(phoneNumberId, "sent", "1000");
      const firma = firmar(cuerpo);

      let publicaciones = 0;
      const deps = { supabase: admin, topicInbound: "x", metaAppSecret: appSecret, metaVerifyToken: verifyToken, publicar: async () => { publicaciones++; return "msg-id"; } };

      const r1 = await manejarWebhookMeta(deps, { firmaHeader: firma, cuerpoCrudo: cuerpo });
      const r2 = await manejarWebhookMeta(deps, { firmaHeader: firma, cuerpoCrudo: cuerpo });

      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);
      assert.equal((r1.cuerpo as { procesado: boolean }).procesado, true);
      assert.equal((r2.cuerpo as { procesado: boolean }).procesado, false, "la segunda entrega del MISMO webhook no debe procesarse de nuevo");
      assert.equal(publicaciones, 1, "solo debe haberse publicado UNA vez a Pub/Sub");

      const { count } = await admin.from("dulabs_dev_events").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
      assert.equal(count, 1, "un solo evento lógico persistido, pese a 2 entregas HTTP");
    });

    it("REQUISITO CRÍTICO: sent, delivered y read del MISMO wamid generan event_id DIFERENTES -> 3 eventos lógicos distintos, no deduplicados entre sí", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const phoneNumberId = `phn-${randomUUID()}`;
      await crearNumero(workspaceId, phoneNumberId);

      const deps = { supabase: admin, topicInbound: "x", metaAppSecret: appSecret, metaVerifyToken: verifyToken, publicar: async () => "msg-id" };

      const cuerpoSent = payloadStatus(phoneNumberId, "sent", "1000");
      const cuerpoDelivered = payloadStatus(phoneNumberId, "delivered", "1001");
      const cuerpoRead = payloadStatus(phoneNumberId, "read", "1002");

      await manejarWebhookMeta(deps, { firmaHeader: firmar(cuerpoSent), cuerpoCrudo: cuerpoSent });
      await manejarWebhookMeta(deps, { firmaHeader: firmar(cuerpoDelivered), cuerpoCrudo: cuerpoDelivered });
      await manejarWebhookMeta(deps, { firmaHeader: firmar(cuerpoRead), cuerpoCrudo: cuerpoRead });

      const { count } = await admin.from("dulabs_dev_events").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
      assert.equal(count, 3, "sent/delivered/read del mismo wamid deben persistirse como 3 eventos lógicos distintos");
    });
  }
);
