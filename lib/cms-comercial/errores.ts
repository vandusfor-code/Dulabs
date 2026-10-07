/**
 * CMS comercial — errores tipados. El servicio y el repositorio lanzan CmsError; la capa HTTP (http.ts) los traduce a status + envelope.
 * Los mensajes son SIEMPRE texto fijo y seguro para mostrar a la administradora: nunca SQL, trazas ni datos de otro negocio.
 */
import type { Problema } from "@/lib/cms-comercial/contrato";

export type CmsErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "ARCHIVED"
  | "INVALID_STATE"
  | "NOT_PUBLISHABLE"
  | "FEATURE_UNAVAILABLE"
  | "INTERNAL_ERROR";

const STATUS: Record<CmsErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
  ARCHIVED: 409,
  INVALID_STATE: 409,
  NOT_PUBLISHABLE: 422,
  FEATURE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class CmsError extends Error {
  readonly code: CmsErrorCode;
  readonly status: number;
  /** Problemas de validación (solo en NOT_PUBLISHABLE): se devuelven a la administradora para que corrija. */
  readonly problemas: Problema[] | undefined;

  constructor(code: CmsErrorCode, message: string, problemas?: Problema[]) {
    super(message);
    this.name = "CmsError";
    this.code = code;
    this.status = STATUS[code];
    this.problemas = problemas;
  }
}

export function isCmsError(err: unknown): err is CmsError {
  return err instanceof CmsError;
}
