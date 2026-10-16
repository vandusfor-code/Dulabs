/**
 * CMS comercial — video PÚBLICO de la vitrina: /catalogo/{slug}/vitrina/{id}.mp4. Servicios inyectables (se prueba sin Supabase ni Storage).
 *
 * Igual que las imágenes (imagen-publica.ts), la tienda no entrega direcciones de Storage ni ids de negocio: la ruta resuelve en el servidor y reenvía el video en streaming. Solo se sirve un video si:
 *   1. el archivo pedido es EXACTAMENTE «<id en minúsculas>.mp4» (nada más llega a la base de datos),
 *   2. la tienda existe, está publicada y con el módulo habilitado,
 *   3. el CMS lo tiene listo (subido y verificado) PARA ESE NEGOCIO,
 *   4. está usado por contenido PUBLICADO (un video subido pero no publicado no se expone; sí en el panel, que lo ve por su propia vista previa) y
 *   5. su ruta en Storage vive bajo la carpeta del propio negocio (`{negocio}/cms/…`; defensa en profundidad).
 * En cualquier otro caso, 404 idéntico: no revela si el video existe, si es de otro negocio o si es un borrador.
 *
 * Un video se reproduce a pedazos: Safari y los iPhone EXIGEN que el servidor entienda `Range` (y Chrome lo usa para avanzar y para empezar antes de bajarlo entero). Por eso la petición
 * de rango se reenvía a Storage y se devuelve tal cual (206 con su `Content-Range`, o 416 si el rango no existe). Sin `Range`, o con uno que no se entiende, se entrega el video completo.
 */
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { videosReferenciados } from "@/lib/cms-comercial/vitrina";

export interface ObjetoVideoPublico {
  status: 200 | 206 | 416;
  body: ReadableStream<Uint8Array> | null;
  contentType: string;
  /** Largo de LO QUE SE ENTREGA en esta respuesta (el pedazo, si es un 206). */
  contentLength: number | null;
  /** «bytes 0-99/1000» (206) o «bytes *\/1000» (416); null en un 200. */
  contentRange: string | null;
}

export interface DepsVideoPublico {
  tenantDe(slug: string): Promise<string | null>;
  cargar(tenantId: string): Promise<InstantaneaCms | null>;
  /** Abre el video en Storage, con el rango pedido ya validado (o null para el video completo). null = no existe o no es un MP4. */
  abrirVideo(path: string, rango: string | null): Promise<ObjetoVideoPublico | null>;
}

const ARCHIVO = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.mp4$/;
/** Un solo rango simple: `bytes=0-99`, `bytes=100-` o `bytes=-500`. Cualquier otra forma (varios rangos, unidades raras, basura) se ignora y se entrega el video completo. */
const RANGO = /^bytes=(\d{1,12})?-(\d{1,12})?$/;

/** El rango pedido por el navegador si es uno simple y coherente; null si no hay o no se entiende (entonces se entrega todo, lo que la norma permite). */
export function rangoSimple(encabezado: string | null | undefined): string | null {
  const crudo = (encabezado ?? "").trim();
  const m = RANGO.exec(crudo);
  if (!m) return null;
  const [, desde, hasta] = m;
  if (desde === undefined && hasta === undefined) return null;
  if (desde !== undefined && hasta !== undefined && Number(desde) > Number(hasta)) return null;
  return crudo;
}

// Mismas reglas de caché que las imágenes: navegador 1 día; CDN 1 día + 7 sirviendo la copia mientras revalida. Retirar un video de lo publicado deja de servirlo como máximo al vencer s-maxage.
const CACHE_COMPLETO = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";
// Un pedazo NO se guarda en cachés compartidas (solo en el navegador): un CDN que lo confundiera con el video entero lo rompería.
const CACHE_PEDAZO = "private, max-age=86400";
// 404 cacheado un minuto: un script probando ids no golpea la base de datos en cada intento.
const CACHE_404 = "public, max-age=60, s-maxage=60";

function noEncontrado(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": CACHE_404, "X-Robots-Tag": "noindex, nofollow" },
  });
}

export async function responderVideoCms(slug: string, archivo: string, rango: string | null | undefined, deps: DepsVideoPublico): Promise<Response> {
  const id = ARCHIVO.exec(archivo)?.[1];
  if (!id) return noEncontrado();
  try {
    const tenantId = await deps.tenantDe(slug);
    if (!tenantId) return noEncontrado();
    const snap = await deps.cargar(tenantId);
    if (!snap || snap.tenantId !== tenantId) return noEncontrado();
    const asset = snap.assets.get(id);
    if (!asset || asset.id !== id || asset.mimeType !== "video/mp4" || !videosReferenciados(snap).has(id)) return noEncontrado();
    if (asset.storagePath !== `${tenantId}/cms/${id}/video.mp4`) return noEncontrado();

    const pedido = rangoSimple(rango);
    const video = await deps.abrirVideo(asset.storagePath, pedido);
    if (!video) return noEncontrado();
    const headers = new Headers({
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Disposition": "inline",
    });
    if (video.contentLength !== null) headers.set("Content-Length", String(video.contentLength));
    if (video.status === 416) {
      // El rango pedido no existe en este video: se dice cuánto mide y no se guarda en ninguna caché.
      void video.body?.cancel().catch(() => {});
      if (video.contentRange) headers.set("Content-Range", video.contentRange);
      headers.set("Cache-Control", "no-store");
      headers.delete("Content-Length");
      return new Response(null, { status: 416, headers });
    }
    if (video.status === 206 && video.contentRange) {
      headers.set("Content-Range", video.contentRange);
      headers.set("Cache-Control", CACHE_PEDAZO);
      return new Response(video.body, { status: 206, headers });
    }
    headers.set("Cache-Control", CACHE_COMPLETO);
    return new Response(video.body, { status: 200, headers });
  } catch (error) {
    console.error("[cms-comercial/video] error sirviendo el video:", error instanceof Error ? error.message : error);
    return new Response("Error", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

/**
 * Abre un video del Storage público de Supabase (el bucket es público: se lee por su dirección pública, sin pasar por la API de Storage) reenviando el rango pedido y devolviendo lo que Storage
 * contesta. Solo se acepta un MP4; cualquier otra cosa (o un error de Storage) es null.
 */
export async function abrirVideoDeStorage(url: string, rango: string | null, f: typeof fetch = (...args) => fetch(...args)): Promise<ObjetoVideoPublico | null> {
  try {
    // Sin caché de datos de Next: la caché la hacen el CDN y el navegador con los encabezados de la ruta pública.
    const res = await f(url, { cache: "no-store", ...(rango ? { headers: { Range: rango } } : {}) });
    const largo = Number(res.headers.get("content-length"));
    const contentLength = Number.isFinite(largo) && largo >= 0 && res.headers.has("content-length") ? largo : null;
    if (res.status === 416) {
      void res.body?.cancel().catch(() => {});
      return { status: 416, body: null, contentType: "video/mp4", contentLength: null, contentRange: res.headers.get("content-range") };
    }
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if ((res.status !== 200 && res.status !== 206) || !res.body || contentType !== "video/mp4") {
      // Sin await: con el fetch de Next, esperar el cancel de un 404 puede no resolver nunca y dejaba colgada la ruta pública.
      void res.body?.cancel().catch(() => {});
      return null;
    }
    const contentRange = res.headers.get("content-range");
    if (res.status === 206 && !contentRange) {
      void res.body.cancel().catch(() => {});
      return null;
    }
    return { status: res.status, body: res.body, contentType, contentLength, contentRange };
  } catch (error) {
    console.error("[cms-comercial/video] abrirVideoDeStorage:", error instanceof Error ? error.message : error);
    return null;
  }
}
