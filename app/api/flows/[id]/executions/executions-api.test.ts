/**
 * GET /api/flows/[id]/executions — Execution Inspector, LISTADO (Fase 2, autorizado).
 * Mismo patrón que app/api/flows/flows-api.test.ts / simulate-api.test.ts:
 * integración real contra Supabase, gateada por HAS_SUPABASE.
 *
 * Cobertura: 1 (listar), 15 (paginación), 16 (filtros), retrocompatibilidad
 * del contrato previo a Fase 2 (sin query params -> misma forma de antes +
 * campos nuevos aditivos), y aislamiento multi-tenant del listado.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { GET as executionsGET } from "./route";
import { POST as flowsPOST } from "../../route";
import { createExecution } from "@/lib/flow/flow-store";
import { createFlowEngineState } from "@/lib/flow/flow-engine";
import type { FlowDefinition } from "@/lib/flow/types";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const BASE_URL = "http://localhost/api/flows";

function req(method: string, url: string, opts?: { token?: string; noAuth?: boolean; body?: unknown }): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts?.noAuth) headers.authorization = `Bearer ${opts?.token ?? ""}`;
  return new NextRequest(url, { method, headers, body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined });
}

function paramsFor(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function flowValido(): FlowDefinition {
  return {
    name: "Executions listing test flow",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg", type: "message", config: { text: "Hola" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "msg" },
      { id: "e2", source: "msg", target: "end" },
    ],
    variables: [],
  };
}

describe(
  "Fase 2 — GET /api/flows/[id]/executions (listado, integración real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const sufijo = randomUUID().slice(0, 8);

    type UsuarioPrueba = { id: string; email: string; token: string };
    let adminA: UsuarioPrueba;
    let lecturaA: UsuarioPrueba;
    let adminB: UsuarioPrueba;
    let flowId: string;
    let versionId: string;

    async function crearUsuario(nombre: string, tenantId: string, rol: "admin" | "agente" | "lectura"): Promise<UsuarioPrueba> {
      const email = `executions-list-test-${nombre}-${sufijo}@example.com`;
      const password = `ExecListTest-${randomUUID()}`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: tenantId, user_id: data.user.id, email, rol, estado: "activo" });
      const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      const { data: sesion, error: signInError } = await anon.auth.signInWithPassword({ email, password });
      if (signInError || !sesion.session) throw signInError ?? new Error("sin sesión");
      return { id: data.user.id, email, token: sesion.session.access_token };
    }

    before(async () => {
      if (!HAS_SUPABASE) return;
      adminA = await crearUsuario("admin-a", TENANT_A, "admin");
      lecturaA = await crearUsuario("lectura-a", TENANT_A, "lectura");
      adminB = await crearUsuario("admin-b", TENANT_B, "admin");

      const createRes = await flowsPOST(req("POST", BASE_URL, { token: adminA.token, body: { slug: `exec-list-${sufijo}`, name: "Exec list test" } }));
      const createJson = await createRes.json();
      flowId = createJson.flow.id;
      versionId = createJson.version.id;

      // 3 ejecuciones reales: 2 "completed" (contactos distintos) + 1 "waiting_input".
      for (const [telefono, status] of [
        ["573000000001", "completed"],
        ["573000000002", "completed"],
        ["573000000003", "waiting_input"],
      ] as const) {
        const state = createFlowEngineState(flowValido(), { flowId, flowVersionId: versionId, executionId: randomUUID() });
        await createExecution(admin, {
          tenantId: TENANT_A,
          flowId,
          flowVersionId: versionId,
          executionId: state.executionId,
          phoneNumberId: `exec-list-${sufijo}`,
          telefonoCliente: telefono,
          initialState: { ...state, status },
        });
      }
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      for (const tenantId of [TENANT_A, TENANT_B]) {
        const { data: flows } = await admin.from("dulabs_flows").select("id").eq("tenant_id", tenantId);
        const flowIds = (flows ?? []).map((f) => f.id as string);
        if (flowIds.length > 0) {
          await admin.from("dulabs_flow_executions").delete().eq("tenant_id", tenantId).in("flow_id", flowIds);
          await admin.from("dulabs_flow_versions").delete().eq("tenant_id", tenantId).in("flow_id", flowIds);
        }
        await admin.from("dulabs_flows").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
      }
      for (const u of [adminA, lecturaA, adminB]) if (u) await admin.auth.admin.deleteUser(u.id);
    });

    describe("Auth y roles", () => {
      it("sin token -> 401", async () => {
        const res = await executionsGET(req("GET", `${BASE_URL}/${flowId}/executions`, { noAuth: true }), paramsFor(flowId));
        assert.equal(res.status, 401);
      });
      it("lectura -> 403", async () => {
        const res = await executionsGET(req("GET", `${BASE_URL}/${flowId}/executions`, { token: lecturaA.token }), paramsFor(flowId));
        assert.equal(res.status, 403);
      });
    });

    describe("1. Listar + retrocompatibilidad", () => {
      it("sin query params -> incluye las 3 ejecuciones del tenant, más reciente primero, y trae total/page/pageSize (campos NUEVOS aditivos)", async () => {
        const res = await executionsGET(req("GET", `${BASE_URL}/${flowId}/executions`, { token: adminA.token }), paramsFor(flowId));
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.executions.length, 3);
        assert.equal(json.total, 3);
        assert.equal(json.page, 1);
        assert.equal(json.pageSize, 100, "sin query params, pageSize preserva el límite histórico (100)");
      });

      it("tenant B -> lista vacía, nunca ve las ejecuciones de tenant A", async () => {
        // El Flow es de tenant A -- tenant B ni siquiera puede resolver el Flow (404), confirmado abajo en "16".
        const res = await executionsGET(req("GET", `${BASE_URL}/${flowId}/executions`, { token: adminB.token }), paramsFor(flowId));
        assert.equal(res.status, 404);
      });
    });

    describe("15. Paginación real", () => {
      it("pageSize=1 -> 1 sola ejecución por página, total sigue siendo 3", async () => {
        const res = await executionsGET(req("GET", `${BASE_URL}/${flowId}/executions?pageSize=1&page=1`, { token: adminA.token }), paramsFor(flowId));
        const json = await res.json();
        assert.equal(json.executions.length, 1);
        assert.equal(json.total, 3);
        assert.equal(json.page, 1);
      });

      it("page=2 con pageSize=1 -> trae la SIGUIENTE ejecución, no repite la de la página 1", async () => {
        const p1 = await (await executionsGET(req("GET", `${BASE_URL}/${flowId}/executions?pageSize=1&page=1`, { token: adminA.token }), paramsFor(flowId))).json();
        const p2 = await (await executionsGET(req("GET", `${BASE_URL}/${flowId}/executions?pageSize=1&page=2`, { token: adminA.token }), paramsFor(flowId))).json();
        assert.notEqual(p1.executions[0].id, p2.executions[0].id);
      });

      it("page/pageSize inválidos -> 400", async () => {
        const res = await executionsGET(req("GET", `${BASE_URL}/${flowId}/executions?page=0`, { token: adminA.token }), paramsFor(flowId));
        assert.equal(res.status, 400);
      });
    });

    describe("16. Filtros", () => {
      it("status=waiting_input -> solo esa 1 ejecución", async () => {
        const res = await executionsGET(req("GET", `${BASE_URL}/${flowId}/executions?status=waiting_input`, { token: adminA.token }), paramsFor(flowId));
        const json = await res.json();
        assert.equal(json.executions.length, 1);
        assert.equal(json.executions[0].status, "waiting_input");
      });

      it("status inválido (no es un FlowEngineStatus real) -> 400, nunca inventa un valor", async () => {
        const res = await executionsGET(req("GET", `${BASE_URL}/${flowId}/executions?status=cancelled`, { token: adminA.token }), paramsFor(flowId));
        assert.equal(res.status, 400);
      });

      it("telefono parcial -> encuentra por coincidencia", async () => {
        const res = await executionsGET(req("GET", `${BASE_URL}/${flowId}/executions?telefono=0000002`, { token: adminA.token }), paramsFor(flowId));
        const json = await res.json();
        assert.equal(json.executions.length, 1);
        assert.equal(json.executions[0].telefono_cliente, "573000000002");
      });
    });

    describe("Flow inexistente / cross-tenant", () => {
      it("flow_id inexistente -> 404", async () => {
        const id = randomUUID();
        const res = await executionsGET(req("GET", `${BASE_URL}/${id}/executions`, { token: adminA.token }), paramsFor(id));
        assert.equal(res.status, 404);
      });
    });
  },
);
