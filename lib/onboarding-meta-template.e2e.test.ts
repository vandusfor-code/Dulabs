/**
 * F16.2 (Onboarding comercial: pago -> conectar WhatsApp con Meta ->
 * plantilla bienvenida_dulabs, autorizado) — E2E real contra Supabase,
 * mismo patrón que lib/flow/f16-1-dunning.e2e.test.ts: tenants 100%
 * desechables, se borran al final. NUNCA manda un WhatsApp real: este
 * entorno no tiene ALERTAS_META_TOKEN/ALERTAS_PHONE_NUMBER_ID configurados
 * (confirmado abajo, no asumido), así que dispararBienvenidaMetaSiAplica
 * llega como mucho hasta "credenciales_alerta_faltantes" — el camino real
 * de envío (consultarEstadoPlantilla/enviarPlantilla contra la Graph API)
 * NUNCA se ejerce en esta suite. Eso es intencional (sección 28/30 del
 * brief: "NO enviar WhatsApp reales durante pruebas"), no una limitación
 * oculta -- se deja documentado y verificado explícitamente en vez de
 * mockear la llamada de red.
 *
 * REQUIERE la migración 20261005000000_dulabs_onboarding_meta_bienvenida.sql
 * aplicada (columnas bienvenida_meta_* en dulabs_onboarding_sesiones) — ver
 * PENDING_MIGRATIONS.md. Si no está aplicada, los tests que tocan esas
 * columnas fallan con un error claro de Postgres en vez de silenciarse.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PLANES } from "@/lib/planes";
import { dispararBienvenidaMetaSiAplica } from "@/lib/onboarding-meta-template";
import { reclamarEnvioBienvenidaMeta, crearOnboardingSesionIdempotente, marcarBienvenidaMetaFallida } from "@/lib/onboarding-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

async function crearTenantDesechable(admin: SupabaseClient, prefijo: string): Promise<string> {
  const email = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !created.user) throw error ?? new Error("no se pudo crear el usuario de prueba");
  const idTenant = created.user.id;
  await admin.from("dulabs_miembros_equipo").insert({ tenant_id: idTenant, user_id: idTenant, email, rol: "admin", estado: "activo" });
  return idTenant;
}

describe(
  "F16.2 — Onboarding comercial: setup fee, bienvenida Meta idempotente, seguridad",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const tenantsCreados: string[] = [];

    after(async () => {
      for (const idTenant of tenantsCreados) {
        await admin.from("dulabs_onboarding_sesiones").delete().eq("id_tenant", idTenant).then(() => {}, () => {});
        await admin.from("dulabs_suscripciones").delete().eq("id_tenant", idTenant).then(() => {}, () => {});
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", idTenant).then(() => {}, () => {});
        await admin.auth.admin.deleteUser(idTenant).catch(() => {});
      }
    });

    // --- Sección 5/6 del brief: precios y setup fee ---

    it("essential/business/pro tienen la mensualidad y el setup fee exactos del brief", () => {
      assert.equal(PLANES.essential.precioCop, 79990);
      assert.equal(PLANES.essential.implementacionCop, 49990);
      assert.equal(PLANES.essential.precioCop + (PLANES.essential.implementacionCop ?? 0), 129980);

      assert.equal(PLANES.business.precioCop, 159990);
      assert.equal(PLANES.business.implementacionCop, 149990);
      assert.equal(PLANES.business.precioCop + (PLANES.business.implementacionCop ?? 0), 309980);

      assert.equal(PLANES.pro.precioCop, 299990);
      assert.equal(PLANES.pro.implementacionCop, 199990);
      assert.equal(PLANES.pro.precioCop + (PLANES.pro.implementacionCop ?? 0), 499980);
    });

    // --- Confirma real (no asumido) que este entorno no puede mandar WhatsApp ---

    it("este entorno NO tiene credenciales de alerta configuradas (documenta por qué el envío real nunca se ejerce acá)", () => {
      assert.equal(process.env.ALERTAS_META_TOKEN ?? "", "");
      assert.equal(process.env.ALERTAS_PHONE_NUMBER_ID ?? "", "");
    });

    // --- Condiciones de disparo (sección 16 del brief) ---

    it("no dispara nada si el pago todavía no está confirmado", async () => {
      const idTenant = await crearTenantDesechable(admin, "f162-sin-pago");
      tenantsCreados.push(idTenant);
      await admin.from("dulabs_suscripciones").insert({
        id_tenant: idTenant,
        plan: "essential",
        precio_cop: 79990,
        estado: "pendiente_pago",
        fecha_proximo_cobro: "2099-01-01",
        telefono_onboarding: "573001112233",
      });

      const resultado = await dispararBienvenidaMetaSiAplica(admin, idTenant);
      assert.equal(resultado.enviado, false);
      if (!resultado.enviado) assert.equal(resultado.motivo, "pago_no_confirmado");
    });

    it("no dispara nada si no hay teléfono de contacto guardado", async () => {
      const idTenant = await crearTenantDesechable(admin, "f162-sin-telefono");
      tenantsCreados.push(idTenant);
      await admin.from("dulabs_suscripciones").insert({
        id_tenant: idTenant,
        plan: "essential",
        precio_cop: 79990,
        estado: "activa",
        fecha_proximo_cobro: "2099-01-01",
        telefono_onboarding: null,
      });

      const resultado = await dispararBienvenidaMetaSiAplica(admin, idTenant);
      assert.equal(resultado.enviado, false);
      if (!resultado.enviado) assert.equal(resultado.motivo, "sin_telefono_contacto");
    });

    it("con pago activo y teléfono, sin credenciales de alerta configuradas, falla de forma controlada y deja el motivo registrado (nunca intenta mandar nada a Meta)", async () => {
      const idTenant = await crearTenantDesechable(admin, "f162-sin-creds");
      tenantsCreados.push(idTenant);
      await admin.from("dulabs_suscripciones").insert({
        id_tenant: idTenant,
        plan: "essential",
        precio_cop: 79990,
        estado: "activa",
        fecha_proximo_cobro: "2099-01-01",
        telefono_onboarding: "573001112233",
      });

      const resultado = await dispararBienvenidaMetaSiAplica(admin, idTenant);
      assert.equal(resultado.enviado, false);
      if (!resultado.enviado) assert.equal(resultado.motivo, "credenciales_alerta_faltantes");

      const { data: sesion } = await admin.from("dulabs_onboarding_sesiones").select("bienvenida_meta_enviada_at, bienvenida_meta_error, estado_implementacion").eq("id_tenant", idTenant).single();
      assert.equal(sesion?.bienvenida_meta_enviada_at, null);
      assert.ok(sesion?.bienvenida_meta_error?.includes("ALERTAS_"));
      // El fallo NO debe adelantar el estado de implementación (sección 13/19).
      assert.equal(sesion?.estado_implementacion, "PENDIENTE");
    });

    // --- Idempotencia real (sección 18 del brief) ---

    it("reclamarEnvioBienvenidaMeta es atómico: llamadas concurrentes solo dejan que UNA gane el reclamo", async () => {
      const idTenant = await crearTenantDesechable(admin, "f162-concurrencia");
      tenantsCreados.push(idTenant);
      await crearOnboardingSesionIdempotente(admin, {
        idTenant,
        phoneNumberId: "test-phone-number-id",
        telefonoCliente: "573001112233",
        plan: "Essential",
      });

      const resultados = await Promise.all([
        reclamarEnvioBienvenidaMeta(admin, idTenant),
        reclamarEnvioBienvenidaMeta(admin, idTenant),
        reclamarEnvioBienvenidaMeta(admin, idTenant),
        reclamarEnvioBienvenidaMeta(admin, idTenant),
        reclamarEnvioBienvenidaMeta(admin, idTenant),
      ]);
      const ganadores = resultados.filter((r) => r !== null);
      assert.equal(ganadores.length, 1, "exactamente una llamada concurrente debe ganar el reclamo, nunca cero ni más de una");
    });

    it("una vez reclamado, un segundo intento (ej. Meta reenvía el mismo evento) no vuelve a reclamar", async () => {
      const idTenant = await crearTenantDesechable(admin, "f162-doble-evento");
      tenantsCreados.push(idTenant);
      await crearOnboardingSesionIdempotente(admin, {
        idTenant,
        phoneNumberId: "test-phone-number-id",
        telefonoCliente: "573001112233",
        plan: "Essential",
      });

      const primero = await reclamarEnvioBienvenidaMeta(admin, idTenant);
      assert.ok(primero, "el primer reclamo debe ganar");
      const segundo = await reclamarEnvioBienvenidaMeta(admin, idTenant);
      assert.equal(segundo, null, "un segundo reclamo sobre la misma fila ya enviada debe devolver null");
    });

    it("marcarBienvenidaMetaFallida libera el reclamo para permitir un reintento real (sección 19)", async () => {
      const idTenant = await crearTenantDesechable(admin, "f162-reintento");
      tenantsCreados.push(idTenant);
      await crearOnboardingSesionIdempotente(admin, {
        idTenant,
        phoneNumberId: "test-phone-number-id",
        telefonoCliente: "573001112233",
        plan: "Essential",
      });

      const primero = await reclamarEnvioBienvenidaMeta(admin, idTenant);
      assert.ok(primero);
      await marcarBienvenidaMetaFallida(admin, idTenant, "fallo simulado de prueba");

      const reintento = await reclamarEnvioBienvenidaMeta(admin, idTenant);
      assert.ok(reintento, "después de marcar el fallo, un reintento debe poder volver a reclamar");
    });

    // --- Aislamiento entre tenants (sección 25/28 del brief) ---

    it("reclamar la bienvenida de un tenant nunca afecta la sesión de otro tenant", async () => {
      const tenantA = await crearTenantDesechable(admin, "f162-aislado-a");
      const tenantB = await crearTenantDesechable(admin, "f162-aislado-b");
      tenantsCreados.push(tenantA, tenantB);
      await crearOnboardingSesionIdempotente(admin, { idTenant: tenantA, phoneNumberId: "test-a", telefonoCliente: "573001110000", plan: "Essential" });
      await crearOnboardingSesionIdempotente(admin, { idTenant: tenantB, phoneNumberId: "test-b", telefonoCliente: "573002220000", plan: "Business" });

      const reclamoA = await reclamarEnvioBienvenidaMeta(admin, tenantA);
      assert.ok(reclamoA);
      assert.equal(reclamoA!.id_tenant, tenantA);

      const { data: sesionB } = await admin.from("dulabs_onboarding_sesiones").select("bienvenida_meta_enviada_at").eq("id_tenant", tenantB).single();
      assert.equal(sesionB?.bienvenida_meta_enviada_at, null, "el reclamo del tenant A no debe tocar la fila del tenant B");
    });
  }
);
