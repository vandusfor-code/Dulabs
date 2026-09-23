/**
 * /api/dashboard/catalogo/categorias — categorías del Catálogo del tenant.
 * GET para cualquier rol con acceso al catálogo; POST solo admin.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { categoryCreateSchema } from "@/lib/catalogo/domain";
import { parseBody, withCatalog } from "@/lib/catalogo/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCatalog(request, "read", async ({ service, actor }) => apiOk({ categories: await service.listCategories(actor) }));
}

export async function POST(request: NextRequest) {
  return withCatalog(request, "write", async ({ service, actor }) => {
    const body = await parseBody(request, categoryCreateSchema);
    if (!body.ok) return body.response;
    return apiOk({ category: await service.createCategory(actor, body.data) }, 201);
  });
}
