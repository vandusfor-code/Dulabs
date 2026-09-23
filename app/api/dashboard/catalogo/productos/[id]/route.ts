/**
 * /api/dashboard/catalogo/productos/[id] — detalle (GET) y edición (PATCH),
 * incluido activar/desactivar (`status`). Desactivar nunca borra. La
 * referencia es inmutable: un PATCH que la incluya se rechaza (400) y además
 * la BD la protege con un trigger.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { productUpdateSchema } from "@/lib/catalogo/domain";
import { parseBody, parseIdParam, withCatalog } from "@/lib/catalogo/http";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  return withCatalog(request, "read", async ({ service, actor }) => {
    const id = parseIdParam(rawId, "El producto");
    if (!id.ok) return id.response;
    return apiOk({ product: await service.getProduct(actor, id.data) });
  });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: rawId } = await params;
  return withCatalog(request, "write", async ({ service, actor }) => {
    const id = parseIdParam(rawId, "El producto");
    if (!id.ok) return id.response;
    const body = await parseBody(request, productUpdateSchema);
    if (!body.ok) return body.response;
    return apiOk({ product: await service.updateProduct(actor, id.data, body.data) });
  });
}
