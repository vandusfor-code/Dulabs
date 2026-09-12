/**
 * GET /api/flows/[id]/executions/[executionId] — Execution Inspector, DETALLE
 * (Fase 2, autorizado). Integración real, gateada por HAS_SUPABASE, mismo
 * patrón que el resto de /api/flows/*.
 *
 * Cobertura: 2 (detalle), 3 (aislamiento tenant), 4 (execution_id inválido),
 * 5 (flow_id inválido / cross), 6 (inexistente), 20 (read-only estricto:
 * el módulo de la ruta no exporta ningún método más que GET) + el test de
 * seguridad EXPLÍCITO pedido: escanea la respuesta COMPLETA (incluida
 * metadata/error/result anidados) buscando cualquier campo con forma de
 * secreto/token/credencial, y falla si aparece alguno.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import * as executionDetailRoute from "./route";
import { GET as executionDetailGET } from "./route";
import { POST as flowsPOST } from "../../../route";
import {
  createExecution,
  insertEventIdempotent,
  insertEffectIdempotent,
  resolveEffectResult,
  recordNodeTransition,
} from "@/lib/flow/flow-store";
import { createFlowEngineState } from "@/lib/flow/flow-engine";
import type { FlowDefinition } from "@/lib/flow/types";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const BASE_URL = "http://localhost/api/flows";

function req(method: string, url: string, opts?: { token?: string; noAuth?: boolean }): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts?.noAuth) headers.authorization = `Bearer ${opts?.token ?? ""}`;
  return new NextRequest(url, { method, headers });
}

function paramsFor(id: string, executionId: string): { params: Promise<{ id: string; executionId: string }> } {
  return { params: Promise.resolve({ id, executionId }) };
}

function flowValido(): FlowDefinition {
  return {
    name: "Execution detail test flow",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "act", type: "action", config: { actionType: "crear_lead_enterprise", params: {} } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "act" },
      { id: "e2", source: "act", target: "end", sourceHandle: "success" },
    ],
    variables: [],
  };
}

// Cadena de secretos plausibles (mismos patrones que ya detecta
// lib/flow/detect-embedded-secrets.ts, reutilizado por
// sanitizePayloadForObservability) inyectados en TODOS los lugares posibles
// de la cadena real: variables, raw_payload de un evento, y result_payload
// de un efecto -- si CUALQUIERA sobrevive hasta la respuesta HTTP, el test
// de seguridad explícito de abajo debe atraparlo.
const SECRET_TOKEN = "sk-live-51AbCdEfGhIjKlMnOpQrStUvWxYz1234567890ABCDEF";
const SENSITIVE_KEYS = ["access_token", "refresh_token", "api_key", "apiKey", "secret", "service_role", "password", "token"];

function scanForSensitiveFields(value: unknown, path: string, hits: string[]): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (value === SECRET_TOKEN) hits.push(`${path} contiene el valor secreto literal inyectado`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanForSensitiveFields(v, `${path}[${i}]`, hits));
    return;
  }
  if (typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s.toLowerCase())) && typeof v === "string" && v.length > 0 && v !== "[REDACTED]") {
        // Una clave sensible con un valor no vacío y NO redactado -- salvo
        // que sea evidentemente un placeholder de plantilla ({{var}}), es
        // una fuga real.
        if (!/^\{\{[a-zA-Z0-9_.]+\}\}$/.test(v)) {
          hits.push(`${path}.${key} = "${v}" (clave sensible con valor no redactado)`);
        }
      }
      scanForSensitiveFields(v, `${path}.${key}`, hits);
    }
  }
}

describe(
  "Fase 2 — GET /api/flows/[id]/executions/[executionId] (detalle, integración real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const sufijo = randomUUID().slice(0, 8);

    type UsuarioPrueba = { id: string; email: string; token: string };
    let adminA: UsuarioPrueba;
    let adminB: UsuarioPrueba;
    let flowId: string;
    let flowBId: string;
    let versionId: string;
    let executionRowId: string;

    async function crearUsuario(nombre: string, tenantId: string, rol: "admin" | "agente"): Promise<UsuarioPrueba> {
      const email = `exec-detail-test-${nombre}-${sufijo}@example.com`;
      const password = `ExecDetailTest-${randomUUID()}`;
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
      adminB = await crearUsuario("admin-b", TENANT_B, "admin");

      const createRes = await flowsPOST(
        new NextRequest(BASE_URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${adminA.token}` },
          body: JSON.stringify({ slug: `exec-detail-${sufijo}`, name: "Exec detail test" }),
        }),
      );
      const createJson = await createRes.json();
      flowId = createJson.flow.id;
      versionId = createJson.version.id;

      const createBRes = await flowsPOST(
        new NextRequest(BASE_URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${adminB.token}` },
          body: JSON.stringify({ slug: `exec-detail-b-${sufijo}`, name: "Exec detail test B" }),
        }),
      );
      flowBId = (await createBRes.json()).flow.id;

      const engineState = createFlowEngineState(flowValido(), { flowId, flowVersionId: versionId, executionId: randomUUID() });
      const result = await createExecution(admin, {
        tenantId: TENANT_A,
        flowId,
        flowVersionId: versionId,
        executionId: engineState.executionId,
        phoneNumberId: `exec-detail-${sufijo}`,
        telefonoCliente: "573000000099",
        initialState: { ...engineState, status: "failed", currentNodeId: "act", variables: { nombre: "Ana", token: SECRET_TOKEN } },
      });
      if (!result.created) throw new Error("no se pudo crear la ejecución de prueba");
      executionRowId = result.row.id;

      await insertEventIdempotent(admin, {
        tenantId: TENANT_A,
        flowExecutionId: executionRowId,
        eventId: "ev-1",
        eventType: "conversation_started",
        rawPayload: { texto: "hola", access_token: SECRET_TOKEN },
      });

      await insertEffectIdempotent(admin, {
        tenantId: TENANT_A,
        flowExecutionId: executionRowId,
        effectId: "eff-1",
        nodeId: "act",
        kind: "action",
      });
      await resolveEffectResult(admin, {
        tenantId: TENANT_A,
        flowExecutionId: executionRowId,
        effectId: "eff-1",
        status: "failed",
        resultPayloadRaw: { error: "algo_fallo", api_key: SECRET_TOKEN },
      });

      await recordNodeTransition(admin, { tenantId: TENANT_A, flowExecutionId: executionRowId, fromNodeId: "start", toNodeId: "act" });
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      for (const tenantId of [TENANT_A, TENANT_B]) {
        const { data: flows } = await admin.from("dulabs_flows").select("id").eq("tenant_id", tenantId);
        const flowIds = (flows ?? []).map((f) => f.id as string);
        if (flowIds.length > 0) {
          const { data: execs } = await admin.from("dulabs_flow_executions").select("id").eq("tenant_id", tenantId).in("flow_id", flowIds);
          const execIds = (execs ?? []).map((e) => e.id as string);
          if (execIds.length > 0) {
            await admin.from("dulabs_flow_node_transitions").delete().eq("tenant_id", tenantId).in("flow_execution_id", execIds);
            await admin.from("dulabs_flow_effects").delete().eq("tenant_id", tenantId).in("flow_execution_id", execIds);
            await admin.from("dulabs_flow_events").delete().eq("tenant_id", tenantId).in("flow_execution_id", execIds);
          }
          await admin.from("dulabs_flow_executions").delete().eq("tenant_id", tenantId).in("flow_id", flowIds);
          await admin.from("dulabs_flow_versions").delete().eq("tenant_id", tenantId).in("flow_id", flowIds);
        }
        await admin.from("dulabs_flows").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
      }
      for (const u of [adminA, adminB]) if (u) await admin.auth.admin.deleteUser(u.id);
    });

    describe("20. Read-only estricto", () => {
      it("el módulo de la ruta NO exporta ningún método más que GET (nada de POST/PUT/PATCH/DELETE)", () => {
        const exported = Object.keys(executionDetailRoute);
        assert.deepEqual(exported, ["GET"]);
      });
    });

    describe("Auth", () => {
      it("sin token -> 401", async () => {
        const res = await executionDetailGET(req("GET", `${BASE_URL}/${flowId}/executions/${executionRowId}`, { noAuth: true }), paramsFor(flowId, executionRowId));
        assert.equal(res.status, 401);
      });
    });

    describe("2. Detalle real", () => {
      it("trae execution + evento + efecto (failed) + transición, todo correlacionado", async () => {
        const res = await executionDetailGET(req("GET", `${BASE_URL}/${flowId}/executions/${executionRowId}`, { token: adminA.token }), paramsFor(flowId, executionRowId));
        assert.equal(res.status, 200);
        const json = await res.json();
        const exec = json.execution;
        assert.equal(exec.execution.id, executionRowId);
        assert.equal(exec.execution.status, "failed");
        assert.equal(exec.execution.eventsCount, 1);
        assert.equal(exec.execution.effectsCount, 1);
        assert.equal(exec.execution.transitionsCount, 1);
        assert.equal(exec.events[0].eventType, "conversation_started");
        assert.equal(exec.effects[0].status, "failed");
        assert.ok(exec.error, "status failed -> debe traer un objeto error");
        assert.match(exec.error.code, /^EFFECT_FAILED:/);
        assert.ok(exec.timeline.length >= 2, "timeline debe combinar evento + efecto");
      });
    });

    describe("3/5. Aislamiento multi-tenant", () => {
      it("tenant B pidiendo la ejecución de tenant A -> 404 (no revela existencia)", async () => {
        const res = await executionDetailGET(req("GET", `${BASE_URL}/${flowId}/executions/${executionRowId}`, { token: adminB.token }), paramsFor(flowId, executionRowId));
        assert.equal(res.status, 404);
      });

      it("execution_id real pero pedido bajo el flow_id de OTRO tenant (flowBId) -> 404", async () => {
        const res = await executionDetailGET(req("GET", `${BASE_URL}/${flowBId}/executions/${executionRowId}`, { token: adminA.token }), paramsFor(flowBId, executionRowId));
        assert.equal(res.status, 404);
      });
    });

    describe("4. execution_id inválido", () => {
      it("un string que no es un UUID real -> 404 (nunca 500)", async () => {
        const res = await executionDetailGET(req("GET", `${BASE_URL}/${flowId}/executions/no-es-un-uuid`, { token: adminA.token }), paramsFor(flowId, "no-es-un-uuid"));
        assert.equal(res.status, 404);
      });
    });

    describe("5. flow_id inválido", () => {
      it("flow_id que no es un UUID real -> 404", async () => {
        const res = await executionDetailGET(req("GET", `${BASE_URL}/no-es-un-uuid/executions/${executionRowId}`, { token: adminA.token }), paramsFor("no-es-un-uuid", executionRowId));
        assert.equal(res.status, 404);
      });
    });

    describe("6. Ejecución inexistente", () => {
      it("UUID válido pero que no existe -> 404", async () => {
        const id = randomUUID();
        const res = await executionDetailGET(req("GET", `${BASE_URL}/${flowId}/executions/${id}`, { token: adminA.token }), paramsFor(flowId, id));
        assert.equal(res.status, 404);
      });
    });

    describe("17/18/19. Test de seguridad EXPLÍCITO — ningún campo sensible en la respuesta completa", () => {
      it("escanea el JSON completo (incluida metadata/error/result anidados) y falla si aparece cualquier secreto/token/credencial", async () => {
        const res = await executionDetailGET(req("GET", `${BASE_URL}/${flowId}/executions/${executionRowId}`, { token: adminA.token }), paramsFor(flowId, executionRowId));
        assert.equal(res.status, 200);
        const json = await res.json();

        const raw = JSON.stringify(json);
        assert.ok(!raw.includes(SECRET_TOKEN), "el token secreto literal NUNCA debe aparecer en ningún punto de la respuesta serializada");

        const hits: string[] = [];
        scanForSensitiveFields(json, "$", hits);
        assert.deepEqual(hits, [], `se encontraron campos sensibles sin redactar: ${JSON.stringify(hits)}`);
      });
    });
  },
);
