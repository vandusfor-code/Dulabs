/**
 * DuLabs Developer V1 -- Fase 9 (autorizado). E2E real contra Postgres de las
 * rutas Next del Dashboard (app/api/developer/*): auth de sesión, selección de
 * workspace (X-Dulabs-Workspace), autorización por rol (D4), aislamiento
 * cross-tenant, secretos mostrados una sola vez y proyecciones sin secretos.
 *
 * Se invocan los route handlers reales con NextRequest. Sesiones reales
 * (JWT) vía sesion-prueba. REQUIERE migraciones Fase 2/7/8 aplicadas.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { crearClienteDePruebaComoSesion } from "@/lib/test-helpers/sesion-prueba";
import { crearMiembro, type RolDev } from "@/lib/developer/memberships-store";
import { crearApiKey } from "@/lib/developer/api-keys-store";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";

import { GET as workspaceGET } from "@/app/api/developer/workspace/route";
import { GET as usageGET } from "@/app/api/developer/usage/route";
import { GET as apiKeysGET, POST as apiKeysPOST } from "@/app/api/developer/api-keys/route";
import { DELETE as apiKeyDELETE } from "@/app/api/developer/api-keys/[id]/route";
import { POST as apiKeyROTATE } from "@/app/api/developer/api-keys/[id]/rotate/route";
import { GET as numbersGET } from "@/app/api/developer/numbers/route";
import { GET as webhooksGET } from "@/app/api/developer/webhooks/route";
import { POST as membersPOST } from "@/app/api/developer/members/route";
import { PATCH as memberPATCH, DELETE as memberDELETE } from "@/app/api/developer/members/[id]/route";
import { GET as jobsGET } from "@/app/api/developer/jobs/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function req(path: string, opts: { token?: string; ws?: string; method?: string; body?: unknown } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.ws) headers["x-dulabs-workspace"] = opts.ws;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, { method: opts.method ?? "GET", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
}

describe(
  "DuLabs Developer V1 — rutas Next del Dashboard real contra Postgres (Fase 9)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const userIds: string[] = [];
    const workspaceIds: string[] = [];

    // Clave de cifrado de prueba (mismo patrón que whatsapp-numbers-store.e2e):
    // permite sembrar un número con token de Meta para probar que la proyección
    // NUNCA lo expone. secure-crypto lee la env en cada llamada.
    const claveOriginal = process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    before(() => {
      process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    });
    after(() => {
      if (claveOriginal === undefined) delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
      else process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveOriginal;
    });

    after(async () => {
      for (const ws of workspaceIds) {
        for (const t of ["dulabs_dev_usage_ledger", "dulabs_dev_jobs", "dulabs_dev_idempotency_keys", "dulabs_dev_webhook_configs", "dulabs_dev_api_keys", "dulabs_dev_whatsapp_numbers", "dulabs_dev_memberships"]) {
          await admin.from(t).delete().eq("workspace_id", ws).then(() => {}, () => {});
        }
      }
      for (const id of userIds) await admin.auth.admin.deleteUser(id).then(() => {}, () => {});
    });

    async function usuario(rolEnWs: RolDev | null, ws: string): Promise<{ userId: string; token: string }> {
      const email = `f9-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const password = `F9Test-${randomUUID()}`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw error ?? new Error("no user");
      userIds.push(data.user.id);
      if (rolEnWs) await crearMiembro(admin, { workspaceId: ws, userId: data.user.id, rol: rolEnWs });
      const sesion = crearClienteDePruebaComoSesion();
      const signIn = await sesion.auth.signInWithPassword({ email, password });
      if (signIn.error || !signIn.data.session) throw signIn.error ?? new Error("no session");
      return { userId: data.user.id, token: signIn.data.session.access_token };
    }

    async function body(res: Response): Promise<Record<string, unknown>> {
      return (await res.json()) as Record<string, unknown>;
    }

    // ---- Auth / workspace selection ----
    it("Test 2/23 -- sin token de sesión -> 401", async () => {
      const res = await apiKeysGET(req("/api/developer/api-keys"));
      assert.equal(res.status, 401);
    });

    it("Test 3/4 -- GET /workspace devuelve los workspaces y el seleccionado por header", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      const res = await workspaceGET(req("/api/developer/workspace", { token: owner.token, ws }));
      assert.equal(res.status, 200);
      const b = await body(res);
      assert.ok(Array.isArray(b.workspaces));
      assert.equal((b.selected as { workspaceId: string }).workspaceId, ws);
    });

    it("Test 5/21/22 -- X-Dulabs-Workspace de un workspace ajeno -> 403 (nunca escala)", async () => {
      const ws = randomUUID();
      const wsAjeno = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      const res = await apiKeysGET(req("/api/developer/api-keys", { token: owner.token, ws: wsAjeno }));
      assert.equal(res.status, 403);
      assert.equal(((await body(res)).error as { code: string }).code, "workspace_forbidden");
    });

    // ---- Roles (D4) ----
    it("Tests 6/9/10 -- OWNER crea API key (201) y la clave se devuelve UNA vez; el listado nunca trae la clave ni el hash", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      const crear = await apiKeysPOST(req("/api/developer/api-keys", { token: owner.token, ws, method: "POST", body: { name: "prod" } }));
      assert.equal(crear.status, 201);
      const creado = await body(crear);
      assert.ok((creado.apiKey as string).startsWith("dl_live_"), "la clave completa se devuelve al crear");

      const lista = await apiKeysGET(req("/api/developer/api-keys", { token: owner.token, ws }));
      const b = await body(lista);
      const keys = b.apiKeys as Array<Record<string, unknown>>;
      assert.ok(keys.length >= 1);
      for (const k of keys) {
        assert.equal(k.apiKey, undefined, "el listado NUNCA trae la clave en claro");
        assert.equal(k.key_hash, undefined, "el listado NUNCA trae el hash");
      }
    });

    it("Test 7 -- ADMIN crea API key (201) pero NO puede gestionar miembros (403)", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      await usuario("OWNER", ws);
      const adminU = await usuario("ADMIN", ws);
      const key = await apiKeysPOST(req("/api/developer/api-keys", { token: adminU.token, ws, method: "POST", body: { name: "k" } }));
      assert.equal(key.status, 201);
      const addMember = await membersPOST(req("/api/developer/members", { token: adminU.token, ws, method: "POST", body: { userId: randomUUID(), rol: "MEMBER" } }));
      assert.equal(addMember.status, 403);
    });

    it("Tests 8/14b -- MEMBER puede listar (200) pero NO crear keys (403)", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      await usuario("OWNER", ws);
      const member = await usuario("MEMBER", ws);
      assert.equal((await apiKeysGET(req("/api/developer/api-keys", { token: member.token, ws }))).status, 200);
      assert.equal((await apiKeysPOST(req("/api/developer/api-keys", { token: member.token, ws, method: "POST", body: { name: "x" } }))).status, 403);
    });

    // ---- API key revoke / rotate ----
    it("Test 11 -- revoke: OWNER revoca una key (200) y queda revocada", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      const { fila } = await crearApiKey(admin, { workspaceId: ws, name: "to-revoke" });
      const res = await apiKeyDELETE(req(`/api/developer/api-keys/${fila.id}`, { token: owner.token, ws, method: "DELETE" }), { params: Promise.resolve({ id: fila.id }) });
      assert.equal(res.status, 200);
      const { data } = await admin.from("dulabs_dev_api_keys").select("revoked_at").eq("id", fila.id).single();
      assert.ok(data!.revoked_at, "la key quedó revocada");
    });

    it("Test 12 -- rotate: OWNER rota (201, nueva clave una vez) y la vieja queda revocada", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      const { fila } = await crearApiKey(admin, { workspaceId: ws, name: "to-rotate" });
      const res = await apiKeyROTATE(req(`/api/developer/api-keys/${fila.id}/rotate`, { token: owner.token, ws, method: "POST" }), { params: Promise.resolve({ id: fila.id }) });
      assert.equal(res.status, 201);
      assert.ok(((await body(res)).apiKey as string).startsWith("dl_live_"));
      const { data } = await admin.from("dulabs_dev_api_keys").select("revoked_at").eq("id", fila.id).single();
      assert.ok(data!.revoked_at, "la vieja quedó revocada tras rotar");
    });

    // ---- Usage / numbers / webhooks / jobs projections ----
    it("Test 13 -- usage: devuelve plan, período, mensajes y números; nunca precio", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      const res = await usageGET(req("/api/developer/usage", { token: owner.token, ws }));
      assert.equal(res.status, 200);
      const b = await body(res);
      assert.ok(b.plan && b.period && b.messages && b.numbers);
      assert.equal(JSON.stringify(b).includes("precio"), false);
      assert.equal((b as { price?: unknown }).price, undefined);
    });

    it("Test 15/21 -- numbers: la proyección nunca incluye el token de Meta", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      await registrarNumero(admin, { workspaceId: ws, phoneNumberId: `phn-${randomUUID()}`, displayName: "Line", metaToken: "EAA-secret-token" });
      const res = await numbersGET(req("/api/developer/numbers", { token: owner.token, ws }));
      const b = await body(res);
      const numbers = b.numbers as Array<Record<string, unknown>>;
      assert.ok(numbers.length >= 1);
      for (const n of numbers) {
        assert.equal(n.metaToken, undefined);
        assert.equal(n.meta_token_cifrado, undefined);
        assert.equal(JSON.stringify(n).includes("EAA-secret-token"), false, "NUNCA el token de Meta");
      }
    });

    it("Test 16/21 -- webhooks: la proyección nunca incluye el secret", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      const res = await webhooksGET(req("/api/developer/webhooks", { token: owner.token, ws }));
      assert.equal(res.status, 200);
      const b = await body(res);
      for (const w of b.webhooks as Array<Record<string, unknown>>) {
        assert.equal(w.secret, undefined);
        assert.equal(w.secret_cifrado, undefined);
      }
    });

    it("Test 17 -- jobs: lista paginada, proyección sin payload", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      const res = await jobsGET(req("/api/developer/jobs?limit=10", { token: owner.token, ws }));
      assert.equal(res.status, 200);
      const b = await body(res);
      assert.ok(Array.isArray(b.jobs));
      assert.ok("nextCursor" in b);
      for (const j of b.jobs as Array<Record<string, unknown>>) assert.equal(j.payload, undefined, "el job resumen nunca trae payload");
    });

    // ---- Members (Fase 8 vía Dashboard) ----
    it("Tests 6/16(owner) -- OWNER agrega miembro (201), cambia rol (200) y no puede eliminar al último owner (409)", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      const nuevo = await usuario(null, ws); // usuario existente sin membresía todavía

      const add = await membersPOST(req("/api/developer/members", { token: owner.token, ws, method: "POST", body: { userId: nuevo.userId, rol: "MEMBER" } }));
      assert.equal(add.status, 201);
      const membershipId = ((await body(add)).member as { id: string }).id;

      const patch = await memberPATCH(req(`/api/developer/members/${membershipId}`, { token: owner.token, ws, method: "PATCH", body: { rol: "ADMIN" } }), { params: Promise.resolve({ id: membershipId }) });
      assert.equal(patch.status, 200);

      // Owner intenta eliminarse siendo el ÚNICO owner -> 409 last_owner.
      const ownerMembership = await admin.from("dulabs_dev_memberships").select("id").eq("workspace_id", ws).eq("user_id", owner.userId).single();
      const delOwner = await memberDELETE(req(`/api/developer/members/${ownerMembership.data!.id}`, { token: owner.token, ws, method: "DELETE" }), { params: Promise.resolve({ id: ownerMembership.data!.id }) });
      assert.equal(delOwner.status, 409);
      assert.equal(((await body(delOwner)).error as { code: string }).code, "last_owner");
    });

    it("Test 19/22 -- cross-tenant: OWNER de A no puede modificar un miembro de B (404 member_not_found)", async () => {
      const wsA = randomUUID();
      const wsB = randomUUID();
      workspaceIds.push(wsA, wsB);
      const ownerA = await usuario("OWNER", wsA);
      const victimaB = await usuario("MEMBER", wsB);
      const membershipB = await admin.from("dulabs_dev_memberships").select("id").eq("workspace_id", wsB).eq("user_id", victimaB.userId).single();
      const res = await memberPATCH(req(`/api/developer/members/${membershipB.data!.id}`, { token: ownerA.token, ws: wsA, method: "PATCH", body: { rol: "OWNER" } }), { params: Promise.resolve({ id: membershipB.data!.id }) });
      assert.equal(res.status, 404);
    });
  }
);
