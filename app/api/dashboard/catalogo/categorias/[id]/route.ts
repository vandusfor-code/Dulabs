/**
 * DELETE /api/dashboard/catalogo/categorias/[id]?moveTo=<id de otra categoría | none> — elimina una categoría (solo admin).
 *
 * Sin productos se borra directo. Con productos hay que decir qué pasa con ellos: `moveTo` = el id de otra categoría del negocio, o «none» para dejarlos sin
 * categoría; sin `moveTo` responde 409 y no toca nada. Qué productos mueve y cómo se protege: ver CatalogService.deleteCategory.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { categoryDeleteQuerySchema } from "@/lib/catalogo/domain";
import { parseIdParam, validationError, withCatalog } from "@/lib/catalogo/http";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  return withCatalog(request, "write", async ({ service, actor }) => {
    const id = parseIdParam(rawId, "La categoría");
    if (!id.ok) return id.response;
    const query = categoryDeleteQuerySchema.safeParse({ moveTo: request.nextUrl.searchParams.get("moveTo") ?? undefined });
    if (!query.success) return validationError(query.error);
    return apiOk(await service.deleteCategory(actor, id.data, { moveTo: query.data.moveTo }));
  });
}
