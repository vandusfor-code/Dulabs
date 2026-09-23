/**
 * POST /api/dashboard/catalogo/productos/[id]/imagenes/upload-url — emite las
 * URLs firmadas para que el navegador suba la imagen (y su miniatura) DIRECTO
 * a Storage, sin pasar la foto por esta función. La ruta la decide el
 * servidor ({tenant}/{producto}/{uploadId}); el cliente solo declara formato
 * y tamaño, que se vuelven a verificar al confirmar.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { imageUploadRequestSchema } from "@/lib/catalogo/domain";
import { parseBody, parseIdParam, withCatalog } from "@/lib/catalogo/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  return withCatalog(request, "write", async ({ service, actor }) => {
    const id = parseIdParam(rawId, "El producto");
    if (!id.ok) return id.response;
    const body = await parseBody(request, imageUploadRequestSchema);
    if (!body.ok) return body.response;
    return apiOk({ upload: await service.requestImageUpload(actor, id.data, body.data) }, 201);
  });
}
