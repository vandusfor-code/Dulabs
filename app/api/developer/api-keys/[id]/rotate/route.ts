import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { rotarApiKey } from "@/lib/developer/api-keys-store";

// DuLabs Developer V1 -- Fase 9 (autorizado, D6). POST = rotar una API key
// (OWNER o ADMIN): revoca la vieja y crea la nueva atómicamente (Fase 8). La
// clave nueva se devuelve UNA sola vez.

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    const resultado = await rotarApiKey(ctx.supabase, { workspaceId: ctx.workspaceId, apiKeyId: id });
    if (!resultado.ok) return jsonError(404, "not_found", ctx.requestId, "API key no encontrada o ya revocada");
    return jsonOk(
      { id: resultado.fila.id, name: resultado.fila.name, prefix: resultado.fila.prefix, createdAt: resultado.fila.created_at, apiKey: resultado.claveEnClaro },
      ctx.requestId,
      201
    );
  });
}
