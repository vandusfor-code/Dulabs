/**
 * Login AMORE (autorizado) — integración REAL contra Supabase (tenants
 * descartables, randomUUID, nunca AMORE/Daniela/Solo Talento reales) del
 * gate opt-in de resolverTenantDesdeToken: un tenant SIN filas en
 * dulabs_usuarios sigue funcionando EXACTAMENTE como antes (sin sesión);
 * uno CON filas exige una sesión real que además pertenezca a ese mismo
 * tenant. Si la migración 20260909000000_usuarios_login.sql todavía no se
 * ha corrido, el `before()` lo detecta y todo el archivo se salta con un
 * mensaje claro.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolverTenantDesdeToken, requiereAdministrador } from "./agenda-admin-auth";
import { hashPassword } from "./auth/password";
import { crearSesion, construirSetCookie } from "./auth/session";
import type { NextRequest } from "next/server";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function requestConCookie(cookieHeader: string | null): NextRequest {
  return { headers: { get: (nombre: string) => (nombre.toLowerCase() === "cookie" ? cookieHeader : null) } } as unknown as NextRequest;
}

describe(
  "lib/agenda-admin-auth — gate opt-in de login (integración real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    let migracionLista = false;
    const tenantsCreados: string[] = [];
    const especialistasCreados: number[] = [];
    const usuariosCreados: number[] = [];

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const sonda = await supabase.from("dulabs_usuarios").select("id").limit(1);
      migracionLista = !sonda.error;
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (usuariosCreados.length > 0) await supabase.from("dulabs_usuarios").delete().in("id", usuariosCreados);
      if (especialistasCreados.length > 0) await supabase.from("dulabs_especialistas").delete().in("id", especialistasCreados);
      if (tenantsCreados.length > 0) await supabase.from("dulabs_suscripciones").delete().in("id_tenant", tenantsCreados);
    });

    async function activarPlanDescartable(idTenant: string): Promise<void> {
      tenantsCreados.push(idTenant);
      await supabase.from("dulabs_suscripciones").insert({
        id_tenant: idTenant,
        plan: "start",
        precio_cop: 0,
        wompi_payment_source_id: "prueba",
        wompi_customer_email: "prueba@dulabs.co",
        estado: "activa",
        fecha_proximo_cobro: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    async function crearEspecialista(idTenant: string): Promise<{ id: number; token: string }> {
      const token = randomUUID().slice(0, 8);
      const { data } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: idTenant,
          phone_number_id: `prueba-${idTenant}`,
          nombre: "Especialista de prueba",
          numero_whatsapp: token, // único por llamada -- evita chocar con dulabs_especialistas_numero_unico cuando el mismo tenant crea más de una especialista de prueba
          servicio: "prueba",
          duracion_min: 60,
          token,
          activo: true,
          bloquea_horario: true,
          es_general: false,
          requiere_aprobacion: false,
        })
        .select("id")
        .single();
      const id = data!.id as number;
      especialistasCreados.push(id);
      return { id, token };
    }

    it("tenant SIN dulabs_usuarios: resuelve sin cookie, rol=administrador, sesion=null (comportamiento de siempre)", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260909000000_usuarios_login.sql");
      const idTenant = randomUUID();
      await activarPlanDescartable(idTenant);
      const { token } = await crearEspecialista(idTenant);

      const resultado = await resolverTenantDesdeToken(supabase, token, requestConCookie(null));
      assert.equal(resultado.ok, true);
      if (resultado.ok) {
        assert.equal(resultado.rol, "administrador");
        assert.equal(resultado.sesion, null);
        assert.equal(requiereAdministrador(resultado).ok, true);
      }
    });

    it("tenant CON dulabs_usuarios, sin cookie: 401", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260909000000_usuarios_login.sql");
      const idTenant = randomUUID();
      await activarPlanDescartable(idTenant);
      const { id: especialistaId, token } = await crearEspecialista(idTenant);
      const { data: usuario } = await supabase
        .from("dulabs_usuarios")
        .insert({
          id_tenant: idTenant,
          especialista_id: especialistaId,
          username: `prueba-${randomUUID()}`,
          password_hash: await hashPassword("clave"),
          nombre: "Admin de prueba",
          rol: "administrador",
        })
        .select("id")
        .single();
      usuariosCreados.push(usuario!.id as number);

      const resultado = await resolverTenantDesdeToken(supabase, token, requestConCookie(null));
      assert.equal(resultado.ok, false);
      if (!resultado.ok) assert.equal(resultado.status, 401);
    });

    it("tenant CON dulabs_usuarios, cookie de sesión de OTRO tenant: 403", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260909000000_usuarios_login.sql");
      const idTenantA = randomUUID();
      const idTenantB = randomUUID();
      await activarPlanDescartable(idTenantA);
      await activarPlanDescartable(idTenantB);
      const { id: especialistaIdA, token: tokenA } = await crearEspecialista(idTenantA);
      const { id: especialistaIdB } = await crearEspecialista(idTenantB);

      // A tiene login habilitado (fila en dulabs_usuarios); B también, pero
      // la sesión que se usa para pedir el token de A pertenece a B.
      const { data: usuarioA } = await supabase
        .from("dulabs_usuarios")
        .insert({
          id_tenant: idTenantA,
          especialista_id: especialistaIdA,
          username: `prueba-a-${randomUUID()}`,
          password_hash: await hashPassword("clave"),
          nombre: "Admin A",
          rol: "administrador",
        })
        .select("id")
        .single();
      usuariosCreados.push(usuarioA!.id as number);

      const { data: usuarioB } = await supabase
        .from("dulabs_usuarios")
        .insert({
          id_tenant: idTenantB,
          especialista_id: especialistaIdB,
          username: `prueba-b-${randomUUID()}`,
          password_hash: await hashPassword("clave"),
          nombre: "Admin B",
          rol: "administrador",
        })
        .select("id")
        .single();
      usuariosCreados.push(usuarioB!.id as number);

      const tokenSesionB = await crearSesion(supabase, usuarioB!.id as number);
      const cookie = construirSetCookie(tokenSesionB).split(";")[0]!;

      const resultado = await resolverTenantDesdeToken(supabase, tokenA, requestConCookie(cookie));
      assert.equal(resultado.ok, false);
      if (!resultado.ok) assert.equal(resultado.status, 403);
    });

    it("tenant CON dulabs_usuarios, cookie de sesión correcta (colaboradora): resuelve con su propio rol/especialista", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260909000000_usuarios_login.sql");
      const idTenant = randomUUID();
      await activarPlanDescartable(idTenant);
      const { id: especialistaId, token } = await crearEspecialista(idTenant);
      const { data: usuario } = await supabase
        .from("dulabs_usuarios")
        .insert({
          id_tenant: idTenant,
          especialista_id: especialistaId,
          username: `prueba-${randomUUID()}`,
          password_hash: await hashPassword("clave"),
          nombre: "Colaboradora de prueba",
          rol: "colaboradora",
        })
        .select("id")
        .single();
      usuariosCreados.push(usuario!.id as number);

      const tokenSesion = await crearSesion(supabase, usuario!.id as number);
      const cookie = construirSetCookie(tokenSesion).split(";")[0]!;

      const resultado = await resolverTenantDesdeToken(supabase, token, requestConCookie(cookie));
      assert.equal(resultado.ok, true);
      if (resultado.ok) {
        assert.equal(resultado.rol, "colaboradora");
        assert.equal(resultado.sesion?.especialistaId, especialistaId);
        assert.equal(requiereAdministrador(resultado).ok, false);
      }
    });

    it("REGRESIÓN (hallazgo real en producción): una colaboradora NUNCA puede usar el token de OTRA especialista del mismo tenant -- 403", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260909000000_usuarios_login.sql");
      const idTenant = randomUUID();
      await activarPlanDescartable(idTenant);
      const { id: especialistaIdPropia } = await crearEspecialista(idTenant);
      const { token: tokenDeOtra } = await crearEspecialista(idTenant);

      const { data: usuario } = await supabase
        .from("dulabs_usuarios")
        .insert({
          id_tenant: idTenant,
          especialista_id: especialistaIdPropia,
          username: `prueba-${randomUUID()}`,
          password_hash: await hashPassword("clave"),
          nombre: "Colaboradora de prueba",
          rol: "colaboradora",
        })
        .select("id")
        .single();
      usuariosCreados.push(usuario!.id as number);

      const tokenSesion = await crearSesion(supabase, usuario!.id as number);
      const cookie = construirSetCookie(tokenSesion).split(";")[0]!;

      // Usa su cookie de sesión válida, pero con el TOKEN de otra especialista del mismo tenant.
      const resultado = await resolverTenantDesdeToken(supabase, tokenDeOtra, requestConCookie(cookie));
      assert.equal(resultado.ok, false);
      if (!resultado.ok) assert.equal(resultado.status, 403);
    });
  }
);
