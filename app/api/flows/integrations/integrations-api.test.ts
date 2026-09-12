/**
 * Fase 5 (Actions + Integrations, autorizado) — tests de integración real
 * contra Supabase real (usuarios de Auth efímeros, tenants descartables),
 * mismo patrón que app/api/flows/flows-api.test.ts y
 * app/api/flows/[id]/activate/activate-deactivate-api.test.ts.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { GET as integrationsGET, POST as integrationsPOST } from "./route";
import { GET as integrationGET, PATCH as integrationPATCH } from "./[id]/route";
import { POST as approvePOST } from "./[id]/approve/route";
import { POST as revokePOST } from "./[id]/revoke/route";
import { GET as credentialsGET, POST as credentialsPOST } from "./[id]/credentials/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const BASE_URL = "http://localhost/api/flows/integrations";

function req(method: string, url: string, opts?: { token?: string; body?: unknown; noAuth?: boolean }): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts?.noAuth) headers.authorization = `Bearer ${opts?.token ?? ""}`;
  return new NextRequest(url, { method, headers, body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined });
}
function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe(
  "Fase 5 — API de Integraciones (integración real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const sufijo = randomUUID().slice(0, 8);

    type UsuarioPrueba = { id: string; email: string; token: string };
    let adminA: UsuarioPrueba;
    let agenteA: UsuarioPrueba;
    let adminB: UsuarioPrueba;

    async function crearUsuario(nombre: string, tenantId: string, rol: "admin" | "agente"): Promise<UsuarioPrueba> {
      const email = `f5-integrations-test-${nombre}-${sufijo}@example.com`;
      const password = `F5IntegrationsTest-${randomUUID()}`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      const { error: miembroError } = await admin.from("dulabs_miembros_equipo").insert({
        tenant_id: tenantId,
        user_id: data.user.id,
        email,
        rol,
        estado: "activo",
      });
      if (miembroError) throw miembroError;

      const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      const { data: sesion, error: signInError } = await anon.auth.signInWithPassword({ email, password });
      if (signInError || !sesion.session) throw signInError ?? new Error("sin sesión");

      return { id: data.user.id, email, token: sesion.session.access_token };
    }

    before(async () => {
      if (!HAS_SUPABASE) return;
      adminA = await crearUsuario("admin-a", TENANT_A, "admin");
      agenteA = await crearUsuario("agente-a", TENANT_A, "agente");
      adminB = await crearUsuario("admin-b", TENANT_B, "admin");
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      for (const tenantId of [TENANT_A, TENANT_B]) {
        const { data: integraciones } = await admin.from("dulabs_flow_integrations").select("id").eq("tenant_id", tenantId);
        const ids = (integraciones ?? []).map((i) => i.id as string);
        if (ids.length > 0) {
          await admin.from("dulabs_flow_credentials").delete().eq("tenant_id", tenantId).in("integration_id", ids);
        }
        await admin.from("dulabs_flow_integrations").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
      }
      for (const u of [adminA, agenteA, adminB]) {
        if (u) await admin.auth.admin.deleteUser(u.id);
      }
    });

    let integrationId: string;
    const slug = `f5-webhook-${sufijo}`;

    describe("Autenticación y roles", () => {
      it("sin token -> 401", async () => {
        const res = await integrationsGET(req("GET", BASE_URL, { noAuth: true }));
        assert.equal(res.status, 401);
      });

      it("agente -> 403 en POST (escritura solo admin)", async () => {
        const res = await integrationsPOST(
          req("POST", BASE_URL, { token: agenteA.token, body: { slug, displayName: "x", capability: "x", url: "https://x.com" } }),
        );
        assert.equal(res.status, 403);
      });

      it("agente -> 200 en GET (lectura admin+agente)", async () => {
        const res = await integrationsGET(req("GET", BASE_URL, { token: agenteA.token }));
        assert.equal(res.status, 200);
      });
    });

    describe("Crear integración", () => {
      it("URL no-HTTPS -> 400 (SSRF, nunca se crea)", async () => {
        const res = await integrationsPOST(
          req("POST", BASE_URL, {
            token: adminA.token,
            body: { slug: `${slug}-insecure`, displayName: "x", capability: "notificar", url: "http://api.ejemplo.com/x" },
          }),
        );
        assert.equal(res.status, 400);
      });

      it("URL localhost -> 400 (SSRF)", async () => {
        const res = await integrationsPOST(
          req("POST", BASE_URL, {
            token: adminA.token,
            body: { slug: `${slug}-localhost`, displayName: "x", capability: "notificar", url: "https://localhost/x" },
          }),
        );
        assert.equal(res.status, 400);
      });

      it("URL IP privada -> 400 (SSRF)", async () => {
        const res = await integrationsPOST(
          req("POST", BASE_URL, {
            token: adminA.token,
            body: { slug: `${slug}-privada`, displayName: "x", capability: "notificar", url: "https://192.168.1.5/x" },
          }),
        );
        assert.equal(res.status, 400);
      });

      it("admin, datos válidos -> 201, status='pending'", async () => {
        const res = await integrationsPOST(
          req("POST", BASE_URL, {
            token: adminA.token,
            body: {
              slug,
              displayName: "Webhook de prueba F5",
              capability: "notificar_externo",
              url: "https://api.ejemplo.com/webhook",
              httpMethod: "POST",
              headersTemplate: { "x-source": "dulabs" },
            },
          }),
        );
        assert.equal(res.status, 201);
        const json = await res.json();
        assert.equal(json.integration.status, "pending");
        assert.equal(json.integration.tenant_id, TENANT_A);
        integrationId = json.integration.id;
      });

      it("slug duplicado -> 409", async () => {
        const res = await integrationsPOST(
          req("POST", BASE_URL, { token: adminA.token, body: { slug, displayName: "x", capability: "y", url: "https://api.ejemplo.com/y" } }),
        );
        assert.equal(res.status, 409);
      });
    });

    describe("Listar / obtener", () => {
      it("GET lista (tenant A) -> incluye la creada", async () => {
        const res = await integrationsGET(req("GET", BASE_URL, { token: adminA.token }));
        const json = await res.json();
        assert.ok(json.integrations.some((i: { id: string }) => i.id === integrationId));
      });

      it("GET lista (tenant B) -> NO incluye la de tenant A", async () => {
        const res = await integrationsGET(req("GET", BASE_URL, { token: adminB.token }));
        const json = await res.json();
        assert.ok(!json.integrations.some((i: { id: string }) => i.id === integrationId));
      });

      it("GET [id] (dueño) -> 200", async () => {
        const res = await integrationGET(req("GET", `${BASE_URL}/${integrationId}`, { token: adminA.token }), paramsFor(integrationId));
        assert.equal(res.status, 200);
      });

      it("GET [id] (tenant B, no dueño) -> 404, no revela existencia", async () => {
        const res = await integrationGET(req("GET", `${BASE_URL}/${integrationId}`, { token: adminB.token }), paramsFor(integrationId));
        assert.equal(res.status, 404);
      });

      it("la respuesta de GET [id] NUNCA incluye 'encrypted_value' ni 'credentials'", async () => {
        const res = await integrationGET(req("GET", `${BASE_URL}/${integrationId}`, { token: adminA.token }), paramsFor(integrationId));
        const text = await res.text();
        assert.ok(!text.includes("encrypted_value"));
        assert.ok(!text.includes("credentials"));
      });
    });

    describe("PATCH (solo metadata)", () => {
      it("cambiar displayName/url -> 200", async () => {
        const res = await integrationPATCH(
          req("PATCH", `${BASE_URL}/${integrationId}`, { token: adminA.token, body: { displayName: "Renombrado", url: "https://api.ejemplo.com/v2" } }),
          paramsFor(integrationId),
        );
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.integration.display_name, "Renombrado");
        assert.equal(json.integration.url, "https://api.ejemplo.com/v2");
        assert.equal(json.integration.status, "pending", "PATCH no debe tocar status");
      });

      it("intentar cambiar 'status' -> 400, rechazado explícitamente", async () => {
        const res = await integrationPATCH(
          req("PATCH", `${BASE_URL}/${integrationId}`, { token: adminA.token, body: { status: "approved" } }),
          paramsFor(integrationId),
        );
        assert.equal(res.status, 400);
      });

      it("PATCH con URL insegura -> 400, no aplica el cambio", async () => {
        const res = await integrationPATCH(
          req("PATCH", `${BASE_URL}/${integrationId}`, { token: adminA.token, body: { url: "http://inseguro.com" } }),
          paramsFor(integrationId),
        );
        assert.equal(res.status, 400);
      });

      it("agente -> 403", async () => {
        const res = await integrationPATCH(
          req("PATCH", `${BASE_URL}/${integrationId}`, { token: agenteA.token, body: { displayName: "hackeado" } }),
          paramsFor(integrationId),
        );
        assert.equal(res.status, 403);
      });

      it("tenant B sobre integración de tenant A -> 404", async () => {
        const res = await integrationPATCH(
          req("PATCH", `${BASE_URL}/${integrationId}`, { token: adminB.token, body: { displayName: "hackeado" } }),
          paramsFor(integrationId),
        );
        assert.equal(res.status, 404);
      });
    });

    describe("Credenciales", () => {
      it("agente -> 403 en POST credentials", async () => {
        const res = await credentialsPOST(
          req("POST", `${BASE_URL}/${integrationId}/credentials`, { token: agenteA.token, body: { credentialKey: "Authorization", plaintext: "Bearer x" } }),
          paramsFor(integrationId),
        );
        assert.equal(res.status, 403);
      });

      it("admin, guarda una credencial -> 201, respuesta NUNCA incluye el plaintext ni el valor cifrado", async () => {
        const res = await credentialsPOST(
          req("POST", `${BASE_URL}/${integrationId}/credentials`, {
            token: adminA.token,
            body: { credentialKey: "Authorization", plaintext: "Bearer sk-live-secreto-real-12345" },
          }),
          paramsFor(integrationId),
        );
        assert.equal(res.status, 201);
        const text = await res.text();
        assert.ok(!text.includes("sk-live-secreto-real-12345"));
        assert.ok(!text.includes("encrypted_value"));
      });

      it("GET credentials -> lista SOLO el credentialKey, nunca el valor", async () => {
        const res = await credentialsGET(req("GET", `${BASE_URL}/${integrationId}/credentials`, { token: adminA.token }), paramsFor(integrationId));
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.credentials.length, 1);
        assert.equal(json.credentials[0].credentialKey, "Authorization");
        const text = JSON.stringify(json);
        assert.ok(!text.includes("sk-live-secreto-real-12345"));

        const { data: filaRealCifrada } = await admin
          .from("dulabs_flow_credentials")
          .select("encrypted_value")
          .eq("tenant_id", TENANT_A)
          .eq("integration_id", integrationId)
          .single();
        assert.ok(filaRealCifrada!.encrypted_value.length > 0, "el valor SÍ quedó cifrado en la tabla real");
        assert.ok(!filaRealCifrada!.encrypted_value.includes("sk-live-secreto-real-12345"), "nunca en texto plano en DB");
      });

      it("tenant B no puede ver ni escribir credenciales de la integración de A -> 404", async () => {
        const resGet = await credentialsGET(req("GET", `${BASE_URL}/${integrationId}/credentials`, { token: adminB.token }), paramsFor(integrationId));
        assert.equal(resGet.status, 404);
        const resPost = await credentialsPOST(
          req("POST", `${BASE_URL}/${integrationId}/credentials`, { token: adminB.token, body: { credentialKey: "x", plaintext: "y" } }),
          paramsFor(integrationId),
        );
        assert.equal(resPost.status, 404);
      });
    });

    describe("Aprobar / revocar", () => {
      it("agente -> 403 en approve", async () => {
        const res = await approvePOST(req("POST", `${BASE_URL}/${integrationId}/approve`, { token: agenteA.token }), paramsFor(integrationId));
        assert.equal(res.status, 403);
      });

      it("tenant B -> 404 en approve (no puede aprobar integración ajena)", async () => {
        const res = await approvePOST(req("POST", `${BASE_URL}/${integrationId}/approve`, { token: adminB.token }), paramsFor(integrationId));
        assert.equal(res.status, 404);
      });

      it("admin -> 200, status='approved', approved_by/approved_at presentes", async () => {
        const res = await approvePOST(req("POST", `${BASE_URL}/${integrationId}/approve`, { token: adminA.token }), paramsFor(integrationId));
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.integration.status, "approved");
        assert.equal(json.integration.approved_by, adminA.id);
        assert.ok(json.integration.approved_at);
      });

      it("admin -> revoke, status='revoked' (reversible, la fila y credenciales se conservan)", async () => {
        const res = await revokePOST(req("POST", `${BASE_URL}/${integrationId}/revoke`, { token: adminA.token }), paramsFor(integrationId));
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.integration.status, "revoked");

        const { data: credencialesTrasRevoke } = await admin.from("dulabs_flow_credentials").select("id").eq("integration_id", integrationId);
        assert.equal(credencialesTrasRevoke?.length, 1, "revocar no borra las credenciales guardadas");
      });

      it("re-aprobar tras revocar -> 200, status vuelve a 'approved'", async () => {
        const res = await approvePOST(req("POST", `${BASE_URL}/${integrationId}/approve`, { token: adminA.token }), paramsFor(integrationId));
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.integration.status, "approved");
      });
    });
  },
);
