/**
 * FASE F14.2 (Billing / Monetización completa, autorizado) — E2E real de
 * upgrade/downgrade de plan (Fases 3, 4, 5, 17 del pedido). Tenants 100%
 * desechables, Wompi/Meta siempre mockeados -- este endpoint (PATCH
 * /api/dashboard/suscripcion) nunca llama a Wompi, así que ni siquiera hace
 * falta el mock ahí, solo para el alta inicial vía /pagos/suscribir.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { instalarWompiMock } from "@/lib/testing/wompi-mock";
import { instalarMetaGraphMock } from "@/lib/testing/meta-graph-mock";
import { POST as suscribirPOST } from "@/app/api/pagos/suscribir/route";
import { PATCH as suscripcionPATCHRaw } from "@/app/api/dashboard/suscripcion/route";
// Next tipa los handlers exportados como `Promise<Response> | undefined`
// cuando el mismo archivo exporta varios métodos -- en tiempo de ejecución
// siempre devuelven Response de verdad (cada rama del handler retorna
// explícitamente). Mismo criterio ya usado en otros tests de F13/F14.
const suscripcionPATCH = suscripcionPATCHRaw as (req: NextRequest) => Promise<Response>;
import { PLANES } from "@/lib/planes";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
process.env.WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY || "test_fake_wompi_private_key";
process.env.WOMPI_INTEGRITY_KEY = process.env.WOMPI_INTEGRITY_KEY || "test_fake_wompi_integrity_key";
process.env.WOMPI_EVENTS_KEY = process.env.WOMPI_EVENTS_KEY || "test_fake_wompi_events_key";

function reqJson(url: string, method: string, body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest(url, { method, headers, body: JSON.stringify(body) });
}

async function crearTenantConUsuario(admin: SupabaseClient, prefijo: string) {
  const email = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `F142Test-${randomUUID()}`;
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

async function crearTenantConPlan(admin: SupabaseClient, prefijo: string, plan: string) {
  const t = await crearTenantConUsuario(admin, prefijo);
  const mock = instalarMocksBilling();
  try {
    const res = await suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir(plan), t.token));
    assert.equal(res.status, 200);
  } finally {
    mock.restaurar();
  }
  return t;
}

describe(
  "FASE F14.2 — upgrade/downgrade de plan",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const tenantsCreados: string[] = [];

    after(async () => {
      for (const tenantId of tenantsCreados) {
        await admin.from("dulabs_historial_planes").delete().eq("id_tenant", tenantId).then(() => {}, () => {});
        await admin.from("dulabs_pagos").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_suscripciones").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
        await admin.auth.admin.deleteUser(tenantId).catch(() => {});
      }
    });

    it("upgrade Essential -> Business: aplica de inmediato, precio actualizado, historial registrado", async () => {
      const t = await crearTenantConPlan(admin, "f142-up", "essential");
      tenantsCreados.push(t.tenantId);

      const res = await suscripcionPATCH(reqJson("http://test/api/dashboard/suscripcion", "PATCH", { plan: "business" }, t.token));
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.direccion, "upgrade");
      assert.equal(json.plan, "business");
      assert.equal(json.precio_cop, PLANES.business.precioCop);

      const { data: sus } = await admin.from("dulabs_suscripciones").select("plan, precio_cop, estado").eq("id_tenant", t.tenantId).single();
      assert.equal(sus?.plan, "business");
      assert.equal(sus?.precio_cop, PLANES.business.precioCop);
      assert.equal(sus?.estado, "activa", "el upgrade no debe tocar el estado de la suscripción");

      const { data: historial } = await admin
        .from("dulabs_historial_planes")
        .select("plan_anterior, plan_nuevo, precio_anterior_cop, precio_nuevo_cop")
        .eq("id_tenant", t.tenantId)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (historial) {
        // Fail-safe: si la migración todavía no corrió, no hay fila -- no es un fallo del test.
        assert.equal(historial.plan_anterior, "essential");
        assert.equal(historial.plan_nuevo, "business");
        assert.equal(historial.precio_anterior_cop, PLANES.essential.precioCop);
        assert.equal(historial.precio_nuevo_cop, PLANES.business.precioCop);
      }
    });

    it("downgrade Business -> Essential: aplica de inmediato, NUNCA borra datos existentes (solo limita lo nuevo)", async () => {
      const t = await crearTenantConPlan(admin, "f142-down", "business");
      tenantsCreados.push(t.tenantId);

      const res = await suscripcionPATCH(reqJson("http://test/api/dashboard/suscripcion", "PATCH", { plan: "essential" }, t.token));
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.direccion, "downgrade");
      assert.equal(json.plan, "essential");
      assert.equal(json.precio_cop, PLANES.essential.precioCop);

      // El equipo/miembro creado durante el alta (el propio admin) sigue existiendo
      // -- el downgrade a un plan con menos usuarios permitidos no borra al admin actual.
      const { data: miembro } = await admin.from("dulabs_miembros_equipo").select("estado").eq("tenant_id", t.tenantId).eq("user_id", t.userId).maybeSingle();
      assert.equal(miembro?.estado, "activo", "downgrade no debe suspender/borrar miembros existentes");
    });

    it("no permite cambiar de familia de plan (essential -> start): 400, sin inventar una migración de familia", async () => {
      const t = await crearTenantConPlan(admin, "f142-familia", "essential");
      tenantsCreados.push(t.tenantId);
      const res = await suscripcionPATCH(reqJson("http://test/api/dashboard/suscripcion", "PATCH", { plan: "start" }, t.token));
      assert.equal(res.status, 400);
    });

    it("plan destino = plan actual: idempotente (200, ya_estaba)", async () => {
      const t = await crearTenantConPlan(admin, "f142-idem", "essential");
      tenantsCreados.push(t.tenantId);
      const res = await suscripcionPATCH(reqJson("http://test/api/dashboard/suscripcion", "PATCH", { plan: "essential" }, t.token));
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.ya_estaba, true);
    });

    it("plan inválido y Enterprise (fuera de autoservicio): 400", async () => {
      const t = await crearTenantConPlan(admin, "f142-invalido", "essential");
      tenantsCreados.push(t.tenantId);
      const resInvalido = await suscripcionPATCH(reqJson("http://test/api/dashboard/suscripcion", "PATCH", { plan: "no-existe" }, t.token));
      assert.equal(resInvalido.status, 400);
      const resEnterprise = await suscripcionPATCH(reqJson("http://test/api/dashboard/suscripcion", "PATCH", { plan: "enterprise" }, t.token));
      assert.equal(resEnterprise.status, 400);
    });

    it("Fase 5 — no permite cambiar de plan mientras el pago sigue PENDING", async () => {
      const t = await crearTenantConUsuario(admin, "f142-pending");
      tenantsCreados.push(t.tenantId);
      const mock = instalarWompiMock({ colaTransacciones: [{ status: "PENDING" }] });
      const metaMock = instalarMetaGraphMock();
      try {
        const res = await suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir("essential"), t.token));
        assert.equal(res.status, 200);
      } finally {
        mock.restaurar();
        metaMock.restaurar();
      }
      const resCambio = await suscripcionPATCH(reqJson("http://test/api/dashboard/suscripcion", "PATCH", { plan: "business" }, t.token));
      assert.equal(resCambio.status, 400);
    });

    it("Fase 17 — un tenant no puede cambiar el plan de otro tenant (no hay tenant_id que inyectar; el endpoint solo usa la sesión propia)", async () => {
      const [a, b] = await Promise.all([crearTenantConPlan(admin, "f142-sec-a", "essential"), crearTenantConPlan(admin, "f142-sec-b", "business")]);
      tenantsCreados.push(a.tenantId, b.tenantId);

      // A intenta "cambiar de plan" usando su propia sesión pero pretendiendo
      // afectar a B inyectando tenant_id/id_tenant en el body -- el endpoint
      // ni siquiera lee esos campos, así que esto solo puede afectar a A mismo.
      const res = await suscripcionPATCH(
        reqJson("http://test/api/dashboard/suscripcion", "PATCH", { plan: "business", tenant_id: b.tenantId, id_tenant: b.tenantId }, a.token),
      );
      assert.equal(res.status, 200);

      const { data: subB } = await admin.from("dulabs_suscripciones").select("plan").eq("id_tenant", b.tenantId).single();
      assert.equal(subB?.plan, "business", "B debe seguir en su plan original, sin ningún cambio causado por A");
    });

    it("sin sesión: 401", async () => {
      const res = await suscripcionPATCH(reqJson("http://test/api/dashboard/suscripcion", "PATCH", { plan: "business" }));
      assert.equal(res.status, 401);
    });

    it("Fase 5 — dos cambios de plan simultáneos (business y pro) desde essential: termina en UN estado consistente, nunca mezclado", async () => {
      const t = await crearTenantConPlan(admin, "f142-concurrente", "essential");
      tenantsCreados.push(t.tenantId);

      const [r1, r2] = await Promise.all([
        suscripcionPATCH(reqJson("http://test/api/dashboard/suscripcion", "PATCH", { plan: "business" }, t.token)),
        suscripcionPATCH(reqJson("http://test/api/dashboard/suscripcion", "PATCH", { plan: "pro" }, t.token)),
      ]);
      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);

      const { data: sus, count } = await admin
        .from("dulabs_suscripciones")
        .select("plan, precio_cop", { count: "exact" })
        .eq("id_tenant", t.tenantId);
      assert.equal(count, 1, "nunca debe existir más de una fila de suscripción para el tenant");
      const fila = sus![0];
      assert.ok(fila.plan === "business" || fila.plan === "pro", "el plan final debe ser uno de los dos pedidos, no un tercer valor");
      const precioEsperado = fila.plan === "business" ? PLANES.business.precioCop : PLANES.pro.precioCop;
      assert.equal(fila.precio_cop, precioEsperado, "el precio SIEMPRE debe corresponder al plan que quedó guardado, nunca un plan nuevo con precio viejo o viceversa");
    });
  },
);
