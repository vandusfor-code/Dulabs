/**
 * Reconexión de un número ya conectado (autorizado) — el caso real de
 * Soluciones Financieras/Charlotte: el número se desconectó del todo del
 * lado de Meta, y al reconectar por el botón, Meta emitió un
 * phone_number_id NUEVO para el MISMO número físico. El backend solo sabía
 * reconocer una reconexión cuando el phone_number_id coincidía exactamente
 * -- si cambia, lo trataba como un número nuevo y aplicaba el límite del
 * plan aunque fuera, en la práctica, el mismo número de siempre.
 *
 * Integración real contra Supabase (tenants/usuarios de Auth descartables,
 * NUNCA Solotalento/Soluciones Financieras/Daniela reales). El único mock es
 * `fetch` global hacia graph.facebook.com -- inevitable, no hay forma de
 * llamar a la API real de Meta desde un test. Nunca se llama a Meta de
 * verdad; cualquier URL fuera de graph.facebook.com hace fallar el test.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { POST as metaCallbackPOST } from "./route";

// meta-callback exige NEXT_PUBLIC_META_APP_ID/META_APP_SECRET para construir
// la URL de intercambio de token -- el fake fetch de abajo nunca lee su
// valor real (matchea por substring de la URL), así que un valor de relleno
// alcanza cuando el entorno local no los tiene configurados (no hace falta
// para Meta real, solo para pasar el chequeo del propio endpoint).
process.env.NEXT_PUBLIC_META_APP_ID ||= "test-app-id";
process.env.META_APP_SECRET ||= "test-app-secret";

const HAS_SUPABASE = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

function req(body: unknown, token: string): NextRequest {
  return new NextRequest("http://localhost/api/auth/meta-callback", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

/**
 * Fake fetch: SOLO intercepta graph.facebook.com (con las respuestas exactas
 * que meta-callback espera en cada paso); cualquier otra URL (ej. las
 * llamadas internas de @supabase/auth-js a .../auth/v1/user) se delega al
 * fetch real -- nunca se bloquea tráfico que no sea hacia Meta.
 */
function instalarFakeGraph(params: { wabaId: string; phoneId: string; displayPhone: string }) {
  const original = global.fetch;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("graph.facebook.com")) {
      return original(input, init);
    }
    if (url.includes("/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "fake-tenant-token" }), { status: 200 });
    }
    if (url.includes("/phone_numbers")) {
      return new Response(
        JSON.stringify({ data: [{ id: params.phoneId, display_phone_number: params.displayPhone, verified_name: "Test Negocio" }] }),
        { status: 200 },
      );
    }
    if (url.includes(`/${params.wabaId}/subscribed_apps`)) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (url.includes("/smb_app_data")) {
      return new Response(JSON.stringify({ request_id: "req-test" }), { status: 200 });
    }
    if (url.endsWith(`/${params.wabaId}?fields=name`)) {
      return new Response(JSON.stringify({ name: "Test Negocio" }), { status: 200 });
    }
    throw new Error(`fetch real bloqueado en test -- URL de graph no cubierta por el mock: ${url} (init=${JSON.stringify(init?.method)})`);
  }) as typeof fetch;
  return () => {
    global.fetch = original;
  };
}

describe(
  "meta-callback — reconexión de un número ya conectado (mismo phone_number_id o mismo número físico bajo uno nuevo)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const sufijo = randomUUID().slice(0, 8);
    const tenants: string[] = [];
    const userIds: string[] = [];

    async function crearTenantConNumero(params: {
      phoneNumberId: string;
      telefonoNegocio: string;
      wabaId: string;
      planLimiteUnNumero: boolean;
    }): Promise<{ tenantId: string; token: string }> {
      const tenantId = randomUUID();
      tenants.push(tenantId);
      const email = `meta-callback-test-${sufijo}-${tenantId.slice(0, 8)}@example.com`;
      const password = `MetaCallbackTest-${randomUUID()}`;
      const { data: userData, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (userErr) throw userErr;
      userIds.push(userData.user.id);

      const { error: miembroErr } = await admin
        .from("dulabs_miembros_equipo")
        .insert({ tenant_id: tenantId, user_id: userData.user.id, email, rol: "admin", estado: "activo" });
      if (miembroErr) throw miembroErr;

      const { error: cfgErr } = await admin.from("dulabs_clientes_config").insert({
        id_tenant: tenantId,
        phone_number_id: params.phoneNumberId,
        whatsapp_business_account_id: params.wabaId,
        telefono_negocio: params.telefonoNegocio,
        nombre_negocio: "Negocio de prueba",
        meta_permanent_token: null,
      });
      if (cfgErr) throw cfgErr;

      if (params.planLimiteUnNumero) {
        const enUnMes = new Date();
        enUnMes.setMonth(enUnMes.getMonth() + 1);
        const { error: susErr } = await admin.from("dulabs_suscripciones").insert({
          id_tenant: tenantId,
          plan: "start",
          estado: "activa",
          precio_cop: 0,
          fecha_proximo_cobro: enUnMes.toISOString().slice(0, 10),
        });
        if (susErr) throw susErr;
      }

      const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      const { data: sesion, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
      if (signInErr || !sesion.session) throw signInErr ?? new Error("sin sesión");

      return { tenantId, token: sesion.session.access_token };
    }

    after(async () => {
      if (!HAS_SUPABASE) return;
      for (const tenantId of tenants) {
        await admin.from("dulabs_clientes_config").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_suscripciones").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
      }
      for (const id of userIds) await admin.auth.admin.deleteUser(id);
    });

    it("1. mismo phone_number_id de siempre (reconexión clásica) -> no aplica el límite del plan aunque esté en el tope", async () => {
      const phoneId = `pn-${randomUUID()}`;
      const wabaId = `waba-${randomUUID()}`;
      const telefono = `57300${Math.floor(Math.random() * 10_000_000)}`;
      const { tenantId, token } = await crearTenantConNumero({ phoneNumberId: phoneId, telefonoNegocio: telefono, wabaId, planLimiteUnNumero: true });

      const restaurar = instalarFakeGraph({ wabaId, phoneId, displayPhone: `+${telefono}` });
      try {
        const res = await metaCallbackPOST(req({ code: "fake-code", waba_id: wabaId, phone_number_id: phoneId }, token));
        const json = await res.json();
        assert.equal(res.status, 200, JSON.stringify(json));
        assert.equal(json.success, true);
      } finally {
        restaurar();
      }

      const { data: filas } = await admin.from("dulabs_clientes_config").select("phone_number_id").eq("id_tenant", tenantId);
      assert.equal(filas?.length, 1, "sigue siendo UNA sola fila para este tenant");
    });

    it("2. MISMO número físico, phone_number_id NUEVO (el caso real de Charlotte) -> se actualiza la fila vieja, no cuenta como número nuevo ni bloquea por el plan", async () => {
      const phoneIdViejo = `pn-viejo-${randomUUID()}`;
      const phoneIdNuevo = `pn-nuevo-${randomUUID()}`;
      const wabaIdNuevo = `waba-nuevo-${randomUUID()}`;
      const telefono = `57301${Math.floor(Math.random() * 10_000_000)}`;
      const { tenantId, token } = await crearTenantConNumero({
        phoneNumberId: phoneIdViejo,
        telefonoNegocio: telefono,
        wabaId: `waba-viejo-${randomUUID()}`,
        planLimiteUnNumero: true,
      });

      const restaurar = instalarFakeGraph({ wabaId: wabaIdNuevo, phoneId: phoneIdNuevo, displayPhone: `+${telefono}` });
      try {
        const res = await metaCallbackPOST(req({ code: "fake-code", waba_id: wabaIdNuevo, phone_number_id: phoneIdNuevo }, token));
        const json = await res.json();
        assert.equal(res.status, 200, JSON.stringify(json));
        assert.equal(json.success, true, "NO debe rechazarse por el límite del plan -- es el mismo número físico");
      } finally {
        restaurar();
      }

      const { data: filas } = await admin
        .from("dulabs_clientes_config")
        .select("phone_number_id, whatsapp_business_account_id, telefono_negocio")
        .eq("id_tenant", tenantId);
      assert.equal(filas?.length, 1, "sigue siendo UNA sola fila -- nunca se duplica por el mismo número físico");
      assert.equal(filas?.[0]?.phone_number_id, phoneIdNuevo, "la fila quedó renombrada al phone_number_id nuevo");
      assert.equal(filas?.[0]?.whatsapp_business_account_id, wabaIdNuevo);
    });

    it("3. número físico DISTINTO para un tenant ya en el tope de su plan -> SIGUE bloqueado (no se rompió la protección real)", async () => {
      const phoneIdExistente = `pn-${randomUUID()}`;
      const telefonoExistente = `57302${Math.floor(Math.random() * 10_000_000)}`;
      const { token } = await crearTenantConNumero({
        phoneNumberId: phoneIdExistente,
        telefonoNegocio: telefonoExistente,
        wabaId: `waba-${randomUUID()}`,
        planLimiteUnNumero: true,
      });

      const phoneIdOtroNumero = `pn-otro-${randomUUID()}`;
      const wabaIdOtroNumero = `waba-otro-${randomUUID()}`;
      const telefonoDistinto = `57303${Math.floor(Math.random() * 10_000_000)}`;

      const restaurar = instalarFakeGraph({ wabaId: wabaIdOtroNumero, phoneId: phoneIdOtroNumero, displayPhone: `+${telefonoDistinto}` });
      try {
        const res = await metaCallbackPOST(req({ code: "fake-code", waba_id: wabaIdOtroNumero, phone_number_id: phoneIdOtroNumero }, token));
        const json = await res.json();
        assert.equal(res.status, 500);
        assert.equal(json.success, false);
        assert.match(json.error, /permite máximo 1 número/);
      } finally {
        restaurar();
      }
    });

    it("4. phone_number_id ya conectado a OTRO tenant -> sigue bloqueado (protección contra secuestro intacta)", async () => {
      const phoneIdAjeno = `pn-${randomUUID()}`;
      const telefonoAjeno = `57304${Math.floor(Math.random() * 10_000_000)}`;
      await crearTenantConNumero({
        phoneNumberId: phoneIdAjeno,
        telefonoNegocio: telefonoAjeno,
        wabaId: `waba-ajeno-${randomUUID()}`,
        planLimiteUnNumero: false,
      });

      // Un segundo tenant/usuario intenta "conectar" el MISMO phone_number_id.
      const { token: tokenIntruso } = await crearTenantConNumero({
        phoneNumberId: `pn-intruso-${randomUUID()}`,
        telefonoNegocio: `57305${Math.floor(Math.random() * 10_000_000)}`,
        wabaId: `waba-intruso-${randomUUID()}`,
        planLimiteUnNumero: false,
      });

      const restaurar = instalarFakeGraph({ wabaId: "waba-ajeno-cualquiera", phoneId: phoneIdAjeno, displayPhone: `+${telefonoAjeno}` });
      try {
        const res = await metaCallbackPOST(
          req({ code: "fake-code", waba_id: "waba-ajeno-cualquiera", phone_number_id: phoneIdAjeno }, tokenIntruso),
        );
        const json = await res.json();
        assert.equal(res.status, 500);
        assert.equal(json.success, false);
        assert.match(json.error, /ya está conectado a otra cuenta/);
      } finally {
        restaurar();
      }
    });
  },
);
