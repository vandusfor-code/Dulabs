/**
 * DELETE /api/dashboard/catalogo/imagenes/[mediaId] — elimina una imagen del
 * producto. Si era la principal, la BD promueve la siguiente y actualiza
 * foto_url en la misma transacción; después se borran los objetos de Storage.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { parseIdParam, withCatalog } from "@/lib/catalogo/http";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ mediaId: string }> }) {
  const { mediaId } = await params;
  return withCatalog(request, "write", async ({ service, actor }) => {
    const id = parseIdParam(mediaId, "La imagen");
    if (!id.ok) return id.response;
    return apiOk(await service.deleteImage(actor, id.data));
  });
}
