/**
 * POST /api/campanas/media — integración real contra Supabase (mismo
 * criterio que app/api/campanas/enviar/route.test.ts). NUNCA se llega a
 * subirMediaMeta() (llamada real a Meta): todos los casos probados aquí se
 * resuelven o fallan deliberadamente ANTES de esa línea.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { POST as mediaPOST } from "./route";
import { MENSAJE_PLANTILLA_DESCONECTADA } from "@/lib/plantilla-conexion";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const URL = "http://localhost/api/campanas/media";

function req(form: FormData | null, token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest(URL, { method: "POST", headers, body: form ?? undefined });
}

function formularioValido(phoneNumberId: string): FormData {
  const form = new FormData();
  form.append("phone_number_id", phoneNumberId);
  form.append("archivo", new File(["contenido de prueba"], "prueba.jpg", { type: "image/jpeg" }));
  return form;
}

describe(
  "POST /api/campanas/media — integración real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const sufijo = randomUUID().slice(0, 8);
    const PHONE_CONECTADO_A = `campanas-media-test-conectado-${sufijo}`;
    const PHONE_HUERFANO = `campanas-media-test-huerfano-${sufijo}`; // nunca insertado en dulabs_clientes_config
    const PHONE_TOKEN_MALO = `campanas-media-test-token-malo-${sufijo}`;

    type UsuarioPrueba = { id: string; token: string };
    let adminA: UsuarioPrueba;
    let lecturaA: UsuarioPrueba;
    let adminB: UsuarioPrueba;

    async function crearUsuario(nombre: string, tenantId: string, rol: "admin" | "agente" | "lectura"): Promise<UsuarioPrueba> {
      const email = `campanas-media-test-${nombre}-${sufijo}@example.com`;
      const password = `CampanasMediaTest-${randomUUID()}`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      const { error: miembroError } = await admin
        .from("dulabs_miembros_equipo")
        .insert({ tenant_id: tenantId, user_id: data.user.id, email, rol, estado: "activo" });
      if (miembroError) throw miembroError;

      const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      const { data: sesion, error: signInError } = await anon.auth.signInWithPassword({ email, password });
      if (signInError || !sesion.session) throw signInError ?? new Error("sin sesión");
      return { id: data.user.id, token: sesion.session.access_token };
    }

    before(async () => {
      adminA = await crearUsuario("admin-a", TENANT_A, "admin");
      lecturaA = await crearUsuario("lectura-a", TENANT_A, "lectura");
      adminB = await crearUsuario("admin-b", TENANT_B, "admin");

      const { error: configError } = await admin.from("dulabs_clientes_config").insert([
        {
          id_tenant: TENANT_A,
          phone_number_id: PHONE_CONECTADO_A,
          whatsapp_business_account_id: `waba-conectado-${sufijo}`,
          nombre_negocio: "Tenant A de prueba (campanas/media)",
          telefono_negocio: "570000000003",
          meta_permanent_token: null,
        },
        {
          id_tenant: TENANT_A,
          phone_number_id: PHONE_TOKEN_MALO,
          whatsapp_business_account_id: `waba-token-malo-${sufijo}`,
          nombre_negocio: "Tenant A de prueba (token corrupto)",
          telefono_negocio: "570000000004",
          meta_permanent_token: "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA",
        },
      ]);
      if (configError) throw configError;
    });

    after(async () => {
      await admin.from("dulabs_clientes_config").delete().eq("id_tenant", TENANT_A);
      await admin.from("dulabs_miembros_equipo").delete().in("tenant_id", [TENANT_A, TENANT_B]);
      for (const u of [adminA, lecturaA, adminB]) {
        if (u) await admin.auth.admin.deleteUser(u.id);
      }
    });

    it("sin token de sesión -> 401 JSON", async () => {
      const res = await mediaPOST(req(formularioValido(PHONE_CONECTADO_A)));
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(typeof data.error, "string");
    });

    it("rol 'lectura' (no admin) -> 403 JSON", async () => {
      const res = await mediaPOST(req(formularioValido(PHONE_CONECTADO_A), lecturaA.token));
      assert.equal(res.status, 403);
    });

    it("faltan campos requeridos -> 400 JSON", async () => {
      const form = new FormData();
      form.append("phone_number_id", PHONE_CONECTADO_A);
      // sin 'archivo' a propósito
      const res = await mediaPOST(req(form, adminA.token));
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(typeof data.error, "string");
    });

    it("Caso obligatorio 5: phone_number_id huérfano (sin config real para este tenant) -> 409, mensaje claro, NUNCA 'Número no encontrado'", async () => {
      const res = await mediaPOST(req(formularioValido(PHONE_HUERFANO), adminA.token));
      assert.equal(res.status, 409);
      const data = await res.json();
      assert.equal(data.error, MENSAJE_PLANTILLA_DESCONECTADA);
      assert.notEqual(data.error, "Número no encontrado");
    });

    it("Caso obligatorio 4: Tenant B no puede usar el phone_number_id conectado del Tenant A -> 409, nunca lo encuentra por aislamiento de tenant", async () => {
      const res = await mediaPOST(req(formularioValido(PHONE_CONECTADO_A), adminB.token));
      assert.equal(res.status, 409);
    });

    it("phone_number_id conectado real -> pasa la validación de conexión (nunca 409), se detiene de forma controlada por falta de token de Meta (nunca llama a Meta de verdad)", async () => {
      const res = await mediaPOST(req(formularioValido(PHONE_CONECTADO_A), adminA.token));
      assert.notEqual(res.status, 409, "un número conectado nunca debe rechazarse como huérfano");
      assert.equal(res.status, 500);
      const data = await res.json();
      assert.equal(data.error, "Sin token de Meta configurado para este número");
    });

    it("Caso obligatorio 7/8: token de Meta corrupto (descifrado falla) -> JSON 500, NUNCA HTML, nunca expone el token/stack", async () => {
      const res = await mediaPOST(req(formularioValido(PHONE_TOKEN_MALO), adminA.token));
      assert.equal(res.status, 500);
      assert.equal(res.headers.get("content-type")?.includes("application/json"), true);
      const data = await res.json();
      assert.equal(typeof data.error, "string");
      const textoCompleto = JSON.stringify(data);
      assert.doesNotMatch(textoCompleto, /AAAAAAAAAAAAAAAA/, "nunca debe exponer el valor del token corrupto");
      assert.doesNotMatch(textoCompleto, /at [A-Za-z]+.*\(.*:\d+:\d+\)/, "nunca debe exponer un stack trace");
    });
  },
);
