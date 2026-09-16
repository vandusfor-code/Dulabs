// DuLabs Developer V1 -- Fase 5 (autorizado, decisión D5). Clasificación
// PURA (sin red, sin DB) de errores 4xx reales de Meta, por su código
// propio (`error.code` en el cuerpo de la respuesta) -- NUNCA solo por el
// status HTTP, que por sí solo no distingue "número inválido" (nunca
// reintentar) de "rate limit de Meta" (reintentar con el mecanismo ya
// existente) de "error genérico de servicio" (incertidumbre real, mismo
// criterio que un timeout).
//
// Fuente: documentación real de Meta, "WhatsApp error codes"
// (developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes),
// consultada en esta fase. Lista DELIBERADAMENTE mínima -- no un catálogo
// exhaustivo de los cientos de códigos de Meta, solo los que cambian el
// comportamiento real de reintento (instrucción explícita: "no construyas
// una lista enorme innecesaria").

export type ClasificacionErrorMeta = "permanente" | "retryable" | "incertidumbre";

// Errores que Meta documenta como validación/negocio definitiva -- nunca
// tiene sentido reintentar el MISMO job, sin importar cuántos intentos
// físicos queden disponibles.
const CODIGOS_PERMANENTES = new Set([
  131021, // sender y recipient son el mismo número
  131026, // no se puede entregar -- destinatario no es usuario de WhatsApp / motivo permanente
  131047, // ventana de 24h de re-engagement ya cerrada
  131050, // el destinatario optó por no recibir mensajes de marketing
  132001, // la plantilla no existe en ese idioma / no está aprobada
]);

// Errores de rate limit / throughput real de Meta -- documentados
// explícitamente como el caso que esta decisión pide verificar con
// cuidado. Deben usar el mecanismo de retry YA existente (retry_pending),
// nunca tratarse como permanentes.
const CODIGOS_RATE_LIMIT = new Set([
  4, // límite de tasa de la app
  80007, // límite de tasa de la WhatsApp Business Account
  130429, // throughput de mensajes de la Cloud API alcanzado
  131048, // restricciones de cuántos mensajes puede mandar este número
  131056, // demasiados mensajes al mismo destinatario en poco tiempo
]);

// Errores genéricos de servicio de Meta -- no hay certeza real de si el
// mensaje se procesó o no antes de que Meta fallara del lado suyo. Mismo
// criterio conservador que un timeout de red: incertidumbre, nunca "no
// enviado".
const CODIGOS_INCERTIDUMBRE = new Set([
  1, // request inválida o posible error de servidor
  2, // temporal, por downtime o sobrecarga
  131016, // servicio temporalmente no disponible
  133004, // servidor temporalmente no disponible
]);

/**
 * Clasifica un error 4xx real de Meta por su `error.code` propio. Un
 * código desconocido (o un cuerpo sin `error.code` parseable) cae en
 * "retryable" -- es el comportamiento que YA existía antes de esta
 * clasificación (un 4xx sin distinguir pasaba por meta_rechazo, dejando
 * que la máquina de estados decida retry_pending/failed_by_meta según los
 * intentos restantes) -- nunca se asume "permanente" para algo que no se
 * reconoce, eso sería más agresivo que el comportamiento previo.
 */
export function clasificarErrorMeta(cuerpoRespuestaMeta: unknown): ClasificacionErrorMeta {
  const codigo = extraerCodigoError(cuerpoRespuestaMeta);
  if (codigo === null) return "retryable";
  if (CODIGOS_PERMANENTES.has(codigo)) return "permanente";
  if (CODIGOS_RATE_LIMIT.has(codigo)) return "retryable";
  if (CODIGOS_INCERTIDUMBRE.has(codigo)) return "incertidumbre";
  return "retryable";
}

function extraerCodigoError(cuerpo: unknown): number | null {
  if (!cuerpo || typeof cuerpo !== "object") return null;
  const error = (cuerpo as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const codigo = (error as { code?: unknown }).code;
  return typeof codigo === "number" ? codigo : null;
}
