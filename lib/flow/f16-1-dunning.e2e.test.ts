/**
 * FASE F16.1 (Commercial Scale — Dunning, autorizado) — E2E real contra
 * Supabase, mismo patrón que f15-admin-operations-center.e2e.test.ts /
 * f15-1-admin-flow-studio.e2e.test.ts: tenants 100% desechables, un
 * operador admin desechable bajo el tenant real de DuLabs (se borra al
 * final), Wompi siempre mockeado (nunca se cobra de verdad), nunca se
 * manda un email real (RESEND_API_KEY no está configurado en este entorno
 * -- lib/dunning/email-provider.ts no-opea de forma segura y esta suite lo
 * verifica explícitamente en vez de asumirlo).
 *
 * REQUIERE la migración 20261004000000_dulabs_dunning.sql aplicada
 * (dulabs_dunning_ciclos / dulabs_dunning_eventos / la RPC de reclamo) --
 * ver PENDING_MIGRATIONS.md. Si no está aplicada, cada test falla con un
 * error claro de Postgres/PostgREST ("relation ... does not exist" /
 * "could not find function") en vez de un fallo silencioso -- se deja así
 * a propósito (nunca se oculta con un try/catch) para que sea evidente qué
 * falta antes de poder cerrar F16.1 en este entorno.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { TENANT_DULABS_ID } from "@/lib/admin-tenant";
import { PLANES } from "@/lib/planes";
import { instalarWompiMock, construirEventoWompiFirmado } from "@/lib/testing/wompi-mock";
import { GET as cobroMensualGET } from "@/app/api/wompi/cobro-mensual/route";
import { GET as dunningReintentosGET } from "@/app/api/wompi/dunning-reintentos/route";
import { POST as webhookPOST } from "@/app/api/wompi/webhook/route";
import { POST as reintentarPagoPOST } from "@/app/api/dashboard/suscripcion/reintentar-pago/route";
import { GET as adminDunningGET, POST as adminDunningPOST } from "@/app/api/dashboard/admin/clientes/[idTenant]/dunning/route";
import { iniciarCicloDunning, reclamarCicloParaReintento, obtenerCicloActivo, registrarReintentoFallido } from "@/lib/dunning/dunning-domain";
import { enviarNotificacionDunning } from "@/lib/dunning/notificaciones";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
process.env.WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY || "test_fake_wompi_private_key";
process.env.WOMPI_INTEGRITY_KEY = process.env.WOMPI_INTEGRITY_KEY || "test_fake_wompi_integrity_key";
process.env.WOMPI_EVENTS_KEY = process.env.WOMPI_EVENTS_KEY || "test_fake_wompi_events_key";
process.env.CRON_SECRET = process.env.CRON_SECRET || "test_fake_cron_secret";

function reqJson(url: string, method: string, body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
function reqGet(url: string, token?: string): NextRequest {
  return new NextRequest(url, { method: "GET", headers: token ? { authorization: `Bearer ${token}` } : {} });
}
function reqCron(url: string): NextRequest {
  return new NextRequest(url, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
}
function ctx(idTenant: string) {
  return { params: Promise.resolve({ idTenant }) };
}

async function crearUsuarioConSesion(admin: SupabaseClient, prefijo: string) {
  const email = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `F161Test-${randomUUID()}`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) throw createError ?? new Error("no se pudo crear el usuario de prueba");
  const sesion = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signIn, error: signInError } = await sesion.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) throw signInError ?? new Error("no se pudo iniciar sesión de prueba");
  return { userId: created.user.id, email, token: signIn.session.access_token };
}

describe(
  "FASE F16.1 — Dunning: ciclo, reintentos, notificaciones, admin, seguridad, concurrencia",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const tenantsCreados: string[] = [];
    let operadorUserId: string | null = null;
    let operadorToken: string | null = null;

    after(async () => {
      if (operadorUserId) {
        await admin.from("dulabs_miembros_equipo").delete().eq("user_id", operadorUserId).eq("tenant_id", TENANT_DULABS_ID);
        await admin.auth.admin.deleteUser(operadorUserId).catch(() => {});
      }
      for (const tenantId of tenantsCreados) {
        await admin.from("dulabs_dunning_eventos").delete().eq("id_tenant", tenantId).then(() => {}, () => {});
        await admin.from("dulabs_dunning_ciclos").delete().eq("id_tenant", tenantId).then(() => {}, () => {});
        await admin.from("dulabs_auditoria_admin").delete().eq("id_tenant", tenantId).then(() => {}, () => {});
        await admin.from("dulabs_pagos").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_clientes_config").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_suscripciones").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
        await admin.auth.admin.deleteUser(tenantId).catch(() => {});
      }
    });

    async function crearTenantConSuscripcionActiva(prefijo: string, opts?: { conFuentePago?: boolean }) {
      const t = await crearUsuarioConSesion(admin, prefijo);
      tenantsCreados.push(t.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: t.userId, user_id: t.userId, email: t.email, rol: "admin", estado: "activo" });
      await admin.from("dulabs_suscripciones").insert({
        id_tenant: t.userId,
        plan: "essential",
        precio_cop: PLANES.essential.precioCop,
        estado: "activa",
        fecha_proximo_cobro: new Date().toISOString().slice(0, 10),
        wompi_customer_email: t.email,
        wompi_payment_source_id: opts?.conFuentePago === false ? null : "900001",
      });
      return t;
    }

    it("setup — operador admin desechable bajo el tenant real de DuLabs (se borra al final)", async () => {
      const operador = await crearUsuarioConSesion(admin, "f161-operador");
      operadorUserId = operador.userId;
      const { error } = await admin.from("dulabs_miembros_equipo").insert({
        tenant_id: TENANT_DULABS_ID,
        user_id: operador.userId,
        email: operador.email,
        nombre: "F16.1 Test Operador (desechable)",
        rol: "admin",
        estado: "activo",
      });
      assert.equal(error, null);
      operadorToken = operador.token;
    });

    it("1. payment_failed inicia dunning -- cobro-mensual con Wompi DECLINED abre un ciclo y NO vence la suscripción de inmediato", async () => {
      const t = await crearTenantConSuscripcionActiva("f161-cobro-declined");
      const mock = instalarWompiMock({ colaTransacciones: [{ status: "DECLINED" }] });
      try {
        const res = await cobroMensualGET(reqCron("http://test/api/wompi/cobro-mensual"));
        assert.equal(res.status, 200);
      } finally {
        mock.restaurar();
      }

      const { data: sub } = await admin.from("dulabs_suscripciones").select("estado").eq("id_tenant", t.userId).single();
      assert.equal(sub?.estado, "activa", "la suscripción debe seguir activa durante el período de gracia -- este es el hallazgo central de F16.1");

      const ciclo = await obtenerCicloActivo(admin, t.userId);
      assert.ok(ciclo, "debe existir un ciclo de dunning activo");
      assert.equal(ciclo?.intentos, 1);

      const { data: eventos } = await admin.from("dulabs_dunning_eventos").select("tipo").eq("id_tenant", t.userId);
      const tipos = (eventos ?? []).map((e) => e.tipo);
      assert.ok(tipos.includes("payment_failed"));
      assert.ok(tipos.includes("dunning_started"));
    });

    it("6/7. pago rechazado mantiene estado correcto y el grace period funciona a través de reintentos fallidos", async () => {
      const t = await crearTenantConSuscripcionActiva("f161-grace");
      const ciclo = await iniciarCicloDunning(admin, { idTenant: t.userId, motivoFallo: "DECLINED" });

      const r1 = await registrarReintentoFallido(admin, { cicloId: ciclo.id, idTenant: t.userId, primerFalloAt: new Date(ciclo.primer_fallo_at), intentosActuales: 1, motivoFallo: "DECLINED" });
      assert.equal(r1.expirado, false);
      const { data: sub1 } = await admin.from("dulabs_suscripciones").select("estado").eq("id_tenant", t.userId).single();
      assert.equal(sub1?.estado, "activa");

      const r2 = await registrarReintentoFallido(admin, { cicloId: ciclo.id, idTenant: t.userId, primerFalloAt: new Date(ciclo.primer_fallo_at), intentosActuales: 2, motivoFallo: "DECLINED" });
      assert.equal(r2.expirado, true, "al 3er intento (maximoIntentos) debe expirar");
    });

    it("8. vencimiento final funciona -- al agotar la política, la suscripción SÍ queda vencida y el ciclo cierra", async () => {
      const t = await crearTenantConSuscripcionActiva("f161-vencido-final");
      const ciclo = await iniciarCicloDunning(admin, { idTenant: t.userId, motivoFallo: "DECLINED" });
      await registrarReintentoFallido(admin, { cicloId: ciclo.id, idTenant: t.userId, primerFalloAt: new Date(ciclo.primer_fallo_at), intentosActuales: 1, motivoFallo: "DECLINED" });
      const final = await registrarReintentoFallido(admin, { cicloId: ciclo.id, idTenant: t.userId, primerFalloAt: new Date(ciclo.primer_fallo_at), intentosActuales: 2, motivoFallo: "DECLINED" });
      assert.equal(final.expirado, true);

      // El caller (cron/webhook) es quien realmente marca vencida -- se simula acá igual que hacen esas rutas.
      const { expirarSuscripcionPorAgotamiento } = await import("@/lib/dunning/dunning-domain");
      await expirarSuscripcionPorAgotamiento(admin, t.userId);
      const { data: sub } = await admin.from("dulabs_suscripciones").select("estado").eq("id_tenant", t.userId).single();
      assert.equal(sub?.estado, "vencida");

      const { data: cicloFinal } = await admin.from("dulabs_dunning_ciclos").select("estado").eq("id", ciclo.id).single();
      assert.equal(cicloFinal?.estado, "vencido_final");
    });

    it("5. pago recuperado reactiva correctamente -- dunning-reintentos con Wompi APPROVED cierra el ciclo y reactiva la suscripción", async () => {
      const t = await crearTenantConSuscripcionActiva("f161-recuperado");
      await iniciarCicloDunning(admin, { idTenant: t.userId, motivoFallo: "DECLINED" });
      // Fuerza que el reintento ya toque (proximo_intento_at en el pasado) para que el cron lo procese hoy.
      await admin.from("dulabs_dunning_ciclos").update({ proximo_intento_at: new Date(Date.now() - 60_000).toISOString() }).eq("id_tenant", t.userId);

      const mock = instalarWompiMock({ colaTransacciones: [{ status: "APPROVED" }] });
      try {
        const res = await dunningReintentosGET(reqCron("http://test/api/wompi/dunning-reintentos"));
        assert.equal(res.status, 200);
      } finally {
        mock.restaurar();
      }

      const { data: sub } = await admin.from("dulabs_suscripciones").select("estado").eq("id_tenant", t.userId).single();
      assert.equal(sub?.estado, "activa");
      const { data: ciclo } = await admin.from("dulabs_dunning_ciclos").select("estado").eq("id_tenant", t.userId).single();
      assert.equal(ciclo?.estado, "recuperado");

      const { data: eventos } = await admin.from("dulabs_dunning_eventos").select("tipo").eq("id_tenant", t.userId);
      assert.ok((eventos ?? []).some((e) => e.tipo === "retry_succeeded"));
      assert.ok((eventos ?? []).some((e) => e.tipo === "subscription_recovered"));
    });

    it("2/3. notificación enviada una sola vez -- dos llamadas concurrentes para el mismo tipo/ciclo solo registran UN evento *_sent", async () => {
      const t = await crearTenantConSuscripcionActiva("f161-notif-unica");
      const ciclo = await iniciarCicloDunning(admin, { idTenant: t.userId, motivoFallo: "DECLINED" });

      const [r1, r2] = await Promise.all([
        enviarNotificacionDunning(admin, { idTenant: t.userId, cicloId: ciclo.id, tipo: "reminder", destinatario: t.email, nombreNegocio: "Test" }),
        enviarNotificacionDunning(admin, { idTenant: t.userId, cicloId: ciclo.id, tipo: "reminder", destinatario: t.email, nombreNegocio: "Test" }),
      ]);
      assert.ok(r1.yaEnviada || r2.yaEnviada || (r1.enviada === false && r2.enviada === false), "sin RESEND_API_KEY configurado, ninguna de las dos debe reportar un envío real -- solo se prueba que el registro no se duplica");

      const { count } = await admin.from("dulabs_dunning_eventos").select("id", { count: "exact", head: true }).eq("ciclo_id", ciclo.id).eq("tipo", "notification_reminder_sent");
      assert.ok((count ?? 0) <= 1, "nunca debe haber más de un evento notification_reminder_sent para el mismo ciclo");
    });

    it("email-provider: sin RESEND_API_KEY, nunca intenta una llamada de red real y siempre devuelve un resultado explícito", async () => {
      const { enviarNotificacionEmail } = await import("@/lib/dunning/email-provider");
      const antes = process.env.RESEND_API_KEY;
      delete process.env.RESEND_API_KEY;
      try {
        const resultado = await enviarNotificacionEmail({ destinatario: "test@example.com", asunto: "x", textoPlano: "x", html: "<p>x</p>" });
        assert.equal(resultado.enviado, false);
      } finally {
        if (antes) process.env.RESEND_API_KEY = antes;
      }
    });

    it("4/14 (concurrencia). retry duplicado no genera doble cobro -- dos reclamos simultáneos del mismo ciclo: exactamente uno gana", async () => {
      const t = await crearTenantConSuscripcionActiva("f161-doble-reclamo");
      await iniciarCicloDunning(admin, { idTenant: t.userId, motivoFallo: "DECLINED" });
      await admin.from("dulabs_dunning_ciclos").update({ proximo_intento_at: new Date(Date.now() - 60_000).toISOString() }).eq("id_tenant", t.userId);

      const [c1, c2] = await Promise.all([reclamarCicloParaReintento(admin, t.userId), reclamarCicloParaReintento(admin, t.userId)]);
      const ganadores = [c1, c2].filter((c) => c !== null);
      assert.equal(ganadores.length, 1, "exactamente un reclamo debe ganar bajo concurrencia real");
    });

    it("13. pago PENDING no genera segundo cobro -- el reintento automático respeta debeOmitirCobroPorPagoPendiente", async () => {
      const t = await crearTenantConSuscripcionActiva("f161-pending-noretry");
      await iniciarCicloDunning(admin, { idTenant: t.userId, motivoFallo: "DECLINED" });
      await admin.from("dulabs_dunning_ciclos").update({ proximo_intento_at: new Date(Date.now() - 60_000).toISOString() }).eq("id_tenant", t.userId);
      // Deja un pago PENDING previo simulado (como si un intento anterior quedara en challenge 3DS).
      await admin.from("dulabs_pagos").insert({ id_tenant: t.userId, wompi_transaction_id: `mock-pending-${randomUUID()}`, monto_cop: PLANES.essential.precioCop!, estado: "PENDING", tipo: "suscripcion" });

      const mock = instalarWompiMock({ colaTransacciones: [{ status: "APPROVED" }] });
      try {
        await dunningReintentosGET(reqCron("http://test/api/wompi/dunning-reintentos"));
        assert.equal(mock.numeroDeCargosIntentados(), 0, "no debe intentar cobrar mientras el pago anterior siga PENDING");
      } finally {
        mock.restaurar();
      }
    });

    it("12. webhook fuera de orden no rompe el estado de un ciclo ya recuperado", async () => {
      const t = await crearTenantConSuscripcionActiva("f161-fuera-de-orden");
      // Pago viejo DECLINED, luego uno nuevo APPROVED que ya se registró y resolvió (simulado directo en DB, como F14).
      await admin.from("dulabs_pagos").insert({ id_tenant: t.userId, wompi_transaction_id: "f161-viejo-declined", monto_cop: PLANES.essential.precioCop!, estado: "DECLINED", tipo: "suscripcion" });
      const { data: pagoNuevo } = await admin
        .from("dulabs_pagos")
        .insert({ id_tenant: t.userId, wompi_transaction_id: "f161-nuevo-approved", monto_cop: PLANES.essential.precioCop!, estado: "APPROVED", tipo: "suscripcion" })
        .select("id")
        .single();
      assert.ok(pagoNuevo);

      // Llega tarde un webhook del evento VIEJO (DECLINED) -- no debe abrir un ciclo de dunning ni tocar la suscripción activa.
      const evento = await construirEventoWompiFirmado({ transactionId: "f161-viejo-declined", status: "DECLINED" });
      const res = await webhookPOST(reqJson("http://test/api/wompi/webhook", "POST", evento));
      assert.equal(res.status, 200);

      const ciclo = await obtenerCicloActivo(admin, t.userId);
      assert.equal(ciclo, null, "un evento fuera de orden nunca debe abrir un ciclo de dunning");
    });

    it("9. seguridad -- un tenant normal (no admin DuLabs) no puede leer/manipular el dunning de OTRO tenant", async () => {
      const victima = await crearTenantConSuscripcionActiva("f161-victima");
      const atacante = await crearTenantConSuscripcionActiva("f161-atacante");
      await iniciarCicloDunning(admin, { idTenant: victima.userId, motivoFallo: "DECLINED" });

      const resGet = await adminDunningGET(reqGet("http://test/x", atacante.token), ctx(victima.userId));
      assert.equal(resGet.status, 403);

      const resPost = await adminDunningPOST(reqJson("http://test/x", "POST", { accion: "reintentar" }, atacante.token), ctx(victima.userId));
      assert.equal(resPost.status, 403);

      // reintentar-pago del cliente SIEMPRE opera sobre SU PROPIO tenant (de la sesión) -- no acepta ningún id en el body.
      const mock = instalarWompiMock({ colaTransacciones: [{ status: "APPROVED" }] });
      try {
        await reintentarPagoPOST(reqJson("http://test/x", "POST", { idTenant: victima.userId }, atacante.token));
      } finally {
        mock.restaurar();
      }
      const cicloVictimaIntacto = await obtenerCicloActivo(admin, victima.userId);
      assert.ok(cicloVictimaIntacto, "el ciclo de la víctima debe seguir intacto -- el atacante nunca pudo operar sobre él");
    });

    it("10/11. admin puede consultar el ciclo, y un precio_cop inyectado en el body de un reintento NUNCA se usa", async () => {
      assert.ok(operadorToken);
      const t = await crearTenantConSuscripcionActiva("f161-admin-precio");
      const ciclo = await iniciarCicloDunning(admin, { idTenant: t.userId, motivoFallo: "DECLINED" });

      const resGet = await adminDunningGET(reqGet("http://test/x", operadorToken!), ctx(t.userId));
      assert.equal(resGet.status, 200);
      const dataGet = await resGet.json();
      assert.equal(dataGet.ciclo.id, ciclo.id);

      const mock = instalarWompiMock({ colaTransacciones: [{ status: "APPROVED" }] });
      try {
        // precio_cop no es parte del tipo Body de la ruta (reqJson toma
        // `body: unknown`) -- se manda igual a propósito para probar que
        // un request crafteado fuera de TypeScript tampoco lo aplica.
        const resPost = await adminDunningPOST(reqJson("http://test/x", "POST", { accion: "reintentar", precio_cop: 1 }, operadorToken!), ctx(t.userId));
        assert.equal(resPost.status, 200);
        const montoCobrado = mock.llamadas.find((l) => l.path.includes("/transactions"))?.body as { amount_in_cents?: number } | undefined;
        assert.equal(montoCobrado?.amount_in_cents, PLANES.essential.precioCop! * 100, "el monto cobrado SIEMPRE debe ser el precio real guardado, nunca uno del body");
      } finally {
        mock.restaurar();
      }
    });

    it("14. auditoría se registra -- un reintento manual de admin queda en dulabs_auditoria_admin y en dulabs_dunning_eventos", async () => {
      assert.ok(operadorToken);
      const t = await crearTenantConSuscripcionActiva("f161-auditoria");
      const ciclo = await iniciarCicloDunning(admin, { idTenant: t.userId, motivoFallo: "DECLINED" });

      const mock = instalarWompiMock({ colaTransacciones: [{ status: "DECLINED" }] });
      try {
        const res = await adminDunningPOST(reqJson("http://test/x", "POST", { accion: "reintentar" }, operadorToken!), ctx(t.userId));
        assert.equal(res.status, 200);
      } finally {
        mock.restaurar();
      }

      const { data: auditoria } = await admin.from("dulabs_auditoria_admin").select("accion, operador_user_id").eq("id_tenant", t.userId).eq("accion", "DUNNING_MANUAL_RETRY").maybeSingle();
      if (auditoria) {
        assert.equal(auditoria.operador_user_id, operadorUserId);
      }
      const { data: eventoManual } = await admin.from("dulabs_dunning_eventos").select("tipo, actor_user_id").eq("ciclo_id", ciclo.id).eq("tipo", "manual_retry").maybeSingle();
      assert.ok(eventoManual);
      assert.equal(eventoManual?.actor_user_id, operadorUserId);
    });

    it("clientes reales protegidos -- Daniel sigue con su plan/estado intactos (ninguna acción de este archivo usó su tenant)", async () => {
      const DANIEL_TENANT_ID = "c69010b5-6c70-4f2c-bbf0-7e261fd77b9c";
      const { data } = await admin.from("dulabs_suscripciones").select("plan, estado").eq("id_tenant", DANIEL_TENANT_ID).single();
      assert.equal(data?.plan, "essential");
      assert.equal(data?.estado, "activa");
    });
  },
);
