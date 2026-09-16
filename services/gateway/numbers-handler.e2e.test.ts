/**
 * DuLabs Developer V1 -- Fase 4 (autorizado). E2E real contra Postgres
 * para GET /api/v1/whatsapp-numbers (+ /:id), la superficie de solo
 * lectura autenticada por API key.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { manejarListaNumerosPublica, manejarObtenerNumeroPublico } from "./numbers-handler";
import { crearApiKey } from "@/lib/developer/api-keys-store";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — GET /api/v1/whatsapp-numbers real contra Postgres (Fase 4)",
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
        await admin.from("dulabs_dev_api_keys").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_whatsapp_numbers").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    async function prepararWorkspace(metaToken?: string) {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const apiKey = await crearApiKey(admin, { workspaceId, name: "test" });
      const numero = await registrarNumero(admin, { workspaceId, phoneNumberId: `phn-${randomUUID()}`, displayName: "Número de prueba", metaToken });
      if (!numero.ok) throw new Error("no se pudo crear número de prueba");
      return { workspaceId, claveEnClaro: apiKey.claveEnClaro, numeroId: numero.fila.id };
    }

    it("lista los números del workspace, con proyección pública -- nunca el token de Meta cifrado", async () => {
      const { claveEnClaro, numeroId } = await prepararWorkspace("EAA-token-secreto-de-prueba");
      const resultado = await manejarListaNumerosPublica({ supabase: admin }, { autorizacion: `Bearer ${claveEnClaro}`, requestId: `req-${randomUUID()}` });
      assert.equal(resultado.status, 200);
      const numeros = resultado.cuerpo.numbers as Array<Record<string, unknown>>;
      assert.equal(numeros.length, 1);
      assert.equal(numeros[0].id, numeroId);
      assert.equal(numeros[0].displayName, "Número de prueba");
      assert.equal(numeros[0].meta_token_cifrado, undefined);
      assert.equal(numeros[0].metaToken, undefined);
      assert.ok(!JSON.stringify(numeros[0]).includes("EAA-token-secreto"), "el token de Meta nunca debe aparecer en la respuesta pública");
    });

    it("GET /:id devuelve el número correcto, reusando obtenerNumeroDelWorkspace", async () => {
      const { claveEnClaro, numeroId } = await prepararWorkspace();
      const resultado = await manejarObtenerNumeroPublico({ supabase: admin }, { autorizacion: `Bearer ${claveEnClaro}`, numeroId, requestId: `req-${randomUUID()}` });
      assert.equal(resultado.status, 200);
      assert.equal(resultado.cuerpo.id, numeroId);
    });

    it("GET /:id de un número de OTRO workspace -> 404 (nunca 403)", async () => {
      const { claveEnClaro: claveB } = await prepararWorkspace();
      const { numeroId: numeroA } = await prepararWorkspace();

      const resultado = await manejarObtenerNumeroPublico({ supabase: admin }, { autorizacion: `Bearer ${claveB}`, numeroId: numeroA, requestId: `req-${randomUUID()}` });
      assert.equal(resultado.status, 404);
      assert.equal((resultado.cuerpo.error as { code: string }).code, "not_found");
    });

    it("sin API key -> 401 missing_api_key", async () => {
      const resultado = await manejarListaNumerosPublica({ supabase: admin }, { autorizacion: undefined, requestId: `req-${randomUUID()}` });
      assert.equal(resultado.status, 401);
      assert.equal((resultado.cuerpo.error as { code: string }).code, "missing_api_key");
    });

    it("API key inválida -> 401 invalid_api_key", async () => {
      const resultado = await manejarListaNumerosPublica({ supabase: admin }, { autorizacion: "Bearer dl_live_no_existe", requestId: `req-${randomUUID()}` });
      assert.equal(resultado.status, 401);
      assert.equal((resultado.cuerpo.error as { code: string }).code, "invalid_api_key");
    });
  }
);
