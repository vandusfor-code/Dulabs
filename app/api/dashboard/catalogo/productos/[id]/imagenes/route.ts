/**
 * POST /api/dashboard/catalogo/productos/[id]/imagenes — confirma una imagen
 * ya subida con upload-url. El servidor recalcula la ruta desde el uploadId,
 * verifica existencia, tamaño, content-type y firma real del archivo, y la
 * registra atómicamente (principal única + foto_url sincronizada).
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { imageConfirmSchema } from "@/lib/catalogo/domain";
import { parseBody, parseIdParam, withCatalog } from "@/lib/catalogo/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  return withCatalog(request, "write", async ({ service, actor }) => {
    const id = parseIdParam(rawId, "El producto");
    if (!id.ok) return id.response;
    const body = await parseBody(request, imageConfirmSchema);
    if (!body.ok) return body.response;
    return apiOk({ image: await service.confirmImage(actor, id.data, body.data) }, 201);
  });
}
