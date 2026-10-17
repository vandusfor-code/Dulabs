/**
 * /api/dashboard/catalogo/categorias — categorías del Catálogo del tenant.
 * GET para cualquier rol con acceso al catálogo (con ?conteo=1 trae cuántos productos usa cada una); POST solo admin.
 * Eliminar una categoría: DELETE /api/dashboard/catalogo/categorias/[id].
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { categoryCreateSchema } from "@/lib/catalogo/domain";
import { parseBody, withCatalog } from "@/lib/catalogo/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // El conteo cuesta una consulta por categoría: solo lo pide el administrador de categorías, no el selector del formulario de producto.
  const conCuenta = request.nextUrl.searchParams.get("conteo") === "1";
  return withCatalog(request, "read", async ({ service, actor }) =>
    apiOk({ categories: conCuenta ? await service.listCategoriesWithCounts(actor) : await service.listCategories(actor) }),
  );
}

export async function POST(request: NextRequest) {
  return withCatalog(request, "write", async ({ service, actor }) => {
    const body = await parseBody(request, categoryCreateSchema);
    if (!body.ok) return body.response;
    return apiOk({ category: await service.createCategory(actor, body.data) }, 201);
  });
}
