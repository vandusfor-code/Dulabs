import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk } from "@/lib/developer/dev-api-http";
import { listarJobsDelWorkspace } from "@/lib/developer/jobs-store";

// DuLabs Developer V1 -- Fase 9 (autorizado, D2). GET = lista paginada de
// jobs del workspace (cualquier rol). Proyección segura (sin payload/secretos).

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN", "MEMBER"], async (ctx) => {
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20;
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const { jobs, nextCursor } = await listarJobsDelWorkspace(ctx.supabase, { workspaceId: ctx.workspaceId, limit, cursor });
    return jsonOk({ jobs, nextCursor }, ctx.requestId);
  });
}
