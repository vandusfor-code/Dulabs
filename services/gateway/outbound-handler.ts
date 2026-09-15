import type { SupabaseClient } from "@supabase/supabase-js";
import { autenticarApiKey } from "@/lib/developer/api-keys-store";
import { crearJobConIdempotencia } from "@/lib/developer/jobs-store";
import { publicarMensaje } from "../shared/pubsub";

// DuLabs Developer V1 -- Fase 3 (autorizado, sección A/B del documento de
// infraestructura). Handler de POST /api/v1/messages -- el contrato
// original de Fase 1 (sección 2). Reusa sin modificar: api-keys-store.ts,
// jobs-store.ts (que a su vez reusa idempotency.ts, Fase 1).

export type DependenciasOutbound = {
  supabase: SupabaseClient;
  topicOutbound: string;
  publicar?: typeof publicarMensaje;
};

export type RequestMensajeSaliente = {
  autorizacion: string | undefined; // header Authorization completo
  idempotencyKey: string | undefined; // header Idempotency-Key
  cuerpo: unknown;
};

export type RespuestaMensajeSaliente = { status: number; cuerpo: Record<string, unknown> };

function extraerBearer(header: string | undefined): string | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

export async function manejarMensajeSaliente(deps: DependenciasOutbound, req: RequestMensajeSaliente): Promise<RespuestaMensajeSaliente> {
  const publicar = deps.publicar ?? publicarMensaje;

  const claveApi = extraerBearer(req.autorizacion);
  if (!claveApi) return { status: 401, cuerpo: { error: "Falta Authorization: Bearer dl_live_..." } };

  const auth = await autenticarApiKey(deps.supabase, claveApi);
  if (!auth.autenticado) return { status: 401, cuerpo: { error: `API key inválida (${auth.motivo})` } };

  if (!req.idempotencyKey) return { status: 400, cuerpo: { error: "Falta la cabecera Idempotency-Key" } };

  const cuerpo = req.cuerpo as { whatsappNumberId?: string; to?: string } | null;
  if (!cuerpo || typeof cuerpo !== "object" || !cuerpo.whatsappNumberId || !cuerpo.to) {
    return { status: 400, cuerpo: { error: "El cuerpo debe incluir al menos whatsappNumberId y to" } };
  }

  const resultado = await crearJobConIdempotencia(deps.supabase, {
    workspaceId: auth.workspaceId,
    whatsappNumberId: cuerpo.whatsappNumberId,
    idempotencyKey: req.idempotencyKey,
    payload: cuerpo as Record<string, unknown>,
  });

  if (resultado.resultado === "conflicto_payload_distinto") {
    return { status: 409, cuerpo: { error: "Ya existe una operación con esa Idempotency-Key pero con un payload distinto" } };
  }

  if (resultado.resultado === "duplicado_identico") {
    // Réplica exacta de un request ya procesado -- el job original ya fue
    // (o está siendo) publicado a Pub/Sub la primera vez; NO se vuelve a
    // publicar acá (evitaría un segundo mensaje para el mismo job sin
    // necesidad -- el lease/CAS del Worker ya lo protegería igual, pero no
    // hay ninguna razón de negocio para generar el mensaje duplicado).
    return { status: 200, cuerpo: { jobId: resultado.jobId, status: "duplicado_identico" } };
  }

  await publicar(deps.topicOutbound, { workspaceId: auth.workspaceId, jobId: resultado.jobId });
  return { status: 201, cuerpo: { jobId: resultado.jobId, status: "created" } };
}
