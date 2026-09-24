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
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { apiError } from "@/lib/agent-compiler/api/http";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { CATALOG_ORDER_ROLES, CATALOG_WRITE_ROLES, requireCatalogo, type CatalogAccessMode } from "@/lib/catalogo/auth";
import { firstIssueMessage } from "@/lib/catalogo/domain";
import { isCatalogError } from "@/lib/catalogo/errors";
import { createSupabaseCatalogRepository, type CatalogRepository } from "@/lib/catalogo/repository";
import { createCatalogService, type CatalogActor, type CatalogService } from "@/lib/catalogo/service";

export interface CatalogHandlerContext {
  service: CatalogService;
  /** Mismo repositorio del service (para casos de uso que se construyen sobre él, como la carga masiva). */
  repo: CatalogRepository;
  actor: CatalogActor;
  /** Rol con permiso de escritura (admin). Ya validado por el backend. */
  canWrite: boolean;
  /** Rol que atiende pedidos (admin / agente): ve el teléfono del cliente y puede actuar. Ya validado por el backend. */
  canManageOrders: boolean;
  /** Miembro del equipo de la sesión (para registrar quién hizo un cambio). */
  memberId: number;
  /** Cliente del backend (service_role) de la sesión ya autorizada: para casos de uso fuera del CatalogService (pedidos). */
  supabase: SupabaseClient;
}

export async function withCatalog(
  request: NextRequest,
  mode: CatalogAccessMode,
  handler: (ctx: CatalogHandlerContext) => Promise<Response>,
  /** `recurso`: cubeta propia de rate limit (la carga masiva no debe agotar la del formulario, ni al revés). */
  opts: { recurso?: string } = {},
): Promise<Response> {
  const access = await requireCatalogo(request, mode);
  if (!access.ok) return access.response;
  const { supabase, actor, member } = access.ctx;

  const limite = await respuestaSiLimiteTasaExcedido(supabase, {
    recurso: opts.recurso ?? (mode === "read" ? "catalogo_lectura" : "catalogo_escritura"),
    tenantId: actor.tenantId,
    categoria: mode === "read" ? "lectura" : "escritura",
  });
  if (limite) return limite;

  const repo = createSupabaseCatalogRepository(supabase);
  const service = createCatalogService({ repo });
  try {
    return await handler({ service, repo, actor, canWrite: CATALOG_WRITE_ROLES.includes(member.rol), canManageOrders: CATALOG_ORDER_ROLES.includes(member.rol), memberId: member.miembroId, supabase });
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
