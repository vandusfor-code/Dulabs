/**
 * DuLabs Developer V1 -- Fase 4 (autorizado, threat model amenazas #6/#15/#20).
 * E2E real contra Postgres: las dos superficies de autenticación (API key
 * vs. sesión de Supabase Auth) deben permanecer GENUINAMENTE separadas --
 * ninguna acepta el token de la otra "por accidente".
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { conWorkspaceAutenticado } from "./management-handler";
import { conWorkspaceAutenticadoPorApiKey } from "./api-auth";
import { manejarObtenerMe } from "./me-handler";
import { crearApiKey } from "@/lib/developer/api-keys-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — separación real de superficies de autenticación (Fase 4)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_api_keys").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    it("una API key real (dl_live_...) enviada a una ruta de SESIÓN (/api/v1/dev/*) nunca autentica -- 401, nunca 'funciona por accidente'", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const apiKey = await crearApiKey(admin, { workspaceId, name: "test" });

      let llamadaInterna = false;
      const resultado = await conWorkspaceAutenticado({ supabase: admin }, `Bearer ${apiKey.claveEnClaro}`, undefined, ["OWNER", "ADMIN", "MEMBER"], async () => {
        llamadaInterna = true;
        return { status: 200, cuerpo: {} };
      });
      assert.equal(resultado.status, 401, "una API key real nunca debe autenticar una ruta de sesión");
      assert.equal(llamadaInterna, false, "el handler interno nunca debe ejecutarse");
    });

    it("un token arbitrario (no-JWT, formato de sesión inválido) enviado a una ruta de API KEY nunca autentica -- 401 invalid_api_key", async () => {
      let llamadaInterna = false;
      const resultado = await conWorkspaceAutenticadoPorApiKey({ supabase: admin }, "Bearer eyJhbGciOiJIUzI1NiJ9.token-de-sesion-simulado.firma", `req-${randomUUID()}`, undefined, async () => {
        llamadaInterna = true;
        return { status: 200, cuerpo: {} };
      });
      assert.equal(resultado.status, 401);
      assert.equal((resultado.cuerpo.error as { code: string }).code, "invalid_api_key");
      assert.equal(llamadaInterna, false);
    });

    it("GET /api/v1/me con una API key real funciona (control positivo -- confirma que el mecanismo correcto sí autentica)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const apiKey = await crearApiKey(admin, { workspaceId, name: "control" });

      const resultado = await manejarObtenerMe({ supabase: admin }, { autorizacion: `Bearer ${apiKey.claveEnClaro}`, requestId: `req-${randomUUID()}` });
      assert.equal(resultado.status, 200);
      assert.equal(resultado.cuerpo.workspaceId, workspaceId);
    });
  }
);
