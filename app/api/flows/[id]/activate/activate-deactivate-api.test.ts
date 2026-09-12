/**
 * Fase 4 (Self-Service Flow Activation, autorizado) — tests de integración
 * real contra Supabase real (usuarios de Auth efímeros, tenants
 * descartables), mismo criterio que app/api/flows/flows-api.test.ts: sin
 * mocks del código bajo prueba.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { POST as flowsPOST } from "../../route";
import { POST as versionsPOST } from "../versions/route";
import { POST as publishPOST } from "../publish/route";
import { POST as activatePOST } from "./route";
import { POST as deactivatePOST } from "../deactivate/route";
import type { FlowDefinition } from "@/lib/flow/types";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const BASE_URL = "http://localhost/api/flows";

function req(method: string, url: string, opts?: { token?: string; body?: unknown; noAuth?: boolean }): NextRequest {
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

function flowValido(nombre: string): FlowDefinition {
  return {
    name: nombre,
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
  "Fase 4 — POST /api/flows/[id]/activate y /deactivate (integración real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const sufijo = randomUUID().slice(0, 8);

    const PHONE_A1 = `f4-activate-a1-${sufijo}`;
    const PHONE_A2 = `f4-activate-a2-${sufijo}`;
    const PHONE_B1 = `f4-activate-b1-${sufijo}`;
    const PHONE_INEXISTENTE = `f4-activate-inexistente-${sufijo}`;

    type UsuarioPrueba = { id: string; email: string; token: string };
    let adminA: UsuarioPrueba;
    let agenteA: UsuarioPrueba;
    let adminB: UsuarioPrueba;

    async function crearUsuario(nombre: string, tenantId: string, rol: "admin" | "agente"): Promise<UsuarioPrueba> {
      const email = `flows-activate-test-${nombre}-${sufijo}@example.com`;
      const password = `FlowsActivateTest-${randomUUID()}`;
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

    let flowPublicadoId: string;
    let versionPublicadaId: string;
    let flowDraftId: string;
    let flowTenantBId: string;

    before(async () => {
      if (!HAS_SUPABASE) return;
      adminA = await crearUsuario("admin-a", TENANT_A, "admin");
      agenteA = await crearUsuario("agente-a", TENANT_A, "agente");
      adminB = await crearUsuario("admin-b", TENANT_B, "admin");

      // Números descartables -- PHONE_A1/A2 de tenant A, PHONE_B1 de tenant B.
      await admin.from("dulabs_clientes_config").insert([
        {
          id_tenant: TENANT_A,
          nombre_negocio: "F4 test A1 (descartable, borrar)",
          whatsapp_business_account_id: `waba-${PHONE_A1}`,
          phone_number_id: PHONE_A1,
          telefono_negocio: "0000000001",
        },
        {
          id_tenant: TENANT_A,
          nombre_negocio: "F4 test A2 (descartable, borrar)",
          whatsapp_business_account_id: `waba-${PHONE_A2}`,
          phone_number_id: PHONE_A2,
          telefono_negocio: "0000000002",
        },
        {
          id_tenant: TENANT_B,
          nombre_negocio: "F4 test B1 (descartable, borrar)",
          whatsapp_business_account_id: `waba-${PHONE_B1}`,
          phone_number_id: PHONE_B1,
          telefono_negocio: "0000000003",
        },
      ]);

      // Flow publicado (tenant A).
      const resCrear = await flowsPOST(
        req("POST", BASE_URL, { token: adminA.token, body: { slug: `f4-publicado-${sufijo}`, name: "F4 publicado" } }),
      );
      const jsonCrear = await resCrear.json();
      flowPublicadoId = jsonCrear.flow.id;

      const resVersion = await versionsPOST(
        req("POST", `${BASE_URL}/${flowPublicadoId}/versions`, { token: adminA.token, body: { definition: flowValido("F4 publicado") } }),
        paramsFor(flowPublicadoId),
      );
      const jsonVersion = await resVersion.json();
      versionPublicadaId = jsonVersion.version.id;

      await publishPOST(
        req("POST", `${BASE_URL}/${flowPublicadoId}/publish`, { token: adminA.token, body: { versionId: versionPublicadaId } }),
        paramsFor(flowPublicadoId),
      );

      // Flow en draft (tenant A, nunca publicado).
      const resDraft = await flowsPOST(
        req("POST", BASE_URL, { token: adminA.token, body: { slug: `f4-draft-${sufijo}`, name: "F4 draft" } }),
      );
      const jsonDraft = await resDraft.json();
      flowDraftId = jsonDraft.flow.id;

      // Flow publicado de tenant B (para el caso cross-tenant).
      const resCrearB = await flowsPOST(
        req("POST", BASE_URL, { token: adminB.token, body: { slug: `f4-tenant-b-${sufijo}`, name: "F4 tenant B" } }),
      );
      const jsonCrearB = await resCrearB.json();
      flowTenantBId = jsonCrearB.flow.id;
      const resVersionB = await versionsPOST(
        req("POST", `${BASE_URL}/${flowTenantBId}/versions`, { token: adminB.token, body: { definition: flowValido("F4 tenant B") } }),
        paramsFor(flowTenantBId),
      );
      const jsonVersionB = await resVersionB.json();
      await publishPOST(
        req("POST", `${BASE_URL}/${flowTenantBId}/publish`, { token: adminB.token, body: { versionId: jsonVersionB.version.id } }),
        paramsFor(flowTenantBId),
      );
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
      for (const u of [adminA, agenteA, adminB]) {
        if (u) await admin.auth.admin.deleteUser(u.id);
      }
    });

    // -----------------------------------------------------------------
    // 1. Activación válida
    // -----------------------------------------------------------------
    describe("Activación válida", () => {
      it("agente -> 403 (solo admin)", async () => {
        const res = await activatePOST(
          req("POST", `${BASE_URL}/${flowPublicadoId}/activate`, { token: agenteA.token, body: { phoneNumberId: PHONE_A1 } }),
          paramsFor(flowPublicadoId),
        );
        assert.equal(res.status, 403);
      });

      it("sin token -> 401", async () => {
        const res = await activatePOST(
          req("POST", `${BASE_URL}/${flowPublicadoId}/activate`, { noAuth: true, body: { phoneNumberId: PHONE_A1 } }),
          paramsFor(flowPublicadoId),
        );
        assert.equal(res.status, 401);
      });

      it("sin phoneNumberId -> 400", async () => {
        const res = await activatePOST(req("POST", `${BASE_URL}/${flowPublicadoId}/activate`, { token: adminA.token, body: {} }), paramsFor(flowPublicadoId));
        assert.equal(res.status, 400);
      });

      it("admin, Flow publicado, número propio -> 200, flow_activo=true y flow_id correctos", async () => {
        const res = await activatePOST(
          req("POST", `${BASE_URL}/${flowPublicadoId}/activate`, { token: adminA.token, body: { phoneNumberId: PHONE_A1 } }),
          paramsFor(flowPublicadoId),
        );
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.negocio.flow_activo, true);
        assert.equal(json.negocio.flow_id, flowPublicadoId);
        assert.equal(json.negocio.phone_number_id, PHONE_A1);

        const { data } = await admin.from("dulabs_clientes_config").select("flow_activo, flow_id").eq("phone_number_id", PHONE_A1).maybeSingle();
        assert.equal(data!.flow_activo, true);
        assert.equal(data!.flow_id, flowPublicadoId);
      });

      it("activar el MISMO Flow en un SEGUNDO número del mismo tenant -> 200 (no hay límite de 1 número por Flow)", async () => {
        const res = await activatePOST(
          req("POST", `${BASE_URL}/${flowPublicadoId}/activate`, { token: adminA.token, body: { phoneNumberId: PHONE_A2 } }),
          paramsFor(flowPublicadoId),
        );
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.negocio.flow_activo, true);
        assert.equal(json.negocio.phone_number_id, PHONE_A2);
      });
    });

    // -----------------------------------------------------------------
    // 2. Rechazo de Flow no publicado
    // -----------------------------------------------------------------
    describe("Rechazo de Flow no publicado", () => {
      it("Flow en draft -> 409, no toca dulabs_clientes_config", async () => {
        const res = await activatePOST(
          req("POST", `${BASE_URL}/${flowDraftId}/activate`, { token: adminA.token, body: { phoneNumberId: PHONE_A1 } }),
          paramsFor(flowDraftId),
        );
        assert.equal(res.status, 409);

        const { data } = await admin.from("dulabs_clientes_config").select("flow_id").eq("phone_number_id", PHONE_A1).maybeSingle();
        assert.equal(data!.flow_id, flowPublicadoId, "debe seguir apuntando al Flow publicado, no al draft");
      });
    });

    // -----------------------------------------------------------------
    // 3. Rechazo cross-tenant (Flow de otro tenant)
    // -----------------------------------------------------------------
    describe("Rechazo cross-tenant", () => {
      it("admin A intentando activar un Flow de tenant B -> 404 (no revela existencia)", async () => {
        const res = await activatePOST(
          req("POST", `${BASE_URL}/${flowTenantBId}/activate`, { token: adminA.token, body: { phoneNumberId: PHONE_A1 } }),
          paramsFor(flowTenantBId),
        );
        assert.equal(res.status, 404);
      });

      it("el número de tenant A no quedó tocado por el intento cross-tenant", async () => {
        const { data } = await admin.from("dulabs_clientes_config").select("flow_id").eq("phone_number_id", PHONE_A1).maybeSingle();
        assert.equal(data!.flow_id, flowPublicadoId);
      });
    });

    // -----------------------------------------------------------------
    // 4. Rechazo de phone_number_id ajeno
    // -----------------------------------------------------------------
    describe("Rechazo de phone_number_id ajeno", () => {
      it("admin A intentando activar su propio Flow en un número de tenant B -> 404", async () => {
        const res = await activatePOST(
          req("POST", `${BASE_URL}/${flowPublicadoId}/activate`, { token: adminA.token, body: { phoneNumberId: PHONE_B1 } }),
          paramsFor(flowPublicadoId),
        );
        assert.equal(res.status, 404);
      });

      it("el número de tenant B no quedó tocado por el intento", async () => {
        const { data } = await admin.from("dulabs_clientes_config").select("flow_activo, flow_id").eq("phone_number_id", PHONE_B1).maybeSingle();
        assert.equal(data!.flow_activo, false);
        assert.equal(data!.flow_id, null);
      });

      it("phone_number_id que no existe en absoluto -> 404", async () => {
        const res = await activatePOST(
          req("POST", `${BASE_URL}/${flowPublicadoId}/activate`, { token: adminA.token, body: { phoneNumberId: PHONE_INEXISTENTE } }),
          paramsFor(flowPublicadoId),
        );
        assert.equal(res.status, 404);
      });
    });

    // -----------------------------------------------------------------
    // 5. Desactivación
    // -----------------------------------------------------------------
    describe("Desactivación", () => {
      it("agente -> 403 (solo admin)", async () => {
        const res = await deactivatePOST(
          req("POST", `${BASE_URL}/${flowPublicadoId}/deactivate`, { token: agenteA.token, body: { phoneNumberId: PHONE_A1 } }),
          paramsFor(flowPublicadoId),
        );
        assert.equal(res.status, 403);
      });

      it("desactivar un Flow que NO es el activo en ese número -> 409", async () => {
        const res = await deactivatePOST(
          req("POST", `${BASE_URL}/${flowDraftId}/deactivate`, { token: adminA.token, body: { phoneNumberId: PHONE_A1 } }),
          paramsFor(flowDraftId),
        );
        assert.equal(res.status, 409);
      });

      it("admin, Flow activo en ese número -> 200, flow_activo=false Y flow_id=null (CHECK preexistente exige ambos juntos)", async () => {
        const res = await deactivatePOST(
          req("POST", `${BASE_URL}/${flowPublicadoId}/deactivate`, { token: adminA.token, body: { phoneNumberId: PHONE_A1 } }),
          paramsFor(flowPublicadoId),
        );
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.negocio.flow_activo, false);
        assert.equal(json.negocio.flow_id, null);

        const { data } = await admin.from("dulabs_clientes_config").select("flow_activo, flow_id").eq("phone_number_id", PHONE_A1).maybeSingle();
        assert.equal(data!.flow_activo, false);
        assert.equal(data!.flow_id, null);
      });

      it("PHONE_A2 (el segundo número, nunca desactivado) sigue activo -- confirma que desactivar A1 no afectó a A2", async () => {
        const { data } = await admin.from("dulabs_clientes_config").select("flow_activo, flow_id").eq("phone_number_id", PHONE_A2).maybeSingle();
        assert.equal(data!.flow_activo, true);
        assert.equal(data!.flow_id, flowPublicadoId);
      });

      it("phone_number_id ajeno en deactivate -> 404", async () => {
        const res = await deactivatePOST(
          req("POST", `${BASE_URL}/${flowPublicadoId}/deactivate`, { token: adminA.token, body: { phoneNumberId: PHONE_B1 } }),
          paramsFor(flowPublicadoId),
        );
        assert.equal(res.status, 404);
      });
    });

    // -----------------------------------------------------------------
    // 6. Aislamiento de datos (cierre): estado final exacto esperado por tenant
    // -----------------------------------------------------------------
    describe("Aislamiento de datos", () => {
      it("estado final: A1 inactivo, A2 activo, B1 intacto -- ninguna operación sobre un tenant afectó al otro", async () => {
        const { data: filaA1 } = await admin.from("dulabs_clientes_config").select("flow_activo, flow_id, id_tenant").eq("phone_number_id", PHONE_A1).maybeSingle();
        assert.equal(filaA1!.id_tenant, TENANT_A);
        assert.equal(filaA1!.flow_activo, false);

        const { data: filaA2 } = await admin.from("dulabs_clientes_config").select("flow_activo, flow_id, id_tenant").eq("phone_number_id", PHONE_A2).maybeSingle();
        assert.equal(filaA2!.id_tenant, TENANT_A);
        assert.equal(filaA2!.flow_activo, true);
        assert.equal(filaA2!.flow_id, flowPublicadoId);

        const { data: filaB1 } = await admin.from("dulabs_clientes_config").select("flow_activo, flow_id, id_tenant").eq("phone_number_id", PHONE_B1).maybeSingle();
        assert.equal(filaB1!.id_tenant, TENANT_B);
        assert.equal(filaB1!.flow_activo, false);
        assert.equal(filaB1!.flow_id, null);
      });

      it("el Flow de tenant B nunca fue tocado por ninguna operación de tenant A (sigue published, sin cambios)", async () => {
        const { data } = await admin.from("dulabs_flows").select("status, tenant_id").eq("id", flowTenantBId).maybeSingle();
        assert.equal(data!.tenant_id, TENANT_B);
        assert.equal(data!.status, "published");
      });
    });
  },
);
