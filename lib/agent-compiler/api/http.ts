// DuLabs Business — Agent Compiler, Bloque 12 (Authoring API) — contrato HTTP.
//
// Envelope de respuesta pedido explícitamente para esta API (distinto del
// patrón histórico {error} de /api/flows/*, que se deja intacto):
//   success: {success:true, data}
//   error:   {success:false, error:{code, message, diagnostics?}}
// Nunca expone stack traces, secretos, SQL ni datos de otro tenant -- los
// mensajes de error son siempre texto fijo/seguro, nunca err.message crudo.

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  diagnostics?: unknown;
}

export interface ApiError {
  success: false;
  error: ApiErrorBody;
}

export function apiOk<T>(data: T, status = 200): Response {
  return Response.json({ success: true, data } satisfies ApiSuccess<T>, { status });
}

export function apiError(code: string, message: string, status: number, diagnostics?: unknown): Response {
  const error: ApiErrorBody = diagnostics === undefined ? { code, message } : { code, message, diagnostics };
  return Response.json({ success: false, error } satisfies ApiError, { status });
}
