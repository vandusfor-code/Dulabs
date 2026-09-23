/**
 * Adaptador HTTP de la carga masiva: el mismo withCatalog del catálogo (sesión
 * + rol admin + módulo "catalogo" + tenant de la membresía), con su propia
 * cubeta de rate limit y el servicio de importación construido sobre el
 * CatalogService de siempre.
 */
import type { NextRequest } from "next/server";
import { withCatalog, type CatalogHandlerContext } from "@/lib/catalogo/http";
import { createCatalogImportService, type CatalogImportService } from "@/lib/catalogo/import/servicio";

export const IMPORT_RATE_RESOURCE = "catalogo_importacion";

export function withImport(
  request: NextRequest,
  mode: "read" | "write",
  handler: (ctx: CatalogHandlerContext & { imports: CatalogImportService }) => Promise<Response>,
): Promise<Response> {
  return withCatalog(
    request,
    mode,
    (ctx) => handler({ ...ctx, imports: createCatalogImportService({ repo: ctx.repo, catalog: ctx.service }) }),
    { recurso: IMPORT_RATE_RESOURCE },
  );
}
