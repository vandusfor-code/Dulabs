/**
 * FASE F14.2 (Billing / Monetización completa, autorizado) — historial de
 * pagos y de cambios de plan (Fases 12-14 del pedido). Tenants desechables,
 * Wompi/Meta siempre mockeados.
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
const suscripcionPATCH = suscripcionPATCHRaw as (req: NextRequest) => Promise<Response>;
import { GET as pagosGET } from "@/app/api/dashboard/pagos/route";
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
function reqGet(url: string, token?: string): NextRequest {
  return new NextRequest(url, { method: "GET", headers: token ? { authorization: `Bearer ${token}` } : {} });
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
  return { userId: created.user.id, tenantId: created.user.id, token: signIn.session.access_token };
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
  "FASE F14.2 — historial de pagos y de planes (Fases 12-14)",
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

    it("Fase 13 — GET /api/dashboard/pagos reconstruye el historial real (transacción, monto, estado, fecha, plan)", async () => {
      const t = await crearTenantConUsuario(admin, "f142-hist-pagos");
      tenantsCreados.push(t.tenantId);
      const mock = instalarMocksBilling();
      try {
        const res = await suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir("essential"), t.token));
        assert.equal(res.status, 200);
      } finally {
        mock.restaurar();
      }

      const res = await pagosGET(reqGet("http://test/api/dashboard/pagos", t.token));
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.pagos.length, 1);
      const pago = json.pagos[0];
      assert.equal(pago.estado, "APPROVED");
      assert.equal(pago.monto_cop, PLANES.essential.precioCop);
      assert.equal(pago.tipo, "suscripcion");
      assert.ok(typeof pago.referencia === "string" && pago.referencia.length > 0, "debe reconstruir la referencia real de la transacción");
      assert.ok(pago.fecha);
      // pago.plan puede ser null si la migración 20260914100000 todavía no
      // corrió (fail-safe) -- si existe, debe ser el plan real contratado.
      if (pago.plan !== null) assert.equal(pago.plan, "essential");
    });

    it("Fase 17 — un tenant NUNCA puede leer el historial de pagos de otro (el endpoint solo usa su propia sesión)", async () => {
      const [a, b] = await Promise.all([crearTenantConUsuario(admin, "f142-hist-a"), crearTenantConUsuario(admin, "f142-hist-b")]);
      tenantsCreados.push(a.tenantId, b.tenantId);
      const mock = instalarMocksBilling();
      try {
        // Ambos se suscriben de verdad (A necesita pertenecer a un equipo real
        // para poder llamar CUALQUIER ruta del dashboard -- si no, un 403 por
        // "sin equipo" no probaría nada sobre aislamiento cross-tenant).
        await suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir("essential"), a.token));
        await suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir("business"), b.token));
      } finally {
        mock.restaurar();
      }

      const resA = await pagosGET(reqGet("http://test/api/dashboard/pagos", a.token));
      assert.equal(resA.status, 200);
      const jsonA = await resA.json();
      assert.equal(jsonA.pagos.length, 1, "A debe ver exactamente SU propio pago");
      assert.equal(jsonA.pagos[0].monto_cop, PLANES.essential.precioCop, "A debe ver el monto de SU plan (essential), nunca el de B (business)");
    });

    it("sin sesión: 401", async () => {
      const res = await pagosGET(reqGet("http://test/api/dashboard/pagos"));
      assert.equal(res.status, 401);
    });

    it("Fase 6 — historial de cambios de plan: alta inicial -> upgrade -> downgrade queda todo trazado en orden", async (t) => {
      const tenant = await crearTenantConUsuario(admin, "f142-hist-planes");
      tenantsCreados.push(tenant.tenantId);
      const mock = instalarMocksBilling();
      try {
        await suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir("essential"), tenant.token));
      } finally {
        mock.restaurar();
      }
      await suscripcionPATCH(reqJson("http://test/api/dashboard/suscripcion", "PATCH", { plan: "business" }, tenant.token));
      await suscripcionPATCH(reqJson("http://test/api/dashboard/suscripcion", "PATCH", { plan: "essential" }, tenant.token));

      const { data: historial, error } = await admin
        .from("dulabs_historial_planes")
        .select("plan_anterior, plan_nuevo")
        .eq("id_tenant", tenant.tenantId)
        .order("id", { ascending: true });
      if (error?.code === "PGRST205" || error?.message?.includes("dulabs_historial_planes")) {
        t.skip("requiere la migración 20260914100000 (tabla dulabs_historial_planes) aplicada en Supabase");
        return;
      }
      assert.equal(historial?.length, 3, "alta inicial + upgrade + downgrade = 3 filas de historial");
      assert.deepEqual(
        historial?.map((h) => [h.plan_anterior, h.plan_nuevo]),
        [
          [null, "essential"],
          ["essential", "business"],
          ["business", "essential"],
        ],
      );
    });
  },
);
