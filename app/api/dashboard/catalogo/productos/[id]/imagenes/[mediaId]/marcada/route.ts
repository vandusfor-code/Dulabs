/**
 * GET /api/dashboard/catalogo/productos/[id]/imagenes/[mediaId]/marcada — Bloque 29: la foto en
 * JPEG con la referencia estampada en la esquina, para descargarla y publicarla (Instagram,
 * estados). Solo con el módulo "marca_referencia" del negocio; el archivo original no cambia.
 */
import type { NextRequest } from "next/server";
import { parseIdParam, withCatalog } from "@/lib/catalogo/http";
import { toWhatsappJpeg } from "@/lib/catalogo/imagen-whatsapp";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; mediaId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id: rawId, mediaId: rawMedia } = await params;
  return withCatalog(request, "read", async ({ service, actor }) => {
    const id = parseIdParam(rawId, "El producto");
    if (!id.ok) return id.response;
    const media = parseIdParam(rawMedia, "La imagen");
    if (!media.ok) return media.response;
    const { body, reference } = await service.openImageForMark(actor, id.data, media.data);
    const jpeg = await toWhatsappJpeg(body, { marca: reference });
    return new Response(new Uint8Array(jpeg), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(jpeg.byteLength),
        "Content-Disposition": `attachment; filename="${reference}.jpg"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
