import { DevApiError, type DevErrorKind } from "@/lib/dev-dashboard/dev-client";

// DuLabs Developer V1 -- Fase 9 (autorizado). Mensajes de error legibles y
// PUROS a partir de un DevApiError. Nunca exponen detalles de
// infraestructura; distinguen 401/403/429(rate vs quota)/red/servidor.

export function mensajePorKind(kind: DevErrorKind): string {
  switch (kind) {
    case "unauthorized":
      return "Tu sesión expiró. Vuelve a iniciar sesión.";
    case "forbidden":
      return "No tienes permisos para realizar esta acción.";
    case "not_found":
      return "No encontramos lo que buscabas.";
    case "validation":
      return "Revisa los datos e inténtalo de nuevo.";
    case "rate_limit":
      return "Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.";
    case "quota":
      return "Alcanzaste la cuota mensual de tu plan.";
    case "network":
      return "No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.";
    case "server":
      return "Ocurrió un error de nuestro lado. Inténtalo de nuevo.";
    default:
      return "Ocurrió un error inesperado.";
  }
}

/** Mensaje de usuario para cualquier error capturado (DevApiError u otro). */
export function mensajeDeError(err: unknown): string {
  if (err instanceof DevApiError) return mensajePorKind(err.kind);
  return "Ocurrió un error inesperado.";
}

/** request_id para mostrar en estados de error (soporte/correlación), o null. */
export function requestIdDeError(err: unknown): string | null {
  return err instanceof DevApiError ? err.requestId : null;
}

/** true si el error indica sesión expirada -> el caller debe redirigir a /login. */
export function esSesionExpirada(err: unknown): boolean {
  return err instanceof DevApiError && err.kind === "unauthorized";
}
