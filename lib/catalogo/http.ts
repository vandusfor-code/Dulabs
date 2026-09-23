/**
 * Catálogo DuLabs — adaptador HTTP compartido por /api/dashboard/catalogo/*.
 *
 * Cada ruta queda delgada: withCatalog() aplica auth (sesión + rol + módulo),
 * rate limit por tenant, construye el service sobre el repositorio Supabase y
 * traduce CatalogError al envelope {success, data | error:{code, message}}
 * (el mismo contrato de lib/agent-compiler/api/http.ts, reutilizado). Ninguna
 * ruta contiene lógica de negocio.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/agent-compiler/api/http";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { requireCatalogo, type CatalogAccessMode } from "@/lib/catalogo/auth";
import { firstIssueMessage } from "@/lib/catalogo/domain";
import { isCatalogError } from "@/lib/catalogo/errors";
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";
import { createCatalogService, type CatalogActor, type CatalogService } from "@/lib/catalogo/service";

export interface CatalogHandlerContext {
  service: CatalogService;
  actor: CatalogActor;
}

export async function withCatalog(
  request: NextRequest,
  mode: CatalogAccessMode,
  handler: (ctx: CatalogHandlerContext) => Promise<Response>,
): Promise<Response> {
  const access = await requireCatalogo(request, mode);
  if (!access.ok) return access.response;
  const { supabase, actor } = access.ctx;

  const limite = await respuestaSiLimiteTasaExcedido(supabase, {
    recurso: mode === "write" ? "catalogo_escritura" : "catalogo_lectura",
    tenantId: actor.tenantId,
    categoria: mode === "write" ? "escritura" : "lectura",
  });
  if (limite) return limite;

  const service = createCatalogService({ repo: createSupabaseCatalogRepository(supabase) });
  try {
    return await handler({ service, actor });
  } catch (err) {
    return catalogErrorResponse(err);
  }
}

export function catalogErrorResponse(err: unknown): Response {
  if (isCatalogError(err)) return apiError(err.code, err.message, err.status);
  console.error("[catalogo] error inesperado:", err instanceof Error ? err.message : err);
  return apiError("INTERNAL_ERROR", "No se pudo completar la operación del catálogo.", 500);
}

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

export function validationError(error: z.ZodError): Response {
  return apiError("VALIDATION_ERROR", firstIssueMessage(error), 400);
}

/** Lee y valida el body JSON con el schema del dominio. */
export async function parseBody<S extends z.ZodType>(request: NextRequest, schema: S): Promise<Parsed<z.output<S>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: apiError("REQUEST_INVALID_JSON", "JSON inválido.", 400) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) return { ok: false, response: validationError(result.error) };
  return { ok: true, data: result.data };
}

const uuidParam = z.uuid();

/** Un id de ruta que no es UUID no puede existir: 404 directo, sin tocar la BD. */
export function parseIdParam(id: string, recurso: string): Parsed<string> {
  if (!uuidParam.safeParse(id).success) return { ok: false, response: apiError("NOT_FOUND", `${recurso} no existe.`, 404) };
  return { ok: true, data: id };
}
