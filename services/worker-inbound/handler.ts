import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerEventoPorId, marcarEventoProcesado } from "@/lib/developer/events-store";
import { obtenerNumeroPorPhoneNumberId } from "@/lib/developer/whatsapp-numbers-store";
import { obtenerWebhookDelNumero, obtenerSecretoWebhookDelNumero } from "@/lib/developer/webhook-config-store";
import { firmarEvento, HEADER_FIRMA, HEADER_TIMESTAMP, HEADER_EVENT_ID } from "@/lib/developer/webhook-signature";

// DuLabs Developer V1 -- Fase 3 (autorizado, sección B del documento de
// infraestructura). Handler del Worker inbound -- procesa UN mensaje push
// de dulabs-inbound (una referencia a una fila ya persistida y validada por
// el Gateway en dulabs_dev_events). Reenvía el contenido al Developer
// Webhook configurado (si existe), firmado con HMAC (webhook-signature.ts,
// Fase 1, sin modificar).

export type DependenciasWorkerInbound = {
  supabase: SupabaseClient;
  fetchImpl?: typeof fetch;
};

export type MensajePubSubInbound = { eventoId: number };

export type ResultadoProcesamientoInbound = { httpStatus: 200 | 500; motivo: string };

function extraerPhoneNumberId(payload: unknown): string | null {
  try {
    const entry = (payload as { entry?: Array<{ changes?: Array<{ value?: { metadata?: { phone_number_id?: string } } }> }> })?.entry?.[0];
    return entry?.changes?.[0]?.value?.metadata?.phone_number_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Procesa un mensaje de dulabs-inbound. Idempotente por diseño: si el
 * evento ya fue marcado `procesado_en` (por una entrega anterior, real o
 * por el barrido de recuperación republicando de más -- ver sección A del
 * documento), esta llamada es un no-op seguro -- SIEMPRE ACK (200), nunca
 * hay "efecto secundario duplicado" posible porque el reenvío al Developer
 * Webhook solo ocurre si `marcarEventoProcesado` de verdad ganó la carrera.
 */
export async function procesarMensajeInbound(deps: DependenciasWorkerInbound, mensaje: MensajePubSubInbound): Promise<ResultadoProcesamientoInbound> {
  const { supabase } = deps;
  const fetchFn = deps.fetchImpl ?? fetch;

  try {
    const evento = await obtenerEventoPorId(supabase, { id: mensaje.eventoId });
    if (!evento) return { httpStatus: 200, motivo: "evento_no_encontrado" };

    // CAS real -- si otra entrega concurrente (o una redelivery) ya ganó
    // esta carrera, no reenviamos de nuevo. Esto es lo que prueba el
    // requisito "recibir dos veces el mismo evento no genera efectos
    // secundarios duplicados".
    const marcado = await marcarEventoProcesado(supabase, { id: evento.id });
    if (!marcado.marcado) return { httpStatus: 200, motivo: "ya_procesado_por_otra_entrega" };

    if (!evento.payload) return { httpStatus: 200, motivo: "evento_sin_payload_nada_que_reenviar" };

    const phoneNumberId = extraerPhoneNumberId(evento.payload);
    if (!phoneNumberId) return { httpStatus: 200, motivo: "payload_sin_phone_number_id" };

    const numero = await obtenerNumeroPorPhoneNumberId(supabase, phoneNumberId);
    if (!numero || numero.workspace_id !== evento.workspace_id) {
      return { httpStatus: 200, motivo: "numero_no_resuelto_o_workspace_no_coincide" };
    }

    const webhook = await obtenerWebhookDelNumero(supabase, { workspaceId: evento.workspace_id, whatsappNumberId: numero.id });
    if (!webhook || webhook.estado !== "activo") {
      return { httpStatus: 200, motivo: "sin_webhook_configurado_o_pausado" };
    }

    const secretoWebhook = await obtenerSecretoWebhookDelNumero(supabase, { workspaceId: evento.workspace_id, whatsappNumberId: numero.id });
    if (!secretoWebhook) return { httpStatus: 200, motivo: "secreto_de_webhook_no_disponible" };

    const cuerpo = JSON.stringify({ event_id: evento.event_id, tipo: evento.tipo, payload: evento.payload });
    const firmado = firmarEvento(secretoWebhook, cuerpo);

    try {
      await fetchFn(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [HEADER_FIRMA]: firmado.firma,
          [HEADER_TIMESTAMP]: String(firmado.timestamp),
          [HEADER_EVENT_ID]: evento.event_id,
        },
        body: cuerpo,
        signal: AbortSignal.timeout(10_000),
      });
      // No se condiciona el ACK a que el desarrollador haya respondido 200
      // -- eso es responsabilidad de su propio endpoint/reintentos, fuera
      // del contrato de "at-least-once hacia DuLabs, exactamente-una-vez
      // procesado del lado nuestro" que este Worker garantiza.
    } catch {
      // Fallo de red hacia el webhook del desarrollador -- ya se marcó
      // procesado (decisión deliberada: at-most-once del lado nuestro
      // hacia el desarrollador, no se reintenta automáticamente desde acá
      // en V1 -- ver nota en el reporte de Fase 3).
    }

    return { httpStatus: 200, motivo: "reenviado_a_developer_webhook" };
  } catch (err) {
    return { httpStatus: 500, motivo: `error_transitorio:${err instanceof Error ? err.message : String(err)}` };
  }
}
