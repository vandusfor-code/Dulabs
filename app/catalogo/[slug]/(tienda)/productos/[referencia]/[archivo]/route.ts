/**
 * Foto pública de un producto del catálogo:
 *   /catalogo/{slug}/productos/{referencia}/{main|thumb|2..12[-thumb]}.{webp|jpg|png}?v={version}
 *   /catalogo/{slug}/productos/{referencia}/whatsapp.jpg?v={version}   (JPEG para WhatsApp, ver imagen-whatsapp.ts)
 *
 * La URL solo lleva datos que el cliente ya ve (slug del negocio y referencia).
 * La ruta real en Storage ({tenant}/{producto}/{upload}.webp) se resuelve aquí,
 * en el servidor, y la imagen se reenvía en streaming. El CDN la cachea: `v`
 * cambia cuando cambia la foto, así que una foto nueva nunca queda tapada por
 * la vieja. Mismas reglas que la vitrina: catálogo publicado, módulo habilitado
 * y producto ACTIVO; en cualquier otro caso, 404 idéntico (no revela si existe).
 */
import { supabaseAdmin } from "@/lib/supabase";
import { WHATSAPP_IMAGE_FILE, parseImageFileName } from "@/lib/catalogo/publicacion";
import { toWhatsappJpeg } from "@/lib/catalogo/imagen-whatsapp";
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";
import { createPublicCatalogService } from "@/lib/catalogo/service";

export const runtime = "nodejs";

type Params = { params: Promise<{ slug: string; referencia: string; archivo: string }> };

// Navegador: 1 día. CDN: 1 día + hasta 7 sirviendo la copia mientras revalida.
// Desactivar un producto deja de servir su foto como máximo al vencer s-maxage.
const CACHE_OK = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";
// 404 cacheado un minuto: un bot probando referencias no golpea la BD en cada intento.
const CACHE_404 = "public, max-age=60, s-maxage=60";

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": CACHE_404, "X-Robots-Tag": "noindex, nofollow" },
  });
}

export async function GET(_request: Request, { params }: Params) {
  const { slug, referencia, archivo } = await params;
  const whatsapp = archivo === WHATSAPP_IMAGE_FILE;
  const file = whatsapp ? { index: 1, variant: "detail" as const } : parseImageFileName(archivo);
  if (!file) return notFound();

  try {
    const service = createPublicCatalogService({ repo: createSupabaseCatalogRepository(supabaseAdmin()) });
    const image = await service.getImage({ slug, reference: referencia, file });
    if (!image) return notFound();

    if (whatsapp) {
      // Meta no acepta WebP como imagen: la foto de detalle se convierte a JPEG (el CDN la cachea por versión).
      const jpeg = await toWhatsappJpeg(image.body);
      return new Response(new Uint8Array(jpeg), {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": String(jpeg.byteLength),
          "Cache-Control": CACHE_OK,
          "X-Robots-Tag": "noindex, nofollow",
          "Content-Disposition": "inline",
        },
      });
    }

    const headers = new Headers({
      "Content-Type": image.contentType,
      "Cache-Control": CACHE_OK,
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Disposition": "inline",
    });
    if (image.size !== null) headers.set("Content-Length", String(image.size));
    return new Response(image.body, { status: 200, headers });
  } catch (error) {
    console.error("[catalogo/imagen] error sirviendo la foto:", error instanceof Error ? error.message : error);
    return new Response("Error", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
