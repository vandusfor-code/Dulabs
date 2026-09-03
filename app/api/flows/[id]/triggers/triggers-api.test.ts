/**
 * Fase 3 (Triggers + Event Routing, autorizado) — tests de integración real
 * contra Supabase real (usuarios de Auth efímeros, tenants descartables).
 * Mismo criterio que app/api/flows/flows-api.test.ts: sin mocks del código
 * bajo prueba.
 *
 * REQUIERE que la migración 20260903090000_dulabs_flow_triggers.sql ya
 * esté aplicada en el proyecto de Supabase apuntado por SUPABASE_URL --
 * si la tabla no existe todavía, estos tests fallan con "relation
 * dulabs_flow_triggers does not exist" (no un SKIP silencioso).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { GET as triggersGET, POST as triggersPOST } from "./route";
import { PATCH as triggerPATCH, DELETE as triggerDELETE } from "./[triggerId]/route";
import { POST as flowsPOST } from "../../route";
import { POST as publishPOST } from "../publish/route";
import { listFlowVersions, resolveFlowForIncomingEvent } from "@/lib/flow/flow-store";
import type { IncomingEvent } from "@/lib/flow-triggers/types";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const BASE_URL = "http://localhost/api/flows";

function req(method: string, url: string, opts?: { token?: string; body?: unknown; noAuth?: boolean }): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts?.noAuth) headers.authorization = `Bearer ${opts?.token ?? ""}`;
  return new NextRequest(url, { method, headers, body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined });
}

function paramsFor(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function paramsForTrigger(id: string, triggerId: string): { params: Promise<{ id: string; triggerId: string }> } {
  return { params: Promise.resolve({ id, triggerId }) };
}

describe(
  "Fase 3 — API de Triggers (integración real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const sufijo = randomUUID().slice(0, 8);

    type UsuarioPrueba = { id: string; email: string; token: string };
    let adminA: UsuarioPrueba;
    let agenteA: UsuarioPrueba;
    let adminB: UsuarioPrueba;

    async function crearUsuario(nombre: string, tenantId: string, rol: "admin" | "agente"): Promise<UsuarioPrueba> {
      const email = `triggers-api-test-${nombre}-${sufijo}@example.com`;
      const password = `TriggersApiTest-${randomUUID()}`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      const { error: miembroError } = await admin
        .from("dulabs_miembros_equipo")
        .insert({ tenant_id: tenantId, user_id: data.user.id, email, rol, estado: "activo" });
      if (miembroError) throw miembroError;

      const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      const { data: sesion, error: signInError } = await anon.auth.signInWithPassword({ email, password });
      if (signInError || !sesion.session) throw signInError ?? new Error("sin sesión");
      return { id: data.user.id, email, token: sesion.session.access_token };
    }

    let flowAId: string;
    let flowASlug: string;

    before(async () => {
      if (!HAS_SUPABASE) return;
      adminA = await crearUsuario("admin-a", TENANT_A, "admin");
      agenteA = await crearUsuario("agente-a", TENANT_A, "agente");
      adminB = await crearUsuario("admin-b", TENANT_B, "admin");

      flowASlug = `triggers-test-flow-${sufijo}`;
      const flowRes = await flowsPOST(req("POST", BASE_URL, { token: adminA.token, body: { slug: flowASlug, name: "Flow con triggers" } }));
      const flowJson = await flowRes.json();
      flowAId = flowJson.flow.id;
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      for (const tenantId of [TENANT_A, TENANT_B]) {
        const { data: flows } = await admin.from("dulabs_flows").select("id").eq("tenant_id", tenantId);
        const flowIds = (flows ?? []).map((f) => f.id as string);
        if (flowIds.length > 0) {
          await admin.from("dulabs_flow_triggers").delete().eq("tenant_id", tenantId).in("flow_id", flowIds);
          await admin.from("dulabs_flow_versions").delete().eq("tenant_id", tenantId).in("flow_id", flowIds);
        }
        await admin.from("dulabs_flows").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
      }
      for (const u of [adminA, agenteA, adminB]) {
        if (u) await admin.auth.admin.deleteUser(u.id);
      }
    });

    // -----------------------------------------------------------------
    // CRUD
    // -----------------------------------------------------------------
    let triggerId: string;

    describe("CRUD de triggers", () => {
      it("POST (admin) -> 201, crea un trigger keyword", async () => {
        const res = await triggersPOST(
          req("POST", `${BASE_URL}/${flowAId}/triggers`, {
            token: adminA.token,
            body: { type: "keyword", config: { keywords: ["hola", "buenas"] }, priority: 10 },
          }),
          paramsFor(flowAId),
        );
        assert.equal(res.status, 201);
        const json = await res.json();
        assert.equal(json.trigger.type, "keyword");
        assert.deepEqual(json.trigger.config, { keywords: ["hola", "buenas"] });
        assert.equal(json.trigger.priority, 10);
        assert.equal(json.trigger.enabled, true);
        triggerId = json.trigger.id;
      });

      it("POST con type inválido -> 400", async () => {
        const res = await triggersPOST(
          req("POST", `${BASE_URL}/${flowAId}/triggers`, { token: adminA.token, body: { type: "no_existe", config: {} } }),
          paramsFor(flowAId),
        );
        assert.equal(res.status, 400);
      });

      it("POST keyword sin 'keywords' -> 400 (config inválido para el tipo)", async () => {
        const res = await triggersPOST(
          req("POST", `${BASE_URL}/${flowAId}/triggers`, { token: adminA.token, body: { type: "keyword", config: {} } }),
          paramsFor(flowAId),
        );
        assert.equal(res.status, 400);
      });

      it("POST con agente -> 403 (escritura solo admin)", async () => {
        const res = await triggersPOST(
          req("POST", `${BASE_URL}/${flowAId}/triggers`, { token: agenteA.token, body: { type: "manual", config: {} } }),
          paramsFor(flowAId),
        );
        assert.equal(res.status, 403);
      });

      it("GET (admin+agente) -> incluye el trigger creado", async () => {
        const res = await triggersGET(req("GET", `${BASE_URL}/${flowAId}/triggers`, { token: agenteA.token }), paramsFor(flowAId));
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.ok(json.triggers.some((t: { id: string }) => t.id === triggerId));
      });

      it("GET desde tenant B -> 404 (no revela existencia)", async () => {
        const res = await triggersGET(req("GET", `${BASE_URL}/${flowAId}/triggers`, { token: adminB.token }), paramsFor(flowAId));
        assert.equal(res.status, 404);
      });

      it("PATCH (admin) -> 200, actualiza priority/enabled", async () => {
        const res = await triggerPATCH(
          req("PATCH", `${BASE_URL}/${flowAId}/triggers/${triggerId}`, { token: adminA.token, body: { priority: 50, enabled: false } }),
          paramsForTrigger(flowAId, triggerId),
        );
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.trigger.priority, 50);
        assert.equal(json.trigger.enabled, false);
      });

      it("PATCH config para otro trigger inexistente -> 404", async () => {
        const res = await triggerPATCH(
          req("PATCH", `${BASE_URL}/${flowAId}/triggers/${randomUUID()}`, { token: adminA.token, body: { priority: 1 } }),
          paramsForTrigger(flowAId, randomUUID()),
        );
        assert.equal(res.status, 404);
      });

      it("PATCH con agente -> 403", async () => {
        const res = await triggerPATCH(
          req("PATCH", `${BASE_URL}/${flowAId}/triggers/${triggerId}`, { token: agenteA.token, body: { priority: 1 } }),
          paramsForTrigger(flowAId, triggerId),
        );
        assert.equal(res.status, 403);
      });

      it("DELETE desde tenant B -> 404, no elimina", async () => {
        const res = await triggerDELETE(
          req("DELETE", `${BASE_URL}/${flowAId}/triggers/${triggerId}`, { token: adminB.token }),
          paramsForTrigger(flowAId, triggerId),
        );
        assert.equal(res.status, 404);
        const check = await triggersGET(req("GET", `${BASE_URL}/${flowAId}/triggers`, { token: adminA.token }), paramsFor(flowAId));
        const checkJson = await check.json();
        assert.ok(checkJson.triggers.some((t: { id: string }) => t.id === triggerId), "no debió eliminarse");
      });

      it("DELETE (admin) -> 200, ya no aparece en GET", async () => {
        const res = await triggerDELETE(
          req("DELETE", `${BASE_URL}/${flowAId}/triggers/${triggerId}`, { token: adminA.token }),
          paramsForTrigger(flowAId, triggerId),
        );
        assert.equal(res.status, 200);
        const check = await triggersGET(req("GET", `${BASE_URL}/${flowAId}/triggers`, { token: adminA.token }), paramsFor(flowAId));
        const checkJson = await check.json();
        assert.ok(!checkJson.triggers.some((t: { id: string }) => t.id === triggerId));
      });
    });

    // -----------------------------------------------------------------
    // Routing real end-to-end: Draft NO enruta, Published SÍ, cross-tenant
    // -----------------------------------------------------------------
    describe("resolveFlowForIncomingEvent — routing real contra Supabase", () => {
      let flowBId: string;
      const keywordUnico = `activar-${sufijo}`;

      function eventoPara(tenantId: string, texto: string): IncomingEvent {
        return {
          tenantId,
          channel: "whatsapp",
          channelAccountId: `pn-${sufijo}`,
          contactId: "+573000000000",
          eventType: "message",
          timestamp: new Date().toISOString(),
          message: { text: texto },
        };
      }

      before(async () => {
        if (!HAS_SUPABASE) return;
        const flowRes = await flowsPOST(
          req("POST", BASE_URL, { token: adminA.token, body: { slug: `triggers-routing-${sufijo}`, name: "Flow de routing" } }),
        );
        const flowJson = await flowRes.json();
        flowBId = flowJson.flow.id;

        await triggersPOST(
          req("POST", `${BASE_URL}/${flowBId}/triggers`, {
            token: adminA.token,
            body: { type: "keyword", config: { keywords: [keywordUnico] } },
          }),
          paramsFor(flowBId),
        );
      });

      it("Flow en Draft con trigger enabled -- el evento NO selecciona nada", async () => {
        const result = await resolveFlowForIncomingEvent(admin, eventoPara(TENANT_A, keywordUnico));
        assert.deepEqual(result, { matched: false, reason: "no_trigger_matched" });
      });

      it("tras publicar el Flow, el MISMO evento SÍ lo selecciona", async () => {
        // POST /api/flows ya crea automáticamente la v1 (Draft, un nodo
        // Start) -- se publica ESA misma versión, sin crear una segunda.
        const [version] = await listFlowVersions(admin, { tenantId: TENANT_A, flowId: flowBId });
        assert.ok(version, "flowsPOST debe haber creado la v1 automáticamente");
        const publishRes = await publishPOST(
          req("POST", `${BASE_URL}/${flowBId}/publish`, { token: adminA.token, body: { versionId: version.id } }),
          paramsFor(flowBId),
        );
        assert.equal(publishRes.status, 200);

        const result = await resolveFlowForIncomingEvent(admin, eventoPara(TENANT_A, keywordUnico));
        assert.equal(result.matched, true);
        if (result.matched) assert.equal(result.flowId, flowBId);
      });

      it("el mismo keyword, evento de OTRO tenant -- nunca selecciona el Flow de tenant A", async () => {
        const result = await resolveFlowForIncomingEvent(admin, eventoPara(TENANT_B, keywordUnico));
        assert.deepEqual(result, { matched: false, reason: "no_candidates" });
      });
    });
  },
);
