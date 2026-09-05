/**
 * Login AMORE (autorizado) — integración REAL contra Supabase (tenants
 * descartables, randomUUID, nunca AMORE/Daniela/Solo Talento reales) de
 * session.ts. Si la migración 20260909000000_usuarios_login.sql todavía no
 * se ha corrido, el `before()` lo detecta y todo el archivo se salta con un
 * mensaje claro (mismo patrón que manager.test.ts del worker de WhatsApp).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { crearSesion, resolverSesion, revocarSesion, extraerTokenCookie, construirSetCookie, construirClearCookie } from "./session";
import { hashPassword } from "./password";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "lib/auth/session — integración real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    let migracionLista = false;
    const usuariosCreados: number[] = [];
    const especialistasCreados: number[] = [];

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
    });

    async function nuevoUsuario(rol: "administrador" | "colaboradora" = "administrador", activo = true): Promise<number> {
      const idTenant = randomUUID();
      let especialistaId: number | null = null;
      if (rol === "colaboradora") {
        const { data: especialista } = await supabase
          .from("dulabs_especialistas")
          .insert({
            id_tenant: idTenant,
            phone_number_id: `prueba-${idTenant}`,
            nombre: "Especialista de prueba",
            numero_whatsapp: "0000000000",
            servicio: "prueba",
            duracion_min: 60,
            token: randomUUID().slice(0, 8),
            activo: true,
            bloquea_horario: true,
            es_general: false,
            requiere_aprobacion: false,
          })
          .select("id")
          .single();
        especialistaId = especialista!.id as number;
        especialistasCreados.push(especialistaId);
      }

      const { data } = await supabase
        .from("dulabs_usuarios")
        .insert({
          id_tenant: idTenant,
          especialista_id: especialistaId,
          username: `prueba-session-${randomUUID()}`,
          password_hash: await hashPassword("clave-de-prueba"),
          nombre: "Usuario de prueba",
          rol,
          activo,
        })
        .select("id")
        .single();
      const id = data!.id as number;
      usuariosCreados.push(id);
      return id;
    }

    it("crea una sesión y resolverSesion la encuentra con los datos correctos", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260909000000_usuarios_login.sql");
      const usuarioId = await nuevoUsuario("administrador");
      const token = await crearSesion(supabase, usuarioId);
      const sesion = await resolverSesion(supabase, token);
      assert.ok(sesion);
      assert.equal(sesion!.usuarioId, usuarioId);
      assert.equal(sesion!.rol, "administrador");
    });

    it("un token que nunca existió resuelve null, nunca lanza", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260909000000_usuarios_login.sql");
      const sesion = await resolverSesion(supabase, "token-que-jamas-existio");
      assert.equal(sesion, null);
    });

    it("revocarSesion invalida la sesión de verdad -- resolverSesion deja de encontrarla", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260909000000_usuarios_login.sql");
      const usuarioId = await nuevoUsuario("colaboradora");
      const token = await crearSesion(supabase, usuarioId);
      assert.ok(await resolverSesion(supabase, token));
      await revocarSesion(supabase, token);
      assert.equal(await resolverSesion(supabase, token), null);
    });

    it("un usuario desactivado (activo=false) nunca resuelve sesión válida, aunque el token exista", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260909000000_usuarios_login.sql");
      const usuarioId = await nuevoUsuario("colaboradora", false);
      const token = await crearSesion(supabase, usuarioId);
      assert.equal(await resolverSesion(supabase, token), null);
    });
  }
);

describe("lib/auth/session — cookies (puro, sin I/O)", () => {
  it("extraerTokenCookie encuentra el valor entre otras cookies", () => {
    assert.equal(extraerTokenCookie("otra=1; dulabs_sesion=abc123; mas=2"), "abc123");
  });
  it("extraerTokenCookie devuelve null si no está presente", () => {
    assert.equal(extraerTokenCookie("otra=1; mas=2"), null);
    assert.equal(extraerTokenCookie(null), null);
  });
  it("construirSetCookie produce httpOnly + Secure + SameSite=Lax", () => {
    const header = construirSetCookie("abc123");
    assert.ok(header.includes("HttpOnly"));
    assert.ok(header.includes("Secure"));
    assert.ok(header.includes("SameSite=Lax"));
    assert.ok(header.includes("abc123"));
  });
  it("construirClearCookie expira inmediatamente (Max-Age=0)", () => {
    assert.ok(construirClearCookie().includes("Max-Age=0"));
  });
});
