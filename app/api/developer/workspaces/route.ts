import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { ensureCuentaParaWorkspace } from "@/lib/developer/accounts-store";
import { crearWorkspaceEnCuenta } from "@/lib/developer/subscription-store";
import { resolverEntitlementsDeWorkspace } from "@/lib/developer/plans";

// DuLabs Developer V1 -- Fase 11 (autorizado). Crear un workspace/proyecto
// bajo la CUENTA (Agency = hasta 5). OWNER/ADMIN. Límite maxWorkspaces
// aplicado atómicamente a nivel de cuenta (RPC). GET lista los workspaces de
// la cuenta del contexto actual.

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN", "MEMBER"], async (ctx) => {
    const accountId = (await resolverEntitlementsDeWorkspace(ctx.supabase, ctx.workspaceId)).accountId;
    if (!accountId) {
      // Workspace legacy sin cuenta: es su propio workspace único.
      return jsonOk({ workspaces: [{ workspaceId: ctx.workspaceId }] }, ctx.requestId);
    }
    const { data, error } = await ctx.supabase.from("dulabs_dev_workspace_plans").select("workspace_id, created_at").eq("account_id", accountId).order("created_at", { ascending: true });
    if (error) return jsonError(500, "internal_error", ctx.requestId);
    return jsonOk({ workspaces: (data ?? []).map((w) => ({ workspaceId: w.workspace_id as string, createdAt: w.created_at })) }, ctx.requestId);
  });
}

export async function POST(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    // Un workspace por sí solo no genera costo (los números/mensajes que sí
    // lo generan quedan bloqueados aparte en past_due), así que su creación se
    // permite aun en past_due -- acceso administrativo. Ver doc Fase 11.
    const cuenta = await ensureCuentaParaWorkspace(ctx.supabase, { workspaceId: ctx.workspaceId, ownerUserId: ctx.userId });
    const e = await resolverEntitlementsDeWorkspace(ctx.supabase, ctx.workspaceId);
    const r = await crearWorkspaceEnCuenta(ctx.supabase, { accountId: cuenta.id, ownerUserId: ctx.userId, limiteWorkspaces: e.maxWorkspaces });
    if (!r.ok) {
      if (r.motivo === "limite_workspaces_excedido") return jsonError(403, "workspace_limit_exceeded", ctx.requestId, `Tu plan ${e.planCodigo} permite ${e.maxWorkspaces} workspaces`);
      return jsonError(404, "account_not_found", ctx.requestId);
    }
    return jsonOk({ workspaceId: r.workspaceId }, ctx.requestId, 201);
  });
}
