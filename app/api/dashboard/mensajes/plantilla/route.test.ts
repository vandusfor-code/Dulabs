/**
 * FASE 11 (Completion & Debt Zero, autorizado) — POST /api/dashboard/mensajes/plantilla
 * (envío de plantillas aprobadas desde el composer del Inbox). Integración
 * real contra Supabase; NUNCA se llega a enviarPlantilla() de verdad (todos
 * los casos se resuelven o fallan deliberadamente antes de esa línea).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { POST as plantillaPOST } from "./route";
import { MENSAJE_PLANTILLA_DESCONECTADA } from "@/lib/plantilla-conexion";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const URL = "http://localhost/api/dashboard/mensajes/plantilla";

function req(body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest(URL, { method: "POST", headers, body: JSON.stringify(body) });
}

describe(
  "POST /api/dashboard/mensajes/plantilla — integración real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const sufijo = randomUUID().slice(0, 8);
    const PHONE_A = `f11-mensajes-plantilla-${sufijo}`;
    const PHONE_HUERFANO = `f11-mensajes-plantilla-huerfano-${sufijo}`; // nunca insertado en dulabs_clientes_config

    type UsuarioPrueba = { id: string; token: string };
    let adminA: UsuarioPrueba;
    let lecturaA: UsuarioPrueba;
    let adminB: UsuarioPrueba;
    let plantillaAprobadaId: number;
    let plantillaPendienteId: number;
    let plantillaHuerfanaId: number;

    async function crearUsuario(nombre: string, tenantId: string, rol: "admin" | "agente" | "lectura"): Promise<UsuarioPrueba> {
      const email = `f11-mensajes-plantilla-${nombre}-${sufijo}@example.com`;
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

      const { error: configError } = await admin.from("dulabs_clientes_config").insert({
        id_tenant: TENANT_A,
        phone_number_id: PHONE_A,
        whatsapp_business_account_id: `waba-${sufijo}`,
        nombre_negocio: "Tenant A de prueba (mensajes/plantilla)",
        telefono_negocio: "570000000007",
        meta_permanent_token: null,
      });
      if (configError) throw configError;

      const { data: p1, error: p1Error } = await admin
        .from("dulabs_plantillas")
        .insert({
          id_tenant: TENANT_A,
          phone_number_id: PHONE_A,
          whatsapp_business_account_id: `waba-${sufijo}`,
          nombre: `f11_plantilla_aprobada_${sufijo}`,
          categoria: "UTILITY",
          idioma: "es_CO",
          cuerpo: "Hola {{1}}, tu pedido {{2}} está listo.",
          estado: "APPROVED",
        })
        .select("id")
        .single();
      if (p1Error) throw p1Error;
      plantillaAprobadaId = p1.id;

      const { data: p2, error: p2Error } = await admin
        .from("dulabs_plantillas")
        .insert({
          id_tenant: TENANT_A,
          phone_number_id: PHONE_A,
          whatsapp_business_account_id: `waba-${sufijo}`,
          nombre: `f11_plantilla_pendiente_${sufijo}`,
          categoria: "UTILITY",
          idioma: "es_CO",
          cuerpo: "Sin variables.",
          estado: "PENDING",
        })
        .select("id")
        .single();
      if (p2Error) throw p2Error;
      plantillaPendienteId = p2.id;

      const { data: p3, error: p3Error } = await admin
        .from("dulabs_plantillas")
        .insert({
          id_tenant: TENANT_A,
          phone_number_id: PHONE_HUERFANO,
          whatsapp_business_account_id: `waba-huerfano-${sufijo}`,
          nombre: `f11_plantilla_huerfana_${sufijo}`,
          categoria: "UTILITY",
          idioma: "es_CO",
          cuerpo: "Sin variables.",
          estado: "APPROVED",
        })
        .select("id")
        .single();
      if (p3Error) throw p3Error;
      plantillaHuerfanaId = p3.id;
    });

    after(async () => {
      await admin.from("dulabs_plantillas").delete().in("id", [plantillaAprobadaId, plantillaPendienteId, plantillaHuerfanaId]);
      await admin.from("dulabs_mensajes_log").delete().eq("phone_number_id", PHONE_A);
      await admin.from("dulabs_conversacion_asignaciones").delete().eq("phone_number_id", PHONE_A);
      await admin.from("dulabs_conversacion_eventos").delete().eq("phone_number_id", PHONE_A);
      await admin.from("dulabs_clientes_config").delete().eq("id_tenant", TENANT_A);
      await admin.from("dulabs_miembros_equipo").delete().in("tenant_id", [TENANT_A, TENANT_B]);
      for (const u of [adminA, lecturaA, adminB]) {
        if (u) await admin.auth.admin.deleteUser(u.id);
      }
    });

    it("sin token de sesión -> 401", async () => {
      const res = await plantillaPOST(req({ phone_number_id: PHONE_A, telefono_cliente: "573000000001", plantilla_id: plantillaAprobadaId, variables: ["a", "b"] }));
      assert.equal(res.status, 401);
    });

    it("rol 'lectura' -> 403", async () => {
      const res = await plantillaPOST(req({ phone_number_id: PHONE_A, telefono_cliente: "573000000001", plantilla_id: plantillaAprobadaId, variables: ["a", "b"] }, lecturaA.token));
      assert.equal(res.status, 403);
    });

    it("faltan campos requeridos -> 400", async () => {
      const res = await plantillaPOST(req({ phone_number_id: PHONE_A }, adminA.token));
      assert.equal(res.status, 400);
    });

    it("plantilla_id inexistente -> 404", async () => {
      const res = await plantillaPOST(req({ phone_number_id: PHONE_A, telefono_cliente: "573000000001", plantilla_id: 999999999, variables: [] }, adminA.token));
      assert.equal(res.status, 404);
    });

    it("plantilla de OTRO tenant -> 404, nunca cruza tenants", async () => {
      const res = await plantillaPOST(req({ phone_number_id: PHONE_A, telefono_cliente: "573000000001", plantilla_id: plantillaAprobadaId, variables: ["a", "b"] }, adminB.token));
      assert.equal(res.status, 404);
    });

    it("plantilla no aprobada (PENDING) -> 400, nunca intenta enviar", async () => {
      const res = await plantillaPOST(req({ phone_number_id: PHONE_A, telefono_cliente: "573000000001", plantilla_id: plantillaPendienteId, variables: [] }, adminA.token));
      assert.equal(res.status, 400);
    });

    it("número de variables incorrecto -> 400, nunca envía a medias", async () => {
      const res = await plantillaPOST(req({ phone_number_id: PHONE_A, telefono_cliente: "573000000001", plantilla_id: plantillaAprobadaId, variables: ["solo-una"] }, adminA.token));
      assert.equal(res.status, 400);
    });

    it("una variable vacía -> 400", async () => {
      const res = await plantillaPOST(req({ phone_number_id: PHONE_A, telefono_cliente: "573000000001", plantilla_id: plantillaAprobadaId, variables: ["ok", "  "] }, adminA.token));
      assert.equal(res.status, 400);
    });

    it("plantilla con phone_number_id huérfano -> 409, mensaje claro", async () => {
      const res = await plantillaPOST(req({ phone_number_id: PHONE_HUERFANO, telefono_cliente: "573000000001", plantilla_id: plantillaHuerfanaId, variables: [] }, adminA.token));
      assert.equal(res.status, 409);
      const data = await res.json();
      assert.equal(data.error, MENSAJE_PLANTILLA_DESCONECTADA);
    });

    it("plantilla conectada real y variables correctas -> pasa toda la validación, se detiene por falta de token de Meta (nunca llama a Meta de verdad)", async () => {
      const res = await plantillaPOST(req({ phone_number_id: PHONE_A, telefono_cliente: "573000000001", plantilla_id: plantillaAprobadaId, variables: ["Ana", "PED-42"] }, adminA.token));
      assert.notEqual(res.status, 409);
      assert.notEqual(res.status, 400);
      assert.equal(res.status, 500);
      const data = await res.json();
      assert.equal(data.error, "Sin token de Meta para este número");
    });
  },
);
