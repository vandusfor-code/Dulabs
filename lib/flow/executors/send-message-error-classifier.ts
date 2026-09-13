/**
 * FASE F8.3 (Meta Send Reliability, autorizado) — clasifica un error
 * lanzado por enviarTexto/enviarBotones (lib/whatsapp.ts,
 * lib/whatsapp-outbound.ts) en una de las EFFECT_RESULT_CLASSIFICATIONS ya
 * existentes (lib/flow/executor-types.ts), para que
 * lib/flow/flow-orchestrator.ts sepa si vale la pena reintentar un efecto
 * send_message. No inventa clasificaciones nuevas -- reutiliza las 9 que
 * ya existían antes de F8.3 (algunas sin consumidor real hasta ahora,
 * como RATE_LIMIT/TIMEOUT).
 *
 * Reglas (ver F8.3 IMPLEMENTATION REPORT §3 para la versión narrativa):
 *  - HTTP 401, o código Meta 190 (invalid/expired OAuth access token) ->
 *    AUTH_ERROR. Nunca se reintenta: un token vencido no se arregla
 *    reintentando la misma petición.
 *  - HTTP 429 -> RATE_LIMIT. Retryable; usa Retry-After si Meta lo envía
 *    (ver retryAfterMs, acotado por SEND_MESSAGE_BACKOFF_MAX_MS en el
 *    orchestrator).
 *  - HTTP 5xx -> RETRYABLE. Error transitorio del lado de Meta.
 *  - Cualquier otro 4xx (400/403/404/...) -> NON_RETRYABLE. Meta ya
 *    procesó la petición y la rechazó de forma permanente (destinatario
 *    inválido, plantilla rechazada, payload inválido, tipo no soportado,
 *    error de política) -- reintentar el mismo payload nunca lo arregla.
 *  - Timeout (AbortError/TimeoutError -- incluye el timeout del propio
 *    EffectExecutorFramework, ver executor-framework.ts) -> TIMEOUT.
 *    Retryable, con la advertencia de duplicación documentada en el
 *    reporte (Meta pudo haber recibido el mensaje igual antes del abort).
 *  - Error de red (fetch nunca llegó a obtener una respuesta HTTP --
 *    TypeError de undici/Node) -> RETRYABLE, misma advertencia de
 *    duplicación que timeout.
 *  - Cualquier otro error no reconocido -> NON_RETRYABLE. Default seguro:
 *    nunca reintentar algo que no se entiende, para no arriesgar un loop
 *    de reintentos sobre un bug real no relacionado con Meta.
 */
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectResultClassification } from "@/lib/flow/executor-types";
import { MetaGraphApiError } from "@/lib/whatsapp";

export interface ClassifiedSendError {
  classification: EffectResultClassification;
  httpStatus?: number;
  metaErrorCode?: number;
  metaErrorMessage?: string;
  retryAfterMs?: number;
}

/** Códigos de error de Meta que significan "token inválido/vencido" independientemente del HTTP status que haya venido. */
const META_AUTH_ERROR_CODES = new Set([190]);

export function classifyMetaSendError(err: unknown): ClassifiedSendError {
  if (err instanceof MetaGraphApiError) {
    const { httpStatus, metaErrorCode, metaErrorMessage, retryAfterMs } = err;
    if (httpStatus === 401 || (metaErrorCode !== undefined && META_AUTH_ERROR_CODES.has(metaErrorCode))) {
      return { classification: EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR, httpStatus, metaErrorCode, metaErrorMessage };
    }
    if (httpStatus === 429) {
      return {
        classification: EFFECT_RESULT_CLASSIFICATIONS.RATE_LIMIT,
        httpStatus,
        metaErrorCode,
        metaErrorMessage,
        retryAfterMs,
      };
    }
    if (httpStatus >= 500 && httpStatus <= 599) {
      return { classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, httpStatus, metaErrorCode, metaErrorMessage };
    }
    return { classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, httpStatus, metaErrorCode, metaErrorMessage };
  }

  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return { classification: EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT };
  }

  // fetch() (Node/undici) lanza TypeError para fallos de red (DNS, conexión
  // rechazada/reiniciada) -- nunca llegó a haber una respuesta HTTP de Meta.
  if (err instanceof TypeError) {
    return { classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE };
  }

  return { classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE };
}

/** true si esta clasificación justifica un reintento de send_message (ver flow-orchestrator.ts). */
export function isSendMessageRetryableClassification(classification: EffectResultClassification): boolean {
  return (
    classification === EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE ||
    classification === EFFECT_RESULT_CLASSIFICATIONS.RATE_LIMIT ||
    classification === EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT
  );
}
