/**
 * Send Message Executor — I/O real de WhatsApp (Fase 0, autorizado).
 *
 * Reemplaza el stub original ("I/O real en fase posterior", Fase 4.1) con
 * el envío real, reutilizando exactamente las mismas piezas que ya usa el
 * webhook LEGACY para mandar mensajes: resolverTokenMeta / enviarTexto /
 * enviarBotones de lib/whatsapp[-outbound].ts, y el mismo registro en
 * dulabs_mensajes_log. No se reimplementa la llamada a la API de Meta desde
 * cero -- se llama a las funciones de bajo nivel que SÍ propagan
 * éxito/fallo (a diferencia de enviarWhatsApp/enviarBotonesWhatsApp, que
 * tragan el error y devuelven void, pensadas para un caller que no necesita
 * saber si falló). Esto NO toca ni cambia el webhook LEGACY: es un
 * segundo, independiente lector/escritor de las mismas tablas
 * (dulabs_clientes_config, dulabs_mensajes_log) que LEGACY ya usa.
 *
 * FASE F8.4 (WhatsApp Media, autorizado) -- reemplaza el stub
 * "media_send_not_implemented" con envío real de los 5 tipos de media de
 * Meta (image/video/audio/document/sticker), vía enviarMedia (lib/whatsapp.ts).
 * Solo OUTBOUND -- la recepción de media entrante queda fuera de esta fase
 * (requiere modificar app/webhook-dulabs/route.ts, archivo protegido; ver
 * F8.4 IMPLEMENTATION REPORT sección "Bloqueo: recepción de media").
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarTexto, enviarMedia } from "@/lib/whatsapp";
import { enviarBotones, resolverTokenMeta, incrementarUsoMensajes, registrarMensaje } from "@/lib/whatsapp-outbound";
import type { ClienteConfig } from "@/lib/supabase";
import {
  EFFECT_RESULT_CLASSIFICATIONS,
  MAX_SEND_MESSAGE_ATTEMPTS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutionContext,
  type EffectExecutor,
  type InternalActionOperationClass,
} from "@/lib/flow/executor-types";
import { classifyMetaSendError } from "@/lib/flow/executors/send-message-error-classifier";
import type { FlowMediaRef, FlowMediaType, FlowMessageContent } from "@/lib/flow/types";

export interface SendMessageDeps {
  supabase: SupabaseClient;
  /** Inyectable para tests — default: SELECT real sobre dulabs_clientes_config. */
  resolverCliente?: (supabase: SupabaseClient, phoneNumberId: string) => Promise<ClienteConfig | null>;
  /** Inyectables para tests — default: llamadas reales a la Graph API de Meta. */
  enviarTexto?: typeof enviarTexto;
  enviarBotones?: typeof enviarBotones;
  enviarMedia?: typeof enviarMedia;
  incrementarUsoMensajes?: typeof incrementarUsoMensajes;
  registrarMensaje?: typeof registrarMensaje;
}

// FASE F8.1 (autorizado) -- exportada para que InternalActionExecutor
// (lib/flow/executors/internal-action-executor.ts, acción enviar_plantilla)
// reutilice EXACTAMENTE esta misma resolución en vez de duplicarla: ambos
// executors resuelven "la config de un número de WhatsApp" de la MISMA
// forma, por diseño, para no poder divergir en silencio.
export async function resolverClienteDefault(supabase: SupabaseClient, phoneNumberId: string): Promise<ClienteConfig | null> {
  const { data } = await supabase
    .from("dulabs_clientes_config")
    .select("*")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  return (data as ClienteConfig) ?? null;
}

/**
 * Texto plano a enviar -- NO reutiliza extractLogicalMessageText de
 * external-claim-security.ts a propósito: esa función normaliza el texto
 * (colapsa puntuación/espacios) para ANÁLISIS de claims, destruiría el
 * formato real del mensaje que debe llegarle a la clienta.
 */
function resolverTextoPlano(content: FlowMessageContent): string | null {
  if (content.text?.trim()) return content.text.trim();
  if (content.parts?.length) {
    const partes = content.parts.map((p) => p.trim()).filter(Boolean);
    if (partes.length) return partes.join("\n\n");
  }
  if (content.media?.caption?.trim()) return content.media.caption.trim();
  return null;
}

// FASE F8.4 (autorizado) -- placeholder para dulabs_mensajes_log.contenido
// (NOT NULL) cuando el media no trae caption -- mismo criterio que ya usaba
// enviarImagenWhatsApp (lib/whatsapp-outbound.ts) para "[imagen]", ahora
// generalizado a los 5 tipos.
const PLACEHOLDER_POR_TIPO: Record<FlowMediaType, string> = {
  image: "[imagen]",
  video: "[video]",
  audio: "[audio]",
  document: "[documento]",
  sticker: "[sticker]",
};

export class SendMessageExecutor implements EffectExecutor {
  readonly kind = "send_message" as const;
  readonly version = "3.0.0";
  readonly capabilities = {
    supportsIntegration: false,
    supportsAsync: false,
    operationClasses: [] as InternalActionOperationClass[],
  };

  constructor(private readonly deps: SendMessageDeps) {}

  async dispatch(
    request: EffectDispatchRequest,
    _context: EffectExecutionContext,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    if (signal?.aborted) {
      return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT, error: "executor_aborted" };
    }
    if (!request.message) {
      return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR, error: "message_content_required" };
    }
    const conversation = request.conversation;
    if (!conversation) {
      return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR, error: "conversation_required" };
    }

    // Plantillas Meta vía nodo "message": fuera de alcance (F8.1 ya resuelve
    // templates por un camino distinto, internal_action "enviar_plantilla" --
    // ver InternalActionExecutor. Este stub queda igual, sin tocar.
    if (request.message.content.template) {
      return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, error: "template_send_not_implemented" };
    }

    const media: FlowMediaRef | undefined = request.message.content.media;
    const buttons = request.message.buttons;

    // Meta solo permite un header de MEDIA en un mensaje interactivo de
    // botones cuando ese header es una imagen (ver enviarBotones/
    // headerMediaId/headerMediaLink) -- video/audio/document/sticker no
    // tienen equivalente de header interactivo en la Cloud API real. No se
    // inventa un fallback silencioso: se rechaza explícito.
    if (media && buttons?.length && media.type !== "image") {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "media_buttons_unsupported_type",
      };
    }
    if (media && !media.url && !media.mediaId) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "media_reference_required",
      };
    }

    const texto = resolverTextoPlano(request.message.content);
    // Sin media: se necesita texto (comportamiento LEGACY sin cambios). Con
    // media pero CON botones: Meta exige body.text en todo mensaje
    // interactivo, media o no -- mismo requisito. Con media SIN botones: el
    // media es el contenido, no hace falta texto (placeholder al loguear).
    if (!media && !texto) {
      return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR, error: "empty_message_content" };
    }
    if (media && buttons?.length && !texto) {
      return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR, error: "empty_message_content" };
    }

    const resolverCliente = this.deps.resolverCliente ?? resolverClienteDefault;
    const cliente = await resolverCliente(this.deps.supabase, conversation.phoneNumberId);
    if (!cliente) {
      return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, error: "cliente_config_not_found" };
    }
    // Mismo criterio que el webhook LEGACY (tenant_resource_mismatch): un
    // execution nunca puede mandar un mensaje a nombre de otro tenant.
    if (cliente.id_tenant !== request.tenantId) {
      return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED, error: "tenant_resource_mismatch" };
    }

    const token = resolverTokenMeta(cliente);
    if (!token) {
      return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR, error: "meta_token_unavailable" };
    }

    const enviarTextoFn = this.deps.enviarTexto ?? enviarTexto;
    const enviarBotonesFn = this.deps.enviarBotones ?? enviarBotones;
    const enviarMediaFn = this.deps.enviarMedia ?? enviarMedia;
    const incrementarUsoMensajesFn = this.deps.incrementarUsoMensajes ?? incrementarUsoMensajes;
    const registrarMensajeFn = this.deps.registrarMensaje ?? registrarMensaje;

    let wamid: string | null = null;
    let contentType: string;
    try {
      if (media && buttons?.length) {
        // media.type === "image", garantizado por el rechazo de arriba.
        ({ wamid } = await enviarBotonesFn({
          phoneNumberId: cliente.phone_number_id,
          token,
          para: conversation.telefonoCliente,
          cuerpo: texto as string,
          botones: buttons.map((b) => ({ id: b.id, titulo: b.label })),
          headerMediaId: media.mediaId,
          headerMediaLink: media.url,
          signal,
        }));
        contentType = "buttons_with_media";
      } else if (media) {
        ({ wamid } = await enviarMediaFn({
          phoneNumberId: cliente.phone_number_id,
          token,
          para: conversation.telefonoCliente,
          tipo: media.type,
          link: media.url,
          mediaId: media.mediaId,
          caption: media.caption,
          filename: media.filename,
          signal,
        }));
        contentType = media.type;
      } else if (buttons?.length) {
        ({ wamid } = await enviarBotonesFn({
          phoneNumberId: cliente.phone_number_id,
          token,
          para: conversation.telefonoCliente,
          cuerpo: texto as string,
          botones: buttons.map((b) => ({ id: b.id, titulo: b.label })),
          signal,
        }));
        contentType = "buttons";
      } else {
        ({ wamid } = await enviarTextoFn({
          phoneNumberId: cliente.phone_number_id,
          token,
          para: conversation.telefonoCliente,
          texto: texto as string,
          signal,
        }));
        contentType = "text";
      }
    } catch (err) {
      // FASE F8.3 (Meta Send Reliability, autorizado) -- clasificación real
      // por tipo de error (antes: RETRYABLE ciego para CUALQUIER excepción,
      // lo que habría hecho reintentar hasta un token vencido). El objeto
      // completo queda en `rawResult`/`metadata`, nunca solo en `error`
      // (string plano), para que quede trazable en dulabs_flow_effects
      // (resolveEffectResult ya sanitiza este payload -- ver
      // sanitizePayloadForObservability -- así que nunca se persiste un
      // token ni un header Authorization, solo lo que viene de acá).
      const clasificado = classifyMetaSendError(err);
      const detalle = {
        phoneNumberId: cliente.phone_number_id,
        attempt: request.attempt,
        maxAttempts: MAX_SEND_MESSAGE_ATTEMPTS,
        httpStatus: clasificado.httpStatus,
        metaErrorCode: clasificado.metaErrorCode,
        metaErrorMessage: clasificado.metaErrorMessage,
        mediaType: media?.type,
        error: err instanceof Error ? err.message : "meta_send_failed",
      };
      return {
        success: false,
        classification: clasificado.classification,
        error: err instanceof Error ? err.message : "meta_send_failed",
        rawResult: detalle,
        metadata: clasificado.retryAfterMs !== undefined ? { retryAfterMs: clasificado.retryAfterMs } : undefined,
      };
    }

    await incrementarUsoMensajesFn(this.deps.supabase, cliente);
    const contenidoLog = media ? (media.caption?.trim() || PLACEHOLDER_POR_TIPO[media.type]) : (texto as string);
    await registrarMensajeFn(
      this.deps.supabase,
      cliente.phone_number_id,
      conversation.telefonoCliente,
      "saliente",
      contenidoLog,
      "ia",
      wamid ?? undefined,
    );

    const data = {
      delivered: true,
      wamid,
      nodeId: request.nodeId,
      attempt: request.attempt,
      ...(media ? { mediaType: media.type } : {}),
    };
    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { channel: "whatsapp", contentType },
      externalReference: wamid ? `wamid:${wamid}` : undefined,
    };
  }
}
