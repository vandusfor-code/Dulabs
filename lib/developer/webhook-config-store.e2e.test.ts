/**
 * DuLabs Developer V1 -- Fase 2 (autorizado, sección 8 del brief). E2E real
 * contra Postgres para lib/developer/webhook-config-store.ts.
 *
 * REQUIERE la migración 20261007000000_dulabs_developer_v1_fase2_data_model.sql aplicada.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { configurarWebhook, obtenerWebhookDelNumero } from "@/lib/developer/webhook-config-store";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — webhook-config-store real contra Postgres (Fase 2)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];

    // El secreto del webhook se cifra con secure-crypto.ts (fail-closed) --
    // mismo patrón que lib/developer/secure-crypto.test.ts (clave de prueba
    // real fijada para la suite, restaurada al final), en vez de depender
    // de que DEVELOPER_TOKEN_ENCRYPTION_KEY ya esté configurada en local.
    const claveOriginal = process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    before(() => {
      process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    });
    after(() => {
      if (claveOriginal === undefined) delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
      else process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveOriginal;
    });

    async function crearNumeroDePrueba(workspaceId: string): Promise<string> {
      const registro = await registrarNumero(admin, { workspaceId, phoneNumberId: `phn-${randomUUID()}` });
      if (!registro.ok) throw new Error("no se pudo crear número de prueba");
      return registro.fila.id;
    }

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_webhook_configs").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_whatsapp_numbers").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    it("configurarWebhook: URL segura -> se crea, el secreto se devuelve UNA vez y NO se guarda en claro", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);

      const resultado = await configurarWebhook(admin, { workspaceId, whatsappNumberId: numeroId, url: "https://example.com/webhooks/dulabs" });
      assert.equal(resultado.ok, true);
      if (!resultado.ok) return;
      assert.match(resultado.secreto, /^whsec_/);

      const { data: crudo } = await admin.from("dulabs_dev_webhook_configs").select("secret_cifrado").eq("id", resultado.fila.id).single();
      assert.notEqual(crudo!.secret_cifrado, resultado.secreto, "el secreto del webhook nunca debe quedar guardado en claro");
    });

    it("configurarWebhook: URL apuntando a localhost se rechaza ANTES de tocar la base de datos (SSRF real, no una validación superficial)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);

      const resultado = await configurarWebhook(admin, { workspaceId, whatsappNumberId: numeroId, url: "http://127.0.0.1:4000/hook" });
      assert.equal(resultado.ok, false);
      if (resultado.ok) return;
      assert.equal(resultado.motivo, "url_no_permitida");

      const existe = await obtenerWebhookDelNumero(admin, { workspaceId, whatsappNumberId: numeroId });
      assert.equal(existe, null, "una URL rechazada nunca debe dejar una fila a medio persistir");
    });

    it("configurarWebhook: URL apuntando al metadata endpoint de nube (169.254.169.254) se rechaza", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);

      const resultado = await configurarWebhook(admin, { workspaceId, whatsappNumberId: numeroId, url: "http://169.254.169.254/latest/meta-data" });
      assert.equal(resultado.ok, false);
    });

    it("obtenerWebhookDelNumero: aislado por workspace_id -- un workspace no resuelve el webhook de otro aunque conozca whatsappNumberId", async () => {
      const workspaceA = randomUUID();
      const workspaceB = randomUUID();
      workspacesUsados.push(workspaceA, workspaceB);
      const numeroA = await crearNumeroDePrueba(workspaceA);
      const creado = await configurarWebhook(admin, { workspaceId: workspaceA, whatsappNumberId: numeroA, url: "https://example.com/webhooks/dulabs" });
      assert.equal(creado.ok, true);

      const comoB = await obtenerWebhookDelNumero(admin, { workspaceId: workspaceB, whatsappNumberId: numeroA });
      assert.equal(comoB, null);
    });

    it("configurarWebhook: reconfigurar el mismo número reemplaza (UNIQUE(whatsapp_number_id)), no acumula filas ni secretos viejos utilizables", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);

      const primero = await configurarWebhook(admin, { workspaceId, whatsappNumberId: numeroId, url: "https://example.com/v1" });
      const segundo = await configurarWebhook(admin, { workspaceId, whatsappNumberId: numeroId, url: "https://example.com/v2" });
      assert.equal(primero.ok, true);
      assert.equal(segundo.ok, true);
      if (!primero.ok || !segundo.ok) return;
      assert.notEqual(primero.secreto, segundo.secreto, "reconfigurar debe rotar el secreto, no reutilizar el anterior");

      const { count } = await admin.from("dulabs_dev_webhook_configs").select("id", { count: "exact", head: true }).eq("whatsapp_number_id", numeroId);
      assert.equal(count, 1);
    });
  }
);
