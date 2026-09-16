/**
 * DuLabs Developer V1 -- Fase 7 (Billing + Usage + Limits, autorizado).
 * E2E real contra Postgres para lib/developer/plans.ts -- resolución
 * workspace->plan y límites del plan.
 *
 * REQUIERE la migración 20261013000000_dulabs_developer_v1_fase7_billing_usage_limits.sql aplicada.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolverLimitesDelWorkspace, resolverCodigoPlanDelWorkspace, PLAN_POR_DEFECTO } from "@/lib/developer/plans";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — plans real contra Postgres (Fase 7)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_workspace_plans").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    it("Test A -- workspace SIN fila de mapeo se resuelve como DEVELOPER por defecto, con los límites concretos sembrados", async () => {
      const workspaceId = randomUUID();
      const codigo = await resolverCodigoPlanDelWorkspace(admin, workspaceId);
      assert.equal(codigo, PLAN_POR_DEFECTO);

      const limites = await resolverLimitesDelWorkspace(admin, workspaceId);
      assert.equal(limites.planCodigo, "DEVELOPER");
      assert.equal(limites.mensajesMensualesIncluidos, 20000);
      assert.equal(limites.numerosIncluidos, 2);
      assert.equal(limites.mensajesPorSegundoPorNumero, 2);
    });

    it("Test B -- workspace mapeado a AGENCY resuelve límites NULL (configurables, nunca se inventan cifras)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { error } = await admin.from("dulabs_dev_workspace_plans").insert({ workspace_id: workspaceId, plan_codigo: "AGENCY" });
      assert.equal(error, null);

      const limites = await resolverLimitesDelWorkspace(admin, workspaceId);
      assert.equal(limites.planCodigo, "AGENCY");
      assert.equal(limites.mensajesMensualesIncluidos, null, "AGENCY no define límite mensual todavía -> null (no se aplica cuota)");
      assert.equal(limites.numerosIncluidos, null);
    });

    it("Test C -- workspace mapeado a ENTERPRISE resuelve ENTERPRISE (límites NULL/configurables)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      await admin.from("dulabs_dev_workspace_plans").insert({ workspace_id: workspaceId, plan_codigo: "ENTERPRISE" });

      const limites = await resolverLimitesDelWorkspace(admin, workspaceId);
      assert.equal(limites.planCodigo, "ENTERPRISE");
      assert.equal(limites.mensajesMensualesIncluidos, null);
      assert.equal(limites.numerosIncluidos, null);
    });
  }
);
