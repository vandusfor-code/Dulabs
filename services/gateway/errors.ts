// DuLabs Developer V1 -- Fase 4 (autorizado, sección "ERROR MODEL", decisión
// oficial: mantener el contrato real de éxito de POST /api/v1/messages,
// pero cerrar el modelo de error uniforme que Fase 1 diseñó y el código
// real nunca implementó consistentemente). Envoltorio único para TODA
// respuesta de error de la Developer API pública -- nunca un string plano.

export type CodigoErrorApi =
  | "missing_api_key"
  | "invalid_api_key"
  | "invalid_request"
  | "invalid_whatsapp_number"
  | "forbidden"
  | "not_found"
  | "idempotency_conflict"
  | "rate_limit_exceeded"
  | "usage_limit_exceeded"
  | "internal_error";

export type RespuestaApi = { status: number; cuerpo: Record<string, unknown>; headers?: Record<string, string> };

/**
 * Construye la respuesta de error uniforme. `message` debe ser SIEMPRE
 * seguro de mostrar -- nunca un mensaje de error de Postgres/KMS/Supabase
 * crudo, nunca un stack trace, nunca un detalle de infraestructura. Los
 * callers deben pasar un mensaje ya sanitizado, no el error original.
 */
export function errorApi(status: number, code: CodigoErrorApi, message: string, requestId: string, headers?: Record<string, string>): RespuestaApi {
  return { status, cuerpo: { error: { code, message, request_id: requestId } }, headers };
}

/** Envoltorio de éxito -- agrega X-Request-Id sin tocar la forma del body de éxito (decisión D1: no se cambia el contrato real existente). */
export function exitoApi(status: number, cuerpo: Record<string, unknown>, requestId: string): RespuestaApi {
  return { status, cuerpo, headers: { "X-Request-Id": requestId } };
}
