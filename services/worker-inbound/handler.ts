import type { SupabaseClient } from "@supabase/supabase-js";
import {
  obtenerEventoPorId,
  reclamarEntrega,
  marcarEntregado,
  marcarEntregaReintentable,
  marcarEntregaDlq,
  marcarEntregaSinWebhook,
} from "@/lib/developer/events-store";
import { obtenerNumeroPorPhoneNumberId } from "@/lib/developer/whatsapp-numbers-store";
import { obtenerWebhookDelNumero, obtenerSecretoWebhookDelNumero } from "@/lib/developer/webhook-config-store";
import { firmarEvento, HEADER_FIRMA, HEADER_TIMESTAMP, HEADER_EVENT_ID } from "@/lib/developer/webhook-signature";
import { validarUrlWebhookSegura, type FuncionLookupDns } from "@/lib/developer/ssrf-guard";
import { clasificarWebhookMeta, extraerPhoneNumberIdMeta, extraerStatusMeta, normalizarEventoInbound } from "@/lib/developer/inbound-event-mapper";
import { aplicarDeliveryStatus, adquirirLease, aplicarEventoJob, liberarLease } from "@/lib/developer/jobs-store";
import { confirmarUso } from "@/lib/developer/usage-ledger";

// DuLabs Developer V1 -- Fase 3 (autorizado), reescrito en Fase 6
// (autorizado, D1-D4). Handler del Worker inbound. Dos responsabilidades:
//
// 1. STATUS de Meta (sent/delivered/read/failed): correlaciona por
//    (phone_number_id + workspace + wamid) -- NUNCA solo por wamid --,
//    actualiza delivery_status de forma monotónica (dimensión ortogonal, la
//    máquina de estados congelada de Fase 1 no se toca) y, si el Job estaba
//    en reconciliation_pending, lo resuelve vía el evento YA existente
//    `reconciliacion_confirmo_enviado` (sin endpoint ficticio, sin blind
//    resend). La deuda de Fase 5 (consultarEstadoEnMeta) queda resuelta acá.
//
// 2. ENTREGA al webhook del Developer (D1/D3): entrega el evento NORMALIZADO
//    (message.received | message.status) + raw, con reintentos acotados +
//    DLQ (D2), reusando SSRF (config + send-time), HMAC, timeout e
//    idempotencia por event_id/entrega_estado.

export type DependenciasWorkerInbound = {
  supabase: SupabaseClient;
  fetchImpl?: typeof fetch;
  lookupDnsFn?: FuncionLookupDns;
  metaGraphApiBaseUrl?: string; // no se usa para inbound; presente por simetría de deps
};

export type MensajePubSubInbound = { eventoId: number };

export type ResultadoProcesamientoInbound = { httpStatus: 200 | 500; motivo: string };

const ESTADOS_ENTREGA_TERMINALES = new Set(["entregado", "dlq", "sin_webhook"]);

/** Correlación de un status de Meta con su Job outbound + resolución de reconciliation_pending. Idempotente: re-aplicar el mismo status o resolver un job ya resuelto son no-ops seguros. */
async function correlacionarStatus(
  supabase: SupabaseClient,
  params: { workspaceId: string; whatsappNumberId: string; payload: unknown }
): Promise<void> {
  const st = extraerStatusMeta(params.payload);
  if (!st || !st.wamid) return;

  const resultado = await aplicarDeliveryStatus(supabase, {
    workspaceId: params.workspaceId,
    whatsappNumberId: params.whatsappNumberId,
    wamid: st.wamid,
    status: st.status,
    statusAt: st.timestamp ? new Date(Number(st.timestamp) * 1000).toISOString() : undefined,
  });

  // Resolución de reconciliation_pending (decisión I, Opción 1 aprobada): un
  // status sent/delivered/read es evidencia REAL de que Meta envió el mensaje.
  // La correlación es EXCLUSIVAMENTE por wamid (obtenerJobPorWamid) -- nunca
  // heurística por recipient/ventana temporal. Consecuencia explícita del
  // contrato de seguridad "no inventar certeza": un job que entró en
  // reconciliation_pending por timeout NUNCA capturó wamid, así que este
  // bloque no lo encontrará y el job permanece uncertain -- eso NO es un bug,
  // es lo aprobado. Este bloque solo resuelve el caso (seguro) en que sí
  // existe un Job con ese wamid exacto todavía en reconciliation_pending.
  if (resultado.job && resultado.job.status === "reconciliation_pending" && (st.status === "sent" || st.status === "delivered" || st.status === "read")) {
    const lease = await adquirirLease(supabase, { workspaceId: params.workspaceId, jobId: resultado.job.id });
    if (lease.adquirido) {
      try {
        const r = await aplicarEventoJob(supabase, { workspaceId: params.workspaceId, jobId: resultado.job.id, leaseId: lease.leaseId, evento: { tipo: "reconciliacion_confirmo_enviado" } });
        if (r.aplicada && r.job.status === "success_confirmed") {
          await confirmarUso(supabase, { workspaceId: params.workspaceId, jobId: resultado.job.id }).catch(() => {});
        }
      } finally {
        await liberarLease(supabase, { workspaceId: params.workspaceId, jobId: resultado.job.id, leaseId: lease.leaseId }).catch(() => {});
      }
    }
  }
}

/** Clasifica la respuesta HTTP del webhook del Developer en retryable vs terminal (D2): 4xx es terminal salvo 408/429; 5xx y timeouts son reintentables. */
function esRespuestaReintentable(status: number): boolean {
  if (status >= 500) return true;
  if (status === 408 || status === 429) return true;
  return false; // 2xx no llega acá; 4xx (salvo 408/429) es terminal
}

export async function procesarMensajeInbound(deps: DependenciasWorkerInbound, mensaje: MensajePubSubInbound): Promise<ResultadoProcesamientoInbound> {
  const { supabase } = deps;
  const fetchFn = deps.fetchImpl ?? fetch;

  try {
    const evento = await obtenerEventoPorId(supabase, { id: mensaje.eventoId });
    if (!evento) return { httpStatus: 200, motivo: "evento_no_encontrado" };
    if (ESTADOS_ENTREGA_TERMINALES.has(evento.entrega_estado)) return { httpStatus: 200, motivo: `entrega_ya_terminal:${evento.entrega_estado}` };
    if (!evento.payload) {
      await marcarEntregaDlq(supabase, { id: evento.id, motivoSanitizado: "evento_sin_payload" });
      return { httpStatus: 200, motivo: "evento_sin_payload" };
    }

    const phoneNumberId = extraerPhoneNumberIdMeta(evento.payload);
    if (!phoneNumberId) {
      await marcarEntregaDlq(supabase, { id: evento.id, motivoSanitizado: "payload_sin_phone_number_id" });
      return { httpStatus: 200, motivo: "payload_sin_phone_number_id" };
    }

    const numero = await obtenerNumeroPorPhoneNumberId(supabase, phoneNumberId);
    if (!numero || numero.workspace_id !== evento.workspace_id) {
      await marcarEntregaDlq(supabase, { id: evento.id, motivoSanitizado: "numero_no_resuelto_o_workspace_no_coincide" });
      return { httpStatus: 200, motivo: "numero_no_resuelto_o_workspace_no_coincide" };
    }

    // (1) STATUS: correlación interna, independiente de que el webhook del
    // Developer esté arriba -- el estado del Job nunca depende de eso.
    if (clasificarWebhookMeta(evento.payload) === "status") {
      await correlacionarStatus(supabase, { workspaceId: evento.workspace_id, whatsappNumberId: numero.id, payload: evento.payload });
    }

    // (2) ENTREGA al webhook del Developer (message.received y message.status).
    const webhook = await obtenerWebhookDelNumero(supabase, { workspaceId: evento.workspace_id, whatsappNumberId: numero.id });
    if (!webhook || webhook.estado !== "activo") {
      await marcarEntregaSinWebhook(supabase, { id: evento.id });
      return { httpStatus: 200, motivo: "sin_webhook_configurado_o_pausado" };
    }

    const claim = await reclamarEntrega(supabase, { id: evento.id });
    if (!claim.reclamado || !claim.fila) return { httpStatus: 200, motivo: "entrega_no_reclamada_o_no_vencida" };
    const intentosPrevios = claim.fila.entrega_intentos;

    const secreto = await obtenerSecretoWebhookDelNumero(supabase, { workspaceId: evento.workspace_id, whatsappNumberId: numero.id });
    if (!secreto) {
      await marcarEntregaReintentable(supabase, { id: evento.id, intentosPrevios, motivoSanitizado: "secreto_no_disponible" });
      return { httpStatus: 200, motivo: "secreto_no_disponible" };
    }

    // SSRF send-time (DNS rebinding) -- destino inseguro es TERMINAL (nunca se reintenta pegarle a una IP interna).
    const ssrf = await validarUrlWebhookSegura(webhook.url, deps.lookupDnsFn ? { lookupFn: deps.lookupDnsFn } : undefined);
    if (!ssrf.permitido) {
      await marcarEntregaDlq(supabase, { id: evento.id, motivoSanitizado: `destino_no_seguro:${ssrf.motivo}` });
      return { httpStatus: 200, motivo: `webhook_destino_no_seguro:${ssrf.motivo}` };
    }

    const normal = normalizarEventoInbound({ payload: evento.payload, eventId: evento.event_id, workspaceId: evento.workspace_id, whatsappNumberId: numero.id });
    if (!normal) {
      await marcarEntregaDlq(supabase, { id: evento.id, motivoSanitizado: "evento_no_normalizable" });
      return { httpStatus: 200, motivo: "evento_no_normalizable" };
    }

    const cuerpo = JSON.stringify(normal);
    const firmado = firmarEvento(secreto, cuerpo);

    let respuesta: Response;
    try {
      respuesta = await fetchFn(webhook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", [HEADER_FIRMA]: firmado.firma, [HEADER_TIMESTAMP]: String(firmado.timestamp), [HEADER_EVENT_ID]: evento.event_id },
        body: cuerpo,
        signal: AbortSignal.timeout(10_000),
        // Fase 16 (hardening SSRF): NUNCA seguir redirects. El SSRF guard valida
        // la IP de webhook.url ANTES del fetch; si se siguiera un 3xx, el destino
        // final (elegido por el endpoint del Developer) escaparía esa validación
        // y podría apuntar a metadata/red interna. Un 3xx queda como respuesta no
        // "ok" y no reintentable -> DLQ terminal (mismo criterio que el ping).
        redirect: "manual",
      });
    } catch {
      // Timeout / conexión -- reintentable (nunca se filtra el error real al log).
      await marcarEntregaReintentable(supabase, { id: evento.id, intentosPrevios, motivoSanitizado: "timeout_o_conexion" });
      return { httpStatus: 200, motivo: "entrega_reintentable:timeout_o_conexion" };
    }

    if (respuesta.ok) {
      await marcarEntregado(supabase, { id: evento.id });
      return { httpStatus: 200, motivo: `entregado:${normal.event_type}` };
    }

    if (esRespuestaReintentable(respuesta.status)) {
      await marcarEntregaReintentable(supabase, { id: evento.id, intentosPrevios, motivoSanitizado: `http_${respuesta.status}` });
      return { httpStatus: 200, motivo: `entrega_reintentable:http_${respuesta.status}` };
    }

    // 4xx terminal (el endpoint del Developer rechazó el evento -- reintentar no ayuda).
    await marcarEntregaDlq(supabase, { id: evento.id, intentos: intentosPrevios + 1, motivoSanitizado: `http_${respuesta.status}` });
    return { httpStatus: 200, motivo: `entrega_dlq:http_${respuesta.status}` };
  } catch (err) {
    // Error transitorio de infraestructura ANTES/DURANTE -- 500 deja que Pub/Sub reintente. Nunca se filtra detalle sensible.
    return { httpStatus: 500, motivo: `error_transitorio:${err instanceof Error ? err.message : String(err)}` };
  }
}
