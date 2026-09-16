import type { NextRequest } from "next/server";
import { conUsuarioDeveloper, jsonOk, resolverSeleccionSuave } from "@/lib/developer/dev-api-http";
import { listarWorkspacesDelUsuario } from "@/lib/developer/memberships-store";

// DuLabs Developer V1 -- Fase 9 (autorizado). GET /api/developer/workspace.
// Solo requiere sesión válida (no un workspace ya elegido): devuelve la lista
// de workspaces del usuario (para el selector) + el seleccionado según
// X-Dulabs-Workspace (o null si hay varios y no se envió header aún).

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return conUsuarioDeveloper(request, async (ctx) => {
    const workspaces = await listarWorkspacesDelUsuario(ctx.supabase, ctx.userId);
    const { seleccionado } = await resolverSeleccionSuave(ctx.supabase, {
      userId: ctx.userId,
      workspaceHeader: request.headers.get("x-dulabs-workspace") ?? undefined,
    });
    return jsonOk(
      { workspaces: workspaces.map((w) => ({ workspaceId: w.workspaceId, rol: w.rol })), selected: seleccionado },
      ctx.requestId
    );
  });
}
