/**
 * FASE F14 (SaaS Commercial Readiness, autorizado) — multi-tenant real con 3
 * tenants desechables (A/B/C, Fase 13) + pentest comercial real (Fase 16):
 * intentos de leer/modificar la suscripción/plan de otro tenant, acceso al
 * Panel de Operaciones sin ser admin de DuLabs, activación manual sin
 * secreto, y verificación dinámica del fix de Encuestas (Fase 12, gating de
 * lectura por plan). Wompi SIEMPRE mockeado, nunca real. Nunca toca
 * Daniel/AMORE/Daniela/Charlotte/Solo Talento.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { instalarWompiMock } from "@/lib/testing/wompi-mock";
import { instalarMetaGraphMock } from "@/lib/testing/meta-graph-mock";
import { POST as suscribirPOST } from "@/app/api/pagos/suscribir/route";
import { DELETE as suscripcionDELETE } from "@/app/api/dashboard/suscripcion/route";
import { GET as adminClientesGET } from "@/app/api/dashboard/admin/clientes/route";
import { GET as adminResumenGET } from "@/app/api/dashboard/admin/resumen/route";
import { POST as activarSuscripcionPOST } from "@/app/api/admin/activar-suscripcion/route";
import { GET as surveysGET } from "@/app/api/dashboard/surveys/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
process.env.WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY || "test_fake_wompi_private_key";
process.env.WOMPI_INTEGRITY_KEY = process.env.WOMPI_INTEGRITY_KEY || "test_fake_wompi_integrity_key";
process.env.WOMPI_EVENTS_KEY = process.env.WOMPI_EVENTS_KEY || "test_fake_wompi_events_key";

function reqJson(url: string, method: string, body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
function reqGet(url: string, token?: string, extraHeaders?: Record<string, string>): NextRequest {
  return new NextRequest(url, { method: "GET", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders } });
}

async function crearTenantConUsuario(admin: SupabaseClient, prefijo: string) {
  const email = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `F14Test-${randomUUID()}`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) throw createError ?? new Error("no se pudo crear el usuario de prueba");
  const sesion = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInError } = await sesion.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) throw signInError ?? new Error("no se pudo iniciar sesión de prueba");
  return { userId: created.user.id, tenantId: created.user.id, email, token: signIn.session.access_token };
}

function bodySuscribir(plan: string) {
  return {
    token: "tok_test_fake",
    plan,
    customer_email: `pago-${randomUUID()}@example.com`,
    telefono: "573000000900",
    acceptance_token: "acc_test_fake",
    accept_personal_auth: "auth_test_fake",
  };
}

function instalarMocksBilling() {
  const metaMock = instalarMetaGraphMock();
  const wompiMock = instalarWompiMock({ colaTransacciones: [{ status: "APPROVED" }] });
  return {
    restaurar: () => {
      wompiMock.restaurar();
      metaMock.restaurar();
    },
  };
}

describe(
  "FASE F14 — multi-tenant real (A/B/C) + pentest comercial",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const tenantsCreados: string[] = [];

    after(async () => {
      for (const tenantId of tenantsCreados) {
        await admin.from("dulabs_survey_bot_config").delete().eq("phone_number_id", `f14-mt-${tenantId}`);
        await admin.from("dulabs_pagos").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_suscripciones").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
        await admin.auth.admin.deleteUser(tenantId).catch(() => {});
      }
    });

    it("Fase 13 — 3 tenants simultáneos (A/B/C) con planes distintos: cero contaminación cruzada en dulabs_suscripciones", async () => {
      const [a, b, c] = await Promise.all([
        crearTenantConUsuario(admin, "f14-mt-a"),
        crearTenantConUsuario(admin, "f14-mt-b"),
        crearTenantConUsuario(admin, "f14-mt-c"),
      ]);
      tenantsCreados.push(a.tenantId, b.tenantId, c.tenantId);

      const mock = instalarMocksBilling();
      try {
        const [ra, rb, rc] = await Promise.all([
          suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir("essential"), a.token)),
          suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir("business"), b.token)),
          suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir("pro"), c.token)),
        ]);
        assert.equal(ra.status, 200);
        assert.equal(rb.status, 200);
        assert.equal(rc.status, 200);
      } finally {
        mock.restaurar();
      }

      const { data: subs } = await admin
        .from("dulabs_suscripciones")
        .select("id_tenant, plan, estado")
        .in("id_tenant", [a.tenantId, b.tenantId, c.tenantId]);
      const porTenant = new Map((subs ?? []).map((s) => [s.id_tenant, s]));
      assert.equal(porTenant.get(a.tenantId)?.plan, "essential");
      assert.equal(porTenant.get(b.tenantId)?.plan, "business");
      assert.equal(porTenant.get(c.tenantId)?.plan, "pro");
      for (const s of subs ?? []) assert.equal(s.estado, "activa");
    });

    it("Fase 16 — un tenant no puede cancelar/afectar la suscripción de otro tenant inyectando su tenant_id en el body", async () => {
      const [a, b] = await Promise.all([crearTenantConUsuario(admin, "f14-sec-a"), crearTenantConUsuario(admin, "f14-sec-b")]);
      tenantsCreados.push(a.tenantId, b.tenantId);
      const mock = instalarMocksBilling();
      try {
        await suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir("essential"), a.token));
        await suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir("essential"), b.token));
      } finally {
        mock.restaurar();
      }

      // A (autenticado como sí mismo) intenta cancelar mandando el tenant_id de B en el body.
      const res = await suscripcionDELETE(
        reqJson("http://test/api/dashboard/suscripcion", "DELETE", { tenant_id: b.tenantId, id_tenant: b.tenantId }, a.token),
      );
      assert.equal(res.status, 200);

      const { data: subA } = await admin.from("dulabs_suscripciones").select("cancelar_al_vencer").eq("id_tenant", a.tenantId).single();
      const { data: subB } = await admin.from("dulabs_suscripciones").select("cancelar_al_vencer").eq("id_tenant", b.tenantId).single();
      assert.equal(subA?.cancelar_al_vencer, true, "debe cancelar la suscripción de QUIEN LLAMÓ (A), ignorando el tenant_id del body");
      assert.equal(subB?.cancelar_al_vencer, false, "la suscripción de B (inyectada en el body) NO debe verse afectada");
    });

    it("Fase 16 — /api/admin/activar-suscripcion rechaza sin el secreto de plataforma (no cruza a admin de un tenant normal)", async () => {
      const a = await crearTenantConUsuario(admin, "f14-sec-noauth");
      tenantsCreados.push(a.tenantId);
      const res = await activarSuscripcionPOST(
        reqJson("http://test/api/admin/activar-suscripcion", "POST", { tenant_email: a.email, plan: "pro", precio_cop: 0 }),
      );
      assert.equal(res.status, 401);

      const reqConSecretoFalso = new NextRequest("http://test/api/admin/activar-suscripcion", {
        method: "POST",
        headers: { "content-type": "application/json", "x-platform-admin-secret": "secreto-incorrecto-de-prueba" },
        body: JSON.stringify({ tenant_email: a.email, plan: "pro", precio_cop: 0 }),
      });
      const resSecretoFalso = await activarSuscripcionPOST(reqConSecretoFalso);
      assert.equal(resSecretoFalso.status, 401, "un secreto incorrecto (largo distinto al real) también debe rechazarse");
    });

    it("Fase 9/16 — un admin de un tenant normal NO puede entrar al Panel de Operaciones de DuLabs (admin real de plataforma)", async () => {
      const a = await crearTenantConUsuario(admin, "f14-sec-panel");
      tenantsCreados.push(a.tenantId);
      const mock = instalarMocksBilling();
      try {
        await suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir("business"), a.token));
      } finally {
        mock.restaurar();
      }
      // a.tenantId ahora es admin de SU PROPIO tenant (rol admin), pero no es
      // el tenant operador de DuLabs (TENANT_DULABS_ID en lib/admin-tenant.ts).
      const resClientes = await adminClientesGET(reqGet("http://test/api/dashboard/admin/clientes", a.token));
      assert.equal(resClientes.status, 403);
      const resResumen = await adminResumenGET(reqGet("http://test/api/dashboard/admin/resumen", a.token));
      assert.equal(resResumen.status, 403);
    });

    it("Fase 12 (hallazgo F14 ya corregido) — un tenant SIN encuestas en su plan no puede leer datos de encuestas aunque tenga configuración vieja", async () => {
      const a = await crearTenantConUsuario(admin, "f14-sec-encuestas");
      tenantsCreados.push(a.tenantId);
      const mock = instalarMocksBilling();
      const phoneNumberId = `f14-mt-${a.tenantId}`;
      try {
        // essential NO incluye encuestas (lib/planes.ts).
        await suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir("essential"), a.token));
      } finally {
        mock.restaurar();
      }
      await admin.from("dulabs_clientes_config").upsert({ id_tenant: a.tenantId, phone_number_id: phoneNumberId, nombre_negocio: "F14 test" }, { onConflict: "phone_number_id" });
      // Config vieja con preguntas reales -- simula un tenant que SÍ tuvo
      // Encuestas activas antes de bajar de plan (o nunca las pagó pero le
      // quedó una fila de una prueba vieja).
      await admin.from("dulabs_survey_bot_config").upsert(
        { phone_number_id: phoneNumberId, brand_name: "F14", questions: [{ id: "q1", type: "open_text", text: "¿Cómo te fue?" }], active: true },
        { onConflict: "phone_number_id" },
      );

      const res = await surveysGET(reqGet("http://test/api/dashboard/surveys", a.token));
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.deepEqual(json.surveys, [], "un tenant sin la feature de Encuestas no debe recibir datos reales de una encuesta vieja");
      await admin.from("dulabs_survey_bot_config").delete().eq("phone_number_id", phoneNumberId);
      await admin.from("dulabs_clientes_config").delete().eq("phone_number_id", phoneNumberId);
    });
  },
);
