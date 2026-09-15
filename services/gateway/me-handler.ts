import type { SupabaseClient } from "@supabase/supabase-js";
import { conLecturaAutenticadaPorApiKey } from "./api-auth";
import { exitoApi, type RespuestaApi } from "./errors";

// DuLabs Developer V1 -- Fase 4 (autorizado). GET /api/v1/me -- confirma
// en una sola llamada que la API key funciona y a qué workspace
// pertenece. Nunca la key completa (estructuralmente irrecuperable de
// todos modos, ver lib/developer/api-keys.ts).

export type RequestMe = { autorizacion: string | undefined; requestId: string; ipRemota?: string };

export async function manejarObtenerMe(deps: { supabase: SupabaseClient }, req: RequestMe): Promise<RespuestaApi> {
  return conLecturaAutenticadaPorApiKey(deps, req.autorizacion, req.requestId, req.ipRemota, async (ctx) => {
    return exitoApi(
      200,
      { workspaceId: ctx.workspaceId, apiKeyId: ctx.apiKeyId, apiKeyPrefix: ctx.apiKeyPrefix, apiKeyName: ctx.apiKeyName },
      req.requestId
    );
  });
}
