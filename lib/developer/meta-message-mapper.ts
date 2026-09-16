// DuLabs Developer V1 -- Fase 5 (autorizado, decisión D2). Capa de mapeo
// PURA (sin red, sin DB) entre el contrato público de Developer API
// (Fase 4, FROZEN, sin tocar) y el shape real que exige la WhatsApp Cloud
// API de Meta. Hallazgo F1 del diseño de Fase 5: el Worker enviaba
// job.payload sin transformar -- le faltaba `messaging_product`, y
// llevaba un campo interno (`whatsappNumberId`) que Meta no espera. Esta
// transformación ocurre justo antes del POST físico, nunca al persistir
// el job (Fase 4 sigue guardando exactamente lo que el desarrollador
// envió, sin cambios).

export type PayloadDeveloperV1 = {
  whatsappNumberId: string;
  to: string;
  type: "text";
  text: { body: string };
};

export type PayloadMetaGraphApi = {
  messaging_product: "whatsapp";
  to: string;
  type: "text";
  text: { body: string };
};

/**
 * Traduce el payload interno (lo que Fase 4 valida y persiste, ver
 * services/gateway/validation.ts::CuerpoMensajeSaliente) al payload real
 * de Meta. Nunca incluye `whatsappNumberId` -- ese id ya se usa en la URL
 * del endpoint (`/{whatsapp_number_id}/messages`), no en el body.
 */
export function mapearPayloadAMeta(payload: PayloadDeveloperV1): PayloadMetaGraphApi {
  return {
    messaging_product: "whatsapp",
    to: payload.to,
    type: "text",
    text: { body: payload.text.body },
  };
}

export type ResultadoExtraccionWamid = { valido: true; wamid: string } | { valido: false; motivo: string };

// Formato real observado de un wamid de WhatsApp Cloud API: empieza con
// "wamid." seguido de una cadena base64-like. No se valida un formato
// exacto rígido (Meta no publica una gramática formal estable) -- se
// valida lo mínimo verificable: prefijo real y longitud mínima razonable,
// suficiente para rechazar basura obvia sin inventar una regla más
// estricta de la que Meta documenta.
const PREFIJO_WAMID = "wamid.";
const LONGITUD_MINIMA_WAMID = 20;

/**
 * Extrae y valida el wamid de una respuesta 2xx real de Meta
 * (`{messages:[{id:"wamid...."}]}`). Fase 5, decisión D4: si Meta
 * responde 2xx pero el cuerpo no trae un wamid con forma válida, NUNCA se
 * inventa un id ni se asume éxito silencioso -- se devuelve
 * `{valido:false}` explícito, y el caller decide qué hacer (ver
 * services/worker-outbound/handler.ts -- se trata como incertidumbre, no
 * como éxito ciego, exactamente el mismo criterio conservador que ya
 * existe para timeouts).
 */
export function extraerWamid(cuerpoRespuestaMeta: unknown): ResultadoExtraccionWamid {
  if (!cuerpoRespuestaMeta || typeof cuerpoRespuestaMeta !== "object") {
    return { valido: false, motivo: "respuesta_no_es_objeto_json" };
  }
  const mensajes = (cuerpoRespuestaMeta as { messages?: unknown }).messages;
  if (!Array.isArray(mensajes) || mensajes.length === 0) {
    return { valido: false, motivo: "sin_array_messages" };
  }
  const primero = mensajes[0] as { id?: unknown } | undefined;
  const id = primero?.id;
  if (typeof id !== "string" || !id.startsWith(PREFIJO_WAMID) || id.length < LONGITUD_MINIMA_WAMID) {
    return { valido: false, motivo: "id_con_formato_invalido" };
  }
  return { valido: true, wamid: id };
}
