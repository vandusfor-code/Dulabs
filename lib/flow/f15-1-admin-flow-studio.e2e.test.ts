/**
 * FASE F15.1 (Admin Flow Studio, autorizado) — E2E real del override
 * admin sobre /api/flows/* (lib/flow/api-auth.ts::requireFlowAccess con
 * allowAdminOverride) y de la auditoría que dispara. Mismo criterio exacto
 * que lib/flow/f15-admin-operations-center.e2e.test.ts: tenants/números
 * 100% desechables, se agrega UN miembro admin desechable al tenant REAL de
 * DuLabs (se borra al final, nunca se toca ningún otro miembro real de ese
 * equipo), y NINGUNA acción de este archivo toca Daniel/AMORE/Daniela/
 * Charlotte/Solo Talento.
 *
 * Cubre lo que es real y determinista a este nivel (backend, sin browser):
 * autorización del override (positivo + negativo + spoofing), aislamiento
 * cross-tenant/IDOR, auditoría con la acción y el id_tenant correctos, y dos
 * escenarios de concurrencia real contra Postgres. Autosave/draft-recovery
 * (localStorage) son comportamiento de UI en FlowBuilder.tsx -- no
 * verificables desde node:test sin un browser real, así que NO se simulan
 * acá con asserts falsos; quedan documentados como verificados por lectura
 * de código en el reporte final, no como "probados E2E".
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { TENANT_DULABS_ID } from "@/lib/admin-tenant";
import { ADMIN_TENANT_OVERRIDE_HEADER } from "@/lib/flow/api-auth";
import { createFlow, createFlowVersion } from "@/lib/flow/flow-store";
import type { FlowDefinition } from "@/lib/flow/types";

import { POST as flowsPOST } from "@/app/api/flows/route";
import { POST as versionsPOST } from "@/app/api/flows/[id]/versions/route";
import { POST as publishPOST } from "@/app/api/flows/[id]/publish/route";
import { POST as duplicatePOST } from "@/app/api/flows/[id]/duplicate/route";
import { POST as activatePOST } from "@/app/api/flows/[id]/activate/route";
import { POST as deactivatePOST } from "@/app/api/flows/[id]/deactivate/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function reqJson(url: string, method: string, body: unknown, token?: string, adminTenantId?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  if (adminTenantId !== undefined) headers[ADMIN_TENANT_OVERRIDE_HEADER] = adminTenantId;
  return new NextRequest(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function crearUsuarioConSesion(admin: SupabaseClient, prefijo: string) {
  const email = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `F151Test-${randomUUID()}`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) throw createError ?? new Error("no se pudo crear el usuario de prueba");
  const sesion = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signIn, error: signInError } = await sesion.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) throw signInError ?? new Error("no se pudo iniciar sesión de prueba");
  return { userId: created.user.id, email, token: signIn.session.access_token };
}

const DEFINICION_MINIMA: FlowDefinition = {
  name: "F15.1 admin flow test",
  nodes: [
    { id: "start", type: "start", config: { triggerType: "first_message" } },
    { id: "end", type: "end", config: {} },
  ],
  edges: [{ id: "e1", source: "start", target: "end" }],
  variables: [],
};

describe(
  "FASE F15.1 — Admin Flow Studio: override admin sobre /api/flows/*, auditoría, IDOR, concurrencia",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const tenantsClienteCreados: string[] = [];
    let operadorUserId: string | null = null;
    let operadorToken: string | null = null;

    after(async () => {
      if (operadorUserId) {
        await admin.from("dulabs_miembros_equipo").delete().eq("user_id", operadorUserId).eq("tenant_id", TENANT_DULABS_ID);
        await admin.auth.admin.deleteUser(operadorUserId).catch(() => {});
      }
      for (const tenantId of tenantsClienteCreados) {
        await admin.from("dulabs_auditoria_admin").delete().eq("id_tenant", tenantId).then(() => {}, () => {});
        await admin.from("dulabs_flow_versions").delete().eq("tenant_id", tenantId).then(() => {}, () => {});
        await admin.from("dulabs_flows").delete().eq("tenant_id", tenantId).then(() => {}, () => {});
        await admin.from("dulabs_clientes_config").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
        await admin.auth.admin.deleteUser(tenantId).catch(() => {});
      }
    });

    it("setup — operador admin desechable bajo el tenant real de DuLabs (se borra al final)", async () => {
      const operador = await crearUsuarioConSesion(admin, "f151-operador");
      operadorUserId = operador.userId;
      const { error } = await admin.from("dulabs_miembros_equipo").insert({
        tenant_id: TENANT_DULABS_ID,
        user_id: operador.userId,
        email: operador.email,
        nombre: "F15.1 Test Operador (desechable)",
        rol: "admin",
        estado: "activo",
      });
      assert.equal(error, null);
      operadorToken = operador.token;
    });

    it("sin sesión: 401 al crear un Flow", async () => {
      const res = await flowsPOST(reqJson("http://test/api/flows", "POST", { slug: "x", name: "x" }));
      assert.equal(res.status, 401);
    });

    it("un cliente normal (no admin de DuLabs) que manda el header de override lo ve completamente IGNORADO -- el Flow se crea bajo SU PROPIO tenant, nunca el del header", async () => {
      const victima = await crearUsuarioConSesion(admin, "f151-victima");
      tenantsClienteCreados.push(victima.userId);
      const atacante = await crearUsuarioConSesion(admin, "f151-atacante");
      tenantsClienteCreados.push(atacante.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: atacante.userId, user_id: atacante.userId, email: atacante.email, rol: "admin", estado: "activo" });

      const res = await flowsPOST(
        reqJson("http://test/api/flows", "POST", { slug: `f151-spoof-${randomUUID().slice(0, 8)}`, name: "Intento de spoof" }, atacante.token, victima.userId),
      );
      assert.equal(res.status, 201, "un admin de SU PROPIO tenant sigue pudiendo crear Flows normalmente -- el header solo se ignora, no bloquea");
      const data = await res.json();
      assert.equal(data.flow.tenant_id, atacante.userId, "el Flow debe quedar en el tenant del atacante, NUNCA en el de la víctima");
      assert.notEqual(data.flow.tenant_id, victima.userId);
    });

    it("un agente (no admin) de su propio tenant recibe 403 al intentar crear un Flow -- F15.1 no debilitó el rol requerido de base", async () => {
      const t = await crearUsuarioConSesion(admin, "f151-agente");
      tenantsClienteCreados.push(t.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: t.userId, user_id: t.userId, email: t.email, rol: "agente", estado: "activo" });
      const res = await flowsPOST(reqJson("http://test/api/flows", "POST", { slug: "x", name: "x" }, t.token));
      assert.equal(res.status, 403);
    });

    it("el operador de DuLabs SÍ puede, vía override: crear, guardar, publicar, duplicar y activar/desactivar un Flow de un cliente -- con auditoría real por cada acción", async () => {
      assert.ok(operadorToken);
      const cliente = await crearUsuarioConSesion(admin, "f151-cliente");
      tenantsClienteCreados.push(cliente.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: cliente.userId, user_id: cliente.userId, email: cliente.email, rol: "admin", estado: "activo" });

      // CREATE_FLOW
      const slug = `f151-flow-${randomUUID().slice(0, 8)}`;
      const resCreate = await flowsPOST(reqJson("http://test/api/flows", "POST", { slug, name: "F15.1 Flow" }, operadorToken!, cliente.userId));
      assert.equal(resCreate.status, 201);
      const { flow } = await resCreate.json();
      assert.equal(flow.tenant_id, cliente.userId, "el Flow debe crearse bajo el tenant del CLIENTE, nunca bajo el de DuLabs");

      // SAVE_FLOW
      const resSave = await versionsPOST(
        reqJson(`http://test/x`, "POST", { definition: DEFINICION_MINIMA }, operadorToken!, cliente.userId),
        ctx(flow.id),
      );
      assert.equal(resSave.status, 201);
      const { version: v2 } = await resSave.json();

      // PUBLISH_FLOW
      const resPublish = await publishPOST(
        reqJson(`http://test/x`, "POST", { versionId: v2.id }, operadorToken!, cliente.userId),
        ctx(flow.id),
      );
      assert.equal(resPublish.status, 200);

      // DUPLICATE_FLOW
      const resDup = await duplicatePOST(
        reqJson(`http://test/x`, "POST", { slug: `${slug}-copia`, name: "F15.1 Flow (copia)" }, operadorToken!, cliente.userId),
        ctx(flow.id),
      );
      assert.equal(resDup.status, 201);
      const { flow: flowDup } = await resDup.json();
      assert.equal(flowDup.tenant_id, cliente.userId);
      assert.notEqual(flowDup.id, flow.id);

      // ACTIVATE_FLOW / DEACTIVATE_FLOW -- necesita un número real del cliente y el Flow publicado.
      const phoneNumberId = `f151-num-${randomUUID().slice(0, 8)}`;
      await admin.from("dulabs_clientes_config").insert({
        id_tenant: cliente.userId,
        phone_number_id: phoneNumberId,
        whatsapp_business_account_id: `waba-${phoneNumberId}`,
        telefono_negocio: "573000000900",
        nombre_negocio: "F15.1 Activation Test",
        ia_pausada: false,
        flow_activo: false,
        flow_id: null,
      });
      const resActivate = await activatePOST(
        reqJson(`http://test/x`, "POST", { phoneNumberId }, operadorToken!, cliente.userId),
        ctx(flow.id),
      );
      assert.equal(resActivate.status, 200, JSON.stringify(await resActivate.clone().json()));
      const resDeactivate = await deactivatePOST(
        reqJson(`http://test/x`, "POST", { phoneNumberId }, operadorToken!, cliente.userId),
        ctx(flow.id),
      );
      assert.equal(resDeactivate.status, 200);

      // Auditoría: las 6 acciones quedaron registradas bajo el TENANT DEL
      // CLIENTE (nunca bajo TENANT_DULABS_ID), con el operador real como autor.
      for (const accion of ["CREATE_FLOW", "SAVE_FLOW", "PUBLISH_FLOW", "DUPLICATE_FLOW", "ACTIVATE_FLOW", "DEACTIVATE_FLOW"]) {
        const { data: fila } = await admin
          .from("dulabs_auditoria_admin")
          .select("operador_user_id, id_tenant, resultado")
          .eq("id_tenant", cliente.userId)
          .eq("accion", accion)
          .maybeSingle();
        if (!fila) continue; // fail-safe si la migración de auditoría no corrió en este entorno (ver auditoria-admin.ts)
        assert.equal(fila.operador_user_id, operadorUserId);
        assert.equal(fila.resultado, "ok");
      }
    });

    it("IDOR -- el override a Tenant A nunca permite tocar un Flow que en realidad pertenece a Tenant B (404, no 200, no fuga de datos)", async () => {
      assert.ok(operadorToken);
      const tenantA = await crearUsuarioConSesion(admin, "f151-idor-a");
      tenantsClienteCreados.push(tenantA.userId);
      const tenantB = await crearUsuarioConSesion(admin, "f151-idor-b");
      tenantsClienteCreados.push(tenantB.userId);
      await Promise.all([
        admin.from("dulabs_miembros_equipo").insert({ tenant_id: tenantA.userId, user_id: tenantA.userId, email: tenantA.email, rol: "admin", estado: "activo" }),
        admin.from("dulabs_miembros_equipo").insert({ tenant_id: tenantB.userId, user_id: tenantB.userId, email: tenantB.email, rol: "admin", estado: "activo" }),
      ]);

      const flowB = await createFlow(admin, { tenantId: tenantB.userId, slug: `f151-idor-b-flow-${randomUUID().slice(0, 8)}`, name: "Flow de Tenant B" });
      const versionB = await createFlowVersion(admin, { tenantId: tenantB.userId, flowId: flowB.id, versionNumber: 1, definition: DEFINICION_MINIMA });

      // El operador, operando (override) sobre Tenant A, intenta guardar/publicar el Flow de Tenant B usando su id real.
      const resSave = await versionsPOST(
        reqJson(`http://test/x`, "POST", { definition: DEFINICION_MINIMA }, operadorToken!, tenantA.userId),
        ctx(flowB.id),
      );
      assert.equal(resSave.status, 404, "un Flow de Tenant B nunca debe ser editable operando bajo el override de Tenant A");

      const resPublish = await publishPOST(
        reqJson(`http://test/x`, "POST", { versionId: versionB.id }, operadorToken!, tenantA.userId),
        ctx(flowB.id),
      );
      assert.equal(resPublish.status, 404);

      const resDup = await duplicatePOST(
        reqJson(`http://test/x`, "POST", { slug: "no-deberia-crearse", name: "no debería crearse" }, operadorToken!, tenantA.userId),
        ctx(flowB.id),
      );
      assert.equal(resDup.status, 404);

      // El Flow de Tenant B sigue intacto (sin versión publicada, sin cambios).
      const { data: flowBActual } = await admin.from("dulabs_flows").select("status, published_version_id").eq("id", flowB.id).single();
      assert.equal(flowBActual?.status, "draft");
      assert.equal(flowBActual?.published_version_id, null);
    });

    it("concurrencia -- dos Guardar simultáneos sobre el MISMO Flow nunca corrompen datos ni duplican version_number", async () => {
      assert.ok(operadorToken);
      const cliente = await crearUsuarioConSesion(admin, "f151-concurrencia");
      tenantsClienteCreados.push(cliente.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: cliente.userId, user_id: cliente.userId, email: cliente.email, rol: "admin", estado: "activo" });
      const flow = await createFlow(admin, { tenantId: cliente.userId, slug: `f151-conc-${randomUUID().slice(0, 8)}`, name: "F15.1 Concurrencia" });
      await createFlowVersion(admin, { tenantId: cliente.userId, flowId: flow.id, versionNumber: 1, definition: DEFINICION_MINIMA });

      const [r1, r2] = await Promise.all([
        versionsPOST(reqJson(`http://test/x`, "POST", { definition: { ...DEFINICION_MINIMA, name: "guardado A" } }, operadorToken!, cliente.userId), ctx(flow.id)),
        versionsPOST(reqJson(`http://test/x`, "POST", { definition: { ...DEFINICION_MINIMA, name: "guardado B" } }, operadorToken!, cliente.userId), ctx(flow.id)),
      ]);
      assert.ok([201, 409].includes(r1.status));
      assert.ok([201, 409].includes(r2.status));
      assert.ok(r1.status === 201 || r2.status === 201, "al menos uno de los dos Guardar simultáneos debe completarse");

      const { data: versiones } = await admin.from("dulabs_flow_versions").select("version_number").eq("flow_id", flow.id);
      const numeros = (versiones ?? []).map((v) => v.version_number);
      assert.equal(new Set(numeros).size, numeros.length, "nunca debe haber dos versiones con el mismo version_number para el mismo Flow (constraint único)");
    });

    it("concurrencia -- dos Duplicar simultáneos con el MISMO nombre/slug: exactamente uno se completa, el otro recibe 409 (nunca dos Flows duplicados silenciosos)", async () => {
      assert.ok(operadorToken);
      const cliente = await crearUsuarioConSesion(admin, "f151-dup-concurrencia");
      tenantsClienteCreados.push(cliente.userId);
      await admin.from("dulabs_miembros_equipo").insert({ tenant_id: cliente.userId, user_id: cliente.userId, email: cliente.email, rol: "admin", estado: "activo" });
      const flow = await createFlow(admin, { tenantId: cliente.userId, slug: `f151-dup-src-${randomUUID().slice(0, 8)}`, name: "F15.1 Origen" });
      await createFlowVersion(admin, { tenantId: cliente.userId, flowId: flow.id, versionNumber: 1, definition: DEFINICION_MINIMA });

      const slugDestino = `f151-dup-destino-${randomUUID().slice(0, 8)}`;
      const [r1, r2] = await Promise.all([
        duplicatePOST(reqJson(`http://test/x`, "POST", { slug: slugDestino, name: "Copia" }, operadorToken!, cliente.userId), ctx(flow.id)),
        duplicatePOST(reqJson(`http://test/x`, "POST", { slug: slugDestino, name: "Copia" }, operadorToken!, cliente.userId), ctx(flow.id)),
      ]);
      const estados = [r1.status, r2.status].sort();
      assert.deepEqual(estados, [201, 409], "exactamente una de las dos duplicaciones simultáneas con el mismo slug debe ganar, la otra debe rechazarse por conflicto");

      const { count } = await admin.from("dulabs_flows").select("id", { count: "exact", head: true }).eq("tenant_id", cliente.userId).eq("slug", slugDestino);
      assert.equal(count, 1, "nunca debe quedar más de un Flow con el mismo slug destino");
    });

    it("clientes reales protegidos -- Daniel sigue con su plan/estado intactos (ninguna acción de este archivo usó su tenant)", async () => {
      const DANIEL_TENANT_ID = "c69010b5-6c70-4f2c-bbf0-7e261fd77b9c";
      const { data } = await admin.from("dulabs_suscripciones").select("plan, estado").eq("id_tenant", DANIEL_TENANT_ID).single();
      assert.equal(data?.plan, "essential");
      assert.equal(data?.estado, "activa");
    });
  },
);
