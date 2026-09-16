/**
 * DuLabs Developer V1 -- Fase 7 (Billing + Usage + Limits, autorizado).
 * E2E real contra Postgres a nivel GATEWAY: enforcement de cuota mensual en
 * POST /api/v1/messages (429 + no crea job + no publica), límite de números
 * en la Management API (403), GET /api/v1/usage extendido (plan/período/
 * mensajes/números, sin dinero) y aislamiento multi-tenant.
 *
 * Para ejercer el borde exacto de cuota sin enviar 20.000 mensajes, se crea
 * un PLAN de prueba con límites pequeños y se mapea el workspace a él vía
 * dulabs_dev_workspace_plans (mismo mecanismo real de asignación de plan).
 *
 * REQUIERE la migración 20261013000000 aplicada.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { manejarMensajeSaliente } from "./outbound-handler";
import { manejarObtenerUso } from "./usage-handler";
import { manejarRegistrarNumero } from "./management-handler";
import { crearApiKey } from "@/lib/developer/api-keys-store";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — Gateway billing/usage/limits real contra Postgres (Fase 7)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];
    const planesDePrueba: string[] = [];

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_usage_ledger").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_jobs").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_idempotency_keys").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_api_keys").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_whatsapp_numbers").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_workspace_plans").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
      for (const codigo of planesDePrueba) {
        await admin.from("dulabs_dev_plans").delete().eq("codigo", codigo).then(() => {}, () => {});
      }
    });

    /** Crea un workspace mapeado a un plan de prueba con límites pequeños. */
    async function prepararWorkspaceConPlan(params: { limiteMensajes: number | null; limiteNumeros: number | null }) {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const planCodigo = `TEST_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
      planesDePrueba.push(planCodigo);
      const { error: ePlan } = await admin.from("dulabs_dev_plans").insert({
        codigo: planCodigo,
        nombre: "Plan de prueba Fase 7",
        mensajes_mensuales_incluidos: params.limiteMensajes,
        numeros_incluidos: params.limiteNumeros,
        mensajes_por_segundo_por_numero: 2,
      });
      if (ePlan) throw new Error(`no se pudo crear plan de prueba: ${ePlan.message}`);
      const { error: eMap } = await admin.from("dulabs_dev_workspace_plans").insert({ workspace_id: workspaceId, plan_codigo: planCodigo });
      if (eMap) throw new Error(`no se pudo mapear workspace->plan: ${eMap.message}`);
      const apiKey = await crearApiKey(admin, { workspaceId, name: "test" });
      return { workspaceId, planCodigo, claveEnClaro: apiKey.claveEnClaro };
    }

    const cuerpo = (whatsappNumberId: string, body = "hola") => ({ whatsappNumberId, to: "573000000000", type: "text" as const, text: { body } });

    it("Tests 18/19/20 -- cuota agotada: 429 monthly_message_limit_exceeded, sin crear Job, sin publicar a Pub/Sub, sin idempotency-key huérfano", async () => {
      const { workspaceId, claveEnClaro } = await prepararWorkspaceConPlan({ limiteMensajes: 1, limiteNumeros: 5 });
      const numero = await registrarNumero(admin, { workspaceId, phoneNumberId: `phn-${randomUUID()}` });
      if (!numero.ok) throw new Error("num");
      const whatsappNumberId = numero.fila.id;

      let publicarCount = 0;
      const deps = { supabase: admin, topicOutbound: "dulabs-outbound", publicar: async () => { publicarCount++; return "x"; } };

      // Mensaje 1: entra (consume el único cupo).
      const r1 = await manejarMensajeSaliente(deps, { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey: `idem-1-${randomUUID()}`, cuerpo: cuerpo(whatsappNumberId), requestId: `req-${randomUUID()}` });
      assert.equal(r1.status, 201);

      // Mensaje 2: excede la cuota mensual -> 429 con el código estable.
      const keyExcedida = `idem-2-${randomUUID()}`;
      const r2 = await manejarMensajeSaliente(deps, { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey: keyExcedida, cuerpo: cuerpo(whatsappNumberId, "segundo"), requestId: `req-${randomUUID()}` });
      assert.equal(r2.status, 429);
      assert.equal((r2.cuerpo.error as { code: string }).code, "monthly_message_limit_exceeded");
      assert.equal(r2.cuerpo.jobId, undefined, "una request rechazada por cuota nunca trae jobId");

      // 19 -- no se creó un segundo job.
      const { count: jobs } = await admin.from("dulabs_dev_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
      assert.equal(jobs, 1, "cuota agotada NO debe crear un segundo job");
      // 20 -- solo se publicó el mensaje 1.
      assert.equal(publicarCount, 1, "cuota agotada NO debe publicar a Pub/Sub");
      // Prioridad #2 -- sin idempotency-key huérfano para la request rechazada.
      const { count: idem } = await admin.from("dulabs_dev_idempotency_keys").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("idempotency_key", keyExcedida);
      assert.equal(idem, 0, "cuota agotada NUNCA debe dejar un idempotency-key huérfano");

      // Reintento de la clave rechazada -> sigue 429 (nunca 'duplicado' de un job fantasma).
      const r2bis = await manejarMensajeSaliente(deps, { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey: keyExcedida, cuerpo: cuerpo(whatsappNumberId, "segundo"), requestId: `req-${randomUUID()}` });
      assert.equal(r2bis.status, 429);
    });

    it("Test G (GET usage extendido) -- expone plan, período, mensajes y números; nunca dinero/precio", async () => {
      const { workspaceId, planCodigo, claveEnClaro } = await prepararWorkspaceConPlan({ limiteMensajes: 10, limiteNumeros: 3 });
      const numero = await registrarNumero(admin, { workspaceId, phoneNumberId: `phn-${randomUUID()}` });
      if (!numero.ok) throw new Error("num");
      const deps = { supabase: admin, topicOutbound: "dulabs-outbound", publicar: async () => "x" };
      await manejarMensajeSaliente(deps, { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey: `idem-${randomUUID()}`, cuerpo: cuerpo(numero.fila.id), requestId: `req-${randomUUID()}` });

      const uso = await manejarObtenerUso({ supabase: admin }, { autorizacion: `Bearer ${claveEnClaro}`, requestId: `req-${randomUUID()}` });
      assert.equal(uso.status, 200);
      const c = uso.cuerpo as Record<string, unknown>;
      assert.equal(c.plan, planCodigo);
      assert.match(String(c.period), /^\d{4}-\d{2}$/, "period debe ser YYYY-MM");
      const messages = c.messages as { included: number; reserved: number; confirmed: number; available: number };
      assert.equal(messages.included, 10);
      assert.equal(messages.reserved, 1);
      assert.equal(messages.available, 9, "available = included - (reserved+confirmed)");
      const numbers = c.numbers as { included: number; used: number; available: number };
      assert.equal(numbers.included, 3);
      assert.equal(numbers.used, 1);
      assert.equal(numbers.available, 2);
      // Compatibilidad hacia atrás.
      assert.equal(c.reserved, 1);
      // Nunca dinero.
      assert.equal((c as { price?: unknown }).price, undefined);
      assert.equal(JSON.stringify(c).includes("precio"), false, "GET usage nunca debe exponer precios");
    });

    it("Test 17 -- GET usage multi-tenant: B nunca ve el uso de A", async () => {
      const a = await prepararWorkspaceConPlan({ limiteMensajes: 10, limiteNumeros: 3 });
      const b = await prepararWorkspaceConPlan({ limiteMensajes: 10, limiteNumeros: 3 });
      const numeroA = await registrarNumero(admin, { workspaceId: a.workspaceId, phoneNumberId: `phn-${randomUUID()}` });
      if (!numeroA.ok) throw new Error("num");
      const deps = { supabase: admin, topicOutbound: "dulabs-outbound", publicar: async () => "x" };
      await manejarMensajeSaliente(deps, { autorizacion: `Bearer ${a.claveEnClaro}`, idempotencyKey: `idem-${randomUUID()}`, cuerpo: cuerpo(numeroA.fila.id), requestId: `req-${randomUUID()}` });

      const usoB = await manejarObtenerUso({ supabase: admin }, { autorizacion: `Bearer ${b.claveEnClaro}`, requestId: `req-${randomUUID()}` });
      assert.equal(usoB.status, 200);
      assert.equal((usoB.cuerpo.messages as { reserved: number }).reserved, 0, "B nunca debe ver la reserva de A");
    });

    it("Test 16 -- API key de A sobre un número de B -> 400 invalid_whatsapp_number, sin reservar en ninguno", async () => {
      const a = await prepararWorkspaceConPlan({ limiteMensajes: 10, limiteNumeros: 3 });
      const b = await prepararWorkspaceConPlan({ limiteMensajes: 10, limiteNumeros: 3 });
      const numeroB = await registrarNumero(admin, { workspaceId: b.workspaceId, phoneNumberId: `phn-${randomUUID()}` });
      if (!numeroB.ok) throw new Error("num");
      const deps = { supabase: admin, topicOutbound: "dulabs-outbound", publicar: async () => "x" };

      const r = await manejarMensajeSaliente(deps, { autorizacion: `Bearer ${a.claveEnClaro}`, idempotencyKey: `idem-${randomUUID()}`, cuerpo: cuerpo(numeroB.fila.id), requestId: `req-${randomUUID()}` });
      assert.equal(r.status, 400);
      assert.equal((r.cuerpo.error as { code: string }).code, "invalid_whatsapp_number");

      const { count } = await admin.from("dulabs_dev_usage_ledger").select("id", { count: "exact", head: true }).eq("workspace_id", b.workspaceId);
      assert.equal(count, 0, "nunca debe reservarse contra el workspace del número ajeno");
    });

    it("Test 12 (gateway) -- Management API rechaza el número que excede el cupo del plan con 403 number_limit_exceeded", async () => {
      const { workspaceId } = await prepararWorkspaceConPlan({ limiteMensajes: 100, limiteNumeros: 1 });
      const primero = await manejarRegistrarNumero({ supabase: admin }, workspaceId, { phoneNumberId: `phn-${randomUUID()}` });
      assert.equal(primero.status, 201);
      const segundo = await manejarRegistrarNumero({ supabase: admin }, workspaceId, { phoneNumberId: `phn-${randomUUID()}` });
      assert.equal(segundo.status, 403);
      assert.equal(segundo.cuerpo.error, "number_limit_exceeded");
    });
  }
);
