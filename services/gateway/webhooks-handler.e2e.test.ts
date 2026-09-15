/**
 * DuLabs Developer V1 -- Fase 4 (autorizado, decisión D2). E2E real contra
 * Postgres para GET/POST /api/v1/webhooks (superficie pública por API
 * key) y para el fix de seguridad de ownership aplicado también a
 * manejarConfigurarWebhook (management-handler.ts, superficie de sesión)
 * -- mismo hallazgo, misma corrección, dos superficies.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { manejarListaWebhooksPublica, manejarConfigurarWebhookPublico } from "./webhooks-handler";
import { manejarConfigurarWebhook } from "./management-handler";
import { crearApiKey } from "@/lib/developer/api-keys-store";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";
import { obtenerWebhookDelNumero } from "@/lib/developer/webhook-config-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — webhooks (público por API key + fix de ownership) real contra Postgres (Fase 4)",
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
        await admin.from("dulabs_dev_webhook_configs").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
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

    it("POST configura el webhook real (SSRF-guard ya se ejecuta vía configurarWebhook), GET lo lista sin el secreto", async () => {
      const { workspaceId, claveEnClaro, numeroId } = await prepararWorkspace();

      const post = await manejarConfigurarWebhookPublico(
        { supabase: admin },
        { autorizacion: `Bearer ${claveEnClaro}`, cuerpo: { whatsappNumberId: numeroId, url: "https://example.com/webhook" }, requestId: `req-${randomUUID()}` }
      );
      assert.equal(post.status, 201);
      assert.ok(post.cuerpo.secret, "el secreto se muestra UNA vez en la creación");

      const get = await manejarListaWebhooksPublica({ supabase: admin }, { autorizacion: `Bearer ${claveEnClaro}`, requestId: `req-${randomUUID()}` });
      assert.equal(get.status, 200);
      const webhooks = get.cuerpo.webhooks as Array<Record<string, unknown>>;
      assert.equal(webhooks.length, 1);
      assert.equal(webhooks[0].url, "https://example.com/webhook");
      assert.equal(webhooks[0].secret, undefined, "GET nunca debe incluir el secreto");
      assert.ok(!JSON.stringify(get.cuerpo).includes("whsec_"), "el secreto nunca debe aparecer en la lista");

      const filaReal = await obtenerWebhookDelNumero(admin, { workspaceId, whatsappNumberId: numeroId });
      assert.ok(filaReal, "debe persistir de verdad");
    });

    it("POST con whatsappNumberId de OTRO workspace -> 404, nunca sobrescribe el webhook del dueño real (fix de seguridad)", async () => {
      const victima = await prepararWorkspace();
      const postVictima = await manejarConfigurarWebhookPublico(
        { supabase: admin },
        { autorizacion: `Bearer ${victima.claveEnClaro}`, cuerpo: { whatsappNumberId: victima.numeroId, url: "https://example.com/victima-webhook" }, requestId: `req-${randomUUID()}` }
      );
      assert.equal(postVictima.status, 201);

      const atacante = await prepararWorkspace();
      const postAtacante = await manejarConfigurarWebhookPublico(
        { supabase: admin },
        { autorizacion: `Bearer ${atacante.claveEnClaro}`, cuerpo: { whatsappNumberId: victima.numeroId, url: "https://example.com/atacante-hijack" }, requestId: `req-${randomUUID()}` }
      );
      assert.equal(postAtacante.status, 404, "el número de la víctima no pertenece al workspace del atacante -- debe rechazarse ANTES de tocar la tabla");
      assert.equal((postAtacante.cuerpo.error as { code: string }).code, "not_found");

      const filaReal = await obtenerWebhookDelNumero(admin, { workspaceId: victima.workspaceId, whatsappNumberId: victima.numeroId });
      assert.ok(filaReal, "el webhook de la víctima debe seguir existiendo");
      assert.equal(filaReal!.url, "https://example.com/victima-webhook", "NUNCA debe haber sido sobrescrito por el atacante");
    });

    it("URL SSRF (localhost) se rechaza vía la MISMA validación existente -- reusada, no duplicada", async () => {
      const { claveEnClaro, numeroId } = await prepararWorkspace();
      const resultado = await manejarConfigurarWebhookPublico(
        { supabase: admin },
        { autorizacion: `Bearer ${claveEnClaro}`, cuerpo: { whatsappNumberId: numeroId, url: "http://localhost:8080/hook" }, requestId: `req-${randomUUID()}` }
      );
      assert.equal(resultado.status, 400);
      assert.equal((resultado.cuerpo.error as { code: string }).code, "invalid_request");
    });

    it("REGRESIÓN DE SEGURIDAD (management-handler.ts, superficie de sesión) -- manejarConfigurarWebhook también rechaza un whatsappNumberId de otro workspace", async () => {
      const victima = await prepararWorkspace();
      const postVictima = await manejarConfigurarWebhook({ supabase: admin }, victima.workspaceId, { whatsappNumberId: victima.numeroId, url: "https://example.com/victima-session-webhook" });
      assert.equal(postVictima.status, 201);

      const atacante = await prepararWorkspace();
      const postAtacante = await manejarConfigurarWebhook({ supabase: admin }, atacante.workspaceId, { whatsappNumberId: victima.numeroId, url: "https://example.com/atacante-hijack-session" });
      assert.equal(postAtacante.status, 404, "misma corrección aplicada a la superficie de sesión -- antes de este fix, esto sobrescribía el webhook de la víctima");

      const filaReal = await obtenerWebhookDelNumero(admin, { workspaceId: victima.workspaceId, whatsappNumberId: victima.numeroId });
      assert.equal(filaReal!.url, "https://example.com/victima-session-webhook", "no debe haber sido secuestrado");
    });
  }
);
