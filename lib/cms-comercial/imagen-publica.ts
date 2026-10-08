/**
 * CMS comercial — imagen PÚBLICA de la vitrina: /catalogo/{slug}/vitrina/{id}.webp. Servicios inyectables (se prueba sin Supabase ni Storage).
 *
 * La tienda no entrega direcciones de Storage ni ids de negocio: la ruta resuelve en el servidor y reenvía la imagen en streaming. Solo se sirve una imagen si:
 *   1. el archivo pedido es EXACTAMENTE «<id en minúsculas>.webp» (nada más llega a la base de datos),
 *   2. la tienda existe, está publicada y con el módulo habilitado,
 *   3. el CMS la tiene lista (subida y verificada) PARA ESE NEGOCIO,
 *   4. está usada por contenido PUBLICADO (una imagen subida pero no publicada no se expone) y
 *   5. su ruta en Storage vive bajo la carpeta del propio negocio (`{negocio}/cms/…`; defensa en profundidad).
 * En cualquier otro caso, 404 idéntico: no revela si la imagen existe, si es de otro negocio o si es un borrador.
 */
import type { PublicImageObject } from "@/lib/catalogo/repository";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { assetsReferenciados } from "@/lib/cms-comercial/vitrina";

export interface DepsImagenPublica {
  tenantDe(slug: string): Promise<string | null>;
  cargar(tenantId: string): Promise<InstantaneaCms | null>;
  abrir(path: string): Promise<PublicImageObject | null>;
}

const ARCHIVO = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/;

// Mismas reglas de caché que las fotos de producto: navegador 1 día; CDN 1 día + 7 sirviendo la copia mientras revalida.
// Retirar una imagen de lo publicado deja de servirla como máximo al vencer s-maxage.
const CACHE_OK = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";
// 404 cacheado un minuto: un script probando ids no golpea la base de datos en cada intento.
const CACHE_404 = "public, max-age=60, s-maxage=60";

function noEncontrada(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": CACHE_404, "X-Robots-Tag": "noindex, nofollow" },
  });
}

export async function responderImagenCms(slug: string, archivo: string, deps: DepsImagenPublica): Promise<Response> {
  const id = ARCHIVO.exec(archivo)?.[1];
  if (!id) return noEncontrada();
  try {
    const tenantId = await deps.tenantDe(slug);
    if (!tenantId) return noEncontrada();
    const snap = await deps.cargar(tenantId);
    if (!snap || snap.tenantId !== tenantId) return noEncontrada();
    const asset = snap.assets.get(id);
    if (!asset || asset.id !== id || !assetsReferenciados(snap).has(id)) return noEncontrada();
    if (!asset.storagePath.startsWith(`${tenantId}/cms/`) || asset.storagePath.includes("..")) return noEncontrada();

    const imagen = await deps.abrir(asset.storagePath);
    if (!imagen) return noEncontrada();
    const headers = new Headers({
      "Content-Type": imagen.contentType,
      "Cache-Control": CACHE_OK,
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Disposition": "inline",
    });
    if (imagen.size !== null) headers.set("Content-Length", String(imagen.size));
    return new Response(imagen.body, { status: 200, headers });
  } catch (error) {
    console.error("[cms-comercial/imagen] error sirviendo la imagen:", error instanceof Error ? error.message : error);
    return new Response("Error", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
