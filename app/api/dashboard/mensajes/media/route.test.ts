/**
 * FASE 11 (Completion & Debt Zero, autorizado) — POST /api/dashboard/mensajes/media
 * (subida de archivos del composer del Inbox a Meta). Integración real
 * contra Supabase, mismo patrón que app/api/campanas/media/route.test.ts:
 * NUNCA se llega a subirMediaMeta() (llamada real a Meta) -- todos los
 * casos se resuelven o fallan deliberadamente antes de esa línea.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { POST as mediaPOST } from "./route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const URL = "http://localhost/api/dashboard/mensajes/media";

function req(form: FormData | null, token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest(URL, { method: "POST", headers, body: form ?? undefined });
}

function formularioValido(phoneNumberId: string, opts?: { tipo?: string; archivo?: File }): FormData {
  const form = new FormData();
  form.append("phone_number_id", phoneNumberId);
  form.append("tipo", opts?.tipo ?? "image");
  form.append("archivo", opts?.archivo ?? new File(["contenido de prueba"], "prueba.jpg", { type: "image/jpeg" }));
  return form;
}

describe(
  "POST /api/dashboard/mensajes/media — integración real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const sufijo = randomUUID().slice(0, 8);
    const PHONE_CONECTADO_A = `f11-mensajes-media-conectado-${sufijo}`;
    const PHONE_TOKEN_MALO = `f11-mensajes-media-token-malo-${sufijo}`;

    type UsuarioPrueba = { id: string; token: string };
    let adminA: UsuarioPrueba;
    let lecturaA: UsuarioPrueba;
    let adminB: UsuarioPrueba;

    async function crearUsuario(nombre: string, tenantId: string, rol: "admin" | "agente" | "lectura"): Promise<UsuarioPrueba> {
      const email = `f11-mensajes-media-${nombre}-${sufijo}@example.com`;
      const password = `F11Test-${randomUUID()}`;
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
          nombre_negocio: "Tenant A de prueba (mensajes/media)",
          telefono_negocio: "570000000005",
          meta_permanent_token: null,
        },
        {
          id_tenant: TENANT_A,
          phone_number_id: PHONE_TOKEN_MALO,
          whatsapp_business_account_id: `waba-token-malo-${sufijo}`,
          nombre_negocio: "Tenant A de prueba (token corrupto)",
          telefono_negocio: "570000000006",
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
    });

    it("rol 'lectura' -> 403 (a diferencia de campañas, agente SÍ puede subir/enviar media del Inbox, lectura no)", async () => {
      const res = await mediaPOST(req(formularioValido(PHONE_CONECTADO_A), lecturaA.token));
      assert.equal(res.status, 403);
    });

    it("faltan campos requeridos -> 400", async () => {
      const form = new FormData();
      form.append("phone_number_id", PHONE_CONECTADO_A);
      const res = await mediaPOST(req(form, adminA.token));
      assert.equal(res.status, 400);
    });

    it("'tipo' inválido -> 400", async () => {
      const res = await mediaPOST(req(formularioValido(PHONE_CONECTADO_A, { tipo: "video-falso" }), adminA.token));
      assert.equal(res.status, 400);
    });

    it("mime type que no corresponde al 'tipo' declarado (pdf disfrazado de 'image') -> 400", async () => {
      const archivo = new File(["%PDF-1.4 contenido falso"], "doc.pdf", { type: "application/pdf" });
      const res = await mediaPOST(req(formularioValido(PHONE_CONECTADO_A, { tipo: "image", archivo }), adminA.token));
      assert.equal(res.status, 400);
    });

    it("un pdf declarado como 'document' SÍ pasa la validación de mime (documentos aceptan cualquier tipo)", async () => {
      const archivo = new File(["%PDF-1.4 contenido falso"], "doc.pdf", { type: "application/pdf" });
      const res = await mediaPOST(req(formularioValido(PHONE_CONECTADO_A, { tipo: "document", archivo }), adminA.token));
      // Pasa la validación de mime/tamaño -> llega hasta "sin token de Meta" (500), nunca 400.
      assert.notEqual(res.status, 400);
    });

    it("archivo vacío -> 400", async () => {
      const archivo = new File([], "vacio.jpg", { type: "image/jpeg" });
      const res = await mediaPOST(req(formularioValido(PHONE_CONECTADO_A, { archivo }), adminA.token));
      assert.equal(res.status, 400);
    });

    it("archivo más grande que el límite -> 400, nunca intenta subir a Meta", async () => {
      const archivoGrande = new File([new Uint8Array(17 * 1024 * 1024)], "grande.jpg", { type: "image/jpeg" });
      const res = await mediaPOST(req(formularioValido(PHONE_CONECTADO_A, { archivo: archivoGrande }), adminA.token));
      assert.equal(res.status, 400);
    });

    it("phone_number_id de OTRO tenant -> 404, nunca cruza tenants", async () => {
      const res = await mediaPOST(req(formularioValido(PHONE_CONECTADO_A), adminB.token));
      assert.equal(res.status, 404);
    });

    it("número conectado real -> pasa toda la validación, se detiene por falta de token de Meta (nunca llama a Meta de verdad)", async () => {
      const res = await mediaPOST(req(formularioValido(PHONE_CONECTADO_A), adminA.token));
      assert.equal(res.status, 500);
      const data = await res.json();
      assert.equal(data.error, "Sin token de Meta para este número");
    });

    it("token de Meta corrupto -> 500 JSON limpio, nunca expone el token ni un stack", async () => {
      const res = await mediaPOST(req(formularioValido(PHONE_TOKEN_MALO), adminA.token));
      assert.equal(res.status, 500);
      const data = await res.json();
      const textoCompleto = JSON.stringify(data);
      assert.doesNotMatch(textoCompleto, /AAAAAAAAAAAAAAAA/);
      assert.doesNotMatch(textoCompleto, /at [A-Za-z]+.*\(.*:\d+:\d+\)/);
    });
  },
);
