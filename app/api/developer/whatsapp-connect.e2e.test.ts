/**
 * DuLabs Developer V1 -- Fase 10. E2E real contra Postgres del onboarding de
 * WhatsApp: POST /api/developer/whatsapp/connect y DELETE /api/developer/
 * numbers/[id]. Cubre auth por rol, aislamiento cross-tenant, límite F7,
 * idempotencia/reconexión, token nunca expuesto, y disconnect local.
 *
 * Las llamadas a Meta se interceptan por HOSTNAME (graph.facebook.com) con un
 * shim de globalThis.fetch -- TODO lo demás (Supabase) pasa al fetch real.
 * NUNCA se envía ningún WhatsApp ni se toca Meta de verdad. Solo toca tablas
 * dulabs_dev_* (greenfield) + usuarios de Auth desechables que borra al final.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { crearClienteDePruebaComoSesion } from "@/lib/test-helpers/sesion-prueba";
import { crearMiembro, type RolDev } from "@/lib/developer/memberships-store";
import { obtenerNumeroParaEnvioMeta } from "@/lib/developer/whatsapp-numbers-store";
import { POST as connectPOST } from "@/app/api/developer/whatsapp/connect/route";
import { DELETE as numberDELETE } from "@/app/api/developer/numbers/[id]/route";
import { GET as numbersGET } from "@/app/api/developer/numbers/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// Estado del Meta stub -- el test lo ajusta antes de cada connect.
let metaWabaId = "WABA-TEST";
let metaPhoneId = "PN-TEST";
const fetchOriginal = globalThis.fetch;

function instalarStubMeta() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("graph.facebook.com")) {
      if (url.includes("/oauth/access_token")) return json({ access_token: "META-PERM-TOKEN-SECRETO" });
      if (url.includes("/debug_token")) return json({ data: { granular_scopes: [{ scope: "whatsapp_business_management", target_ids: [metaWabaId] }] } });
      if (url.includes("/phone_numbers")) return json({ data: [{ id: metaPhoneId, display_phone_number: "+57 300 000 0000", verified_name: "Negocio Test" }] });
      if (url.includes("/subscribed_apps")) return json({ success: true });
      if (url.includes("fields=name")) return json({ name: "Negocio Test" });
      return json({});
    }
    return fetchOriginal(input as RequestInfo, init);
  }) as typeof fetch;
}

function json(obj: unknown): Response {
  return { ok: true, status: 200, json: async () => obj } as unknown as Response;
}

function req(path: string, opts: { token?: string; ws?: string; method?: string; body?: unknown } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.ws) headers["x-dulabs-workspace"] = opts.ws;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, { method: opts.method ?? "POST", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
}

describe(
  "DuLabs Developer V1 — onboarding WhatsApp real contra Postgres (Fase 10)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const userIds: string[] = [];
    const workspaceIds: string[] = [];

    const claveOriginal = process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    const appIdOriginal = process.env.NEXT_PUBLIC_META_APP_ID;
    const appSecretOriginal = process.env.META_APP_SECRET;

    before(() => {
      process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
      process.env.NEXT_PUBLIC_META_APP_ID = "TEST-APP-ID";
      process.env.META_APP_SECRET = "TEST-APP-SECRET";
      instalarStubMeta();
    });

    after(() => {
      globalThis.fetch = fetchOriginal;
      const restaurar = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
      restaurar("DEVELOPER_TOKEN_ENCRYPTION_KEY", claveOriginal);
      restaurar("NEXT_PUBLIC_META_APP_ID", appIdOriginal);
      restaurar("META_APP_SECRET", appSecretOriginal);
    });

    after(async () => {
      for (const ws of workspaceIds) {
        for (const t of ["dulabs_dev_whatsapp_numbers", "dulabs_dev_memberships"]) {
          await admin.from(t).delete().eq("workspace_id", ws).then(() => {}, () => {});
        }
      }
      for (const id of userIds) await admin.auth.admin.deleteUser(id).then(() => {}, () => {});
    });

    async function usuario(rolEnWs: RolDev | null, ws: string): Promise<{ userId: string; token: string }> {
      const email = `f10-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const password = `F10Test-${randomUUID()}`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw error ?? new Error("no user");
      userIds.push(data.user.id);
      if (rolEnWs) await crearMiembro(admin, { workspaceId: ws, userId: data.user.id, rol: rolEnWs });
      const sesion = crearClienteDePruebaComoSesion();
      const signIn = await sesion.auth.signInWithPassword({ email, password });
      if (signIn.error || !signIn.data.session) throw signIn.error ?? new Error("no session");
      return { userId: data.user.id, token: signIn.data.session.access_token };
    }
    const bodyDe = async (res: Response) => (await res.json()) as Record<string, unknown>;

    it("sin token de sesión -> 401", async () => {
      const res = await connectPOST(req("/api/developer/whatsapp/connect", { body: { code: "C" } }));
      assert.equal(res.status, 401);
    });

    it("falta 'code' -> 400", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      const res = await connectPOST(req("/api/developer/whatsapp/connect", { token: owner.token, ws, body: {} }));
      assert.equal(res.status, 400);
    });

    it("MEMBER no puede conectar -> 403", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const member = await usuario("MEMBER", ws);
      const res = await connectPOST(req("/api/developer/whatsapp/connect", { token: member.token, ws, body: { code: "C", wabaId: "W", phoneNumberId: "P" } }));
      assert.equal(res.status, 403);
    });

    it("ADMIN conecta un número: 201, estado conectado, y la respuesta NUNCA trae el token", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const adminU = await usuario("ADMIN", ws);
      metaWabaId = `WABA-${randomUUID()}`;
      metaPhoneId = `PN-${randomUUID()}`;
      const res = await connectPOST(req("/api/developer/whatsapp/connect", { token: adminU.token, ws, body: { code: "C", wabaId: metaWabaId, phoneNumberId: metaPhoneId } }));
      assert.equal(res.status, 201);
      const b = await bodyDe(res);
      assert.equal(b.status, "conectado");
      assert.equal(b.phoneNumberId, metaPhoneId);
      const crudo = JSON.stringify(b);
      assert.ok(!crudo.includes("META-PERM-TOKEN-SECRETO"), "el token de Meta jamás debe aparecer en la respuesta");
      assert.equal(b.metaToken, undefined);
    });

    it("idempotencia: reconectar el mismo phone_number_id -> 200 reconnected, sin duplicar fila", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      metaWabaId = `WABA-${randomUUID()}`;
      metaPhoneId = `PN-${randomUUID()}`;
      const r1 = await connectPOST(req("/api/developer/whatsapp/connect", { token: owner.token, ws, body: { code: "C", wabaId: metaWabaId, phoneNumberId: metaPhoneId } }));
      assert.equal(r1.status, 201);
      const r2 = await connectPOST(req("/api/developer/whatsapp/connect", { token: owner.token, ws, body: { code: "C2", wabaId: metaWabaId, phoneNumberId: metaPhoneId } }));
      assert.equal(r2.status, 200);
      assert.equal((await bodyDe(r2)).reconnected, true);
      const lista = await numbersGET(req("/api/developer/numbers", { token: owner.token, ws, method: "GET" }));
      const nums = (await bodyDe(lista)).numbers as unknown[];
      assert.equal(nums.filter((n) => (n as { phoneNumberId: string }).phoneNumberId === metaPhoneId).length, 1);
    });

    it("límite F7 (DEVELOPER=2): el tercer número NUEVO se rechaza con 403 number_limit_exceeded", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      for (let i = 0; i < 2; i++) {
        metaWabaId = `WABA-${randomUUID()}`;
        metaPhoneId = `PN-${randomUUID()}`;
        const r = await connectPOST(req("/api/developer/whatsapp/connect", { token: owner.token, ws, body: { code: "C", wabaId: metaWabaId, phoneNumberId: metaPhoneId } }));
        assert.equal(r.status, 201);
      }
      metaWabaId = `WABA-${randomUUID()}`;
      metaPhoneId = `PN-${randomUUID()}`;
      const tercero = await connectPOST(req("/api/developer/whatsapp/connect", { token: owner.token, ws, body: { code: "C", wabaId: metaWabaId, phoneNumberId: metaPhoneId } }));
      assert.equal(tercero.status, 403);
      assert.equal(((await bodyDe(tercero)).error as { code: string }).code, "number_limit_exceeded");
    });

    it("cross-tenant: un número ya conectado a otro workspace -> 409 (nunca lo reclama)", async () => {
      const wsA = randomUUID();
      const wsB = randomUUID();
      workspaceIds.push(wsA, wsB);
      const ownerA = await usuario("OWNER", wsA);
      const ownerB = await usuario("OWNER", wsB);
      metaWabaId = `WABA-${randomUUID()}`;
      metaPhoneId = `PN-SHARED-${randomUUID()}`;
      const enB = await connectPOST(req("/api/developer/whatsapp/connect", { token: ownerB.token, ws: wsB, body: { code: "C", wabaId: metaWabaId, phoneNumberId: metaPhoneId } }));
      assert.equal(enB.status, 201);
      const enA = await connectPOST(req("/api/developer/whatsapp/connect", { token: ownerA.token, ws: wsA, body: { code: "C", wabaId: metaWabaId, phoneNumberId: metaPhoneId } }));
      assert.equal(enA.status, 409);
      assert.equal(((await bodyDe(enA)).error as { code: string }).code, "number_already_connected");
    });

    it("disconnect: OWNER desconecta -> estado desconectado y el token queda borrado (no se puede enviar)", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      metaWabaId = `WABA-${randomUUID()}`;
      metaPhoneId = `PN-${randomUUID()}`;
      const creado = await connectPOST(req("/api/developer/whatsapp/connect", { token: owner.token, ws, body: { code: "C", wabaId: metaWabaId, phoneNumberId: metaPhoneId } }));
      const id = (await bodyDe(creado)).id as string;
      assert.ok(await obtenerNumeroParaEnvioMeta(admin, { workspaceId: ws, numeroId: id }), "antes de desconectar sí puede enviar");
      const del = await numberDELETE(req(`/api/developer/numbers/${id}`, { token: owner.token, ws, method: "DELETE" }), { params: Promise.resolve({ id }) });
      assert.equal(del.status, 200);
      assert.equal((await bodyDe(del)).status, "desconectado");
      assert.equal(await obtenerNumeroParaEnvioMeta(admin, { workspaceId: ws, numeroId: id }), null, "tras desconectar, sin token -> no puede enviar");
    });

    it("disconnect: MEMBER -> 403; número de otro workspace -> 404", async () => {
      const ws = randomUUID();
      const wsOtro = randomUUID();
      workspaceIds.push(ws, wsOtro);
      const owner = await usuario("OWNER", ws);
      const member = await usuario("MEMBER", ws);
      metaWabaId = `WABA-${randomUUID()}`;
      metaPhoneId = `PN-${randomUUID()}`;
      const creado = await connectPOST(req("/api/developer/whatsapp/connect", { token: owner.token, ws, body: { code: "C", wabaId: metaWabaId, phoneNumberId: metaPhoneId } }));
      const id = (await bodyDe(creado)).id as string;
      const porMember = await numberDELETE(req(`/api/developer/numbers/${id}`, { token: member.token, ws, method: "DELETE" }), { params: Promise.resolve({ id }) });
      assert.equal(porMember.status, 403);
      const ownerOtro = await usuario("OWNER", wsOtro);
      const cruzado = await numberDELETE(req(`/api/developer/numbers/${id}`, { token: ownerOtro.token, ws: wsOtro, method: "DELETE" }), { params: Promise.resolve({ id }) });
      assert.equal(cruzado.status, 404);
    });
  }
);
