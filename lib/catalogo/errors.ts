/**
 * Errores tipados del Catálogo. El service y el repository lanzan
 * CatalogError; la capa HTTP (lib/catalogo/http.ts) los traduce a status +
 * envelope. Los mensajes son SIEMPRE texto fijo y seguro para mostrar al
 * usuario -- nunca SQL, stack traces ni datos de otro tenant.
 */
export type CatalogErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "LIMIT_REACHED"
  | "IMAGE_INVALID"
  | "INTERNAL_ERROR";

const STATUS: Record<CatalogErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  LIMIT_REACHED: 409,
  IMAGE_INVALID: 422,
  INTERNAL_ERROR: 500,
};

export class CatalogError extends Error {
  readonly code: CatalogErrorCode;
  readonly status: number;

  constructor(code: CatalogErrorCode, message: string) {
    super(message);
    this.name = "CatalogError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export function isCatalogError(err: unknown): err is CatalogError {
  return err instanceof CatalogError;
}
