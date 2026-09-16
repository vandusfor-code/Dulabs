/**
 * DuLabs Developer V1 -- Fase 11. E2E real contra Postgres del modelo de
 * planes/suscripciones/entitlements A NIVEL DE CUENTA: entitlements por plan,
 * upgrade/downgrade (opción A), números adicionales, límites de
 * workspaces/miembros, past_due, concurrencia y seguridad por rol.
 *
 * Invoca los route handlers reales. Sesiones reales (JWT). Solo toca tablas
 * dulabs_dev_* + usuarios de Auth desechables. REQUIERE migraciones Fase 7/8/11.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { crearClienteDePruebaComoSesion } from "@/lib/test-helpers/sesion-prueba";
import { crearMiembro, type RolDev } from "@/lib/developer/memberships-store";
import { setEstado } from "@/lib/developer/subscription-store";
import { obtenerAccountIdDeWorkspace } from "@/lib/developer/accounts-store";

import { GET as subGET } from "@/app/api/developer/subscription/route";
import { POST as planPOST } from "@/app/api/developer/subscription/plan/route";
import { POST as addNumbersPOST } from "@/app/api/developer/subscription/additional-numbers/route";
import { POST as wsPOST } from "@/app/api/developer/workspaces/route";
import { POST as membersPOST } from "@/app/api/developer/members/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function req(path: string, opts: { token?: string; ws?: string; method?: string; body?: unknown } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.ws) headers["x-dulabs-workspace"] = opts.ws;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, { method: opts.method ?? "GET", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
}

describe(
  "DuLabs Developer V1 — planes/suscripciones/entitlements por cuenta (Fase 11)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const userIds: string[] = [];
    const workspaceIds: string[] = [];
    const accountIds: string[] = [];

    after(async () => {
      // Borra workspaces creados por la cuenta (via crear_workspace) además de los sembrados.
      for (const acc of accountIds) {
        const { data } = await admin.from("dulabs_dev_workspace_plans").select("workspace_id").eq("account_id", acc);
        for (const w of data ?? []) workspaceIds.push(w.workspace_id as string);
      }
      const uniqWs = [...new Set(workspaceIds)];
      for (const ws of uniqWs) {
        for (const t of ["dulabs_dev_whatsapp_numbers", "dulabs_dev_memberships", "dulabs_dev_usage_ledger", "dulabs_dev_workspace_plans"]) {
          await admin.from(t).delete().eq("workspace_id", ws).then(() => {}, () => {});
        }
      }
      for (const acc of accountIds) {
        await admin.from("dulabs_dev_plan_overrides").delete().eq("account_id", acc).then(() => {}, () => {});
        await admin.from("dulabs_dev_account_audit").delete().eq("account_id", acc).then(() => {}, () => {});
        await admin.from("dulabs_dev_accounts").delete().eq("id", acc).then(() => {}, () => {});
      }
      for (const id of userIds) await admin.auth.admin.deleteUser(id).then(() => {}, () => {});
    });

    async function usuario(rolEnWs: RolDev | null, ws: string): Promise<{ userId: string; token: string }> {
      const email = `f11-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const password = `F11Test-${randomUUID()}`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw error ?? new Error("no user");
      userIds.push(data.user.id);
      if (rolEnWs) await crearMiembro(admin, { workspaceId: ws, userId: data.user.id, rol: rolEnWs });
      const sesion = crearClienteDePruebaComoSesion();
      const signIn = await sesion.auth.signInWithPassword({ email, password });
      if (signIn.error || !signIn.data.session) throw signIn.error ?? new Error("no session");
      return { userId: data.user.id, token: signIn.data.session.access_token };
    }
    async function usuarioSuelto(): Promise<string> {
      const email = `f11u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({ email, password: `F11-${randomUUID()}`, email_confirm: true });
      if (error || !data.user) throw error ?? new Error("no user");
      userIds.push(data.user.id);
      return data.user.id;
    }
    const bodyDe = async (res: Response) => (await res.json()) as Record<string, unknown>;
    async function upgradeAAgency(token: string, ws: string): Promise<string> {
      const r = await planPOST(req("/api/developer/subscription/plan", { token, ws, method: "POST", body: { plan: "AGENCY" } }));
      assert.equal(r.status, 200, `upgrade a AGENCY debería ok: ${JSON.stringify(await bodyDe(r))}`);
      const accId = await obtenerAccountIdDeWorkspace(admin, ws);
      if (accId) accountIds.push(accId);
      return accId!;
    }

    it("default sin cuenta -> entitlements DEVELOPER (2/20K/1/1)", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      const b = await bodyDe(await subGET(req("/api/developer/subscription", { token: owner.token, ws })));
      assert.equal(b.plan, "DEVELOPER");
      assert.equal((b.numbers as { max: number }).max, 2);
      assert.equal((b.messages as { included: number }).included, 20000);
      assert.equal((b.workspaces as { included: number }).included, 1);
      assert.equal((b.members as { included: number }).included, 1);
    });

    it("upgrade a AGENCY -> entitlements 5/100K/5/5", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      await upgradeAAgency(owner.token, ws);
      const b = await bodyDe(await subGET(req("/api/developer/subscription", { token: owner.token, ws })));
      assert.equal(b.plan, "AGENCY");
      assert.equal((b.numbers as { max: number }).max, 5);
      assert.equal((b.messages as { included: number }).included, 100000);
      assert.equal((b.workspaces as { included: number }).included, 5);
      assert.equal((b.members as { included: number }).included, 5);
    });

    it("números adicionales: DEVELOPER 403 not_allowed; AGENCY ok y sube maxNumbers", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      // Developer: no permitido (materializa cuenta DEVELOPER vía la ruta).
      const devRes = await addNumbersPOST(req("/api/developer/subscription/additional-numbers", { token: owner.token, ws, method: "POST", body: { total: 1 } }));
      assert.equal(devRes.status, 403);
      const accId = await obtenerAccountIdDeWorkspace(admin, ws);
      if (accId) accountIds.push(accId);
      // Agency: permitido.
      await planPOST(req("/api/developer/subscription/plan", { token: owner.token, ws, method: "POST", body: { plan: "AGENCY" } }));
      const okRes = await addNumbersPOST(req("/api/developer/subscription/additional-numbers", { token: owner.token, ws, method: "POST", body: { total: 3 } }));
      assert.equal(okRes.status, 200);
      const b = await bodyDe(await subGET(req("/api/developer/subscription", { token: owner.token, ws })));
      assert.equal((b.numbers as { max: number }).max, 8); // 5 incluidos + 3 adicionales
    });

    it("workspaces: crea hasta 5, el 6.º -> 403 workspace_limit_exceeded", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      await upgradeAAgency(owner.token, ws); // ws queda enlazado (workspace #1)
      for (let i = 0; i < 4; i++) {
        const r = await wsPOST(req("/api/developer/workspaces", { token: owner.token, ws, method: "POST", body: {} }));
        assert.equal(r.status, 201, `workspace ${i + 2} debería crearse`);
      }
      const sexto = await wsPOST(req("/api/developer/workspaces", { token: owner.token, ws, method: "POST", body: {} }));
      assert.equal(sexto.status, 403);
      assert.equal(((await bodyDe(sexto)).error as { code: string }).code, "workspace_limit_exceeded");
    });

    it("downgrade AGENCY->DEVELOPER bloqueado con >1 workspace (opción A)", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      await upgradeAAgency(owner.token, ws);
      await wsPOST(req("/api/developer/workspaces", { token: owner.token, ws, method: "POST", body: {} })); // 2 workspaces
      const down = await planPOST(req("/api/developer/subscription/plan", { token: owner.token, ws, method: "POST", body: { plan: "DEVELOPER" } }));
      assert.equal(down.status, 409);
      assert.equal(((await bodyDe(down)).error as { code: string }).code, "downgrade_blocked");
    });

    it("miembros: límite de cuenta (AGENCY=5), el 6.º distinto -> 403", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws); // miembro #1 (owner)
      await upgradeAAgency(owner.token, ws);
      for (let i = 0; i < 4; i++) {
        const u = await usuarioSuelto();
        const r = await membersPOST(req("/api/developer/members", { token: owner.token, ws, method: "POST", body: { userId: u, rol: "MEMBER" } }));
        assert.equal(r.status, 201, `miembro ${i + 2} debería crearse`);
      }
      const sexto = await usuarioSuelto();
      const res = await membersPOST(req("/api/developer/members", { token: owner.token, ws, method: "POST", body: { userId: sexto, rol: "MEMBER" } }));
      assert.equal(res.status, 403);
      assert.equal(((await bodyDe(res)).error as { code: string }).code, "member_limit_exceeded");
    });

    it("past_due: consumoBloqueado + comprar adicionales bloqueado (402)", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      const accId = await upgradeAAgency(owner.token, ws);
      await setEstado(admin, { accountId: accId, estado: "past_due", actorUserId: owner.userId, motivo: "test" });
      const b = await bodyDe(await subGET(req("/api/developer/subscription", { token: owner.token, ws })));
      assert.equal(b.consumoBloqueado, true);
      const add = await addNumbersPOST(req("/api/developer/subscription/additional-numbers", { token: owner.token, ws, method: "POST", body: { total: 2 } }));
      assert.equal(add.status, 402);
    });

    it("seguridad por rol: MEMBER no cambia plan (403); ADMIN no cambia plan (403); solo OWNER", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      await usuario("OWNER", ws);
      const member = await usuario("MEMBER", ws);
      const adminU = await usuario("ADMIN", ws);
      assert.equal((await planPOST(req("/api/developer/subscription/plan", { token: member.token, ws, method: "POST", body: { plan: "AGENCY" } }))).status, 403);
      assert.equal((await planPOST(req("/api/developer/subscription/plan", { token: adminU.token, ws, method: "POST", body: { plan: "AGENCY" } }))).status, 403);
    });

    it("concurrencia: 2 creaciones de workspace con 1 solo cupo libre -> exactamente una gana", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuario("OWNER", ws);
      await upgradeAAgency(owner.token, ws); // ws #1
      // Llenar hasta 4 (queda 1 cupo).
      for (let i = 0; i < 3; i++) await wsPOST(req("/api/developer/workspaces", { token: owner.token, ws, method: "POST", body: {} }));
      const [r1, r2] = await Promise.all([
        wsPOST(req("/api/developer/workspaces", { token: owner.token, ws, method: "POST", body: {} })),
        wsPOST(req("/api/developer/workspaces", { token: owner.token, ws, method: "POST", body: {} })),
      ]);
      const oks = [r1, r2].filter((r) => r.status === 201).length;
      const rechazos = [r1, r2].filter((r) => r.status === 403).length;
      assert.equal(oks, 1, "exactamente una creación debe ganar el último cupo");
      assert.equal(rechazos, 1, "exactamente una debe ser rechazada");
    });
  }
);
