import type { SupabaseClient } from "@supabase/supabase-js";
import { configurarWebhook, listarWebhooksDelWorkspace } from "@/lib/developer/webhook-config-store";
import { obtenerNumeroDelWorkspace } from "@/lib/developer/whatsapp-numbers-store";
import { conWorkspaceAutenticadoPorApiKey, conLecturaAutenticadaPorApiKey } from "./api-auth";
import { errorApi, exitoApi, type RespuestaApi } from "./errors";
import { pareceUuid } from "./validation";

// DuLabs Developer V1 -- Fase 4 (autorizado, decisión D2). GET/POST
// /api/v1/webhooks -- superficie de administración programática por API
// key, GENUINAMENTE separada de /api/v1/dev/webhooks (sesión de Supabase
// Auth, services/gateway/management-handler.ts) -- ninguna de las dos
// acepta el token de la otra. Reusa configurarWebhook (que ya ejecuta
// ssrf-guard antes de persistir) sin duplicar esa lógica.
//
// No se implementa DELETE/PATCH en V1 (evaluado, no agregado por
// simetría): POST ya reemplaza la configuración completa (upsert real,
// rota el secreto en cada llamada); la superficie de sesión equivalente
// tampoco ofrece pausar/eliminar hoy, así que no hay una necesidad real
// identificada para V1 que POST no cubra ya.

export type RequestListaWebhooks = { autorizacion: string | undefined; requestId: string; ipRemota?: string };
export type RequestConfigurarWebhookPublico = { autorizacion: string | undefined; cuerpo: unknown; requestId: string; ipRemota?: string };

function proyeccionPublica(fila: Awaited<ReturnType<typeof listarWebhooksDelWorkspace>>[number]) {
  return { whatsappNumberId: fila.whatsapp_number_id, url: fila.url, status: fila.estado, updatedAt: fila.updated_at };
}

export async function manejarListaWebhooksPublica(deps: { supabase: SupabaseClient }, req: RequestListaWebhooks): Promise<RespuestaApi> {
  return conLecturaAutenticadaPorApiKey(deps, req.autorizacion, req.requestId, req.ipRemota, async (ctx) => {
    const filas = await listarWebhooksDelWorkspace(deps.supabase, ctx.workspaceId);
    return exitoApi(200, { webhooks: filas.map(proyeccionPublica) }, req.requestId);
  });
}

export async function manejarConfigurarWebhookPublico(deps: { supabase: SupabaseClient }, req: RequestConfigurarWebhookPublico): Promise<RespuestaApi> {
  return conWorkspaceAutenticadoPorApiKey(deps, req.autorizacion, req.requestId, req.ipRemota, async (ctx) => {
    const cuerpo = req.cuerpo as { whatsappNumberId?: unknown; url?: unknown } | null;
    if (!cuerpo || typeof cuerpo !== "object") return errorApi(400, "invalid_request", "El cuerpo debe ser un objeto JSON", req.requestId);
    if (!pareceUuid(cuerpo.whatsappNumberId)) return errorApi(400, "invalid_whatsapp_number", "whatsappNumberId inválido o ausente", req.requestId);
    if (typeof cuerpo.url !== "string" || cuerpo.url.length === 0) return errorApi(400, "invalid_request", "url inválida o ausente", req.requestId);

    // Ownership ANTES de tocar la tabla de webhooks -- ver el fix de
    // seguridad correspondiente en management-handler.ts (mismo hallazgo,
    // misma corrección, aplicada acá desde el diseño inicial de esta
    // superficie nueva).
    const numero = await obtenerNumeroDelWorkspace(deps.supabase, { workspaceId: ctx.workspaceId, numeroId: cuerpo.whatsappNumberId });
    if (!numero) return errorApi(404, "not_found", "whatsappNumberId no encontrado en este workspace", req.requestId);

    const resultado = await configurarWebhook(deps.supabase, { workspaceId: ctx.workspaceId, whatsappNumberId: cuerpo.whatsappNumberId, url: cuerpo.url });
    if (!resultado.ok) {
      // url_no_permitida -- SSRF real (ssrf-guard.ts), nunca se persiste.
      return errorApi(400, "invalid_request", `URL de webhook no permitida: ${resultado.detalle}`, req.requestId);
    }

    // El secreto se muestra UNA sola vez, igual que una API key -- nunca
    // se vuelve a poder leer en claro.
    return exitoApi(201, { whatsappNumberId: resultado.fila.whatsapp_number_id, url: resultado.fila.url, status: resultado.fila.estado, secret: resultado.secreto }, req.requestId);
  });
}
