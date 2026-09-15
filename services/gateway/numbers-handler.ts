import type { SupabaseClient } from "@supabase/supabase-js";
import { listarNumeros, obtenerNumeroDelWorkspace } from "@/lib/developer/whatsapp-numbers-store";
import { conLecturaAutenticadaPorApiKey } from "./api-auth";
import { errorApi, exitoApi, type RespuestaApi } from "./errors";

// DuLabs Developer V1 -- Fase 4 (autorizado). GET /api/v1/whatsapp-numbers
// (+ /:id) -- superficie de solo lectura autenticada por API key,
// deliberadamente separada de /api/v1/dev/numbers (sesión). Reusa
// whatsapp-numbers-store.ts sin modificar su lógica -- listarNumeros y
// obtenerNumeroDelWorkspace ya proyectan solo columnas públicas (nunca el
// token de Meta cifrado).

export type RequestListaNumeros = { autorizacion: string | undefined; requestId: string; ipRemota?: string };
export type RequestObtenerNumero = { autorizacion: string | undefined; numeroId: string; requestId: string; ipRemota?: string };

function proyeccionPublica(fila: Awaited<ReturnType<typeof listarNumeros>>[number]) {
  return {
    id: fila.id,
    phoneNumberId: fila.phone_number_id,
    displayName: fila.display_name,
    status: fila.estado,
    createdAt: fila.created_at,
  };
}

export async function manejarListaNumerosPublica(deps: { supabase: SupabaseClient }, req: RequestListaNumeros): Promise<RespuestaApi> {
  return conLecturaAutenticadaPorApiKey(deps, req.autorizacion, req.requestId, req.ipRemota, async (ctx) => {
    const filas = await listarNumeros(deps.supabase, ctx.workspaceId);
    return exitoApi(200, { numbers: filas.map(proyeccionPublica) }, req.requestId);
  });
}

export async function manejarObtenerNumeroPublico(deps: { supabase: SupabaseClient }, req: RequestObtenerNumero): Promise<RespuestaApi> {
  return conLecturaAutenticadaPorApiKey(deps, req.autorizacion, req.requestId, req.ipRemota, async (ctx) => {
    const fila = await obtenerNumeroDelWorkspace(deps.supabase, { workspaceId: ctx.workspaceId, numeroId: req.numeroId });
    if (!fila) return errorApi(404, "not_found", "Número no encontrado", req.requestId);
    return exitoApi(200, proyeccionPublica(fila), req.requestId);
  });
}
