/**
 * DuLabs Developer V1 -- Fase 4 (autorizado). E2E real contra Postgres
 * para GET /api/v1/me.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { manejarObtenerMe } from "./me-handler";
import { crearApiKey } from "@/lib/developer/api-keys-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — GET /api/v1/me real contra Postgres (Fase 4)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_api_keys").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    it("identifica el workspace y la API key correctos, sin exponer nunca la key completa", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const apiKey = await crearApiKey(admin, { workspaceId, name: "mi-key-de-prueba" });

      const resultado = await manejarObtenerMe({ supabase: admin }, { autorizacion: `Bearer ${apiKey.claveEnClaro}`, requestId: `req-${randomUUID()}` });
      assert.equal(resultado.status, 200);
      assert.equal(resultado.cuerpo.workspaceId, workspaceId);
      assert.equal(resultado.cuerpo.apiKeyId, apiKey.fila.id);
      assert.equal(resultado.cuerpo.apiKeyPrefix, apiKey.fila.prefix);
      assert.equal(resultado.cuerpo.apiKeyName, "mi-key-de-prueba");
      assert.ok(!JSON.stringify(resultado.cuerpo).includes(apiKey.claveEnClaro), "la respuesta nunca debe incluir la API key completa");
    });

    it("API key revocada -> 401 invalid_api_key", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const apiKey = await crearApiKey(admin, { workspaceId, name: "revocada" });
      await admin.from("dulabs_dev_api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", apiKey.fila.id);

      const resultado = await manejarObtenerMe({ supabase: admin }, { autorizacion: `Bearer ${apiKey.claveEnClaro}`, requestId: `req-${randomUUID()}` });
      assert.equal(resultado.status, 401);
      assert.equal((resultado.cuerpo.error as { code: string }).code, "invalid_api_key");
    });
  }
);
