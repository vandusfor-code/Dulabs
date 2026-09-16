import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { revocarApiKey } from "@/lib/developer/api-keys-store";

// DuLabs Developer V1 -- Fase 9 (autorizado). DELETE = revocar una API key
// (OWNER o ADMIN). Siempre scoped por workspace.

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    const resultado = await revocarApiKey(ctx.supabase, { workspaceId: ctx.workspaceId, apiKeyId: id });
    if (!resultado.revocada) return jsonError(404, "not_found", ctx.requestId, "API key no encontrada o ya revocada");
    return jsonOk({ revoked: true }, ctx.requestId);
  });
}
