/**
 * DuLabs Developer V1 -- Fase 19 (Controlled Beta, 19.5/19.9). Tests de los
 * controles de seguridad de beta añadidos: kill switch del API público y el
 * tope de API keys. Puros/ligeros (sin DB): el kill switch corta ANTES de tocar
 * Supabase, así que se puede probar con un supabase falso que jamás se usa.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiPublicaHabilitada } from "./beta-flags";
import { ErrorLimiteApiKeys, MAX_API_KEYS_ACTIVAS } from "./api-keys-store";
import { conWorkspaceAutenticadoPorApiKey } from "@/services/gateway/api-auth";

const previo = process.env.DEVELOPER_API_ENABLED;
afterEach(() => {
  if (previo === undefined) delete process.env.DEVELOPER_API_ENABLED;
  else process.env.DEVELOPER_API_ENABLED = previo;
});

describe("Fase 19 -- kill switch del API público", () => {
  it("por defecto (sin var) el API está habilitado", () => {
    delete process.env.DEVELOPER_API_ENABLED;
    assert.equal(apiPublicaHabilitada(), true);
  });

  it("solo valores explícitos falsy lo apagan", () => {
    for (const v of ["false", "0", "off", "no", "FALSE", " Off "]) {
      process.env.DEVELOPER_API_ENABLED = v;
      assert.equal(apiPublicaHabilitada(), false, `'${v}' debería apagar`);
    }
    for (const v of ["true", "1", "on", "yes", "", "cualquiera"]) {
      process.env.DEVELOPER_API_ENABLED = v;
      assert.equal(apiPublicaHabilitada(), true, `'${v}' NO debería apagar`);
    }
  });

  it("con el API apagado, conWorkspaceAutenticadoPorApiKey responde 503 ANTES de tocar la DB", async () => {
    process.env.DEVELOPER_API_ENABLED = "false";
    // supabase falso: si el kill switch NO corta primero, esto explotaría al usarse.
    const supabaseFalso = { from() { throw new Error("no debería tocar la DB"); } } as unknown as SupabaseClient;
    let fnLlamada = false;
    const r = await conWorkspaceAutenticadoPorApiKey(
      { supabase: supabaseFalso },
      "Bearer dl_live_lo_que_sea",
      "req_test",
      "203.0.113.1",
      async () => { fnLlamada = true; return { status: 200, cuerpo: {} }; },
    );
    assert.equal(r.status, 503);
    assert.equal((r.cuerpo.error as { code: string }).code, "service_unavailable");
    assert.equal(fnLlamada, false, "nunca debe ejecutar el handler protegido");
  });

  it("con el API habilitado, el kill switch no interfiere (pasa a validar la key)", async () => {
    process.env.DEVELOPER_API_ENABLED = "true";
    // Sin key válida -> debe llegar a la validación de key (no 503). Usamos una
    // key con forma válida pero el lookup fallará; nos basta que NO sea 503.
    const supabaseFalso = {
      from() { return { select() { return { eq() { return { maybeSingle: async () => ({ data: null, error: null }) }; } }; } }; },
    } as unknown as SupabaseClient;
    const r = await conWorkspaceAutenticadoPorApiKey(
      { supabase: supabaseFalso },
      undefined, // sin Authorization -> 401 missing_api_key, NO 503
      "req_test",
      undefined,
      async () => ({ status: 200, cuerpo: {} }),
    );
    assert.notEqual(r.status, 503);
    assert.equal(r.status, 401);
  });
});

describe("Fase 19 -- tope de API keys", () => {
  it("MAX_API_KEYS_ACTIVAS es un tope conservador de beta", () => {
    assert.ok(MAX_API_KEYS_ACTIVAS >= 1 && MAX_API_KEYS_ACTIVAS <= 100);
  });
  it("ErrorLimiteApiKeys lleva el límite", () => {
    const e = new ErrorLimiteApiKeys(20);
    assert.equal(e.limite, 20);
    assert.equal(e.name, "ErrorLimiteApiKeys");
  });
});
