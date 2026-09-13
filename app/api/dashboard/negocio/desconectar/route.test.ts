/**
 * FASE 8.5 (Connection Lifecycle, autorizado) — tests de integración real de
 * POST /api/dashboard/negocio/desconectar. Mismo patrón EXACTO que
 * app/api/auth/meta-callback/route.test.ts: tenants/usuarios de Auth
 * descartables contra Supabase real, fetch global interceptado SOLO hacia
 * graph.facebook.com (nunca se llama a Meta de verdad), cleanup completo.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { cifrarSecreto } from "@/lib/crypto";
import { POST as desconectarPOST } from "./route";

process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");

const HAS_SUPABASE = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

function req(body: unknown, token?: string): NextRequest {
  return new NextRequest("http://localhost/api/dashboard/negocio/desconectar", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

describe(
  "POST /api/dashboard/negocio/desconectar — integración real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const sufijo = randomUUID().slice(0, 8);
    const tenants: string[] = [];
    const userIds: string[] = [];
    let fetchOriginal: typeof fetch;

    async function crearTenantConNumero(params: { rol?: "admin" | "agente"; conToken?: boolean }): Promise<{
      tenantId: string;
      token: string;
      phoneNumberId: string;
      wabaId: string;
    }> {
      const tenantId = randomUUID();
      tenants.push(tenantId);
      const phoneNumberId = `pn-${randomUUID()}`;
      const wabaId = `waba-${randomUUID()}`;
      const email = `f85-desconectar-${sufijo}-${tenantId.slice(0, 8)}@example.com`;
      const password = `F85Test-${randomUUID()}`;
      const { data: userData, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (userErr) throw userErr;
      userIds.push(userData.user.id);

      const { error: miembroErr } = await admin
        .from("dulabs_miembros_equipo")
        .insert({ tenant_id: tenantId, user_id: userData.user.id, email, rol: params.rol ?? "admin", estado: "activo" });
      if (miembroErr) throw miembroErr;

      const { error: cfgErr } = await admin.from("dulabs_clientes_config").insert({
        id_tenant: tenantId,
        phone_number_id: phoneNumberId,
        whatsapp_business_account_id: wabaId,
        telefono_negocio: `57300${Math.floor(Math.random() * 10_000_000)}`,
        nombre_negocio: "Negocio F8.5 de prueba",
        meta_permanent_token: params.conToken === false ? null : cifrarSecreto("fake-meta-token"),
        flow_activo: true,
        flow_id: randomUUID(),
      });
      if (cfgErr) throw cfgErr;

      const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      const { data: sesion, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
      if (signInErr || !sesion.session) throw signInErr ?? new Error("sin sesión");

      return { tenantId, token: sesion.session.access_token, phoneNumberId, wabaId };
    }

    function instalarFakeGraph() {
      fetchOriginal = global.fetch;
      global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (!url.includes("graph.facebook.com")) return fetchOriginal(input, init);
        if (url.includes("/subscribed_apps")) return new Response(JSON.stringify({ success: true }), { status: 200 });
        throw new Error(`fetch real bloqueado en test -- URL de graph no cubierta por el mock: ${url}`);
      }) as typeof fetch;
    }
    function restaurarFetch() {
      global.fetch = fetchOriginal;
    }

    after(async () => {
      if (!HAS_SUPABASE) return;
      for (const tenantId of tenants) {
        await admin.from("dulabs_clientes_config").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
      }
      for (const id of userIds) await admin.auth.admin.deleteUser(id);
    });

    it("1. sin Authorization -> 401", async () => {
      const res = await desconectarPOST(req({ phone_number_id: "x" }));
      assert.equal(res.status, 401);
    });

    it("2. sesión inválida -> 401", async () => {
      const res = await desconectarPOST(req({ phone_number_id: "x" }, "token-basura"));
      assert.equal(res.status, 401);
    });

    it("3. usuario sin rol admin -> 403, no toca la fila", async () => {
      const { token, phoneNumberId, tenantId } = await crearTenantConNumero({ rol: "agente" });
      const res = await desconectarPOST(req({ phone_number_id: phoneNumberId }, token));
      assert.equal(res.status, 403);
      const { data } = await admin.from("dulabs_clientes_config").select("meta_permanent_token").eq("id_tenant", tenantId).maybeSingle();
      assert.ok(data?.meta_permanent_token, "la credencial NO debe tocarse si el usuario no es admin");
    });

    it("4. falta phone_number_id en el body -> 400", async () => {
      const { token } = await crearTenantConNumero({});
      const res = await desconectarPOST(req({}, token));
      assert.equal(res.status, 400);
    });

    it("5. phone_number_id inexistente -> 404", async () => {
      const { token } = await crearTenantConNumero({});
      const res = await desconectarPOST(req({ phone_number_id: `no-existe-${randomUUID()}` }, token));
      assert.equal(res.status, 404);
    });

    it("6. phone_number_id de OTRO tenant -> 404 (cross-tenant rechazado, nunca desconecta ajeno)", async () => {
      const ajeno = await crearTenantConNumero({});
      const { token } = await crearTenantConNumero({});
      const res = await desconectarPOST(req({ phone_number_id: ajeno.phoneNumberId }, token));
      assert.equal(res.status, 404);
      const { data } = await admin
        .from("dulabs_clientes_config")
        .select("meta_permanent_token")
        .eq("id_tenant", ajeno.tenantId)
        .maybeSingle();
      assert.ok(data?.meta_permanent_token, "el número del OTRO tenant nunca debe desconectarse");
    });

    it("7. admin desconectando su propio número -> 200, credencial limpia, Flow preservado, respuesta sin secretos", async () => {
      const { token, phoneNumberId, tenantId } = await crearTenantConNumero({});
      instalarFakeGraph();
      let res: Response;
      try {
        res = await desconectarPOST(req({ phone_number_id: phoneNumberId }, token));
      } finally {
        restaurarFetch();
      }
      const json = await res.json();
      assert.equal(res.status, 200, JSON.stringify(json));
      assert.equal(json.success, true);
      assert.equal(JSON.stringify(json).toLowerCase().includes("token"), false, "la respuesta nunca debe mencionar el token");

      const { data } = await admin
        .from("dulabs_clientes_config")
        .select("meta_permanent_token, flow_activo, flow_id, nombre_negocio")
        .eq("id_tenant", tenantId)
        .maybeSingle();
      assert.equal(data?.meta_permanent_token, null, "la credencial debe quedar invalidada");
      assert.equal(data?.flow_activo, true, "flow_activo debe preservarse");
      assert.ok(data?.flow_id, "flow_id debe preservarse");
      assert.equal(data?.nombre_negocio, "Negocio F8.5 de prueba");
    });

    it("8. desconectar dos veces seguidas -> ambas 200 (idempotente), nunca un 500", async () => {
      const { token, phoneNumberId } = await crearTenantConNumero({});
      instalarFakeGraph();
      try {
        const r1 = await desconectarPOST(req({ phone_number_id: phoneNumberId }, token));
        const r2 = await desconectarPOST(req({ phone_number_id: phoneNumberId }, token));
        assert.equal(r1.status, 200);
        assert.equal(r2.status, 200);
      } finally {
        restaurarFetch();
      }
    });

    it("9. sin token guardado (ya desconectado a mano en DB) -> igual 200, nunca falla por no poder llamar a Meta", async () => {
      const { token, phoneNumberId } = await crearTenantConNumero({ conToken: false });
      const res = await desconectarPOST(req({ phone_number_id: phoneNumberId }, token));
      assert.equal(res.status, 200);
    });
  },
);
