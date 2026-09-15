import type { SupabaseClient } from "@supabase/supabase-js";
import { crearJobConIdempotencia, obtenerJobDelWorkspace } from "@/lib/developer/jobs-store";
import { obtenerNumeroDelWorkspace } from "@/lib/developer/whatsapp-numbers-store";
import { verificarLimiteTasa } from "@/lib/rate-limit";
import { publicarMensaje } from "../shared/pubsub";
import { conWorkspaceAutenticadoPorApiKey } from "./api-auth";
import { errorApi, exitoApi, type RespuestaApi } from "./errors";
import { validarIdempotencyKey, validarCuerpoMensajeSaliente } from "./validation";
import { estadoPublicoDelJob } from "./job-status";

// DuLabs Developer V1 -- Fase 3 (autorizado, sección A/B del documento de
// infraestructura), extendido en Fase 4 (autorizado, decisión D1: se
// preserva EXACTAMENTE el contrato real de éxito -- camelCase, 201/200,
// {jobId, status} -- solo se agrega el modelo de error uniforme, rate
// limiting, validación de payload y ownership de whatsappNumberId, que
// antes NO se verificaba antes de crear el job). Reusa sin modificar:
// jobs-store.ts (que a su vez reusa idempotency.ts, Fase 1).

export type DependenciasOutbound = {
  supabase: SupabaseClient;
  topicOutbound: string;
  publicar?: typeof publicarMensaje;
};

export type RequestMensajeSaliente = {
  autorizacion: string | undefined;
  idempotencyKey: string | undefined;
  cuerpo: unknown;
  requestId: string;
  ipRemota?: string;
};

export async function manejarMensajeSaliente(deps: DependenciasOutbound, req: RequestMensajeSaliente): Promise<RespuestaApi> {
  const publicar = deps.publicar ?? publicarMensaje;

  return conWorkspaceAutenticadoPorApiKey(deps, req.autorizacion, req.requestId, req.ipRemota, async (ctx) => {
    const idemValidacion = validarIdempotencyKey(req.idempotencyKey);
    if (!idemValidacion.valido) return errorApi(400, "invalid_request", idemValidacion.motivo, req.requestId);

    const cuerpoValidacion = validarCuerpoMensajeSaliente(req.cuerpo);
    if (!cuerpoValidacion.valido) return errorApi(400, "invalid_request", cuerpoValidacion.motivo, req.requestId);
    const { datos } = cuerpoValidacion;

    // Fase 4 (autorizado) -- ownership de whatsappNumberId ANTES de crear
    // nada. Antes de esta corrección, crearJobConIdempotencia aceptaba
    // cualquier whatsappNumberId sin verificar que perteneciera al
    // workspace autenticado -- el Worker outbound sí lo verificaba después
    // (obtenerTokenMetaDelNumero filtra por workspace_id), así que nunca
    // se enviaba un mensaje real por el número de otro workspace, pero sí
    // se creaban job/idempotency/usage-ledger "huérfanos" innecesariamente.
    // Se cierra acá, en el punto de entrada -- mismo criterio que el fix
    // de ownership de webhooks.
    const numero = await obtenerNumeroDelWorkspace(deps.supabase, { workspaceId: ctx.workspaceId, numeroId: datos.whatsappNumberId });
    if (!numero) return errorApi(400, "invalid_whatsapp_number", "whatsappNumberId no encontrado en este workspace", req.requestId);

    // Rate limiting -- Fase 0 (2 msg/s por número) + Fase 4 decisión D8
    // (1200 req/min por workspace). Se evalúan AMBOS, el más restrictivo
    // aplica; ninguno sustituye al otro. Se verifica ANTES de
    // crearJobConIdempotencia -- una request limitada nunca reserva usage
    // ni crea idempotencia.
    const limitePorNumero = await verificarLimiteTasa(deps.supabase, { recurso: "dev-outbound-numero", tenantId: datos.whatsappNumberId, categoria: "devOutboundPorNumero" });
    if (!limitePorNumero.permitido) {
      return errorApi(429, "rate_limit_exceeded", "Límite de 2 mensajes/segundo por número excedido", req.requestId, retryAfterHeader(limitePorNumero.reiniciaEn));
    }
    const limitePorWorkspace = await verificarLimiteTasa(deps.supabase, { recurso: "dev-outbound-workspace", tenantId: ctx.workspaceId, categoria: "devOutboundPorWorkspace" });
    if (!limitePorWorkspace.permitido) {
      return errorApi(429, "rate_limit_exceeded", "Límite de 1200 mensajes/minuto por workspace excedido", req.requestId, retryAfterHeader(limitePorWorkspace.reiniciaEn));
    }

    const resultado = await crearJobConIdempotencia(deps.supabase, {
      workspaceId: ctx.workspaceId,
      whatsappNumberId: datos.whatsappNumberId,
      idempotencyKey: req.idempotencyKey!,
      payload: datos as unknown as Record<string, unknown>,
    });

    if (resultado.resultado === "conflicto_payload_distinto") {
      return errorApi(409, "idempotency_conflict", "Ya existe una operación con esa Idempotency-Key pero con un payload distinto", req.requestId);
    }

    if (resultado.resultado === "duplicado_identico") {
      // Réplica exacta de un request ya procesado -- el job original ya fue
      // (o está siendo) publicado a Pub/Sub la primera vez; NO se vuelve a
      // publicar acá.
      return exitoApi(200, { jobId: resultado.jobId, status: "duplicado_identico" }, req.requestId);
    }

    await publicar(deps.topicOutbound, { workspaceId: ctx.workspaceId, jobId: resultado.jobId, requestId: req.requestId });
    return exitoApi(201, { jobId: resultado.jobId, status: "created" }, req.requestId);
  });
}

function retryAfterHeader(reiniciaEn: string | null): Record<string, string> | undefined {
  if (!reiniciaEn) return undefined;
  const segundos = Math.max(1, Math.ceil((new Date(reiniciaEn).getTime() - Date.now()) / 1000));
  return { "Retry-After": String(segundos) };
}

// ============================================================
// GET /api/v1/messages/:id -- Fase 4 (autorizado)
// ============================================================

export type RequestObtenerMensaje = { autorizacion: string | undefined; jobId: string; requestId: string; ipRemota?: string };

export async function manejarObtenerMensaje(deps: { supabase: SupabaseClient }, req: RequestObtenerMensaje): Promise<RespuestaApi> {
  return conWorkspaceAutenticadoPorApiKey(deps, req.autorizacion, req.requestId, req.ipRemota, async (ctx) => {
    // Nunca "obtener por id y comparar workspace después" -- la misma
    // query ya filtra por (id, workspace_id) -- ver decisión D5.
    const job = await obtenerJobDelWorkspace(deps.supabase, { workspaceId: ctx.workspaceId, jobId: req.jobId });
    if (!job) return errorApi(404, "not_found", "Mensaje no encontrado", req.requestId);

    const payload = job.payload as { to?: string } | null;
    return exitoApi(
      200,
      {
        id: job.id,
        status: estadoPublicoDelJob(job.status),
        to: payload?.to ?? null,
        whatsappNumberId: job.whatsapp_number_id,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
      },
      req.requestId
    );
  });
}
