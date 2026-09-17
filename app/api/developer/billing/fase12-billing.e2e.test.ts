/**
 * DuLabs Developer V1 -- Fase 12 (Billing). E2E real contra Postgres del
 * comportamiento con DEVELOPER_BILLING_ENABLED=ON: /subscription/plan (upgrade
 * exige pago, downgrade se difiere/valida, Enterprise manual), lifecycle
 * (activación/dunning) y reserva atómica de checkout. NO llama a Wompi (no
 * requiere DEVELOPER_WOMPI_*): ejercita el contrato server-side y la BD.
 * Requiere migraciones Fase 7/8/11/12.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { crearClienteDePruebaComoSesion } from "@/lib/test-helpers/sesion-prueba";
import { crearMiembro } from "@/lib/developer/memberships-store";
import { ensureCuentaParaWorkspace } from "@/lib/developer/accounts-store";
import { activarSuscripcionPagada, procesarRenovacionFallida } from "@/lib/developer/billing/billing-lifecycle";
import { reservarCheckout, obtenerSuscripcion } from "@/lib/developer/billing/billing-store";
import { POST as planPOST } from "@/app/api/developer/subscription/plan/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function req(path: string, opts: { token?: string; ws?: string; body?: unknown } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.ws) headers["x-dulabs-workspace"] = opts.ws;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, { method: "POST", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
}

describe(
  "DuLabs Developer V1 — Billing ON (Fase 12)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const userIds: string[] = [];
    const workspaceIds: string[] = [];
    const accountIds: string[] = [];
    let flagPrevio: string | undefined;

    before(() => {
      flagPrevio = process.env.DEVELOPER_BILLING_ENABLED;
      process.env.DEVELOPER_BILLING_ENABLED = "true"; // Billing ON para toda la suite
    });
    after(async () => {
      if (flagPrevio === undefined) delete process.env.DEVELOPER_BILLING_ENABLED;
      else process.env.DEVELOPER_BILLING_ENABLED = flagPrevio;
      for (const acc of [...new Set(accountIds)]) {
        for (const t of ["dulabs_dev_billing_payments", "dulabs_dev_billing_subscriptions", "dulabs_dev_billing_customers", "dulabs_dev_account_audit"]) {
          await admin.from(t).delete().eq("account_id", acc).then(() => {}, () => {});
        }
      }
      for (const ws of [...new Set(workspaceIds)]) {
        for (const t of ["dulabs_dev_memberships", "dulabs_dev_workspace_plans"]) {
          await admin.from(t).delete().eq("workspace_id", ws).then(() => {}, () => {});
        }
      }
      for (const acc of [...new Set(accountIds)]) await admin.from("dulabs_dev_accounts").delete().eq("id", acc).then(() => {}, () => {});
      for (const id of userIds) await admin.auth.admin.deleteUser(id).then(() => {}, () => {});
    });

    async function ownerConCuenta(): Promise<{ token: string; userId: string; ws: string; accountId: string }> {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const email = `f12-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const password = `F12-${randomUUID()}`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw error ?? new Error("no user");
      userIds.push(data.user.id);
      await crearMiembro(admin, { workspaceId: ws, userId: data.user.id, rol: "OWNER" });
      const sesion = crearClienteDePruebaComoSesion();
      const signIn = await sesion.auth.signInWithPassword({ email, password });
      if (signIn.error || !signIn.data.session) throw signIn.error ?? new Error("no session");
      const cuenta = await ensureCuentaParaWorkspace(admin, { workspaceId: ws, ownerUserId: data.user.id });
      accountIds.push(cuenta.id);
      return { token: signIn.data.session.access_token, userId: data.user.id, ws, accountId: cuenta.id };
    }

    async function ponerPlan(accountId: string, plan: string) {
      const fin = new Date(); fin.setDate(fin.getDate() + 30);
      await admin.from("dulabs_dev_accounts").update({ plan_codigo: plan, estado: "active", periodo_inicio: new Date().toISOString(), periodo_fin: fin.toISOString() }).eq("id", accountId);
    }
    const body = async (r: Response) => (await r.json()) as Record<string, unknown>;

    it("upgrade DEVELOPER->AGENCY vía /subscription/plan -> 402 upgrade_requires_payment (no cambia el plan)", async () => {
      const o = await ownerConCuenta(); // cuenta DEVELOPER por defecto
      const r = await planPOST(req("/api/developer/subscription/plan", { token: o.token, ws: o.ws, body: { plan: "AGENCY" } }));
      assert.equal(r.status, 402);
      assert.equal(((await body(r)).error as { code: string }).code, "upgrade_requires_payment");
      const { data } = await admin.from("dulabs_dev_accounts").select("plan_codigo").eq("id", o.accountId).maybeSingle();
      assert.equal((data as { plan_codigo: string }).plan_codigo, "DEVELOPER");
    });

    it("Enterprise vía /subscription/plan -> 400 enterprise_manual", async () => {
      const o = await ownerConCuenta();
      const r = await planPOST(req("/api/developer/subscription/plan", { token: o.token, ws: o.ws, body: { plan: "ENTERPRISE" } }));
      assert.equal(r.status, 400);
      assert.equal(((await body(r)).error as { code: string }).code, "enterprise_manual");
    });

    it("downgrade AGENCY->DEVELOPER con recursos que caben -> 200 programado (no cambia ahora)", async () => {
      const o = await ownerConCuenta();
      await ponerPlan(o.accountId, "AGENCY");
      const r = await planPOST(req("/api/developer/subscription/plan", { token: o.token, ws: o.ws, body: { plan: "DEVELOPER" } }));
      assert.equal(r.status, 200);
      const b = await body(r);
      assert.equal(b.scheduledDowngradeTo, "DEVELOPER");
      const { data } = await admin.from("dulabs_dev_accounts").select("plan_codigo").eq("id", o.accountId).maybeSingle();
      assert.equal((data as { plan_codigo: string }).plan_codigo, "AGENCY"); // sigue AGENCY hasta fin de período
      const sub = await obtenerSuscripcion(admin, o.accountId);
      assert.equal(sub?.downgrade_a_plan, "DEVELOPER");
    });

    it("downgrade AGENCY->DEVELOPER con recursos por encima -> 409 downgrade_blocked", async () => {
      const o = await ownerConCuenta();
      await ponerPlan(o.accountId, "AGENCY");
      // 2º workspace enlazado a la cuenta (DEVELOPER permite 1) -> excede.
      const ws2 = randomUUID(); workspaceIds.push(ws2);
      await admin.from("dulabs_dev_workspace_plans").insert({ workspace_id: ws2, account_id: o.accountId });
      const r = await planPOST(req("/api/developer/subscription/plan", { token: o.token, ws: o.ws, body: { plan: "DEVELOPER" } }));
      assert.equal(r.status, 409);
      assert.equal(((await body(r)).error as { code: string }).code, "downgrade_blocked");
    });

    it("lifecycle: activarSuscripcionPagada aplica plan + activa + fija período", async () => {
      const o = await ownerConCuenta();
      await activarSuscripcionPagada(admin, { accountId: o.accountId, planCodigo: "AGENCY", intervalo: "month", precioUsdCents: 4500, cambiarPlanA: "AGENCY", motivo: "test" });
      const { data } = await admin.from("dulabs_dev_accounts").select("plan_codigo, estado, periodo_fin").eq("id", o.accountId).maybeSingle();
      const acc = data as { plan_codigo: string; estado: string; periodo_fin: string | null };
      assert.equal(acc.plan_codigo, "AGENCY");
      assert.equal(acc.estado, "active");
      assert.ok(acc.periodo_fin && new Date(acc.periodo_fin).getTime() > Date.now());
      const sub = await obtenerSuscripcion(admin, o.accountId);
      assert.equal(sub?.intervalo, "month");
      assert.equal(sub?.precio_usd_cents, 4500);
    });

    it("dunning: fallo de renovación -> past_due; agotados los reintentos -> canceled (sin destruir recursos)", async () => {
      const o = await ownerConCuenta();
      await ponerPlan(o.accountId, "AGENCY");
      const r1 = await procesarRenovacionFallida(admin, { accountId: o.accountId });
      assert.equal(r1.resultado, "past_due");
      // 3 fallos de renovación registrados -> siguiente fallo cancela.
      for (let i = 0; i < 3; i++) {
        await admin.from("dulabs_dev_billing_payments").insert({
          account_id: o.accountId, reference: `f-${o.accountId}-${i}-${Date.now()}`, provider_transaction_id: `ftx-${o.accountId}-${i}-${Date.now()}`,
          tipo: "renewal", plan_codigo: "AGENCY", intervalo: "month", precio_usd_cents: 4500, monto_cop_cents: 1, fx_rate: 4000, estado: "DECLINED",
        });
      }
      const r2 = await procesarRenovacionFallida(admin, { accountId: o.accountId });
      assert.equal(r2.resultado, "canceled");
      // Recursos NO destruidos: la cuenta sigue existiendo con su plan.
      const { data } = await admin.from("dulabs_dev_accounts").select("estado, plan_codigo").eq("id", o.accountId).maybeSingle();
      assert.equal((data as { estado: string }).estado, "canceled");
      assert.equal((data as { plan_codigo: string }).plan_codigo, "AGENCY");
    });

    it("reserva atómica: 2º checkout concurrente -> checkout_en_curso (anti doble-cobro)", async () => {
      const o = await ownerConCuenta();
      const r1 = await reservarCheckout(admin, { accountId: o.accountId, reference: `r1-${Date.now()}`, tipo: "checkout", planCodigo: "DEVELOPER", intervalo: "month", precioUsdCents: 1900, montoCopCents: 7600000, fxRate: 4000 });
      assert.equal(r1.ok, true);
      const r2 = await reservarCheckout(admin, { accountId: o.accountId, reference: `r2-${Date.now()}`, tipo: "checkout", planCodigo: "DEVELOPER", intervalo: "month", precioUsdCents: 1900, montoCopCents: 7600000, fxRate: 4000 });
      assert.equal(r2.ok, false);
      assert.equal((r2 as { motivo: string }).motivo, "checkout_en_curso");
    });
  }
);
