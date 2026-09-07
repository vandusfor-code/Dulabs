/**
 * POST /api/campanas/enviar — integración real contra Supabase (usuarios de
 * Auth efímeros, tenants/plantillas descartables, ver
 * app/api/flows/flows-api.test.ts para el mismo criterio). NUNCA se llega al
 * envío real por WhatsApp/Meta: todos los casos probados aquí se resuelven
 * (o deliberadamente fallan) ANTES de llegar a enviarPlantilla() -- ver cada
 * caso para el porqué exacto.
 *
 * Cubre el ajuste autorizado (caso real Soluciones Financieras/Charlotte):
 * una plantilla cuyo phone_number_id ya no tiene configuración real para el
 * tenant (número reconectado, ver lib/plantilla-conexion.ts) debe rechazarse
 * con un mensaje claro y un status 409 -- nunca "Número no encontrado", y
 * nunca debe poder enviarse. También cubre que cualquier excepción
 * inesperada (ej. un token de Meta corrupto) responde JSON limpio, nunca la
 * página HTML de error de Vercel.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { POST as enviarPOST } from "./route";
import { MENSAJE_PLANTILLA_DESCONECTADA } from "@/lib/plantilla-conexion";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const URL = "http://localhost/api/campanas/enviar";

function req(body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest(URL, { method: "POST", headers, body: JSON.stringify(body) });
}

async function leerJson(res: Response): Promise<{ error?: string; [k: string]: unknown }> {
  // Mismo criterio que el frontend arreglado -- nunca asumir que el body es
  // JSON válido sin comprobarlo primero (si esto lanza, el propio test falla
  // con un mensaje claro de "la respuesta no fue JSON", que es justo el bug
  // que estamos verificando que ya no ocurre).
  return res.json();
}

describe(
  "POST /api/campanas/enviar — integración real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const sufijo = randomUUID().slice(0, 8);
    const PHONE_CONECTADO = `campanas-test-conectado-${sufijo}`;
    const PHONE_HUERFANO = `campanas-test-huerfano-${sufijo}`; // nunca se inserta en dulabs_clientes_config
    const PHONE_TOKEN_MALO = `campanas-test-token-malo-${sufijo}`;

    type UsuarioPrueba = { id: string; token: string };
    let adminA: UsuarioPrueba;
    let lecturaA: UsuarioPrueba;
    let adminB: UsuarioPrueba;
    let plantillaConectadaId: number;
    let plantillaHuerfanaId: number;
    let plantillaNoAprobadaId: number;
    let plantillaTokenMaloId: number;
    let plantillaTenantBId: number;
    let metaAccessTokenOriginal: string | undefined;

    async function crearUsuario(nombre: string, tenantId: string, rol: "admin" | "agente" | "lectura"): Promise<UsuarioPrueba> {
      const email = `campanas-enviar-test-${nombre}-${sufijo}@example.com`;
      const password = `CampanasTest-${randomUUID()}`;
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
      // Nunca debe llegarse realmente a llamar a Meta en estos tests -- se
      // fuerza a que la única plantilla "conectada" sin token propio caiga
      // en el paso "Sin token de Meta para este número" (500 controlado) en
      // vez de intentar un envío real.
      metaAccessTokenOriginal = process.env.META_ACCESS_TOKEN;
      delete process.env.META_ACCESS_TOKEN;

      adminA = await crearUsuario("admin-a", TENANT_A, "admin");
      lecturaA = await crearUsuario("lectura-a", TENANT_A, "lectura");
      adminB = await crearUsuario("admin-b", TENANT_B, "admin");

      // Plan "enterprise" (límites null = ilimitado) para que los tests se
      // enfoquen exclusivamente en la validación de conexión de la
      // plantilla -- sin esto, un tenant sin suscripción activa cae en
      // SIN_PLAN (límites en 0) y todo se rechaza antes de llegar ahí.
      const { error: suscripcionError } = await admin
        .from("dulabs_suscripciones")
        .insert([
          { id_tenant: TENANT_A, plan: "enterprise", estado: "activa", precio_cop: 0, fecha_proximo_cobro: "2099-01-01" },
          { id_tenant: TENANT_B, plan: "enterprise", estado: "activa", precio_cop: 0, fecha_proximo_cobro: "2099-01-01" },
        ]);
      if (suscripcionError) throw suscripcionError;

      const { error: configError } = await admin.from("dulabs_clientes_config").insert([
        {
          id_tenant: TENANT_A,
          phone_number_id: PHONE_CONECTADO,
          whatsapp_business_account_id: `waba-conectado-${sufijo}`,
          nombre_negocio: "Tenant A de prueba (campanas/enviar)",
          telefono_negocio: "570000000001",
          meta_permanent_token: null,
        },
        {
          id_tenant: TENANT_A,
          phone_number_id: PHONE_TOKEN_MALO,
          whatsapp_business_account_id: `waba-token-malo-${sufijo}`,
          nombre_negocio: "Tenant A de prueba (token corrupto)",
          telefono_negocio: "570000000002",
          // "v1:" con datos que nunca podrán autenticar en AES-GCM -- fuerza
          // que descifrarSecreto() lance, exactamente el caso real reportado
          // ("Unexpected token '<'") que ahora debe quedar como JSON 500.
          meta_permanent_token: "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA",
        },
      ]);
      if (configError) throw configError;

      const { data: plantillas, error: plantillasError } = await admin
        .from("dulabs_plantillas")
        .insert([
          {
            id_tenant: TENANT_A,
            phone_number_id: PHONE_CONECTADO,
            whatsapp_business_account_id: `waba-conectado-${sufijo}`,
            nombre: `conectada_${sufijo}`,
            categoria: "MARKETING",
            idioma: "es_CO",
            cuerpo: "Mensaje de prueba sin variables.",
            estado: "APPROVED",
            borrador: false,
          },
          {
            id_tenant: TENANT_A,
            phone_number_id: PHONE_HUERFANO,
            whatsapp_business_account_id: `waba-huerfano-${sufijo}`,
            nombre: `huerfana_${sufijo}`,
            categoria: "MARKETING",
            idioma: "es_CO",
            cuerpo: "Plantilla cuyo número ya no está conectado.",
            estado: "APPROVED",
            borrador: false,
          },
          {
            id_tenant: TENANT_A,
            phone_number_id: PHONE_CONECTADO,
            whatsapp_business_account_id: `waba-conectado-${sufijo}`,
            nombre: `pendiente_${sufijo}`,
            categoria: "MARKETING",
            idioma: "es_CO",
            cuerpo: "Plantilla todavía no aprobada por Meta.",
            estado: "pendiente",
            borrador: false,
          },
          {
            id_tenant: TENANT_A,
            phone_number_id: PHONE_TOKEN_MALO,
            whatsapp_business_account_id: `waba-token-malo-${sufijo}`,
            nombre: `token_malo_${sufijo}`,
            categoria: "MARKETING",
            idioma: "es_CO",
            cuerpo: "Plantilla cuyo número tiene un token corrupto.",
            estado: "APPROVED",
            borrador: false,
          },
          {
            id_tenant: TENANT_B,
            phone_number_id: `campanas-test-tenant-b-${sufijo}`,
            whatsapp_business_account_id: `waba-tenant-b-${sufijo}`,
            nombre: `tenant_b_${sufijo}`,
            categoria: "MARKETING",
            idioma: "es_CO",
            cuerpo: "Plantilla del tenant B.",
            estado: "APPROVED",
            borrador: false,
          },
        ])
        .select("id, nombre");
      if (plantillasError) throw plantillasError;

      plantillaConectadaId = plantillas!.find((p) => p.nombre === `conectada_${sufijo}`)!.id;
      plantillaHuerfanaId = plantillas!.find((p) => p.nombre === `huerfana_${sufijo}`)!.id;
      plantillaNoAprobadaId = plantillas!.find((p) => p.nombre === `pendiente_${sufijo}`)!.id;
      plantillaTokenMaloId = plantillas!.find((p) => p.nombre === `token_malo_${sufijo}`)!.id;
      plantillaTenantBId = plantillas!.find((p) => p.nombre === `tenant_b_${sufijo}`)!.id;
    });

    after(async () => {
      if (metaAccessTokenOriginal !== undefined) process.env.META_ACCESS_TOKEN = metaAccessTokenOriginal;
      await admin.from("dulabs_plantillas").delete().in("id_tenant", [TENANT_A, TENANT_B]);
      await admin.from("dulabs_clientes_config").delete().eq("id_tenant", TENANT_A);
      await admin.from("dulabs_suscripciones").delete().in("id_tenant", [TENANT_A, TENANT_B]);
      await admin.from("dulabs_miembros_equipo").delete().in("tenant_id", [TENANT_A, TENANT_B]);
      for (const u of [adminA, lecturaA, adminB]) {
        if (u) await admin.auth.admin.deleteUser(u.id);
      }
    });

    it("sin token de sesión -> 401 JSON", async () => {
      const res = await enviarPOST(req({}));
      assert.equal(res.status, 401);
      const data = await leerJson(res);
      assert.equal(typeof data.error, "string");
    });

    it("rol 'lectura' (no admin) -> 403 JSON", async () => {
      const res = await enviarPOST(req({ plantilla_id: plantillaConectadaId, destinatarios: ["573000000000"] }, lecturaA.token));
      assert.equal(res.status, 403);
    });

    it("faltan campos requeridos -> 400 JSON", async () => {
      const res = await enviarPOST(req({ plantilla_id: plantillaConectadaId }, adminA.token));
      assert.equal(res.status, 400);
    });

    it("Caso obligatorio 5/9: plantilla con phone_number_id huérfano (sin config real) -> 409, mensaje claro, NUNCA 'Número no encontrado'", async () => {
      const res = await enviarPOST(req({ plantilla_id: plantillaHuerfanaId, destinatarios: ["573000000000"] }, adminA.token));
      assert.equal(res.status, 409);
      const data = await leerJson(res);
      assert.equal(data.error, MENSAJE_PLANTILLA_DESCONECTADA);
      assert.notEqual(data.error, "Número no encontrado");
    });

    it("plantilla todavía no aprobada -> 400, nunca intenta enviar", async () => {
      const res = await enviarPOST(req({ plantilla_id: plantillaNoAprobadaId, destinatarios: ["573000000000"] }, adminA.token));
      assert.equal(res.status, 400);
    });

    it("Caso obligatorio 4: Tenant A no puede usar una plantilla del Tenant B -> 404 'Plantilla no encontrada'", async () => {
      const res = await enviarPOST(req({ plantilla_id: plantillaTenantBId, destinatarios: ["573000000000"] }, adminA.token));
      assert.equal(res.status, 404);
    });

    it("plantilla_id inexistente -> 404, nunca crashea", async () => {
      const res = await enviarPOST(req({ plantilla_id: 999999999, destinatarios: ["573000000000"] }, adminA.token));
      assert.equal(res.status, 404);
    });

    it("Caso obligatorio 6: plantilla conectada real -> pasa la validación de conexión (nunca 409), se detiene de forma controlada por falta de token de Meta (nunca llama a Meta de verdad)", async () => {
      const res = await enviarPOST(req({ plantilla_id: plantillaConectadaId, destinatarios: ["573000000000"] }, adminA.token));
      assert.notEqual(res.status, 409, "una plantilla conectada nunca debe rechazarse como huérfana");
      assert.equal(res.status, 500);
      const data = await leerJson(res);
      assert.equal(data.error, "Sin token de Meta para este número", "debe llegar hasta este punto exacto -- prueba que pasó la validación de conexión sin necesidad de tocar Meta");
    });

    it("Caso obligatorio 7: token de Meta corrupto (descifrado falla) -> JSON 500 genérico, NUNCA HTML, nunca expone el token/])", async () => {
      const res = await enviarPOST(req({ plantilla_id: plantillaTokenMaloId, destinatarios: ["573000000000"] }, adminA.token));
      assert.equal(res.status, 500);
      assert.equal(res.headers.get("content-type")?.includes("application/json"), true);
      const data = await leerJson(res);
      assert.equal(data.error, "Error interno al procesar la campaña.");
      const textoCompleto = JSON.stringify(data);
      assert.doesNotMatch(textoCompleto, /AAAAAAAAAAAAAAAA/, "nunca debe exponer el valor del token corrupto");
      assert.doesNotMatch(textoCompleto, /at [A-Za-z]+.*\(.*:\d+:\d+\)/, "nunca debe exponer un stack trace");
    });
  },
);
