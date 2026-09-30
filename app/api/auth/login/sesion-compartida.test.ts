/**
 * Iniciar sesión NUNCA deja "logueado" al cliente service_role compartido (supabaseAdmin()).
 *
 * supabase-js firma cada consulta con la sesión que el cliente tenga guardada en memoria (aunque
 * `persistSession: false`); sin sesión usa la clave service_role. Si el login hace
 * signInWithPassword sobre el singleton, TODAS las consultas siguientes de esa instancia del servidor
 * (el panel, el webhook de WhatsApp, los crons…) salen con el token de esa persona: la seguridad de
 * filas (RLS) las filtra y, por ejemplo, /api/dashboard/me devuelve 0 números hasta recargar en otra
 * instancia. Sin red: fetch simulado; credenciales y datos ficticios.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

const CLAVE_SERVICIO = "clave-servicio-ficticia";
const TOKEN_USUARIO = "token-de-usuario-ficticio";
const autorizaciones: Array<{ url: string; auth: string | null }> = [];
const fetchReal = globalThis.fetch;
const entornoPrevio = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };

before(() => {
  process.env.SUPABASE_URL = "http://supabase.ficticio.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = CLAVE_SERVICIO;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    autorizaciones.push({ url, auth: headers.get("authorization") });
    if (url.includes("/auth/v1/token")) {
      return Response.json({
        access_token: TOKEN_USUARIO,
        refresh_token: "refresco-ficticio",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "persona@ficticio.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
      });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json", "content-range": "*/0" } });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = fetchReal;
  if (entornoPrevio.url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = entornoPrevio.url;
  if (entornoPrevio.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = entornoPrevio.key;
});

describe("login y el cliente service_role compartido", () => {
  it("después de un login correcto, las consultas de supabaseAdmin() siguen saliendo con la clave service_role", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    const { supabaseAdmin } = await import("@/lib/supabase");
    const r = await POST(new Request("http://app.test/api/auth/login", { method: "POST", body: JSON.stringify({ email: "persona@ficticio.test", password: "clave-ficticia" }) }) as never);
    assert.equal(r.status, 200);
    const body = (await r.json()) as { session?: { access_token: string } };
    assert.equal(body.session?.access_token, TOKEN_USUARIO, "el navegador sí recibe su sesión");
    // Una consulta cualquiera del servidor después del login (p. ej. /api/dashboard/me o el webhook).
    autorizaciones.length = 0;
    await supabaseAdmin().from("dulabs_clientes_config").select("phone_number_id").eq("id_tenant", "t");
    const rest = autorizaciones.filter((a) => a.url.includes("/rest/v1/"));
    assert.equal(rest.length, 1);
    assert.equal(rest[0].auth, `Bearer ${CLAVE_SERVICIO}`, "nunca con el token de la persona que inició sesión");
  });

  it("ninguna ruta ni librería inicia sesión sobre el cliente compartido", async () => {
    const { execSync } = await import("node:child_process");
    const archivos = execSync("git ls-files 'app/**/*.ts' 'lib/**/*.ts'", { encoding: "utf8" })
      .split("\n")
      .filter((f) => f && !/\.test\.ts$/.test(f) && !f.startsWith("lib/test-helpers/"));
    const culpables = archivos.filter((f) => {
      const s = readFileSync(f, "utf8");
      return /supabaseAdmin\(\)/.test(s) && /\.auth\.(signIn\w*|setSession|verifyOtp|exchangeCodeForSession|refreshSession)\(/.test(s) && !/supabaseAuthEfimero\(\)/.test(s);
    });
    assert.deepEqual(culpables, []);
  });
});
