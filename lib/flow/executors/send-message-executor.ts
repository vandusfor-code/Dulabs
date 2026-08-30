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
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarTexto } from "@/lib/whatsapp";
import { enviarBotones, resolverTokenMeta, incrementarUsoMensajes, registrarMensaje } from "@/lib/whatsapp-outbound";
import type { ClienteConfig } from "@/lib/supabase";
import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutionContext,
  type EffectExecutor,
  type InternalActionOperationClass,
} from "@/lib/flow/executor-types";
import type { FlowMessageContent } from "@/lib/flow/types";

export interface SendMessageDeps {
  supabase: SupabaseClient;
  /** Inyectable para tests — default: SELECT real sobre dulabs_clientes_config. */
  resolverCliente?: (supabase: SupabaseClient, phoneNumberId: string) => Promise<ClienteConfig | null>;
  /** Inyectables para tests — default: llamadas reales a la Graph API de Meta. */
  enviarTexto?: typeof enviarTexto;
  enviarBotones?: typeof enviarBotones;
  incrementarUsoMensajes?: typeof incrementarUsoMensajes;
  registrarMensaje?: typeof registrarMensaje;
}

async function resolverClienteDefault(supabase: SupabaseClient, phoneNumberId: string): Promise<ClienteConfig | null> {
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

export class SendMessageExecutor implements EffectExecutor {
  readonly kind = "send_message" as const;
  readonly version = "2.0.0";
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

    // Media y plantillas Meta: fuera de alcance de este corte (blocker
    // documentado, no un parche a medias) -- solo texto y botones, que es
    // todo lo que necesita el Flow de Daniela diseñado en esta fase.
    if (request.message.content.template) {
      return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, error: "template_send_not_implemented" };
    }
    if (request.message.content.media && !resolverTextoPlano(request.message.content)) {
      return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, error: "media_send_not_implemented" };
    }

    const texto = resolverTextoPlano(request.message.content);
    if (!texto) {
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
    const incrementarUsoMensajesFn = this.deps.incrementarUsoMensajes ?? incrementarUsoMensajes;
    const registrarMensajeFn = this.deps.registrarMensaje ?? registrarMensaje;

    let wamid: string | null = null;
    try {
      if (request.message.buttons?.length) {
        ({ wamid } = await enviarBotonesFn({
          phoneNumberId: cliente.phone_number_id,
          token,
          para: conversation.telefonoCliente,
          cuerpo: texto,
          botones: request.message.buttons.map((b) => ({ id: b.id, titulo: b.label })),
        }));
      } else {
        ({ wamid } = await enviarTextoFn({
          phoneNumberId: cliente.phone_number_id,
          token,
          para: conversation.telefonoCliente,
          texto,
        }));
      }
    } catch (err) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE,
        error: err instanceof Error ? err.message : "meta_send_failed",
      };
    }

    await incrementarUsoMensajesFn(this.deps.supabase, cliente);
    await registrarMensajeFn(
      this.deps.supabase,
      cliente.phone_number_id,
      conversation.telefonoCliente,
      "saliente",
      texto,
      "ia",
      wamid ?? undefined,
    );

    const data = { delivered: true, wamid, nodeId: request.nodeId };
    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: {
        channel: "whatsapp",
        contentType: request.message.buttons?.length ? "buttons" : "text",
      },
      externalReference: wamid ? `wamid:${wamid}` : undefined,
    };
  }
}
