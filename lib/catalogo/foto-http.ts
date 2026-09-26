/**
 * Adaptador HTTP de las fotos públicas del catálogo (la ruta
 * /catalogo/{slug}/productos/{referencia}/{archivo} solo lo invoca). Servicio y conversión
 * inyectables para probarlo sin Supabase ni Storage.
 *
 * Solo se sirve la URL CANÓNICA (la `v` vigente). Otra `v` (vieja, ausente o inventada) redirige a
 * la canónica SIN abrir Storage ni convertir: una `v` aleatoria no puede evitar el CDN para forzar
 * descargas o conversiones a JPEG (Bloque 20, medido: 30 pedidos con `v` aleatoria saturaban la CPU).
 */
import { supabaseAdmin } from "@/lib/supabase";
import { WHATSAPP_IMAGE_FILE, parseImageFileName } from "@/lib/catalogo/publicacion";
import { toWhatsappJpeg } from "@/lib/catalogo/imagen-whatsapp";
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";
import { createPublicCatalogService } from "@/lib/catalogo/service";

type Service = Pick<ReturnType<typeof createPublicCatalogService>, "locateImage" | "openLocatedImage">;

export interface FotoDeps {
  servicio: () => Service;
  aJpeg: (body: ReadableStream<Uint8Array>, opts?: { marca?: string | null }) => Promise<Buffer>;
}

const depsReales: FotoDeps = {
  servicio: () => createPublicCatalogService({ repo: createSupabaseCatalogRepository(supabaseAdmin()) }),
  aJpeg: toWhatsappJpeg,
};

// Navegador: 1 día. CDN: 1 día + hasta 7 sirviendo la copia mientras revalida.
// Desactivar un producto deja de servir su foto como máximo al vencer s-maxage.
const CACHE_OK = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";
// 404 cacheado un minuto: un bot probando referencias no golpea la BD en cada intento.
const CACHE_404 = "public, max-age=60, s-maxage=60";
// Redirección a la versión vigente: corta (la versión cambia cuando cambia la foto).
const CACHE_REDIRECT = "public, max-age=60, s-maxage=60";

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": CACHE_404, "X-Robots-Tag": "noindex, nofollow" },
  });
}

export async function responderFoto(
  request: Request,
  { slug, referencia, archivo }: { slug: string; referencia: string; archivo: string },
  deps: FotoDeps = depsReales,
): Promise<Response> {
  const whatsapp = archivo === WHATSAPP_IMAGE_FILE;
  const file = whatsapp ? { index: 1, variant: "detail" as const } : parseImageFileName(archivo);
  if (!file) return notFound();

  try {
    const service = deps.servicio();
    const location = await service.locateImage({ slug, reference: referencia, file, whatsapp });
    if (!location) return notFound();
    const pedida = new URL(request.url);
    if (pedida.searchParams.get("v") !== location.version || pedida.pathname !== location.canonicalPath.split("?")[0]) {
      return new Response(null, {
        status: 307,
        headers: { Location: location.canonicalPath, "Cache-Control": CACHE_REDIRECT, "X-Robots-Tag": "noindex, nofollow" },
      });
    }
    const image = await service.openLocatedImage(location);
    if (!image) return notFound();

    if (whatsapp) {
      // Meta no acepta WebP como imagen: la foto de detalle se convierte a JPEG (el CDN la cachea por versión).
      // Bloque 29: con el módulo "marca_referencia", la referencia va estampada en la esquina.
      const jpeg = await deps.aJpeg(image.body, location.mark ? { marca: location.mark } : {});
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
