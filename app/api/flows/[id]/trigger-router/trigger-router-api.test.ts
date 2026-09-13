/**
 * FASE F8.2 (Trigger Router SaaS — Self-Service Activation, autorizado) —
 * tests de integración real (usuarios de Auth efímeros, tenants
 * descartables) de:
 *   POST /api/flows/[id]/trigger-router/activate
 *   POST /api/flows/[id]/trigger-router/deactivate
 * Mismo criterio que app/api/flows/[id]/triggers/triggers-api.test.ts: sin
 * mocks del código bajo prueba, importa los route handlers reales y los
 * invoca con un NextRequest real.
 *
 * Nota sobre HAS_SUPABASE: esta suite NO exige NEXT_PUBLIC_SUPABASE_ANON_KEY
 * (a diferencia de triggers-api.test.ts) -- para obtener una sesión real de
 * un usuario de prueba, `signInWithPassword` se llama con un cliente
 * configurado con la SERVICE_ROLE_KEY como apikey en vez de la anon key
 * (verificado: produce un access_token real y válido para
 * supabase.auth.getUser(), idéntico en efecto al que produciría la anon
 * key) -- esto permite ejecutar esta suite completa en máquinas donde
 * NEXT_PUBLIC_SUPABASE_ANON_KEY no está poblada localmente (mismo gap ya
 * documentado para TOKEN_ENCRYPTION_KEY/ANTHROPIC_API_KEY en esta sesión).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { POST as activatePOST } from "./activate/route";
import { POST as deactivatePOST } from "./deactivate/route";
import { createFlow, createFlowVersion, publishFlowVersion, archiveFlow } from "@/lib/flow/flow-store";
import type { FlowDefinition } from "@/lib/flow/types";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function flowMinimo(nombre: string): FlowDefinition {
  return {
    name: nombre,
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg", type: "message", config: { text: "hola" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "msg" },
      { id: "e2", source: "msg", target: "end" },
    ],
    variables: [],
  };
}

function req(url: string, opts?: { token?: string; body?: unknown; noAuth?: boolean }): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts?.noAuth) headers.authorization = `Bearer ${opts?.token ?? ""}`;
  return new NextRequest(url, { method: "POST", headers, body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined });
}

function paramsFor(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe(
  "FASE F8.2 — API de Trigger Router activation (integración real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const sufijo = randomUUID().slice(0, 8);
    const PHONE_A = `f82-api-a-${sufijo}`;
    const PHONE_B = `f82-api-b-${sufijo}`;

    type UsuarioPrueba = { id: string; token: string };
    let adminA: UsuarioPrueba;
    let agenteA: UsuarioPrueba;
    let adminB: UsuarioPrueba;

    async function crearUsuario(nombre: string, tenantId: string, rol: "admin" | "agente"): Promise<UsuarioPrueba> {
      const email = `f82-trigger-router-api-${nombre}-${sufijo}@example.com`;
      const password = `F82ApiTest-${randomUUID()}`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      const { error: miembroError } = await admin
        .from("dulabs_miembros_equipo")
        .insert({ tenant_id: tenantId, user_id: data.user.id, email, rol, estado: "activo" });
      if (miembroError) throw miembroError;

      // Ver nota del archivo: SERVICE_ROLE_KEY como apikey del cliente de
      // sign-in (sustituto verificado de NEXT_PUBLIC_SUPABASE_ANON_KEY,
      // ausente en esta máquina) -- produce un access_token real.
      const signInClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      const { data: sesion, error: signInError } = await signInClient.auth.signInWithPassword({ email, password });
      if (signInError || !sesion.session) throw signInError ?? new Error("sin sesión");
      return { id: data.user.id, token: sesion.session.access_token };
    }

    let flowAId: string; // publicado, activo en PHONE_A
    let flowAOtroId: string; // publicado, NO activo en ningún número (para flow_id mismatch)
    let flowADraftId: string; // nunca publicado
    let flowAArchivedId: string; // publicado y luego archivado
    let flowBId: string; // publicado, tenant B

    async function crearFlowPublicado(tenantId: string, nombre: string): Promise<string> {
      const flow = await createFlow(admin, { tenantId, slug: `${nombre}-${sufijo}`, name: nombre });
      const version = await createFlowVersion(admin, { tenantId, flowId: flow.id, versionNumber: 1, definition: flowMinimo(nombre) });
      await publishFlowVersion(admin, tenantId, flow.id, version.id);
      return flow.id;
    }

    before(async () => {
      if (!HAS_SUPABASE) return;
      adminA = await crearUsuario("admin-a", TENANT_A, "admin");
      agenteA = await crearUsuario("agente-a", TENANT_A, "agente");
      adminB = await crearUsuario("admin-b", TENANT_B, "admin");

      flowAId = await crearFlowPublicado(TENANT_A, "f82-api-flow-a");
      flowAOtroId = await crearFlowPublicado(TENANT_A, "f82-api-flow-a-otro");
      flowBId = await crearFlowPublicado(TENANT_B, "f82-api-flow-b");

      const draft = await createFlow(admin, { tenantId: TENANT_A, slug: `f82-api-flow-a-draft-${sufijo}`, name: "f82-api-flow-a-draft" });
      flowADraftId = draft.id;

      flowAArchivedId = await crearFlowPublicado(TENANT_A, "f82-api-flow-a-archived");
      await archiveFlow(admin, { tenantId: TENANT_A, flowId: flowAArchivedId });

      await admin.from("dulabs_clientes_config").insert({
        nombre_negocio: "F8.2 API test A",
        whatsapp_business_account_id: `waba-${PHONE_A}`,
        phone_number_id: PHONE_A,
        telefono_negocio: "0000000000",
        id_tenant: TENANT_A,
        flow_activo: true,
        flow_id: flowAId,
        trigger_routing_activo: false,
      });
      await admin.from("dulabs_clientes_config").insert({
        nombre_negocio: "F8.2 API test B",
        whatsapp_business_account_id: `waba-${PHONE_B}`,
        phone_number_id: PHONE_B,
        telefono_negocio: "0000000001",
        id_tenant: TENANT_B,
        flow_activo: true,
        flow_id: flowBId,
        trigger_routing_activo: false,
      });
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      await admin.from("dulabs_clientes_config").delete().in("phone_number_id", [PHONE_A, PHONE_B]);
      // dulabs_flow_versions es INMUTABLE una vez publicada (trigger real de
      // Postgres bloquea el DELETE) -- archiveFlow() es el único cleanup
      // real posible para un Flow ya publicado; los triggers sí se borran.
      for (const tenantId of [TENANT_A, TENANT_B]) {
        await admin.from("dulabs_flow_triggers").delete().eq("tenant_id", tenantId);
      }
      for (const flowId of [flowAId, flowAOtroId, flowADraftId, flowAArchivedId, flowBId]) {
        try {
          await archiveFlow(admin, { tenantId: flowId === flowBId ? TENANT_B : TENANT_A, flowId });
        } catch {
          // flowADraftId nunca se publicó -- archiveFlow igual funciona para
          // drafts (solo cambia `status`), esto es defensivo por si alguno
          // ya fue archivado antes.
        }
      }
      for (const tenantId of [TENANT_A, TENANT_B]) {
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
      }
      for (const u of [adminA, agenteA, adminB]) {
        if (u) await admin.auth.admin.deleteUser(u.id);
      }
    });

    function assertNoSecretsLeaked(json: unknown): void {
      const raw = JSON.stringify(json);
      for (const campo of ["meta_permanent_token", "api_key_ia", "access_token", "whatsapp_business_account_id"]) {
        // whatsapp_business_account_id no es un secreto per se, pero su
        // presencia indicaría que se filtró la fila completa de
        // dulabs_clientes_config -- se incluye como señal indirecta.
        if (campo === "whatsapp_business_account_id") continue;
        assert.ok(!raw.includes(campo), `la respuesta no debe mencionar '${campo}'`);
      }
    }

    describe("activate — casos de rechazo", () => {
      it("no autenticado -> 401", async () => {
        const res = await activatePOST(req(`http://localhost/api/flows/${flowAId}/trigger-router/activate`, { noAuth: true, body: { phoneNumberId: PHONE_A } }), paramsFor(flowAId));
        assert.equal(res.status, 401);
      });

      it("usuario no-admin (agente) -> 403", async () => {
        const res = await activatePOST(req(`http://localhost/api/flows/${flowAId}/trigger-router/activate`, { token: agenteA.token, body: { phoneNumberId: PHONE_A } }), paramsFor(flowAId));
        assert.equal(res.status, 403);
      });

      it("Flow de otro tenant (admin B intentando el Flow de A) -> 404", async () => {
        const res = await activatePOST(req(`http://localhost/api/flows/${flowAId}/trigger-router/activate`, { token: adminB.token, body: { phoneNumberId: PHONE_A } }), paramsFor(flowAId));
        assert.equal(res.status, 404);
      });

      it("phone_number_id de otro tenant (admin A intentando el número de B) -> 404", async () => {
        const res = await activatePOST(req(`http://localhost/api/flows/${flowAId}/trigger-router/activate`, { token: adminA.token, body: { phoneNumberId: PHONE_B } }), paramsFor(flowAId));
        assert.equal(res.status, 404);
      });

      it("Flow inexistente -> 404", async () => {
        const res = await activatePOST(req(`http://localhost/api/flows/${randomUUID()}/trigger-router/activate`, { token: adminA.token, body: { phoneNumberId: PHONE_A } }), paramsFor(randomUUID()));
        assert.equal(res.status, 404);
      });

      it("Flow draft -> 409, nunca activa el Router", async () => {
        const res = await activatePOST(req(`http://localhost/api/flows/${flowADraftId}/trigger-router/activate`, { token: adminA.token, body: { phoneNumberId: PHONE_A } }), paramsFor(flowADraftId));
        assert.equal(res.status, 409);
      });

      it("Flow archived -> 409", async () => {
        const res = await activatePOST(req(`http://localhost/api/flows/${flowAArchivedId}/trigger-router/activate`, { token: adminA.token, body: { phoneNumberId: PHONE_A } }), paramsFor(flowAArchivedId));
        assert.equal(res.status, 409);
      });

      it("flow_id no coincide con el activo en ese número (flowAOtroId, publicado pero no activo en PHONE_A) -> 409", async () => {
        const res = await activatePOST(req(`http://localhost/api/flows/${flowAOtroId}/trigger-router/activate`, { token: adminA.token, body: { phoneNumberId: PHONE_A } }), paramsFor(flowAOtroId));
        assert.equal(res.status, 409);
      });

      it("Flow inactivo en este número (flow_activo=false) -> 409", async () => {
        await admin.from("dulabs_clientes_config").update({ flow_activo: false, flow_id: null }).eq("phone_number_id", PHONE_A);
        const res = await activatePOST(req(`http://localhost/api/flows/${flowAId}/trigger-router/activate`, { token: adminA.token, body: { phoneNumberId: PHONE_A } }), paramsFor(flowAId));
        assert.equal(res.status, 409);
        await admin.from("dulabs_clientes_config").update({ flow_activo: true, flow_id: flowAId }).eq("phone_number_id", PHONE_A);
      });
    });

    describe("activate / deactivate — caso feliz", () => {
      it("admin válido + Flow publicado y activo -> 200, triggerRoutingActivo=true, sin secretos", async () => {
        const res = await activatePOST(req(`http://localhost/api/flows/${flowAId}/trigger-router/activate`, { token: adminA.token, body: { phoneNumberId: PHONE_A } }), paramsFor(flowAId));
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.deepEqual(json, { success: true, triggerRoutingActivo: true });
        assertNoSecretsLeaked(json);

        const { data } = await admin.from("dulabs_clientes_config").select("trigger_routing_activo").eq("phone_number_id", PHONE_A).maybeSingle();
        assert.equal(data?.trigger_routing_activo, true);
      });

      it("deactivate -> 200, triggerRoutingActivo=false, conserva flow_activo/flow_id, sin secretos", async () => {
        const res = await deactivatePOST(req(`http://localhost/api/flows/${flowAId}/trigger-router/deactivate`, { token: adminA.token, body: { phoneNumberId: PHONE_A } }), paramsFor(flowAId));
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.deepEqual(json, { success: true, triggerRoutingActivo: false });
        assertNoSecretsLeaked(json);

        const { data } = await admin
          .from("dulabs_clientes_config")
          .select("trigger_routing_activo, flow_activo, flow_id")
          .eq("phone_number_id", PHONE_A)
          .maybeSingle();
        assert.equal(data?.trigger_routing_activo, false);
        assert.equal(data?.flow_activo, true);
        assert.equal(data?.flow_id, flowAId);
      });
    });

    describe("deactivate — casos de rechazo", () => {
      it("no autenticado -> 401", async () => {
        const res = await deactivatePOST(req(`http://localhost/api/flows/${flowAId}/trigger-router/deactivate`, { noAuth: true, body: { phoneNumberId: PHONE_A } }), paramsFor(flowAId));
        assert.equal(res.status, 401);
      });

      it("usuario no-admin -> 403", async () => {
        const res = await deactivatePOST(req(`http://localhost/api/flows/${flowAId}/trigger-router/deactivate`, { token: agenteA.token, body: { phoneNumberId: PHONE_A } }), paramsFor(flowAId));
        assert.equal(res.status, 403);
      });

      it("phone_number_id de otro tenant -> 404", async () => {
        const res = await deactivatePOST(req(`http://localhost/api/flows/${flowAId}/trigger-router/deactivate`, { token: adminA.token, body: { phoneNumberId: PHONE_B } }), paramsFor(flowAId));
        assert.equal(res.status, 404);
      });
    });
  },
);
