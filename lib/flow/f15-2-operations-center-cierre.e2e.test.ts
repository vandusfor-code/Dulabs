/**
 * FASE F15.2 (Operations Center, cierre) — E2E real de los hallazgos y
 * cambios de ESTA ronda: (a) el fix de seguridad real en
 * .../suscripcion/route.ts (precio_cop ya no puede venir del body en
 * "activar"), (b) el pipeline de Implementación portado del admin legacy
 * (ahora la única forma de mover ese estado dentro del Panel de
 * Operaciones nuevo), y (c) que la reescritura de .../consumo/route.ts
 * (N+1 -> batch) sigue devolviendo los MISMOS números que el criterio
 * original por-tenant. Mismo patrón que f15-admin-operations-center.e2e.test.ts:
 * tenants desechables, un operador admin desechable bajo el tenant real de
 * DuLabs (se borra al final).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { TENANT_DULABS_ID } from "@/lib/admin-tenant";
import { PLANES } from "@/lib/planes";
import {
  GET as suscripcionAdminGET,
  POST as suscripcionAdminPOST,
} from "@/app/api/dashboard/admin/clientes/[idTenant]/suscripcion/route";
import { PATCH as clienteDetallePATCH } from "@/app/api/dashboard/admin/clientes/[idTenant]/route";
import { GET as consumoGET } from "@/app/api/dashboard/admin/consumo/route";
import { contarNumeros, contarUsuarios, contarAgentesEnUso, mensajesIAMesEfectivo } from "@/lib/plan-limits";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function reqJson(url: string, method: string, body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
function reqGet(url: string, token?: string): NextRequest {
  return new NextRequest(url, { method: "GET", headers: token ? { authorization: `Bearer ${token}` } : {} });
}
function ctx(idTenant: string) {
  return { params: Promise.resolve({ idTenant }) };
}

async function crearUsuarioConSesion(admin: SupabaseClient, prefijo: string) {
  const email = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `F152Test-${randomUUID()}`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) throw createError ?? new Error("no se pudo crear el usuario de prueba");
  const sesion = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signIn, error: signInError } = await sesion.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) throw signInError ?? new Error("no se pudo iniciar sesión de prueba");
  return { userId: created.user.id, email, token: signIn.session.access_token };
}

describe(
  "FASE F15.2 — Operations Center (cierre): fix de precio, Implementación portada, consumo batch == por-tenant",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const tenantsClienteCreados: string[] = [];
    let operadorUserId: string | null = null;
    let operadorToken: string | null = null;

    after(async () => {
      if (operadorUserId) {
        await admin.from("dulabs_miembros_equipo").delete().eq("user_id", operadorUserId).eq("tenant_id", TENANT_DULABS_ID);
        await admin.auth.admin.deleteUser(operadorUserId).catch(() => {});
      }
      for (const tenantId of tenantsClienteCreados) {
        await admin.from("dulabs_auditoria_admin").delete().eq("id_tenant", tenantId).then(() => {}, () => {});
        await admin.from("dulabs_onboarding_sesiones").delete().eq("id_tenant", tenantId).then(() => {}, () => {});
        await admin.from("dulabs_clientes_config").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_suscripciones").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
        await admin.auth.admin.deleteUser(tenantId).catch(() => {});
      }
    });

    it("setup — operador admin desechable bajo el tenant real de DuLabs (se borra al final)", async () => {
      const operador = await crearUsuarioConSesion(admin, "f152-operador");
      operadorUserId = operador.userId;
      const { error } = await admin.from("dulabs_miembros_equipo").insert({
        tenant_id: TENANT_DULABS_ID,
        user_id: operador.userId,
        email: operador.email,
        nombre: "F15.2 Test Operador (desechable)",
        rol: "admin",
        estado: "activo",
      });
      assert.equal(error, null);
      operadorToken = operador.token;
    });

    it("seguridad -- 'activar' con un precio_cop en el body ya NO lo usa: el precio siempre sale del plan real", async () => {
      assert.ok(operadorToken);
      const t = await crearUsuarioConSesion(admin, "f152-precio");
      tenantsClienteCreados.push(t.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: t.userId, user_id: t.userId, email: t.email, rol: "admin", estado: "activo" });

      // precio_cop ya no es parte del tipo Body de la ruta -- se manda igual
      // a propósito acá (reqJson toma `body: unknown`) para probar que un
      // request crafteado fuera de TypeScript (curl, Postman) tampoco lo aplica.
      const res = await suscripcionAdminPOST(
        reqJson("http://test/x", "POST", { accion: "activar", plan: "essential", precio_cop: 1 }, operadorToken!),
        ctx(t.userId),
      );
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.suscripcion.precio_cop, PLANES.essential.precioCop, "el precio guardado debe ser el REAL del plan, nunca el '1' del body");
      assert.notEqual(data.suscripcion.precio_cop, 1);

      const resGet = await suscripcionAdminGET(reqGet("http://test/x", operadorToken!), ctx(t.userId));
      const detalle = await resGet.json();
      assert.equal(detalle.suscripcion.precio_cop, PLANES.essential.precioCop);
    });

    it("Implementación (portada del admin legacy) -- el operador puede mover el pipeline de onboarding y el cambio persiste", async () => {
      assert.ok(operadorToken);
      const t = await crearUsuarioConSesion(admin, "f152-implementacion");
      tenantsClienteCreados.push(t.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: t.userId, user_id: t.userId, email: t.email, rol: "admin", estado: "activo" });
      await admin.from("dulabs_suscripciones").insert({
        id_tenant: t.userId,
        plan: "essential",
        precio_cop: PLANES.essential.precioCop,
        estado: "activa",
        fecha_proximo_cobro: "2099-01-01",
        wompi_customer_email: t.email,
      });
      const { error: sesionError } = await admin.from("dulabs_onboarding_sesiones").insert({
        id_tenant: t.userId,
        plan: "essential",
        estado: "completado",
        estado_implementacion: "PENDIENTE",
        phone_number_id: `f152-${randomUUID().slice(0, 8)}`,
        telefono_cliente: "573000000900",
      });
      assert.equal(sesionError, null);

      const res = await clienteDetallePATCH(reqJson("http://test/x", "PATCH", { estado_implementacion: "EN_CONFIGURACION" }, operadorToken!), ctx(t.userId));
      assert.equal(res.status, 200);

      const { data: sesion } = await admin.from("dulabs_onboarding_sesiones").select("estado_implementacion, implementacion_iniciada_at").eq("id_tenant", t.userId).single();
      assert.equal(sesion?.estado_implementacion, "EN_CONFIGURACION");
      assert.ok(sesion?.implementacion_iniciada_at, "el primer avance desde PENDIENTE debe fijar implementacion_iniciada_at");
    });

    it("consumo -- la reescritura en batch (F15.2) devuelve EXACTAMENTE los mismos números que el criterio original por-tenant (lib/plan-limits.ts)", async () => {
      assert.ok(operadorToken);
      const t = await crearUsuarioConSesion(admin, "f152-consumo");
      tenantsClienteCreados.push(t.userId);
      await admin.from("dulabs_miembros_equipo").insert([
        { tenant_id: t.userId, user_id: t.userId, email: t.email, rol: "admin", estado: "activo" },
      ]);
      await admin.from("dulabs_suscripciones").insert({
        id_tenant: t.userId,
        plan: "essential",
        precio_cop: PLANES.essential.precioCop,
        estado: "activa",
        fecha_proximo_cobro: "2099-01-01",
        wompi_customer_email: t.email,
        mensajes_ia_mes_negociado: 4321,
      });
      const phoneNumberId = `f152-consumo-${randomUUID().slice(0, 8)}`;
      const mesHoy = new Date().toISOString().slice(0, 7);
      await admin.from("dulabs_clientes_config").insert({
        id_tenant: t.userId,
        phone_number_id: phoneNumberId,
        whatsapp_business_account_id: `waba-${phoneNumberId}`,
        telefono_negocio: "573000000901",
        nombre_negocio: "F15.2 Consumo Test",
        mensajes_usados_mes: 77,
        mes_actual: mesHoy,
      });

      const res = await consumoGET(reqGet("http://test/api/dashboard/admin/consumo", operadorToken!));
      assert.equal(res.status, 200);
      const data = await res.json();
      const fila = data.clientes.find((c: { idTenant: string }) => c.idTenant === t.userId);
      assert.ok(fila, "el tenant desechable debe aparecer en la respuesta batch");

      const plan = PLANES.essential;
      const [numerosEsperados, usuariosEsperados, agentesEsperados, topeEsperado] = await Promise.all([
        contarNumeros(admin, t.userId),
        contarUsuarios(admin, t.userId),
        contarAgentesEnUso(admin, t.userId),
        mensajesIAMesEfectivo(admin, t.userId, plan),
      ]);

      assert.equal(fila.numeros.usados, numerosEsperados);
      assert.equal(fila.usuarios.usados, usuariosEsperados);
      assert.equal(fila.agentesIA.usados, agentesEsperados);
      assert.equal(fila.mensajesIA.usados, 77);
      assert.equal(fila.mensajesIA.limite, topeEsperado);
      assert.equal(fila.mensajesIA.limite, 4321, "debe respetar el tope negociado, no el del plan");
    });

    it("clientes reales protegidos -- Daniel sigue con su plan/estado intactos (ninguna acción de este archivo usó su tenant)", async () => {
      const DANIEL_TENANT_ID = "c69010b5-6c70-4f2c-bbf0-7e261fd77b9c";
      const { data } = await admin.from("dulabs_suscripciones").select("plan, estado").eq("id_tenant", DANIEL_TENANT_ID).single();
      assert.equal(data?.plan, "essential");
      assert.equal(data?.estado, "activa");
    });
  },
);
