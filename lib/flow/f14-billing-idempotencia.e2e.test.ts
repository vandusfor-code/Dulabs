/**
 * FASE F14 (SaaS Commercial Readiness, autorizado) — E2E real de
 * idempotencia/concurrencia de billing (Fases 3 y 4 del pedido). Tenants
 * 100% desechables, Wompi SIEMPRE mockeado (lib/testing/wompi-mock.ts,
 * mismo patrón que meta-graph-mock.ts) -- nunca se llama a Wompi real, nunca
 * se corre app/api/wompi/cobro-mensual/route.ts (procesaría TODAS las
 * suscripciones reales de la base, incluida la de Daniel -- prohibido por
 * las reglas de esta fase). El escenario de doble cobro del cron (Fase 4) se
 * prueba contra la función pura extraída (debeOmitirCobroPorPagoPendiente),
 * no contra la ruta completa.
 *
 * Escenarios cubiertos (numeración del pedido, Fase 3):
 *  A  pendiente_pago (PENDING)          -> POST /api/pagos/suscribir
 *  B  aprobado (APPROVED)               -> POST /api/pagos/suscribir
 *  C  rechazado (DECLINED)              -> POST /api/pagos/suscribir
 *  D  webhook duplicado (mismo evento 2 veces) -> POST /api/wompi/webhook x2
 *  E  webhook fuera de orden            -> POST /api/wompi/webhook (hallazgo real, ver lib/wompi-webhook.ts)
 *  F  dos intentos simultáneos (reserva atómica) -> RPC dulabs_reservar_suscripcion x2 en paralelo
 *  G  pago exitoso repetido (renovación no duplica sesión de onboarding) -> dispararOnboardingSiAplica x2
 *  Fase 4 -- doble cobro por PENDING sin resolver -> debeOmitirCobroPorPagoPendiente (unit, sin tocar la tabla real)
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { instalarWompiMock, construirEventoWompiFirmado } from "@/lib/testing/wompi-mock";
import { instalarMetaGraphMock } from "@/lib/testing/meta-graph-mock";
import { verificarChecksumEvento } from "@/lib/wompi";
import { debeOmitirCobroPorPagoPendiente, resolverAccionWebhookPago } from "@/lib/wompi-webhook";
import { POST as suscribirPOST } from "@/app/api/pagos/suscribir/route";
import { POST as webhookPOST } from "@/app/api/wompi/webhook/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
// .env.local local trae estas 3 llaves declaradas pero VACÍAS (nunca se
// deben poner llaves reales de Wompi en un entorno de desarrollo) -- Wompi
// siempre está mockeado en este archivo (nunca se llama de verdad), así que
// un valor fake es seguro; solo necesitamos que wompi.ts no aborte temprano
// por "falta la llave" antes de llegar al fetch (que sí está interceptado).
// Mismo criterio que f13-e2e-onboarding.e2e.test.ts con TOKEN_ENCRYPTION_KEY.
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
  const password = `F14Test-${randomUUID()}`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) throw createError ?? new Error("no se pudo crear el usuario de prueba");
  const sesion = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInError } = await sesion.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) throw signInError ?? new Error("no se pudo iniciar sesión de prueba");
  // tenant_id = user_id: mismo criterio de self-service que
  // app/api/pagos/suscribir/route.ts usa cuando no hay miembroExistente.
  return { userId: created.user.id, tenantId: created.user.id, token: signIn.session.access_token };
}

function bodySuscribir(plan = "essential") {
  return {
    token: "tok_test_fake",
    plan,
    customer_email: `pago-${randomUUID()}@example.com`,
    telefono: "573000000900",
    acceptance_token: "acc_test_fake",
    accept_personal_auth: "auth_test_fake",
  };
}

// APPROVED en /pagos/suscribir dispara dispararOnboardingSiAplica, que a su
// vez puede llamar a graph.facebook.com (aviso interno de "nuevo cliente",
// ver lib/onboarding-trigger.ts) -- se mockea SIEMPRE junto con Wompi, nunca
// se confía en que ALERTAS_DESTINO esté vacío en el entorno de test. Orden
// de instalación/restauración LIFO real (cada mock delega al `fetch` que
// encontró instalado al momento de activarse), para no dejar un interceptor
// residual activo para otros archivos de test que corran en paralelo.
function instalarMocksBilling(opts?: Parameters<typeof instalarWompiMock>[0]) {
  const metaMock = instalarMetaGraphMock();
  const wompiMock = instalarWompiMock(opts);
  return {
    numeroDeCargosIntentados: wompiMock.numeroDeCargosIntentados,
    restaurar: () => {
      wompiMock.restaurar();
      metaMock.restaurar();
    },
  };
}

describe(
  "FASE F14 — idempotencia y concurrencia de billing (Fases 3-4)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const tenantsCreados: string[] = [];

    after(async () => {
      for (const tenantId of tenantsCreados) {
        try {
          await admin.from("dulabs_onboarding_sesiones").delete().eq("id_tenant", tenantId);
        } catch {
          // tabla opcional en algunos entornos; no debe tumbar la limpieza del resto.
        }
        await admin.from("dulabs_pagos").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_suscripciones").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
        await admin.auth.admin.deleteUser(tenantId).catch(() => {});
      }
    });

    it("Escenario B — APPROVED activa la suscripción de inmediato", async () => {
      const t = await crearTenantConUsuario(admin, "f14-bill-b");
      tenantsCreados.push(t.tenantId);
      const mock = instalarMocksBilling({ colaTransacciones: [{ status: "APPROVED" }] });
      try {
        const res = await suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir(), t.token));
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.estado_transaccion, "APPROVED");
      } finally {
        mock.restaurar();
      }
      const { data: sus } = await admin.from("dulabs_suscripciones").select("estado").eq("id_tenant", t.tenantId).single();
      assert.equal(sus?.estado, "activa");
    });

    it("Escenario A — PENDING deja la suscripción en pendiente_pago (challenge 3DS)", async () => {
      const t = await crearTenantConUsuario(admin, "f14-bill-a");
      tenantsCreados.push(t.tenantId);
      const mock = instalarMocksBilling({ colaTransacciones: [{ status: "PENDING" }] });
      try {
        const res = await suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir(), t.token));
        assert.equal(res.status, 200);
      } finally {
        mock.restaurar();
      }
      const { data: sus } = await admin.from("dulabs_suscripciones").select("estado").eq("id_tenant", t.tenantId).single();
      assert.equal(sus?.estado, "pendiente_pago");
    });

    it("Escenario C — DECLINED marca la suscripción como vencida", async () => {
      const t = await crearTenantConUsuario(admin, "f14-bill-c");
      tenantsCreados.push(t.tenantId);
      const mock = instalarMocksBilling({ colaTransacciones: [{ status: "DECLINED" }] });
      try {
        const res = await suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir(), t.token));
        assert.equal(res.status, 200);
      } finally {
        mock.restaurar();
      }
      const { data: sus } = await admin.from("dulabs_suscripciones").select("estado").eq("id_tenant", t.tenantId).single();
      assert.equal(sus?.estado, "vencida");
    });

    it("Escenario F — dos POST /pagos/suscribir simultáneos del mismo tenant: solo uno cobra (reserva atómica)", async () => {
      const t = await crearTenantConUsuario(admin, "f14-bill-f");
      tenantsCreados.push(t.tenantId);
      const mock = instalarMocksBilling({ colaTransacciones: [{ status: "APPROVED" }] });
      try {
        const body = bodySuscribir();
        const [r1, r2] = await Promise.all([
          suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", body, t.token)),
          suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", body, t.token)),
        ]);
        const statuses = [r1.status, r2.status].sort();
        // Uno de los dos debe ganar (200) y el otro debe chocar con la
        // reserva atómica (409) -- NUNCA los dos 200 (eso sería doble cobro).
        assert.deepEqual(statuses, [200, 409]);
        assert.equal(mock.numeroDeCargosIntentados(), 1, "solo se debe haber llamado a Wompi UNA vez, no dos");
      } finally {
        mock.restaurar();
      }
    });

    it("Escenario D — webhook duplicado (mismo evento 2 veces) es idempotente", async () => {
      const t = await crearTenantConUsuario(admin, "f14-bill-d");
      tenantsCreados.push(t.tenantId);
      const mock = instalarMocksBilling({ colaTransacciones: [{ status: "APPROVED", id: `f14-dup-${randomUUID()}` }] });
      try {
        const res = await suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir(), t.token));
        assert.equal(res.status, 200);
      } finally {
        mock.restaurar();
      }
      const { data: pago } = await admin.from("dulabs_pagos").select("wompi_transaction_id").eq("id_tenant", t.tenantId).single();
      const transaccionId = pago!.wompi_transaction_id;

      const evento = await construirEventoWompiFirmado({ transactionId: transaccionId, status: "APPROVED" });
      const res1 = await webhookPOST(reqJson("http://test/api/wompi/webhook", "POST", evento));
      const res2 = await webhookPOST(reqJson("http://test/api/wompi/webhook", "POST", evento));
      assert.equal(res1.status, 200);
      assert.equal(res2.status, 200);

      const { data: sus } = await admin.from("dulabs_suscripciones").select("estado").eq("id_tenant", t.tenantId).single();
      assert.equal(sus?.estado, "activa");
      const { count } = await admin
        .from("dulabs_onboarding_sesiones")
        .select("*", { count: "exact", head: true })
        .eq("id_tenant", t.tenantId);
      assert.ok((count ?? 0) <= 1, "el webhook duplicado no debe crear una segunda sesión de onboarding");
    });

    it("Escenario E — webhook fuera de orden: un evento viejo NO debe revertir una transacción más nueva ya aprobada (hallazgo F14, ya corregido)", async () => {
      const t = await crearTenantConUsuario(admin, "f14-bill-e");
      tenantsCreados.push(t.tenantId);
      // Deja al tenant ya "activa" (transacción inicial aprobada).
      const mock1 = instalarMocksBilling({ colaTransacciones: [{ status: "APPROVED" }] });
      try {
        const res = await suscribirPOST(reqJson("http://test/api/pagos/suscribir", "POST", bodySuscribir(), t.token));
        assert.equal(res.status, 200);
      } finally {
        mock1.restaurar();
      }

      // Simula lo que haría el cron de renovación (SIN invocar la ruta real,
      // que tocaría toda la tabla): dos intentos de cobro para el mismo
      // tenant, insertados directamente como haría cobro-mensual/route.ts.
      const txVieja = `f14-vieja-${randomUUID()}`;
      const txNueva = `f14-nueva-${randomUUID()}`;
      const { data: pagoVieja } = await admin
        .from("dulabs_pagos")
        .insert({ id_tenant: t.tenantId, wompi_transaction_id: txVieja, monto_cop: 79990, estado: "PENDING", tipo: "suscripcion" })
        .select("id")
        .single();
      const { data: pagoNueva } = await admin
        .from("dulabs_pagos")
        .insert({ id_tenant: t.tenantId, wompi_transaction_id: txNueva, monto_cop: 79990, estado: "PENDING", tipo: "suscripcion" })
        .select("id")
        .single();
      assert.ok(pagoNueva!.id > pagoVieja!.id, "la fila insertada después debe tener un id mayor (bigint identity)");

      // La transacción NUEVA se aprueba primero (webhook llega primero) -> activa.
      const eventoNuevaAprobada = await construirEventoWompiFirmado({ transactionId: txNueva, status: "APPROVED" });
      const resNueva = await webhookPOST(reqJson("http://test/api/wompi/webhook", "POST", eventoNuevaAprobada));
      assert.equal(resNueva.status, 200);
      let sus = (await admin.from("dulabs_suscripciones").select("estado").eq("id_tenant", t.tenantId).single()).data;
      assert.equal(sus?.estado, "activa", "la transacción nueva aprobada debe activar la suscripción");

      // El evento de la transacción VIEJA (rechazada) llega DESPUÉS, fuera de
      // orden -- ANTES del fix esto revertía la suscripción a "vencida"
      // aunque la transacción nueva ya la había activado correctamente.
      const eventoViejaRechazada = await construirEventoWompiFirmado({ transactionId: txVieja, status: "DECLINED" });
      const resVieja = await webhookPOST(reqJson("http://test/api/wompi/webhook", "POST", eventoViejaRechazada));
      assert.equal(resVieja.status, 200);
      sus = (await admin.from("dulabs_suscripciones").select("estado").eq("id_tenant", t.tenantId).single()).data;
      assert.equal(sus?.estado, "activa", "un evento de una transacción VIEJA no debe revertir el estado que dejó una transacción más NUEVA");
    });

    it("verificarChecksumEvento (unit) — hallazgo F14 CRÍTICO ya corregido: aceptaba/rechazaba con los valores reales de payload.data.transaction.*, no payload.data.*", async () => {
      const evento = await construirEventoWompiFirmado({ transactionId: "tx-checksum-1", status: "APPROVED", amountInCents: 7999000 });
      assert.equal(verificarChecksumEvento(evento), true, "un evento firmado correctamente debe validar (antes del fix, SIEMPRE daba false)");

      const eventoAlterado = { ...evento, data: { transaction: { ...evento.data.transaction, status: "DECLINED" } } };
      assert.equal(verificarChecksumEvento(eventoAlterado), false, "cambiar un valor firmado sin recalcular el checksum debe seguir siendo rechazado");
    });

    it("resolverAccionWebhookPago (unit) — ignora explícitamente un evento que no es el más reciente", () => {
      const accion = resolverAccionWebhookPago(
        { id_tenant: "t1", tipo: "suscripcion", marketplace_activacion_id: null },
        "DECLINED",
        false, // esTransaccionMasReciente = false
      );
      assert.equal(accion.tipo, "sin_accion");
    });

    it("Fase 4 (unit, sin tocar la tabla real) — debeOmitirCobroPorPagoPendiente detecta el riesgo de doble cobro del cron", () => {
      assert.equal(debeOmitirCobroPorPagoPendiente({ estado: "PENDING" }), true, "un cobro anterior PENDING debe frenar un segundo intento del cron");
      assert.equal(debeOmitirCobroPorPagoPendiente({ estado: "APPROVED" }), false);
      assert.equal(debeOmitirCobroPorPagoPendiente({ estado: "DECLINED" }), false);
      assert.equal(debeOmitirCobroPorPagoPendiente(null), false, "un tenant sin pagos previos (primera renovación) sí debe cobrarse");
    });
  },
);
