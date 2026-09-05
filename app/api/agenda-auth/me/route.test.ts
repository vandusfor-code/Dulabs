/**
 * Panel web AMORE (autorizado) — integración REAL contra Supabase (tenants
 * descartables, randomUUID, nunca AMORE/Daniela/Solo Talento reales) de
 * GET /api/agenda-auth/me: la única pieza de servidor genuinamente NUEVA de
 * esta fase (resuelve "quién soy" desde la cookie de sesión, sin depender
 * del token de agenda en la URL -- lo que permite que /admin/amore exista).
 * Si la migración de usuarios todavía no se ha corrido, el `before()` lo
 * detecta y todo el archivo se salta con un mensaje claro.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { GET as meGET } from "./route";
import { hashPassword } from "@/lib/auth/password";
import { crearSesion, construirSetCookie } from "@/lib/auth/session";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function reqConCookie(cookie: string | null): NextRequest {
  return new NextRequest("http://x/api/agenda-auth/me", {
    headers: cookie ? { cookie } : undefined,
  });
}

describe(
  "GET /api/agenda-auth/me — integración real",
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
      if (!HAS_SUPABASE || !migracionLista) return;
      if (usuariosCreados.length > 0) await supabase.from("dulabs_usuarios").delete().in("id", usuariosCreados);
      if (especialistasCreados.length > 0) await supabase.from("dulabs_especialistas").delete().in("id", especialistasCreados);
      if (tenantsCreados.length > 0) await supabase.from("dulabs_suscripciones").delete().in("id_tenant", tenantsCreados);
    });

    async function crearUsuarioConSesion(rol: "administrador" | "colaboradora"): Promise<{ cookie: string; especialistaToken: string }> {
      const idTenant = randomUUID();
      tenantsCreados.push(idTenant);
      const especialistaToken = randomUUID().slice(0, 8);
      const { data: especialista } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: idTenant,
          phone_number_id: `prueba-${idTenant}`,
          nombre: "Especialista de prueba",
          numero_whatsapp: especialistaToken,
          servicio: "prueba",
          duracion_min: 60,
          token: especialistaToken,
          activo: true,
          bloquea_horario: true,
          es_general: false,
          requiere_aprobacion: false,
        })
        .select("id")
        .single();
      const especialistaId = especialista!.id as number;
      especialistasCreados.push(especialistaId);

      const { data: usuario } = await supabase
        .from("dulabs_usuarios")
        .insert({
          id_tenant: idTenant,
          especialista_id: especialistaId,
          username: `prueba-me-${randomUUID()}`,
          password_hash: await hashPassword("clave"),
          nombre: "Usuario de prueba",
          rol,
        })
        .select("id")
        .single();
      usuariosCreados.push(usuario!.id as number);

      const tokenSesion = await crearSesion(supabase, usuario!.id as number);
      const cookie = construirSetCookie(tokenSesion).split(";")[0]!;
      return { cookie, especialistaToken };
    }

    it("sin cookie: 401", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260909000000_usuarios_login.sql");
      const res = await meGET(reqConCookie(null));
      assert.equal(res.status, 401);
    });

    it("cookie inválida (token que nunca existió): 401", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260909000000_usuarios_login.sql");
      const res = await meGET(reqConCookie("dulabs_sesion=no-existe"));
      assert.equal(res.status, 401);
    });

    it("sesión válida de administrador: devuelve su propio token/rol/nombre", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260909000000_usuarios_login.sql");
      const { cookie, especialistaToken } = await crearUsuarioConSesion("administrador");
      const res = await meGET(reqConCookie(cookie));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.token, especialistaToken);
      assert.equal(body.rol, "administrador");
    });

    it("sesión válida de colaboradora: devuelve su propio token/rol", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260909000000_usuarios_login.sql");
      const { cookie, especialistaToken } = await crearUsuarioConSesion("colaboradora");
      const res = await meGET(reqConCookie(cookie));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.token, especialistaToken);
      assert.equal(body.rol, "colaboradora");
    });
  }
);
