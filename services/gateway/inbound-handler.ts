import type { SupabaseClient } from "@supabase/supabase-js";
import { verificarFirmaMeta } from "@/lib/developer/meta-webhook-signature";
import { calcularEventIdWebhookMeta } from "@/lib/developer/meta-event-id";
import { registrarEvento, marcarEventoPublicado } from "@/lib/developer/events-store";
import { obtenerNumeroPorPhoneNumberId } from "@/lib/developer/whatsapp-numbers-store";
import { publicarMensaje } from "../shared/pubsub";

// DuLabs Developer V1 -- Fase 3 (autorizado, sección A del documento de
// infraestructura, "Endpoint inbound de Meta -- diseño completo"). Handler
// de GET/POST /api/v1/webhooks/meta.

export type DependenciasInbound = {
  supabase: SupabaseClient;
  topicInbound: string;
  metaAppSecret: string;
  metaVerifyToken: string;
  publicar?: typeof publicarMensaje;
};

export type RequestVerificacionMeta = { hubMode: string | undefined; hubVerifyToken: string | undefined; hubChallenge: string | undefined };
export type RespuestaVerificacionMeta = { status: number; cuerpo: string };

/** GET /api/v1/webhooks/meta -- handshake de verificación, sección A del documento. */
export function manejarVerificacionMeta(deps: DependenciasInbound, req: RequestVerificacionMeta): RespuestaVerificacionMeta {
  if (req.hubMode === "subscribe" && req.hubVerifyToken === deps.metaVerifyToken && req.hubChallenge) {
    return { status: 200, cuerpo: req.hubChallenge };
  }
  return { status: 403, cuerpo: "" };
}

export type RequestWebhookMeta = { firmaHeader: string | null | undefined; cuerpoCrudo: string };
export type RespuestaWebhookMeta = { status: number; cuerpo: Record<string, unknown> };

function extraerPhoneNumberId(payload: unknown): string | null {
  try {
    const entry = (payload as { entry?: Array<{ changes?: Array<{ value?: { metadata?: { phone_number_id?: string } } }> }> })?.entry?.[0];
    return entry?.changes?.[0]?.value?.metadata?.phone_number_id ?? null;
  } catch {
    return null;
  }
}

/**
 * POST /api/v1/webhooks/meta. Respeta el orden exacto especificado en el
 * documento: verificar firma -> validar payload -> dedupe -> persistir ->
 * publicar -> responder. Responde 200 en casi todos los casos (incluidos
 * duplicados y payloads no atribuibles a un workspace) -- solo la firma
 * inválida es un 403 duro. Ver la tabla completa de la sección A para el
 * razonamiento de cada rama.
 */
export async function manejarWebhookMeta(deps: DependenciasInbound, req: RequestWebhookMeta): Promise<RespuestaWebhookMeta> {
  const publicar = deps.publicar ?? publicarMensaje;

  if (!verificarFirmaMeta(req.cuerpoCrudo, req.firmaHeader, deps.metaAppSecret)) {
    return { status: 403, cuerpo: { error: "firma_invalida" } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(req.cuerpoCrudo);
  } catch {
    return { status: 200, cuerpo: { procesado: false, motivo: "payload_malformado" } };
  }

  const phoneNumberId = extraerPhoneNumberId(payload);
  if (!phoneNumberId) {
    return { status: 200, cuerpo: { procesado: false, motivo: "payload_sin_phone_number_id" } };
  }

  const numero = await obtenerNumeroPorPhoneNumberId(deps.supabase, phoneNumberId);
  if (!numero) {
    // Un webhook de un número que DuLabs no tiene registrado para ningún
    // workspace -- no hay a quién atribuírselo. Se ACKea igual (Meta no
    // tiene la culpa) pero no se persiste ni se publica nada.
    return { status: 200, cuerpo: { procesado: false, motivo: "numero_no_registrado" } };
  }

  const eventId = calcularEventIdWebhookMeta(payload);
  const registro = await registrarEvento(deps.supabase, {
    eventId,
    workspaceId: numero.workspace_id,
    tipo: "received",
    payload: payload as Record<string, unknown>,
  });

  if (!registro.registrado) {
    return { status: 200, cuerpo: { procesado: false, motivo: "evento_duplicado" } };
  }

  try {
    await publicar(deps.topicInbound, { eventoId: registro.fila.id });
    await marcarEventoPublicado(deps.supabase, { id: registro.fila.id });
    return { status: 200, cuerpo: { procesado: true, eventId } };
  } catch {
    // Publicación falló o quedó incierta -- el evento YA está persistido
    // (registrarEvento fue exitoso), así que se responde 200 igual (Meta
    // no tiene la culpa de un fallo nuestro). published_at queda NULL --
    // el barrido de recuperación de dulabs-reconciliation lo recupera.
    return { status: 200, cuerpo: { procesado: true, eventId, publicacionPendiente: true } };
  }
}
