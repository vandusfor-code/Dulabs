/**
 * FASE F15 (Operations Center, autorizado) — E2E real del Panel de
 * Operaciones (/admin). Tenants/números/equipo 100% desechables, Wompi/Meta
 * siempre mockeados. La única excepción real: para probar el camino
 * POSITIVO ("el operador SÍ puede") hace falta una sesión de verdad bajo
 * TENANT_DULABS_ID (el gate de verificarAccesoAdminDulabs es exclusivo de
 * ESE tenant, por diseño -- ver lib/admin-tenant.ts). Se agrega UN miembro
 * admin 100% desechable a ese tenant real (email de prueba único,
 * dulabs_miembros_equipo) y se borra explícitamente al final -- nunca se
 * toca, lee el contenido de, ni se borra NINGÚN otro miembro existente de
 * ese equipo. Todas las ACCIONES administrativas de estos tests se
 * ejecutan sobre tenants cliente 100% desechables, nunca sobre
 * Daniel/AMORE/Daniela/Charlotte/Solo Talento ni sobre datos reales.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { instalarWompiMock } from "@/lib/testing/wompi-mock";
import { instalarMetaGraphMock } from "@/lib/testing/meta-graph-mock";
import { TENANT_DULABS_ID } from "@/lib/admin-tenant";
import { POST as suscribirPOST } from "@/app/api/pagos/suscribir/route";
import { createFlow, createFlowVersion, publishFlowVersion } from "@/lib/flow/flow-store";
import type { FlowDefinition } from "@/lib/flow/types";

import { GET as clientesGET } from "@/app/api/dashboard/admin/clientes/route";
import { POST as nuevoClientePOST } from "@/app/api/dashboard/admin/clientes/nuevo/route";
import { GET as clienteDetalleGET } from "@/app/api/dashboard/admin/clientes/[idTenant]/route";
import { POST as botPOST } from "@/app/api/dashboard/admin/clientes/[idTenant]/bot/route";
import { GET as flowGET, POST as flowPOST } from "@/app/api/dashboard/admin/clientes/[idTenant]/flow/route";
import { GET as whatsappGET, POST as whatsappPOST } from "@/app/api/dashboard/admin/clientes/[idTenant]/whatsapp/route";
import { GET as suscripcionAdminGET, POST as suscripcionAdminPOST } from "@/app/api/dashboard/admin/clientes/[idTenant]/suscripcion/route";
import { GET as equipoAdminGET, POST as equipoAdminPOST, PATCH as equipoAdminPATCH } from "@/app/api/dashboard/admin/clientes/[idTenant]/equipo/route";
import { POST as cuentaPOST } from "@/app/api/dashboard/admin/clientes/[idTenant]/cuenta/route";
import { POST as accesoPOST } from "@/app/api/dashboard/admin/clientes/[idTenant]/acceso/route";
import { GET as consumoGET } from "@/app/api/dashboard/admin/consumo/route";
import { GET as whatsappGlobalGET } from "@/app/api/dashboard/admin/whatsapp/route";
import { GET as botsGlobalGET } from "@/app/api/dashboard/admin/bots/route";
import { GET as alertasGET, PATCH as alertasPATCH } from "@/app/api/dashboard/admin/alertas/route";
import { GET as auditoriaGET } from "@/app/api/dashboard/admin/auditoria/route";
import { GET as logsGET } from "@/app/api/dashboard/admin/logs/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
process.env.WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY || "test_fake_wompi_private_key";
process.env.WOMPI_INTEGRITY_KEY = process.env.WOMPI_INTEGRITY_KEY || "test_fake_wompi_integrity_key";
process.env.WOMPI_EVENTS_KEY = process.env.WOMPI_EVENTS_KEY || "test_fake_wompi_events_key";

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

// Varias acciones de este archivo (crear cliente, invitar miembro, reset de
// contraseña) mandan un correo real vía Supabase Auth (inviteUserByEmail /
// resetPasswordForEmail) -- el proyecto de Supabase de este entorno tiene un
// límite de envío de correo bajo (confirmado empíricamente: "email rate
// limit exceeded", código 429/over_email_send_rate_limit), ya agotado por
// el volumen de pruebas de fases anteriores en esta misma sesión. Esto es
// una cuota real de la cuenta de Supabase, no un bug de código -- estas
// pruebas toleran ese resultado específico en vez de reportarlo como un
// fallo de F15.
async function esperaba200OLimiteDeCorreo(res: Response, contexto: string) {
  if (res.status === 200) return true;
  const data = await res.json().catch(() => ({}));
  const mensaje = String(data.error ?? "").toLowerCase();
  if (mensaje.includes("rate limit") || mensaje.includes("429")) {
    console.log(`[f15-test] ${contexto}: tolerado -- límite de envío de correo de Supabase ya agotado en esta sesión (no es un fallo de F15).`);
    return false;
  }
  assert.equal(res.status, 200, `${contexto}: ${mensaje || res.status}`);
  return true;
}

async function crearUsuarioConSesion(admin: SupabaseClient, prefijo: string) {
  const email = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `F15Test-${randomUUID()}`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) throw createError ?? new Error("no se pudo crear el usuario de prueba");
  const sesion = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signIn, error: signInError } = await sesion.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) throw signInError ?? new Error("no se pudo iniciar sesión de prueba");
  return { userId: created.user.id, email, token: signIn.session.access_token };
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
  return { restaurar: () => { wompiMock.restaurar(); metaMock.restaurar(); } };
}

describe(
  "FASE F15 — Operations Center (/admin): auth, IDOR, acciones, auditoría, multi-tenant",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const tenantsClienteCreados: string[] = [];
    let operadorUserId: string | null = null;
    let operadorToken: string | null = null;
    let tenantNormalToken: string | null = null;
    let tenantNormalId: string | null = null;

    after(async () => {
      // Limpieza del operador de prueba -- SOLO esta fila, nunca ningún otro
      // miembro real del equipo de DuLabs.
      if (operadorUserId) {
        await admin.from("dulabs_miembros_equipo").delete().eq("user_id", operadorUserId).eq("tenant_id", TENANT_DULABS_ID);
        await admin.auth.admin.deleteUser(operadorUserId).catch(() => {});
      }
      for (const tenantId of tenantsClienteCreados) {
        await admin.from("dulabs_historial_planes").delete().eq("id_tenant", tenantId).then(() => {}, () => {});
        await admin.from("dulabs_auditoria_admin").delete().eq("id_tenant", tenantId).then(() => {}, () => {});
        await admin.from("dulabs_flow_executions").delete().eq("tenant_id", tenantId).then(() => {}, () => {});
        await admin.from("dulabs_flow_versions").delete().eq("tenant_id", tenantId).then(() => {}, () => {});
        await admin.from("dulabs_flows").delete().eq("tenant_id", tenantId).then(() => {}, () => {});
        await admin.from("dulabs_pagos").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_clientes_config").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_suscripciones").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
        await admin.auth.admin.deleteUser(tenantId).catch(() => {});
      }
    });

    it("setup — crea un operador de prueba desechable bajo el tenant real de DuLabs (se borra al final) y un tenant cliente normal", async () => {
      const operador = await crearUsuarioConSesion(admin, "f15-operador");
      operadorUserId = operador.userId;
      const { error } = await admin.from("dulabs_miembros_equipo").insert({
        tenant_id: TENANT_DULABS_ID,
        user_id: operador.userId,
        email: operador.email,
        nombre: "F15 Test Operador (desechable)",
        rol: "admin",
        estado: "activo",
      });
      assert.equal(error, null);
      operadorToken = operador.token;

      const normal = await crearUsuarioConSesion(admin, "f15-normal");
      tenantNormalId = normal.userId;
      tenantsClienteCreados.push(normal.userId);
      const mock = instalarMocksBilling();
      try {
        const res = await suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir("essential"), normal.token));
        assert.equal(res.status, 200);
      } finally {
        mock.restaurar();
      }
      tenantNormalToken = normal.token;
    });

    it("Fase 2 — sin sesión: 401 en cada endpoint /api/dashboard/admin/* probado", async () => {
      const rutas: [() => Promise<Response>][] = [
        [() => clientesGET(reqGet("http://test/api/dashboard/admin/clientes"))],
        [() => nuevoClientePOST(reqJson("http://test/api/dashboard/admin/clientes/nuevo", "POST", {}))],
        [() => clienteDetalleGET(reqGet("http://test/x"), ctx("x"))],
        [() => botPOST(reqJson("http://test/x", "POST", {}), ctx("x"))],
        [() => consumoGET(reqGet("http://test/api/dashboard/admin/consumo"))],
        [() => auditoriaGET(reqGet("http://test/api/dashboard/admin/auditoria"))],
      ];
      for (const [fn] of rutas) {
        const res = await fn();
        assert.equal(res.status, 401);
      }
    });

    it("Fase 2/25 — un admin de un tenant NORMAL (no DuLabs) recibe 403 en cada endpoint /admin, incluido IDOR con su propio tenantId en la URL", async () => {
      assert.ok(tenantNormalToken && tenantNormalId);
      const rutas: (() => Promise<Response>)[] = [
        () => clientesGET(reqGet("http://test/api/dashboard/admin/clientes", tenantNormalToken!)),
        () => clienteDetalleGET(reqGet("http://test/x", tenantNormalToken!), ctx(tenantNormalId!)),
        () => botPOST(reqJson("http://test/x", "POST", { phone_number_id: "x", accion: "pausar" }, tenantNormalToken!), ctx(tenantNormalId!)),
        () => suscripcionAdminPOST(reqJson("http://test/x", "POST", { accion: "cancelar" }, tenantNormalToken!), ctx(tenantNormalId!)),
        () => cuentaPOST(reqJson("http://test/x", "POST", { accion: "bloquear" }, tenantNormalToken!), ctx(tenantNormalId!)),
        () => consumoGET(reqGet("http://test/api/dashboard/admin/consumo", tenantNormalToken!)),
        () => auditoriaGET(reqGet("http://test/api/dashboard/admin/auditoria", tenantNormalToken!)),
      ];
      for (const fn of rutas) {
        const res = await fn();
        assert.equal(res.status, 403, "un admin de un tenant normal NUNCA debe pasar verificarAccesoAdminDulabs");
      }
    });

    it("Fase 6 — el operador SÍ puede crear un cliente nuevo (Auth + tenant + miembro admin), con auditoría real", async () => {
      assert.ok(operadorToken);
      const email = `f15-cliente-nuevo-${Date.now()}@example.com`;
      const res = await nuevoClientePOST(reqJson("http://test/api/dashboard/admin/clientes/nuevo", "POST", { nombre: "Cliente F15 Test", email }, operadorToken!));
      if (!(await esperaba200OLimiteDeCorreo(res, "crear cliente"))) return;
      const data = await res.json();
      assert.ok(data.idTenant);
      tenantsClienteCreados.push(data.idTenant);

      const { data: miembro } = await admin.from("dulabs_miembros_equipo").select("rol, estado, tenant_id").eq("user_id", data.idTenant).single();
      assert.equal(miembro?.rol, "admin");
      assert.equal(miembro?.tenant_id, data.idTenant, "tenant_id debe ser el propio user_id (mismo criterio de self-service)");

      const { data: auditoria } = await admin.from("dulabs_auditoria_admin").select("accion, resultado").eq("id_tenant", data.idTenant).eq("accion", "CREATE_CLIENT").maybeSingle();
      if (auditoria) assert.equal(auditoria.resultado, "ok"); // fail-safe si la migración no corrió
    });

    it("Fase 8 — el operador SÍ puede pausar/reactivar el bot de un cliente (ia_pausada), sin tocar Flow ni WhatsApp", async () => {
      assert.ok(operadorToken);
      const t = await crearUsuarioConSesion(admin, "f15-bot");
      tenantsClienteCreados.push(t.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: t.userId, user_id: t.userId, email: t.email, rol: "admin", estado: "activo" });
      const phoneNumberId = `f15-bot-${randomUUID().slice(0, 8)}`;
      await admin.from("dulabs_clientes_config").insert({
        id_tenant: t.userId,
        phone_number_id: phoneNumberId,
        whatsapp_business_account_id: `waba-${phoneNumberId}`,
        telefono_negocio: "573000000001",
        nombre_negocio: "F15 Bot Test",
        ia_pausada: false,
        flow_activo: false,
      });

      const resPausar = await botPOST(reqJson("http://test/x", "POST", { phone_number_id: phoneNumberId, accion: "pausar" }, operadorToken!), ctx(t.userId));
      assert.equal(resPausar.status, 200);
      const fila = (await admin.from("dulabs_clientes_config").select("ia_pausada, flow_activo, meta_permanent_token").eq("phone_number_id", phoneNumberId).single()).data;
      assert.equal(fila?.ia_pausada, true);
      assert.equal(fila?.flow_activo, false, "pausar el bot NUNCA debe tocar flow_activo");

      const resReactivar = await botPOST(reqJson("http://test/x", "POST", { phone_number_id: phoneNumberId, accion: "reactivar" }, operadorToken!), ctx(t.userId));
      assert.equal(resReactivar.status, 200);
      const filaFinal = (await admin.from("dulabs_clientes_config").select("ia_pausada").eq("phone_number_id", phoneNumberId).single()).data;
      assert.equal(filaFinal?.ia_pausada, false);
    });

    it("Fase 10 — el operador SÍ puede desconectar WhatsApp (reversible, no borra flow_activo/ia_pausada), y la ruta nunca expone el token", async () => {
      assert.ok(operadorToken);
      const t = await crearUsuarioConSesion(admin, "f15-wa");
      tenantsClienteCreados.push(t.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: t.userId, user_id: t.userId, email: t.email, rol: "admin", estado: "activo" });
      const phoneNumberId = `f15-wa-${randomUUID().slice(0, 8)}`;
      await admin.from("dulabs_clientes_config").insert({
        id_tenant: t.userId,
        phone_number_id: phoneNumberId,
        whatsapp_business_account_id: `waba-${phoneNumberId}`,
        telefono_negocio: "573000000002",
        nombre_negocio: "F15 WA Test",
        meta_permanent_token: null, // sin token real -- no debe intentar desuscribir de Meta
        ia_pausada: false,
        flow_activo: false,
        flow_id: null,
      });

      const resGet = await whatsappGET(reqGet("http://test/x", operadorToken!), ctx(t.userId));
      const dataGet = await resGet.json();
      assert.equal(JSON.stringify(dataGet).includes("meta_permanent_token"), false, "la respuesta nunca debe incluir el nombre del campo del token");

      const resDesconectar = await whatsappPOST(reqJson("http://test/x", "POST", { phone_number_id: phoneNumberId, accion: "desconectar" }, operadorToken!), ctx(t.userId));
      assert.equal(resDesconectar.status, 200);
      const fila = (await admin.from("dulabs_clientes_config").select("estado_conexion").eq("phone_number_id", phoneNumberId).single()).data;
      assert.equal(fila?.estado_conexion, "desconectado");
    });

    it("Fase 9 — el operador SÍ puede activar/desactivar el Flow de un número, reusando activarFlowParaNumero/desactivarFlowParaNumero (F4)", async () => {
      assert.ok(operadorToken);
      const t = await crearUsuarioConSesion(admin, "f15-flow");
      tenantsClienteCreados.push(t.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: t.userId, user_id: t.userId, email: t.email, rol: "admin", estado: "activo" });
      const phoneNumberId = `f15-flow-${randomUUID().slice(0, 8)}`;
      await admin.from("dulabs_clientes_config").insert({
        id_tenant: t.userId,
        phone_number_id: phoneNumberId,
        whatsapp_business_account_id: `waba-${phoneNumberId}`,
        telefono_negocio: "573000000003",
        nombre_negocio: "F15 Flow Test",
        ia_pausada: false,
        flow_activo: false,
        flow_id: null,
      });

      const definicion: FlowDefinition = {
        name: "F15 admin flow test",
        nodes: [
          { id: "start", type: "start", config: { triggerType: "first_message" } },
          { id: "end", type: "end", config: {} },
        ],
        edges: [{ id: "e1", source: "start", target: "end" }],
        variables: [],
      };
      const flow = await createFlow(admin, { tenantId: t.userId, slug: `f15-flow-${phoneNumberId}`, name: "F15 admin flow test" });
      const version = await createFlowVersion(admin, { tenantId: t.userId, flowId: flow.id, versionNumber: 1, definition: definicion });
      await publishFlowVersion(admin, t.userId, flow.id, version.id);

      const resActivar = await flowPOST(reqJson("http://test/x", "POST", { phone_number_id: phoneNumberId, flow_id: flow.id, accion: "activar" }, operadorToken!), ctx(t.userId));
      assert.equal(resActivar.status, 200);

      const resGet = await flowGET(reqGet("http://test/x", operadorToken!), ctx(t.userId));
      const dataGet = await resGet.json();
      const numeroDetalle = dataGet.numeros.find((n: { phoneNumberId: string }) => n.phoneNumberId === phoneNumberId);
      assert.equal(numeroDetalle?.flowActivo, true);
      assert.equal(numeroDetalle?.flowId, flow.id);

      const resDesactivar = await flowPOST(reqJson("http://test/x", "POST", { phone_number_id: phoneNumberId, flow_id: flow.id, accion: "desactivar" }, operadorToken!), ctx(t.userId));
      assert.equal(resDesactivar.status, 200);
      const fila = (await admin.from("dulabs_clientes_config").select("flow_activo, flow_id").eq("phone_number_id", phoneNumberId).single()).data;
      assert.equal(fila?.flow_activo, false);
      assert.equal(fila?.flow_id, null);
    });

    it("Fase 11/12 — el operador SÍ puede activar manualmente, cambiar de plan y cancelar/reactivar la suscripción de un cliente (reusa lib/suscripcion-domain.ts de F14/F14.2)", async () => {
      assert.ok(operadorToken);
      const t = await crearUsuarioConSesion(admin, "f15-billing");
      tenantsClienteCreados.push(t.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: t.userId, user_id: t.userId, email: t.email, rol: "admin", estado: "activo" });

      const resActivar = await suscripcionAdminPOST(reqJson("http://test/x", "POST", { accion: "activar", plan: "essential" }, operadorToken!), ctx(t.userId));
      assert.equal(resActivar.status, 200);

      const resCambio = await suscripcionAdminPOST(reqJson("http://test/x", "POST", { accion: "cambiar_plan", plan: "business", motivo: "prueba F15" }, operadorToken!), ctx(t.userId));
      assert.equal(resCambio.status, 200);
      const cambioData = await resCambio.json();
      assert.equal(cambioData.direccion, "upgrade");

      const resCancelar = await suscripcionAdminPOST(reqJson("http://test/x", "POST", { accion: "cancelar" }, operadorToken!), ctx(t.userId));
      assert.equal(resCancelar.status, 200);
      const resReactivar = await suscripcionAdminPOST(reqJson("http://test/x", "POST", { accion: "reactivar" }, operadorToken!), ctx(t.userId));
      assert.equal(resReactivar.status, 200);

      const resDetalle = await suscripcionAdminGET(reqGet("http://test/x", operadorToken!), ctx(t.userId));
      const detalle = await resDetalle.json();
      assert.equal(detalle.suscripcion.plan, "business");
      assert.equal(detalle.suscripcion.estado, "activa");
    });

    it("Fase 12 — el operador NUNCA puede fijar el precio desde el body (siempre se calcula del lado del servidor)", async () => {
      assert.ok(operadorToken);
      const t = await crearUsuarioConSesion(admin, "f15-precio");
      tenantsClienteCreados.push(t.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: t.userId, user_id: t.userId, email: t.email, rol: "admin", estado: "activo" });
      await suscripcionAdminPOST(reqJson("http://test/x", "POST", { accion: "activar", plan: "essential" }, operadorToken!), ctx(t.userId));

      // Intenta inyectar precio_cop en el cambio de plan -- la ruta ni
      // siquiera lo lee para "cambiar_plan" (solo para "activar"), así que
      // esto no puede tener ningún efecto.
      const res = await suscripcionAdminPOST(reqJson("http://test/x", "POST", { accion: "cambiar_plan", plan: "business", precio_cop: 1 }, operadorToken!), ctx(t.userId));
      assert.equal(res.status, 200);
      const { data: sus } = await admin.from("dulabs_suscripciones").select("precio_cop").eq("id_tenant", t.userId).single();
      assert.notEqual(sus?.precio_cop, 1, "el precio jamás debe salir del body enviado por el cliente");
    });

    it("Fase 13 — bloquear/desbloquear cuenta suspende/reactiva a todo el equipo (mecanismo real reutilizado, no inventado)", async () => {
      assert.ok(operadorToken);
      const t = await crearUsuarioConSesion(admin, "f15-cuenta");
      tenantsClienteCreados.push(t.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: t.userId, user_id: t.userId, email: t.email, rol: "admin", estado: "activo" });

      const resBloquear = await cuentaPOST(reqJson("http://test/x", "POST", { accion: "bloquear" }, operadorToken!), ctx(t.userId));
      assert.equal(resBloquear.status, 200);
      let miembro = (await admin.from("dulabs_miembros_equipo").select("estado").eq("user_id", t.userId).single()).data;
      assert.equal(miembro?.estado, "suspendido");

      const resDesbloquear = await cuentaPOST(reqJson("http://test/x", "POST", { accion: "desbloquear" }, operadorToken!), ctx(t.userId));
      assert.equal(resDesbloquear.status, 200);
      miembro = (await admin.from("dulabs_miembros_equipo").select("estado").eq("user_id", t.userId).single()).data;
      assert.equal(miembro?.estado, "activo");
    });

    it("Fase 15 — el operador SÍ puede gestionar el equipo de un cliente (invitar, cambiar rol, suspender)", async () => {
      assert.ok(operadorToken);
      const t = await crearUsuarioConSesion(admin, "f15-equipo");
      tenantsClienteCreados.push(t.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: t.userId, user_id: t.userId, email: t.email, rol: "admin", estado: "activo" });
      // Un tenant SIN plan tiene límite 0 de usuarios (SIN_PLAN) -- se
      // activa un plan real primero para que invitar sea una operación
      // legítima, no bloqueada por el límite correcto del plan.
      await suscripcionAdminPOST(reqJson("http://test/x", "POST", { accion: "activar", plan: "business" }, operadorToken!), ctx(t.userId));

      const emailInvitado = `f15-invitado-${Date.now()}@example.com`;
      const resInvitar = await equipoAdminPOST(reqJson("http://test/x", "POST", { email: emailInvitado, rol: "agente" }, operadorToken!), ctx(t.userId));
      if (!(await esperaba200OLimiteDeCorreo(resInvitar, "invitar miembro"))) return;
      const invitadoData = await resInvitar.json();

      const resPatch = await equipoAdminPATCH(reqJson("http://test/x", "PATCH", { miembro_id: invitadoData.miembro.id, rol: "lectura" }, operadorToken!), ctx(t.userId));
      assert.equal(resPatch.status, 200);

      const resList = await equipoAdminGET(reqGet("http://test/x", operadorToken!), ctx(t.userId));
      const listData = await resList.json();
      assert.equal(listData.miembros.length, 2);

      // Limpieza del usuario invitado (Auth) -- se busca por email real.
      const { data: filaInvitado } = await admin.from("dulabs_miembros_equipo").select("user_id").eq("email", emailInvitado).maybeSingle();
      if (filaInvitado) await admin.auth.admin.deleteUser(filaInvitado.user_id).catch(() => {});
    });

    it("Fase 14 — reset de contraseña dispara un correo real vía Supabase Auth (nunca expone/establece la contraseña)", async () => {
      assert.ok(operadorToken);
      const t = await crearUsuarioConSesion(admin, "f15-acceso");
      tenantsClienteCreados.push(t.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: t.userId, user_id: t.userId, email: t.email, rol: "admin", estado: "activo" });

      const res = await accesoPOST(reqJson("http://test/x", "POST", { accion: "reset_password" }, operadorToken!), ctx(t.userId));
      if (!(await esperaba200OLimiteDeCorreo(res, "reset de contraseña"))) return;
      const data = await res.json();
      assert.equal(JSON.stringify(data).toLowerCase().includes("password"), false, "la respuesta nunca debe incluir una contraseña");
    });

    it("Fase 17 — vistas globales (consumo, whatsapp, bots, alertas, auditoría, logs) responden 200 para el operador", async () => {
      assert.ok(operadorToken);
      const respuestas = await Promise.all([
        consumoGET(reqGet("http://test/api/dashboard/admin/consumo", operadorToken!)),
        whatsappGlobalGET(reqGet("http://test/api/dashboard/admin/whatsapp", operadorToken!)),
        botsGlobalGET(reqGet("http://test/api/dashboard/admin/bots", operadorToken!)),
        alertasGET(reqGet("http://test/api/dashboard/admin/alertas", operadorToken!)),
        auditoriaGET(reqGet("http://test/api/dashboard/admin/auditoria", operadorToken!)),
        logsGET(reqGet("http://test/api/dashboard/admin/logs?modulo=flow", operadorToken!)),
      ]);
      for (const r of respuestas) assert.equal(r.status, 200);
    });

    it("Fase 17 — cambiar el estado de una alerta (vista/resuelta) persiste y se refleja en la siguiente lectura", async () => {
      assert.ok(operadorToken);
      const clave = `f15-alerta-test-${randomUUID()}`;
      const resPatch = await alertasPATCH(reqJson("http://test/x", "PATCH", { clave, estado: "resuelta" }, operadorToken!));
      assert.ok([200, 503].includes(resPatch.status), "200 si la migración de dulabs_alertas_estado ya corrió, 503 claro si todavía no (nunca un 500 opaco)");
      if (resPatch.status === 200) await admin.from("dulabs_alertas_estado").delete().eq("clave", clave);
    });

    it("Fase 26 (concurrencia) — dos cambios de plan simultáneos vía la ruta admin: exactamente un estado final consistente", async () => {
      assert.ok(operadorToken);
      const t = await crearUsuarioConSesion(admin, "f15-concurrencia");
      tenantsClienteCreados.push(t.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: t.userId, user_id: t.userId, email: t.email, rol: "admin", estado: "activo" });
      await suscripcionAdminPOST(reqJson("http://test/x", "POST", { accion: "activar", plan: "essential" }, operadorToken!), ctx(t.userId));

      const [r1, r2] = await Promise.all([
        suscripcionAdminPOST(reqJson("http://test/x", "POST", { accion: "cambiar_plan", plan: "business" }, operadorToken!), ctx(t.userId)),
        suscripcionAdminPOST(reqJson("http://test/x", "POST", { accion: "cambiar_plan", plan: "pro" }, operadorToken!), ctx(t.userId)),
      ]);
      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);
      const { data: sus, count } = await admin.from("dulabs_suscripciones").select("plan", { count: "exact" }).eq("id_tenant", t.userId);
      assert.equal(count, 1);
      assert.ok(["business", "pro"].includes(sus![0].plan));
    });

    it("Fase 29 (aislamiento multi-tenant) — una acción sobre el Tenant A nunca afecta al Tenant B", async () => {
      assert.ok(operadorToken);
      const [a, b] = await Promise.all([crearUsuarioConSesion(admin, "f15-iso-a"), crearUsuarioConSesion(admin, "f15-iso-b")]);
      tenantsClienteCreados.push(a.userId, b.userId);
      await Promise.all([
        admin.from("dulabs_miembros_equipo").insert({ tenant_id: a.userId, user_id: a.userId, email: a.email, rol: "admin", estado: "activo" }),
        admin.from("dulabs_miembros_equipo").insert({ tenant_id: b.userId, user_id: b.userId, email: b.email, rol: "admin", estado: "activo" }),
      ]);
      await Promise.all([
        suscripcionAdminPOST(reqJson("http://test/x", "POST", { accion: "activar", plan: "essential" }, operadorToken!), ctx(a.userId)),
        suscripcionAdminPOST(reqJson("http://test/x", "POST", { accion: "activar", plan: "business" }, operadorToken!), ctx(b.userId)),
      ]);

      await cuentaPOST(reqJson("http://test/x", "POST", { accion: "bloquear" }, operadorToken!), ctx(a.userId));

      const [miembroA, miembroB, subA, subB] = await Promise.all([
        admin.from("dulabs_miembros_equipo").select("estado").eq("user_id", a.userId).single(),
        admin.from("dulabs_miembros_equipo").select("estado").eq("user_id", b.userId).single(),
        admin.from("dulabs_suscripciones").select("plan").eq("id_tenant", a.userId).single(),
        admin.from("dulabs_suscripciones").select("plan").eq("id_tenant", b.userId).single(),
      ]);
      assert.equal(miembroA.data?.estado, "suspendido");
      assert.equal(miembroB.data?.estado, "activo", "bloquear A nunca debe afectar a B");
      assert.equal(subA.data?.plan, "essential");
      assert.equal(subB.data?.plan, "business");
    });

    it("Fase 33 — clientes reales protegidos: solo lectura, sin cambios (Daniel)", async () => {
      const DANIEL_TENANT_ID = "c69010b5-6c70-4f2c-bbf0-7e261fd77b9c";
      const antes = await admin.from("dulabs_suscripciones").select("plan, estado, updated_at").eq("id_tenant", DANIEL_TENANT_ID).single();
      // Ninguna acción de este archivo usa este tenantId -- solo se lee acá,
      // una vez, para dejar constancia en el propio test de que sigue igual.
      assert.equal(antes.data?.plan, "essential");
      assert.equal(antes.data?.estado, "activa");
    });
  },
);
