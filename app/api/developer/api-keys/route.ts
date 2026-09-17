import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { crearApiKey, listarApiKeys, ErrorLimiteApiKeys } from "@/lib/developer/api-keys-store";

// DuLabs Developer V1 -- Fase 9 (autorizado). GET (listar metadata, cualquier
// rol) / POST (crear, OWNER o ADMIN). La clave en claro se devuelve UNA sola
// vez en el POST; el listado nunca expone hash ni clave.

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN", "MEMBER"], async (ctx) => {
    const filas = await listarApiKeys(ctx.supabase, ctx.workspaceId);
    return jsonOk({ apiKeys: filas }, ctx.requestId);
  });
}

export async function POST(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    const cuerpo = (await request.json().catch(() => null)) as { name?: string } | null;
    const name = cuerpo?.name?.trim();
    if (!name) return jsonError(400, "invalid_request", ctx.requestId, "Falta 'name'");
    let fila, claveEnClaro;
    try {
      ({ fila, claveEnClaro } = await crearApiKey(ctx.supabase, { workspaceId: ctx.workspaceId, name }));
    } catch (err) {
      if (err instanceof ErrorLimiteApiKeys) {
        return jsonError(409, "api_key_limit", ctx.requestId, `Máximo ${err.limite} API keys activas por workspace. Revoca alguna para crear otra.`);
      }
      throw err;
    }
    // apiKey: se muestra UNA sola vez; nunca se vuelve a poder recuperar.
    return jsonOk({ id: fila.id, name: fila.name, prefix: fila.prefix, createdAt: fila.created_at, apiKey: claveEnClaro }, ctx.requestId, 201);
  });
}
