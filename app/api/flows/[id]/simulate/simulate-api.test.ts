/**
 * POST /api/flows/[id]/simulate — Fase 1 (Flow Simulator, autorizado).
 * Mismo patrón que app/api/flows/flows-api.test.ts: integración real contra
 * Supabase (usuarios de Auth efímeros, tenants descartables), gateado por
 * HAS_SUPABASE -- se salta automáticamente sin SUPABASE_URL/SERVICE_ROLE_KEY
 * (ej. en este worktree aislado, que no tiene ninguna credencial real).
 *
 * Cobertura de la spec (§28-29):
 * 15. Flow inválido -> 422, nunca ejecuta el motor.
 * 16. Aislamiento multi-tenant -- tenant A no puede simular el flow de tenant B.
 * 17. Simulación sobre draft -- por defecto usa la versión más reciente
 *     guardada (draft), sin necesidad de publicar.
 * + auth/roles (mismo patrón que el resto de /api/flows/*) y el contrato de
 *   respuesta (versionId/versionNumber/turn).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { POST as simulatePOST } from "./route";
import { POST as flowsPOST } from "../../route";
import { POST as versionsPOST } from "../versions/route";

import type { FlowDefinition } from "@/lib/flow/types";

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

function flowValido(): FlowDefinition {
  return {
    name: "Simulate API test flow",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg", type: "message", config: { text: "Hola {{nombre}}" } },
      { id: "end", type: "end", config: { message: "Adiós" } },
    ],
    edges: [
      { id: "e1", source: "start", target: "msg" },
      { id: "e2", source: "msg", target: "end" },
    ],
    variables: [{ key: "nombre", label: "Nombre", type: "string" }],
  };
}

function flowInvalido(): FlowDefinition {
  return {
    name: "Simulate API test flow inválido",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg", type: "message", config: { text: "Hola" } },
      // "msg" queda desconectado -- validateFlowForPublish debe rechazarlo.
    ],
    edges: [],
    variables: [],
  };
}

describe(
  "Fase 1 — POST /api/flows/[id]/simulate (integración real)",
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
    let lecturaA: UsuarioPrueba;
    let adminB: UsuarioPrueba;

    async function crearUsuario(nombre: string, tenantId: string, rol: "admin" | "agente" | "lectura"): Promise<UsuarioPrueba> {
      const email = `simulate-api-test-${nombre}-${sufijo}@example.com`;
      const password = `SimulateApiTest-${randomUUID()}`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      const { error: miembroError } = await admin.from("dulabs_miembros_equipo").insert({
        tenant_id: tenantId,
        user_id: data.user.id,
        email,
        rol,
        estado: "activo",
      });
      if (miembroError) throw miembroError;

      const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      const { data: sesion, error: signInError } = await anon.auth.signInWithPassword({ email, password });
      if (signInError || !sesion.session) throw signInError ?? new Error("sin sesión");
      return { id: data.user.id, email, token: sesion.session.access_token };
    }

    before(async () => {
      if (!HAS_SUPABASE) return;
      adminA = await crearUsuario("admin-a", TENANT_A, "admin");
      agenteA = await crearUsuario("agente-a", TENANT_A, "agente");
      lecturaA = await crearUsuario("lectura-a", TENANT_A, "lectura");
      adminB = await crearUsuario("admin-b", TENANT_B, "admin");
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      for (const tenantId of [TENANT_A, TENANT_B]) {
        const { data: flows } = await admin.from("dulabs_flows").select("id").eq("tenant_id", tenantId);
        const flowIds = (flows ?? []).map((f) => f.id as string);
        if (flowIds.length > 0) {
          await admin.from("dulabs_flow_versions").delete().eq("tenant_id", tenantId).in("flow_id", flowIds);
        }
        await admin.from("dulabs_flows").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
      }
      for (const u of [adminA, agenteA, lecturaA, adminB]) {
        if (u) await admin.auth.admin.deleteUser(u.id);
      }
    });

    let flowId: string;
    let draftVersionId: string;

    describe("Preparación -- crear Flow + versión draft válida", () => {
      it("crea el Flow (v1 automática) y guarda una v2 draft válida", async () => {
        const createRes = await flowsPOST(req("POST", BASE_URL, { token: adminA.token, body: { slug: `simulate-${sufijo}`, name: "Simulate test" } }));
        assert.equal(createRes.status, 201);
        flowId = (await createRes.json()).flow.id;

        const versionRes = await versionsPOST(
          req("POST", `${BASE_URL}/${flowId}/versions`, { token: adminA.token, body: { definition: flowValido() } }),
          paramsFor(flowId),
        );
        assert.equal(versionRes.status, 201);
        draftVersionId = (await versionRes.json()).version.id;
      });
    });

    describe("Auth y roles", () => {
      it("sin token -> 401", async () => {
        const res = await simulatePOST(req("POST", `${BASE_URL}/${flowId}/simulate`, { noAuth: true, body: { event: { type: "start" } } }), paramsFor(flowId));
        assert.equal(res.status, 401);
      });

      it("lectura -> 403 (solo admin/agente pueden simular)", async () => {
        const res = await simulatePOST(
          req("POST", `${BASE_URL}/${flowId}/simulate`, { token: lecturaA.token, body: { event: { type: "start" } } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 403);
      });

      it("agente -> 200 (simular no exige admin estricto, mismo rol que Validar)", async () => {
        const res = await simulatePOST(
          req("POST", `${BASE_URL}/${flowId}/simulate`, { token: agenteA.token, body: { event: { type: "start" } } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 200);
      });
    });

    describe("17. Simulación sobre draft (prioridad draft, spec §8)", () => {
      it("sin versionId -> usa la versión más reciente guardada (draft), corre START -> MESSAGE -> END", async () => {
        const res = await simulatePOST(
          req("POST", `${BASE_URL}/${flowId}/simulate`, { token: adminA.token, body: { event: { type: "start" }, initialVariables: { nombre: "Duvan" } } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.versionId, draftVersionId);
        assert.equal(json.turn.status, "completed");
        assert.ok(json.turn.messages.some((m: { content: { text?: string } }) => m.content.text === "Hola Duvan"), "debe interpolar la variable de prueba inicial");
        assert.ok(json.turn.messages.every((m: { simulated: boolean }) => m.simulated === true));
      });

      it("versionId explícito -> usa esa versión, no la más reciente", async () => {
        const res = await simulatePOST(
          req("POST", `${BASE_URL}/${flowId}/simulate`, { token: adminA.token, body: { event: { type: "start" }, versionId: draftVersionId } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.versionId, draftVersionId);
      });

      it("versionId de otro flow/tenant -> 404 (no revela existencia cross-tenant)", async () => {
        const res = await simulatePOST(
          req("POST", `${BASE_URL}/${flowId}/simulate`, { token: adminA.token, body: { event: { type: "start" }, versionId: randomUUID() } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 404);
      });
    });

    describe("15. Flow inválido -> 422, nunca ejecuta el motor", () => {
      let flowInvalidoId: string;

      before(async () => {
        if (!HAS_SUPABASE) return;
        const createRes = await flowsPOST(req("POST", BASE_URL, { token: adminA.token, body: { slug: `simulate-invalido-${sufijo}`, name: "Inválido" } }));
        flowInvalidoId = (await createRes.json()).flow.id;
        await versionsPOST(
          req("POST", `${BASE_URL}/${flowInvalidoId}/versions`, { token: adminA.token, body: { definition: flowInvalido() } }),
          paramsFor(flowInvalidoId),
        );
      });

      it("POST /simulate -> 422 con el mismo formato que POST /validate, nunca 200", async () => {
        const res = await simulatePOST(
          req("POST", `${BASE_URL}/${flowInvalidoId}/simulate`, { token: adminA.token, body: { event: { type: "start" } } }),
          paramsFor(flowInvalidoId),
        );
        assert.equal(res.status, 422);
        const json = await res.json();
        assert.equal(json.validation.valid, false);
        assert.ok(json.validation.errors.length > 0);
        assert.equal(json.error, "Este flow tiene errores que deben corregirse antes de simular.");
      });
    });

    describe("16. Aislamiento multi-tenant", () => {
      it("tenant B no puede simular el flow de tenant A -> 404 (nunca 403, no revela existencia)", async () => {
        const res = await simulatePOST(
          req("POST", `${BASE_URL}/${flowId}/simulate`, { token: adminB.token, body: { event: { type: "start" } } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 404);
      });

      it("Flow inexistente -> 404", async () => {
        const id = randomUUID();
        const res = await simulatePOST(req("POST", `${BASE_URL}/${id}/simulate`, { token: adminA.token, body: { event: { type: "start" } } }), paramsFor(id));
        assert.equal(res.status, 404);
      });
    });

    describe("Body inválido", () => {
      it("sin 'event' -> 400", async () => {
        const res = await simulatePOST(req("POST", `${BASE_URL}/${flowId}/simulate`, { token: adminA.token, body: {} }), paramsFor(flowId));
        assert.equal(res.status, 400);
      });

      it("JSON malformado -> 400", async () => {
        const request = new NextRequest(`${BASE_URL}/${flowId}/simulate`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${adminA.token}` },
          body: "{esto no es json",
        });
        const res = await simulatePOST(request, paramsFor(flowId));
        assert.equal(res.status, 400);
      });
    });
  },
);
