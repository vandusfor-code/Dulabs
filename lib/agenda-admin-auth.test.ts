/**
 * Fase P (usuarios y permisos, autorizado) — pruebas de la base real de
 * roles: requiereAdministrador (pura) y la resolución de rol dentro de
 * resolverTenantDesdeToken (integración real, tenants descartables,
 * randomUUID, nunca Daniela/Solo Talento/AMORE real).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolverTenantDesdeToken, requiereAdministrador } from "./agenda-admin-auth";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("requiereAdministrador (pura)", () => {
  it("permite cuando rol='administrador'", () => {
    const r = requiereAdministrador({ ok: true, idTenant: "t", phoneNumberId: "p", especialistaId: 1, rol: "administrador" });
    assert.deepEqual(r, { ok: true });
  });

  it("rechaza con 403 cuando rol='personal'", () => {
    const r = requiereAdministrador({ ok: true, idTenant: "t", phoneNumberId: "p", especialistaId: 1, rol: "personal" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 403);
  });
});

describe(
  "resolverTenantDesdeToken -- resolución real de rol",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    let migracionRolLista = false;
    const especialistaIds: number[] = [];
    const tenantsConSuscripcion: string[] = [];

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const sonda = await supabase.from("dulabs_especialistas").select("rol").limit(1);
      migracionRolLista = !sonda.error;
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (especialistaIds.length) await supabase.from("dulabs_especialistas").delete().in("id", especialistaIds);
      if (tenantsConSuscripcion.length) await supabase.from("dulabs_suscripciones").delete().in("id_tenant", tenantsConSuscripcion);
    });

    // resolverTenantDesdeToken exige un plan activo (dulabs_suscripciones) --
    // sin esto, cualquier tenant descartable recién creado (sin fila de
    // suscripción) se resolvería como "Plan pausado", que es el
    // comportamiento REAL correcto para un tenant que nunca pagó, pero no lo
    // que estas pruebas de rol quieren ejercitar.
    async function activarPlanDescartable(idTenant: string): Promise<void> {
      tenantsConSuscripcion.push(idTenant);
      const { error } = await supabase.from("dulabs_suscripciones").insert({
        id_tenant: idTenant,
        plan: "start",
        precio_cop: 1,
        wompi_payment_source_id: `test-${idTenant}`,
        wompi_customer_email: "prueba@dulabs.co",
        estado: "activa",
        fecha_proximo_cobro: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      });
      if (error) throw error;
    }

    async function crearEspecialista(idTenant: string, extra: Record<string, unknown> = {}): Promise<{ id: number; token: string }> {
      await activarPlanDescartable(idTenant);
      const { data, error } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: idTenant,
          phone_number_id: `test-rol-${idTenant}`,
          nombre: "Prueba Rol",
          numero_whatsapp: `57300${Math.floor(Math.random() * 10_000_000)}`,
          servicio: "general",
          ...extra,
        })
        .select("id, token")
        .single();
      if (error) throw error;
      especialistaIds.push(data!.id as number);
      return data as { id: number; token: string };
    }

    it("una fila SIN rol explícito (o con la migración aún no corrida) se resuelve como 'administrador' -- nunca rompe, nunca bloquea", async () => {
      const TENANT = randomUUID();
      const { token } = await crearEspecialista(TENANT);
      const resultado = await resolverTenantDesdeToken(supabase, token);
      assert.ok(resultado.ok);
      if (resultado.ok) assert.equal(resultado.rol, "administrador");
    });

    it("una fila explícitamente 'personal' se resuelve como 'personal' (requiere la migración de rol)", async (t) => {
      if (!migracionRolLista) return t.skip("falta la migración de dulabs_especialistas.rol");
      const TENANT = randomUUID();
      const { token } = await crearEspecialista(TENANT, { rol: "personal" });
      const resultado = await resolverTenantDesdeToken(supabase, token);
      assert.ok(resultado.ok);
      if (resultado.ok) {
        assert.equal(resultado.rol, "personal");
        const permiso = requiereAdministrador(resultado);
        assert.equal(permiso.ok, false);
      }
    });
  }
);
