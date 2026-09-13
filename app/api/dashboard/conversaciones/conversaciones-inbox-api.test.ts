/**
 * FASE 9 (Human Inbox, autorizado) — tests de integración real de los 4
 * endpoints nuevos del Inbox: handoff, asignar, estado, leido. Mismo patrón
 * EXACTO que app/api/dashboard/negocio/desconectar/route.test.ts (Fase
 * 8.5): tenants/usuarios de Auth descartables contra Supabase real, nunca
 * AMORE/Daniela/Charlotte/Solo Talento.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { POST as handoffPOST } from "./handoff/route";
import { POST as asignarPOST } from "./asignar/route";
import { POST as estadoPOST } from "./estado/route";
import { POST as leidoPOST } from "./leido/route";

const HAS_SUPABASE = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

function req(url: string, body: unknown, token?: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

describe(
  "Inbox (Fase 9) — handoff/asignar/estado/leido — integración real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const sufijo = randomUUID().slice(0, 8);
    const tenants: string[] = [];
    const userIds: string[] = [];
    const phoneNumberIds: string[] = [];

    async function crearTenantConAgente(params: { rol?: "admin" | "agente" | "lectura" }): Promise<{
      tenantId: string;
      token: string;
      miembroId: number;
      phoneNumberId: string;
    }> {
      const tenantId = randomUUID();
      tenants.push(tenantId);
      const phoneNumberId = `f9-api-${sufijo}-${randomUUID().slice(0, 8)}`;
      phoneNumberIds.push(phoneNumberId);
      const email = `f9-inbox-${sufijo}-${tenantId.slice(0, 8)}@example.com`;
      const password = `F9Test-${randomUUID()}`;
      const { data: userData, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (userErr) throw userErr;
      userIds.push(userData.user.id);

      const { data: miembroFila, error: miembroErr } = await admin
        .from("dulabs_miembros_equipo")
        .insert({ tenant_id: tenantId, user_id: userData.user.id, email, rol: params.rol ?? "admin", estado: "activo" })
        .select("id")
        .single();
      if (miembroErr) throw miembroErr;

      const { error: cfgErr } = await admin.from("dulabs_clientes_config").insert({
        id_tenant: tenantId,
        phone_number_id: phoneNumberId,
        whatsapp_business_account_id: `waba-${phoneNumberId}`,
        telefono_negocio: `57300${Math.floor(Math.random() * 10_000_000)}`,
        nombre_negocio: "F9 Inbox API test (descartable)",
      });
      if (cfgErr) throw cfgErr;

      const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      const { data: sesion, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
      if (signInErr || !sesion.session) throw signInErr ?? new Error("sin sesión");

      return { tenantId, token: sesion.session.access_token, miembroId: miembroFila.id, phoneNumberId };
    }

    after(async () => {
      if (!HAS_SUPABASE) return;
      for (const phoneNumberId of phoneNumberIds) {
        await admin.from("dulabs_pausas_chat").delete().eq("phone_number_id", phoneNumberId);
        await admin.from("dulabs_conversacion_asignaciones").delete().eq("phone_number_id", phoneNumberId);
        await admin.from("dulabs_conversacion_eventos").delete().eq("phone_number_id", phoneNumberId);
        await admin.from("dulabs_conversacion_estado").delete().eq("phone_number_id", phoneNumberId);
      }
      for (const tenantId of tenants) {
        await admin.from("dulabs_clientes_config").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
      }
      for (const id of userIds) await admin.auth.admin.deleteUser(id);
    });

    it("1. handoff 'tomar' sin sesión -> 401", async () => {
      const res = await handoffPOST(req("/api/dashboard/conversaciones/handoff", { phone_number_id: "x", telefono_cliente: "y", accion: "tomar" }));
      assert.equal(res.status, 401);
    });

    it("2. handoff 'tomar' -> activa la pausa Y autoasigna al agente", async () => {
      const { token, phoneNumberId, miembroId } = await crearTenantConAgente({});
      const telefonoCliente = "573000000010";
      const res = await handoffPOST(req("/api/dashboard/conversaciones/handoff", { phone_number_id: phoneNumberId, telefono_cliente: telefonoCliente, accion: "tomar" }, token));
      const json = await res.json();
      assert.equal(res.status, 200, JSON.stringify(json));
      assert.equal(json.modo, "human");

      const { data: pausa } = await admin.from("dulabs_pausas_chat").select("pausado_hasta").eq("phone_number_id", phoneNumberId).eq("telefono_cliente", telefonoCliente).maybeSingle();
      assert.ok(pausa && new Date(pausa.pausado_hasta).getTime() > Date.now() + 29 * 24 * 60 * 60 * 1000, "debe pausar por ~30 días, no las 24h del traspaso automático");

      const { data: asignacion } = await admin.from("dulabs_conversacion_asignaciones").select("miembro_id").eq("phone_number_id", phoneNumberId).eq("telefono_cliente", telefonoCliente).maybeSingle();
      assert.equal(asignacion?.miembro_id, miembroId);
    });

    it("3. handoff 'devolver_a_ia' -> libera la pausa por completo", async () => {
      const { token, phoneNumberId } = await crearTenantConAgente({});
      const telefonoCliente = "573000000011";
      await handoffPOST(req("/api/dashboard/conversaciones/handoff", { phone_number_id: phoneNumberId, telefono_cliente: telefonoCliente, accion: "tomar" }, token));
      const res = await handoffPOST(req("/api/dashboard/conversaciones/handoff", { phone_number_id: phoneNumberId, telefono_cliente: telefonoCliente, accion: "devolver_a_ia" }, token));
      const json = await res.json();
      assert.equal(res.status, 200, JSON.stringify(json));
      assert.equal(json.modo, "ai");

      const { data: pausa } = await admin.from("dulabs_pausas_chat").select("id").eq("phone_number_id", phoneNumberId).eq("telefono_cliente", telefonoCliente).maybeSingle();
      assert.equal(pausa, null, "sin fila = sin pausa = la IA vuelve a responder");
    });

    it("4. handoff sobre phone_number_id de OTRO tenant -> 404, cross-tenant rechazado", async () => {
      const ajeno = await crearTenantConAgente({});
      const { token } = await crearTenantConAgente({});
      const res = await handoffPOST(req("/api/dashboard/conversaciones/handoff", { phone_number_id: ajeno.phoneNumberId, telefono_cliente: "573000000012", accion: "tomar" }, token));
      assert.equal(res.status, 404);
      const { data: pausa } = await admin.from("dulabs_pausas_chat").select("id").eq("phone_number_id", ajeno.phoneNumberId).maybeSingle();
      assert.equal(pausa, null, "nunca debe pausar la conversación de otro tenant");
    });

    it("5. rol 'lectura' -> 403 en handoff", async () => {
      const { token, phoneNumberId } = await crearTenantConAgente({ rol: "lectura" });
      const res = await handoffPOST(req("/api/dashboard/conversaciones/handoff", { phone_number_id: phoneNumberId, telefono_cliente: "573000000013", accion: "tomar" }, token));
      assert.equal(res.status, 403);
    });

    it("6. asignar: un agente (no admin) puede asignarse a sí mismo", async () => {
      const { token, phoneNumberId, miembroId } = await crearTenantConAgente({ rol: "agente" });
      const telefonoCliente = "573000000014";
      const res = await asignarPOST(req("/api/dashboard/conversaciones/asignar", { phone_number_id: phoneNumberId, telefono_cliente: telefonoCliente, miembro_id: miembroId }, token));
      assert.equal(res.status, 200);
    });

    it("7. asignar: un agente (no admin) NO puede asignar a OTRO miembro -> 403, nunca escribe", async () => {
      const { token, phoneNumberId } = await crearTenantConAgente({ rol: "agente" });
      const telefonoCliente = "573000000015";
      const res = await asignarPOST(req("/api/dashboard/conversaciones/asignar", { phone_number_id: phoneNumberId, telefono_cliente: telefonoCliente, miembro_id: 999999 }, token));
      assert.equal(res.status, 403);
      const { data: asignacion } = await admin.from("dulabs_conversacion_asignaciones").select("id").eq("phone_number_id", phoneNumberId).eq("telefono_cliente", telefonoCliente).maybeSingle();
      assert.equal(asignacion, null);
    });

    it("8. asignar: miembro_id de OTRO tenant -> 404, nunca cruza tenants", async () => {
      const otro = await crearTenantConAgente({});
      const { token, phoneNumberId } = await crearTenantConAgente({});
      const res = await asignarPOST(req("/api/dashboard/conversaciones/asignar", { phone_number_id: phoneNumberId, telefono_cliente: "573000000016", miembro_id: otro.miembroId }, token));
      assert.equal(res.status, 404);
    });

    it("9. asignar miembro_id=null -> quita la asignación (idempotente si ya estaba sin asignar)", async () => {
      const { token, phoneNumberId } = await crearTenantConAgente({});
      const telefonoCliente = "573000000017";
      const res1 = await asignarPOST(req("/api/dashboard/conversaciones/asignar", { phone_number_id: phoneNumberId, telefono_cliente: telefonoCliente, miembro_id: null }, token));
      assert.equal(res1.status, 200);
      const res2 = await asignarPOST(req("/api/dashboard/conversaciones/asignar", { phone_number_id: phoneNumberId, telefono_cliente: telefonoCliente, miembro_id: null }, token));
      assert.equal(res2.status, 200);
    });

    it("10. estado: valor inválido -> 400", async () => {
      const { token, phoneNumberId } = await crearTenantConAgente({});
      const res = await estadoPOST(req("/api/dashboard/conversaciones/estado", { phone_number_id: phoneNumberId, telefono_cliente: "573000000018", estado: "archivada" }, token));
      assert.equal(res.status, 400);
    });

    it("11. estado: 'closed' válido -> 200 (o 503 si la migración todavía no está aplicada en este entorno, nunca 500)", async () => {
      const { token, phoneNumberId } = await crearTenantConAgente({});
      const res = await estadoPOST(req("/api/dashboard/conversaciones/estado", { phone_number_id: phoneNumberId, telefono_cliente: "573000000019", estado: "closed" }, token));
      assert.ok(res.status === 200 || res.status === 503, `status inesperado: ${res.status}`);
    });

    it("12. leido: rol 'lectura' SÍ puede marcar como leída (es una acción de vista, no de escritura de negocio)", async () => {
      const { token, phoneNumberId } = await crearTenantConAgente({ rol: "lectura" });
      const res = await leidoPOST(req("/api/dashboard/conversaciones/leido", { phone_number_id: phoneNumberId, telefono_cliente: "573000000020" }, token));
      assert.ok(res.status === 200 || res.status === 503, `status inesperado: ${res.status}`);
    });

    it("13. leido: phone_number_id inexistente -> 404", async () => {
      const { token } = await crearTenantConAgente({});
      const res = await leidoPOST(req("/api/dashboard/conversaciones/leido", { phone_number_id: `no-existe-${randomUUID()}`, telefono_cliente: "573000000021" }, token));
      assert.equal(res.status, 404);
    });
  },
);
