/**
 * Imagen o video de la vitrina publicada en el CMS comercial: /catalogo/{slug}/vitrina/{id}.webp  y  /catalogo/{slug}/vitrina/{id}.mp4
 *
 * La URL solo lleva datos que el cliente ya ve (slug de la tienda e id del archivo). La ruta real en Storage ({negocio}/cms/{id}/imagen.webp o video.mp4) se
 * resuelve aquí, en el servidor, y el archivo se reenvía en streaming (los videos, también por pedazos: Safari lo exige). Solo se sirven los archivos LISTOS que usa contenido
 * PUBLICADO de ese negocio; en cualquier otro caso, 404 idéntico. Lógica en lib/cms-comercial/imagen-publica.ts y lib/cms-comercial/video-publico.ts.
 */
import { responderImagenCms } from "@/lib/cms-comercial/imagen-publica";
import { crearDepsPublicasCms } from "@/lib/cms-comercial/publico-supabase";
import { responderVideoCms } from "@/lib/cms-comercial/video-publico";

export const runtime = "nodejs";

type Params = { params: Promise<{ slug: string; archivo: string }> };

export async function GET(request: Request, { params }: Params) {
  const { slug, archivo } = await params;
  const deps = crearDepsPublicasCms();
  if (archivo.endsWith(".mp4")) return responderVideoCms(slug, archivo, request.headers.get("range"), deps);
  return responderImagenCms(slug, archivo, deps);
}
