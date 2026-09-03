/**
 * Fase 1 (API de autoría de Flows, autorizado) — tests de integración real
 * contra Supabase real (usuarios de Auth efímeros, tenants descartables).
 * Mismo criterio que el resto de la suite de Flow: sin mocks del código bajo
 * prueba, solo lo inevitable (nada acá, todo es real: auth, roles, RLS-adjacent
 * aislamiento por tenant_id server-side, Postgres real).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { GET as flowsGET, POST as flowsPOST } from "./route";
import { GET as flowGET, PATCH as flowPATCH, DELETE as flowDELETE } from "./[id]/route";
import { GET as versionsGET, POST as versionsPOST } from "./[id]/versions/route";
import { POST as initialVersionPOST } from "./[id]/initial-version/route";
import { POST as validatePOST } from "./[id]/validate/route";
import { POST as publishPOST } from "./[id]/publish/route";
import { GET as executionsGET } from "./[id]/executions/route";
import { createExecution } from "@/lib/flow/flow-store";
import { createFlowEngineState } from "@/lib/flow/flow-engine";
import type { FlowDefinition } from "@/lib/flow/types";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const BASE_URL = "http://localhost/api/flows";

function req(
  method: string,
  url: string,
  opts?: { token?: string; body?: unknown; noAuth?: boolean },
): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts?.noAuth) headers.authorization = `Bearer ${opts?.token ?? ""}`;
  return new NextRequest(url, {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

function paramsFor(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

// Flow mínimo válido: start -> message -> end. Sirve para create/publish;
// no afirma nada externo, así que pasa validateFlowForPublish sin evidencia.
function flowValido(): FlowDefinition {
  return {
    name: "API test flow",
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

// Flow inválido a propósito: nodo "message" sin ningún destino (queda
// desconectado del end) -- validateFlowForPublish debe rechazarlo.
function flowInvalido(): FlowDefinition {
  return {
    name: "API test flow inválido",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg", type: "message", config: { text: "Hola" } },
    ],
    edges: [],
    variables: [],
  };
}

describe(
  "Fase 1 — API de autoría de Flows (integración real)",
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
      const email = `flows-api-test-${nombre}-${sufijo}@example.com`;
      const password = `FlowsApiTest-${randomUUID()}`;
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

      const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
      });
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
          await admin.from("dulabs_flow_executions").delete().eq("tenant_id", tenantId).in("flow_id", flowIds);
          await admin.from("dulabs_flow_versions").delete().eq("tenant_id", tenantId).in("flow_id", flowIds);
        }
        await admin.from("dulabs_flows").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_clientes_config").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
      }
      for (const u of [adminA, agenteA, lecturaA, adminB]) {
        if (u) await admin.auth.admin.deleteUser(u.id);
      }
    });

    // -----------------------------------------------------------------
    // Auth
    // -----------------------------------------------------------------
    describe("Autenticación", () => {
      it("sin token -> 401", async () => {
        const res = await flowsGET(req("GET", BASE_URL, { noAuth: true }));
        assert.equal(res.status, 401);
      });

      it("token inválido -> 401", async () => {
        const res = await flowsGET(req("GET", BASE_URL, { token: "esto-no-es-un-jwt-real" }));
        assert.equal(res.status, 401);
      });
    });

    // -----------------------------------------------------------------
    // Roles
    // -----------------------------------------------------------------
    describe("Roles", () => {
      it("lectura -> 403 en POST /api/flows (escritura solo admin)", async () => {
        const res = await flowsPOST(req("POST", BASE_URL, { token: lecturaA.token, body: { slug: `x-${randomUUID()}`, name: "x" } }));
        assert.equal(res.status, 403);
      });

      it("agente -> 403 en POST /api/flows (escritura solo admin)", async () => {
        const res = await flowsPOST(req("POST", BASE_URL, { token: agenteA.token, body: { slug: `x-${randomUUID()}`, name: "x" } }));
        assert.equal(res.status, 403);
      });

      it("agente -> 200 en GET /api/flows (lectura admin+agente)", async () => {
        const res = await flowsGET(req("GET", BASE_URL, { token: agenteA.token }));
        assert.equal(res.status, 200);
      });

      it("lectura -> 403 en GET /api/flows (la matriz aprobada dice 'admin + agente', NO incluye el rol 'lectura')", async () => {
        // La matriz aprobada dice "admin + agente" para ver Flows, sin
        // mencionar "lectura" explícitamente -- requireRol exige que el rol
        // esté en la lista exacta, así que el rol "lectura" queda FUERA
        // también de ver Flows, pese a su nombre. Documentado aquí como
        // comportamiento real (posible punto a revisar), no asumido.
        const res = await flowsGET(req("GET", BASE_URL, { token: lecturaA.token }));
        assert.equal(res.status, 403);
      });
    });

    // -----------------------------------------------------------------
    // CRUD de Flow
    // -----------------------------------------------------------------
    let flowId: string;
    const slugFlowPrincipal = `api-test-flow-${sufijo}`;

    describe("Crear / listar / obtener Flow", () => {
      it("POST /api/flows (admin) -> 201, crea el Flow Y su primera versión Draft en el mismo request", async () => {
        const res = await flowsPOST(
          req("POST", BASE_URL, { token: adminA.token, body: { slug: slugFlowPrincipal, name: "Flow de prueba API" } }),
        );
        assert.equal(res.status, 201);
        const json = await res.json();
        assert.equal(json.flow.slug, slugFlowPrincipal);
        assert.equal(json.flow.tenant_id, TENANT_A);
        assert.equal(json.flow.status, "draft");
        flowId = json.flow.id;

        assert.ok(json.version, "debe traer 'version' -- el editor no debe encontrarse con 'sin versiones'");
        assert.equal(json.version.flow_id, flowId);
        assert.equal(json.version.version_number, 1);
        assert.equal(json.version.published_at, null, "la primera versión nunca se publica automáticamente");
        assert.equal(json.version.definition_json.nodes.length, 1);
        assert.equal(json.version.definition_json.nodes[0].type, "start");
      });

      it("POST /api/flows con slug duplicado -> 409", async () => {
        const res = await flowsPOST(
          req("POST", BASE_URL, { token: adminA.token, body: { slug: slugFlowPrincipal, name: "otro nombre" } }),
        );
        assert.equal(res.status, 409);
      });

      it("POST /api/flows sin slug/name -> 400", async () => {
        const res = await flowsPOST(req("POST", BASE_URL, { token: adminA.token, body: { name: "sin slug" } }));
        assert.equal(res.status, 400);
      });

      it("GET /api/flows (admin) -> incluye el Flow creado", async () => {
        const res = await flowsGET(req("GET", BASE_URL, { token: adminA.token }));
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.ok(json.flows.some((f: { id: string }) => f.id === flowId));
      });

      it("GET /api/flows con tenant B -> NO incluye el Flow del tenant A", async () => {
        const res = await flowsGET(req("GET", BASE_URL, { token: adminB.token }));
        const json = await res.json();
        assert.ok(!json.flows.some((f: { id: string }) => f.id === flowId));
      });

      it("GET /api/flows/[id] (admin A, dueño) -> 200", async () => {
        const res = await flowGET(req("GET", `${BASE_URL}/${flowId}`, { token: adminA.token }), paramsFor(flowId));
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.flow.id, flowId);
      });

      it("GET /api/flows/[id] (tenant B, NO dueño) -> 404, no 403 (no revela existencia)", async () => {
        const res = await flowGET(req("GET", `${BASE_URL}/${flowId}`, { token: adminB.token }), paramsFor(flowId));
        assert.equal(res.status, 404);
      });

      it("GET /api/flows/[id] con id inexistente -> 404", async () => {
        const res = await flowGET(req("GET", `${BASE_URL}/${randomUUID()}`, { token: adminA.token }), paramsFor(randomUUID()));
        assert.equal(res.status, 404);
      });
    });

    // -----------------------------------------------------------------
    // PATCH
    // -----------------------------------------------------------------
    describe("PATCH (solo metadata)", () => {
      it("PATCH name/description (admin) -> 200, cambia solo eso", async () => {
        const res = await flowPATCH(
          req("PATCH", `${BASE_URL}/${flowId}`, { token: adminA.token, body: { name: "Nombre editado", description: "desc nueva" } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.flow.name, "Nombre editado");
        assert.equal(json.flow.description, "desc nueva");
        assert.equal(json.flow.status, "draft", "PATCH no debe tocar status");
      });

      it("PATCH intentando cambiar 'status' -> 400, rechazado explícitamente", async () => {
        const res = await flowPATCH(
          req("PATCH", `${BASE_URL}/${flowId}`, { token: adminA.token, body: { status: "published" } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 400);
      });

      it("PATCH intentando cambiar 'definition' -> 400, rechazado explícitamente", async () => {
        const res = await flowPATCH(
          req("PATCH", `${BASE_URL}/${flowId}`, { token: adminA.token, body: { definition: flowValido() } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 400);
      });

      it("PATCH con agente -> 403 (escritura solo admin)", async () => {
        const res = await flowPATCH(
          req("PATCH", `${BASE_URL}/${flowId}`, { token: agenteA.token, body: { name: "no debería aplicar" } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 403);
      });

      it("PATCH desde tenant B sobre Flow de tenant A -> 404", async () => {
        const res = await flowPATCH(
          req("PATCH", `${BASE_URL}/${flowId}`, { token: adminB.token, body: { name: "hackeado" } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 404);
      });
    });

    // -----------------------------------------------------------------
    // Versiones
    // -----------------------------------------------------------------
    let versionId: string;

    describe("Versiones", () => {
      // `flowId` ya trae v1 (auto-creada por POST /api/flows, ver arriba) --
      // estas versiones explícitas encadenan a partir de v2.
      it("POST /versions (admin) -> 201, crea v2 sin publicar", async () => {
        const res = await versionsPOST(
          req("POST", `${BASE_URL}/${flowId}/versions`, { token: adminA.token, body: { definition: flowValido() } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 201);
        const json = await res.json();
        assert.equal(json.version.version_number, 2);
        assert.equal(json.version.published_at, null, "no debe publicarse automáticamente");
        versionId = json.version.id;
      });

      it("POST /versions otra vez (sin versionNumber explícito) -> auto-incrementa a 3", async () => {
        const res = await versionsPOST(
          req("POST", `${BASE_URL}/${flowId}/versions`, { token: adminA.token, body: { definition: flowValido() } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 201);
        const json = await res.json();
        assert.equal(json.version.version_number, 3);
      });

      it("POST /versions con versionNumber duplicado explícito -> 409", async () => {
        const res = await versionsPOST(
          req("POST", `${BASE_URL}/${flowId}/versions`, { token: adminA.token, body: { definition: flowValido(), versionNumber: 1 } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 409);
      });

      it("POST /versions sin 'definition' -> 400", async () => {
        const res = await versionsPOST(req("POST", `${BASE_URL}/${flowId}/versions`, { token: adminA.token, body: {} }), paramsFor(flowId));
        assert.equal(res.status, 400);
      });

      it("GET /versions (admin+agente) -> lista las 3 (v1 automática + 2 explícitas), más reciente primero", async () => {
        const res = await versionsGET(req("GET", `${BASE_URL}/${flowId}/versions`, { token: agenteA.token }), paramsFor(flowId));
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.versions.length, 3);
        assert.equal(json.versions[0].version_number, 3);
      });

      it("GET /versions desde tenant B -> 404", async () => {
        const res = await versionsGET(req("GET", `${BASE_URL}/${flowId}/versions`, { token: adminB.token }), paramsFor(flowId));
        assert.equal(res.status, 404);
      });
    });

    // -----------------------------------------------------------------
    // Recuperación: POST /api/flows/[id]/initial-version
    // -----------------------------------------------------------------
    describe("POST /initial-version -- recuperación de un Flow sin ninguna versión", () => {
      let flowSinVersionId: string;

      before(async () => {
        if (!HAS_SUPABASE) return;
        // Se inserta directo (bypass de POST /api/flows) para simular un
        // Flow real que quedó sin versión -- ya sea creado antes de este
        // fix, o si el paso automático falló a mitad de camino.
        const { data } = await admin
          .from("dulabs_flows")
          .insert({ tenant_id: TENANT_A, slug: `sin-version-${sufijo}`, name: "Sin versión" })
          .select("id")
          .single();
        flowSinVersionId = data!.id;
      });

      it("agente -> 403 (escritura solo admin)", async () => {
        const res = await initialVersionPOST(
          req("POST", `${BASE_URL}/${flowSinVersionId}/initial-version`, { token: agenteA.token }),
          paramsFor(flowSinVersionId),
        );
        assert.equal(res.status, 403);
      });

      it("admin, Flow sin versión -> 201, crea v1 con un nodo Start", async () => {
        const res = await initialVersionPOST(
          req("POST", `${BASE_URL}/${flowSinVersionId}/initial-version`, { token: adminA.token }),
          paramsFor(flowSinVersionId),
        );
        assert.equal(res.status, 201);
        const json = await res.json();
        assert.equal(json.version.version_number, 1);
        assert.equal(json.version.published_at, null);
        assert.equal(json.version.definition_json.nodes.length, 1);
        assert.equal(json.version.definition_json.nodes[0].type, "start");
      });

      it("llamado otra vez sobre el MISMO Flow -> 200 (no 201), misma versión, nunca crea v2", async () => {
        const res = await initialVersionPOST(
          req("POST", `${BASE_URL}/${flowSinVersionId}/initial-version`, { token: adminA.token }),
          paramsFor(flowSinVersionId),
        );
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.version.version_number, 1);

        const listRes = await versionsGET(
          req("GET", `${BASE_URL}/${flowSinVersionId}/versions`, { token: adminA.token }),
          paramsFor(flowSinVersionId),
        );
        const listJson = await listRes.json();
        assert.equal(listJson.versions.length, 1, "el segundo llamado no debe haber creado una v2");
      });

      it("Flow de otro tenant -> 404 (no revela existencia)", async () => {
        const res = await initialVersionPOST(
          req("POST", `${BASE_URL}/${flowSinVersionId}/initial-version`, { token: adminB.token }),
          paramsFor(flowSinVersionId),
        );
        assert.equal(res.status, 404);
      });

      it("Flow inexistente -> 404", async () => {
        const id = randomUUID();
        const res = await initialVersionPOST(req("POST", `${BASE_URL}/${id}/initial-version`, { token: adminA.token }), paramsFor(id));
        assert.equal(res.status, 404);
      });
    });

    // -----------------------------------------------------------------
    // Validate
    // -----------------------------------------------------------------
    describe("Validate", () => {
      it("POST /validate con Flow válido -> 200, {valid:true, errors:[]}", async () => {
        const res = await validatePOST(
          req("POST", `${BASE_URL}/${flowId}/validate`, { token: agenteA.token, body: { definition: flowValido() } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.valid, true);
        assert.deepEqual(json.errors, []);
      });

      it("POST /validate con Flow inválido -> 200 (no es un error HTTP), {valid:false, errors:[...]} con code/nodeId/message reales", async () => {
        const res = await validatePOST(
          req("POST", `${BASE_URL}/${flowId}/validate`, { token: agenteA.token, body: { definition: flowInvalido() } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.valid, false);
        assert.ok(json.errors.length > 0);
        assert.ok(json.errors[0].code, "debe traer un code de FLOW_VALIDATION_CODES");
        assert.ok(!("severity" in json.errors[0]), "no debe inventar severity -- no existe en FlowValidationError");
      });

      it("POST /validate con lectura -> 403", async () => {
        const res = await validatePOST(
          req("POST", `${BASE_URL}/${flowId}/validate`, { token: lecturaA.token, body: { definition: flowValido() } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 403);
      });
    });

    // -----------------------------------------------------------------
    // Publish
    // -----------------------------------------------------------------
    describe("Publish", () => {
      it("POST /publish con agente -> 403 (solo admin)", async () => {
        const res = await publishPOST(
          req("POST", `${BASE_URL}/${flowId}/publish`, { token: agenteA.token, body: { versionId } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 403);
      });

      it("POST /publish (admin) -> 200, usa publishFlowVersion()/RPC real: published_version_id + status='published'", async () => {
        const res = await publishPOST(
          req("POST", `${BASE_URL}/${flowId}/publish`, { token: adminA.token, body: { versionId } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.flow.published_version_id, versionId);
        assert.equal(json.flow.status, "published");
      });

      it("POST /publish con versionId inexistente -> 404", async () => {
        const res = await publishPOST(
          req("POST", `${BASE_URL}/${flowId}/publish`, { token: adminA.token, body: { versionId: randomUUID() } }),
          paramsFor(flowId),
        );
        assert.equal(res.status, 404);
      });

      it("La versión publicada quedó marcada published_at (inmutable) -- confirmado contra Supabase directo", async () => {
        const { data } = await admin.from("dulabs_flow_versions").select("published_at").eq("id", versionId).maybeSingle();
        assert.ok(data?.published_at);
      });
    });

    // -----------------------------------------------------------------
    // Executions
    // -----------------------------------------------------------------
    describe("Executions", () => {
      let executionRowId: string;

      before(async () => {
        if (!HAS_SUPABASE) return;
        const state = createFlowEngineState(flowValido(), { flowId, flowVersionId: versionId, executionId: randomUUID() });
        const result = await createExecution(admin, {
          tenantId: TENANT_A,
          flowId,
          flowVersionId: versionId,
          executionId: randomUUID(),
          phoneNumberId: `flows-api-test-${sufijo}`,
          telefonoCliente: "573000000999",
          initialState: state,
        });
        if (!result.created) throw new Error("no se pudo crear la ejecución de prueba");
        executionRowId = result.row.id;
      });

      it("GET /executions (admin+agente) -> incluye la ejecución real creada", async () => {
        const res = await executionsGET(req("GET", `${BASE_URL}/${flowId}/executions`, { token: adminA.token }), paramsFor(flowId));
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.ok(json.executions.some((e: { id: string }) => e.id === executionRowId));
      });

      it("GET /executions desde tenant B -> 404 (ni siquiera ve que el Flow existe)", async () => {
        const res = await executionsGET(req("GET", `${BASE_URL}/${flowId}/executions`, { token: adminB.token }), paramsFor(flowId));
        assert.equal(res.status, 404);
      });
    });

    // -----------------------------------------------------------------
    // Archive (DELETE)
    // -----------------------------------------------------------------
    describe("Archive (DELETE no físico)", () => {
      let flowSinClienteId: string;
      let flowConClienteId: string;
      const phoneActivo = `flows-api-test-activo-${sufijo}`;

      before(async () => {
        if (!HAS_SUPABASE) return;
        const { data: f1 } = await admin
          .from("dulabs_flows")
          .insert({ tenant_id: TENANT_A, slug: `archivable-${sufijo}`, name: "Archivable" })
          .select("id")
          .single();
        flowSinClienteId = f1!.id;

        const { data: f2 } = await admin
          .from("dulabs_flows")
          .insert({ tenant_id: TENANT_A, slug: `activo-${sufijo}`, name: "Con cliente activo" })
          .select("id")
          .single();
        flowConClienteId = f2!.id;

        await admin.from("dulabs_clientes_config").insert({
          id_tenant: TENANT_A,
          nombre_negocio: "Cliente activo de prueba (borrar)",
          whatsapp_business_account_id: `waba-${phoneActivo}`,
          phone_number_id: phoneActivo,
          telefono_negocio: "0000000000",
          flow_activo: true,
          flow_id: flowConClienteId,
        });
      });

      it("DELETE sobre Flow SIN cliente activo -> 200, status pasa a 'archived' (nunca borra la fila)", async () => {
        const res = await flowDELETE(req("DELETE", `${BASE_URL}/${flowSinClienteId}`, { token: adminA.token }), paramsFor(flowSinClienteId));
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.flow.status, "archived");

        const { data } = await admin.from("dulabs_flows").select("id, status").eq("id", flowSinClienteId).maybeSingle();
        assert.ok(data, "la fila sigue existiendo -- no fue un DELETE físico");
        assert.equal(data!.status, "archived");
      });

      it("DELETE sobre Flow CON cliente activo -> 409, mensaje exacto pedido, NO archiva, NO toca dulabs_clientes_config", async () => {
        const res = await flowDELETE(req("DELETE", `${BASE_URL}/${flowConClienteId}`, { token: adminA.token }), paramsFor(flowConClienteId));
        assert.equal(res.status, 409);
        const json = await res.json();
        assert.equal(json.error, "No se puede archivar este Flow porque está activo para uno o más clientes.");

        const { data: flow } = await admin.from("dulabs_flows").select("status").eq("id", flowConClienteId).maybeSingle();
        assert.equal(flow!.status, "draft", "no debe haberse archivado");

        const { data: cliente } = await admin
          .from("dulabs_clientes_config")
          .select("flow_activo, flow_id")
          .eq("phone_number_id", phoneActivo)
          .maybeSingle();
        assert.equal(cliente!.flow_activo, true, "flow_activo NO debe haberse tocado");
        assert.equal(cliente!.flow_id, flowConClienteId, "flow_id NO debe haberse tocado");
      });

      it("DELETE con agente -> 403 (solo admin)", async () => {
        const res = await flowDELETE(req("DELETE", `${BASE_URL}/${flowSinClienteId}`, { token: agenteA.token }), paramsFor(flowSinClienteId));
        assert.equal(res.status, 403);
      });

      it("DELETE desde tenant B sobre Flow de tenant A -> 404", async () => {
        const res = await flowDELETE(req("DELETE", `${BASE_URL}/${flowConClienteId}`, { token: adminB.token }), paramsFor(flowConClienteId));
        assert.equal(res.status, 404);
      });

      it("DELETE sobre id inexistente -> 404", async () => {
        const id = randomUUID();
        const res = await flowDELETE(req("DELETE", `${BASE_URL}/${id}`, { token: adminA.token }), paramsFor(id));
        assert.equal(res.status, 404);
      });
    });
  },
);
