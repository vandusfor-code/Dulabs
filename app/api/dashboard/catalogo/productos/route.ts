/**
 * /api/dashboard/catalogo/productos — listado (GET) y creación (POST) de
 * productos del Catálogo. Tenant SIEMPRE de la sesión (withCatalog). La
 * referencia comercial la asigna la BD: el body que la incluya se rechaza.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { productCreateSchema, productListQuerySchema } from "@/lib/catalogo/domain";
import { parseBody, validationError, withCatalog } from "@/lib/catalogo/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCatalog(request, "read", async ({ service, actor }) => {
    const query = productListQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!query.success) return validationError(query.error);
    return apiOk(await service.listProducts(actor, query.data));
  });
}

export async function POST(request: NextRequest) {
  return withCatalog(request, "write", async ({ service, actor }) => {
    const body = await parseBody(request, productCreateSchema);
    if (!body.ok) return body.response;
    return apiOk({ product: await service.createProduct(actor, body.data) }, 201);
  });
}
