/**
 * CMS comercial — adaptador HTTP compartido por /api/dashboard/tienda/*. Cada ruta queda delgada: withCms() aplica auth (sesión + rol + módulo), límite de
 * peticiones por negocio, construye el servicio sobre el repositorio Supabase y traduce CmsError al envelope {success, data | error:{code, message}}.
 * Ninguna ruta contiene lógica de negocio.
 */
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { apiError } from "@/lib/agent-compiler/api/http";
import { firstIssueMessage } from "@/lib/catalogo/domain";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { crearPuertoCatalogoSupabase, crearPuertoVariablesSupabase } from "@/lib/cms-comercial/adaptadores-supabase";
import { requireCms, type CmsAccessMode } from "@/lib/cms-comercial/auth";
import type { ActorCms } from "@/lib/cms-comercial/contrato";
import { isCmsError } from "@/lib/cms-comercial/errores";
import type { CmsRepositorio } from "@/lib/cms-comercial/repositorio";
import { crearRepositorioSupabaseCms } from "@/lib/cms-comercial/repositorio-supabase";
import { crearServicioCms, type CmsServicio } from "@/lib/cms-comercial/servicio";

export interface CmsHandlerContext {
  servicio: CmsServicio;
  repo: CmsRepositorio;
  actor: ActorCms;
  supabase: SupabaseClient;
}

export async function withCms(request: NextRequest, mode: CmsAccessMode, handler: (ctx: CmsHandlerContext) => Promise<Response>): Promise<Response> {
  const access = await requireCms(request, mode);
  if (!access.ok) return access.response;
  const { supabase, actor } = access.ctx;

  const limite = await respuestaSiLimiteTasaExcedido(supabase, {
    recurso: mode === "read" ? "cms_lectura" : "cms_escritura",
    tenantId: actor.tenantId,
    categoria: mode === "read" ? "lectura" : "escritura",
  });
  if (limite) return limite;

  const repo = crearRepositorioSupabaseCms(supabase);
  const servicio = crearServicioCms({ repo, catalogo: crearPuertoCatalogoSupabase(supabase), variables: crearPuertoVariablesSupabase(supabase) });
  try {
    return await handler({ servicio, repo, actor, supabase });
  } catch (err) {
    return cmsErrorResponse(err);
  }
}

export function cmsErrorResponse(err: unknown): Response {
  if (isCmsError(err)) return apiError(err.code, err.message, err.status, err.problemas ? { problemas: err.problemas } : undefined);
  console.error("[cms-comercial] error inesperado:", err instanceof Error ? err.message : err);
  return apiError("INTERNAL_ERROR", "No se pudo completar la operación de la tienda.", 500);
}

/** Tope del cuerpo de una petición del CMS (un contenido admite hasta ~128 KB; con holgura). */
export const MAX_CUERPO_CMS = 300_000;

export type Leido<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Lee el cuerpo JSON con tope de tamaño y lo valida con el esquema. */
export async function leerCuerpo<S extends z.ZodType>(request: NextRequest, esquema: S): Promise<Leido<z.output<S>>> {
  const declarado = Number(request.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > MAX_CUERPO_CMS) return { ok: false, response: apiError("PAYLOAD_TOO_LARGE", "El contenido es demasiado grande.", 413) };
  let texto: string;
  try {
    texto = await request.text();
  } catch {
    return { ok: false, response: apiError("REQUEST_INVALID_JSON", "JSON inválido.", 400) };
  }
  if (texto.length > MAX_CUERPO_CMS) return { ok: false, response: apiError("PAYLOAD_TOO_LARGE", "El contenido es demasiado grande.", 413) };
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    return { ok: false, response: apiError("REQUEST_INVALID_JSON", "JSON inválido.", 400) };
  }
  const r = esquema.safeParse(crudo);
  if (!r.success) return { ok: false, response: apiError("VALIDATION_ERROR", firstIssueMessage(r.error), 400) };
  return { ok: true, data: r.data };
}

const uuid = z.uuid();

/** Un id de ruta que no es UUID no puede existir: 404 directo, sin tocar la base. */
export function leerIdRuta(id: string, recurso = "El elemento"): { ok: true; data: string } | { ok: false; response: Response } {
  if (!uuid.safeParse(id).success) return { ok: false, response: apiError("NOT_FOUND", `${recurso} no existe.`, 404) };
  return { ok: true, data: id };
}
