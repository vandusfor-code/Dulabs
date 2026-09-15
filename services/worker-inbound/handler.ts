import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerEventoPorId, marcarEventoProcesado } from "@/lib/developer/events-store";
import { obtenerNumeroPorPhoneNumberId } from "@/lib/developer/whatsapp-numbers-store";
import { obtenerWebhookDelNumero, obtenerSecretoWebhookDelNumero } from "@/lib/developer/webhook-config-store";
import { firmarEvento, HEADER_FIRMA, HEADER_TIMESTAMP, HEADER_EVENT_ID } from "@/lib/developer/webhook-signature";
import { validarUrlWebhookSegura, type FuncionLookupDns } from "@/lib/developer/ssrf-guard";

// DuLabs Developer V1 -- Fase 3 (autorizado, sección B del documento de
// infraestructura). Handler del Worker inbound -- procesa UN mensaje push
// de dulabs-inbound (una referencia a una fila ya persistida y validada por
// el Gateway en dulabs_dev_events). Reenvía el contenido al Developer
// Webhook configurado (si existe), firmado con HMAC (webhook-signature.ts,
// Fase 1, sin modificar).

export type DependenciasWorkerInbound = {
  supabase: SupabaseClient;
  fetchImpl?: typeof fetch;
  // Inyectable a propósito (mismo criterio que fetchImpl) -- los tests de DNS
  // rebinding necesitan controlar exactamente a qué IP "resuelve" la URL del
  // webhook al momento del envío, sin depender de un DNS real. En producción
  // queda undefined y ssrf-guard usa el resolver real.
  lookupDnsFn?: FuncionLookupDns;
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
 * Procesa un mensaje de dulabs-inbound. Idempotente por diseño: el único
 * efecto secundario real es el POST al Developer Webhook, así que el CAS
 * de `marcarEventoProcesado` protege ESE punto específicamente -- no toda
 * la función. Resolver el evento/número/webhook/secreto y firmar son
 * operaciones de solo lectura + cómputo local, sin efecto secundario, por
 * lo que son seguras de repetir en cada entrega/redelivery sin necesidad
 * de CAS.
 *
 * CORRECCIÓN (Fase 3, cierre): originalmente el CAS corría ANTES de
 * resolver número/webhook/secreto -- cualquier fallo transitorio en esa
 * ventana (ej. el gap real de IAM de KMS documentado como riesgo #1, o
 * cualquier error pasajero de Postgres) dejaba `procesado_en` marcado
 * permanentemente sin que el relay real hubiera ocurrido nunca, y todo
 * reintento de Pub/Sub encontraba el evento "ya procesado" y respondía 200
 * sin volver a intentar -- el evento nunca llegaba a DLQ, el relay nunca
 * se completaba, sin ninguna señal visible del fallo. Mover el CAS a
 * proteger solo el `fetch` real corrige esto sin debilitar la garantía de
 * "como mucho un relay real por evento": ante una entrega concurrente
 * genuina, ambas pueden resolver/firmar en paralelo (barato, sin efecto
 * secundario), pero solo una gana el CAS justo antes del POST.
 */
export async function procesarMensajeInbound(deps: DependenciasWorkerInbound, mensaje: MensajePubSubInbound): Promise<ResultadoProcesamientoInbound> {
  const { supabase } = deps;
  const fetchFn = deps.fetchImpl ?? fetch;

  try {
    const evento = await obtenerEventoPorId(supabase, { id: mensaje.eventoId });
    if (!evento) return { httpStatus: 200, motivo: "evento_no_encontrado" };

    if (evento.procesado_en) return { httpStatus: 200, motivo: "ya_procesado_por_otra_entrega" };

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

    // Endurecimiento de seguridad (autorizado) -- protección real contra DNS
    // rebinding. La URL del webhook YA se validó contra SSRF al configurarse
    // (webhook-config-store.ts), pero esa validación es de solo-config: un
    // hostname que resolvía a una IP pública en ese momento puede resolver a
    // una IP interna (loopback, RFC1918, 169.254.169.254/metadata) justo al
    // momento real del envío. Se RE-VALIDA acá, inmediatamente antes del POST
    // -- mismo patrón de defensa en profundidad que ya usa el Flow para sus
    // integraciones externas (lib/flow/executors/http-integration-executor.ts,
    // re-valida SSRF en el dispatch). Si la URL ahora resuelve a un destino no
    // seguro, se rechaza el relay y a propósito NO se marca procesado (mismo
    // criterio que cualquier otro fallo ANTES del relay real -- ver el test de
    // regresión "sin webhook configurado"): así el evento no se pierde de forma
    // silenciosa si el desarrollador corrige su DNS más adelante.
    //
    // Límite conocido V1: esto reduce la ventana de rebinding a un TOCTOU
    // mínimo entre esta validación y la resolución DNS propia de fetch; el
    // pinning a la IP ya validada (vía undici Agent) queda como endurecimiento
    // futuro -- exactamente igual que el http-integration-executor del Flow,
    // que también se detiene en la re-validación.
    const validacionSsrf = await validarUrlWebhookSegura(webhook.url, deps.lookupDnsFn ? { lookupFn: deps.lookupDnsFn } : undefined);
    if (!validacionSsrf.permitido) {
      return { httpStatus: 200, motivo: `webhook_destino_no_seguro:${validacionSsrf.motivo}` };
    }

    const cuerpo = JSON.stringify({ event_id: evento.event_id, tipo: evento.tipo, payload: evento.payload });
    const firmado = firmarEvento(secretoWebhook, cuerpo);

    // CAS real, justo antes del único efecto secundario -- si otra entrega
    // concurrente ya ganó esta carrera exacta, no reenviamos de nuevo.
    const marcado = await marcarEventoProcesado(supabase, { id: evento.id });
    if (!marcado.marcado) return { httpStatus: 200, motivo: "ya_procesado_por_otra_entrega" };

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
