/**
 * Imagen de la vitrina publicada en el CMS comercial: /catalogo/{slug}/vitrina/{id}.webp
 *
 * La URL solo lleva datos que el cliente ya ve (slug de la tienda e id de la imagen). La ruta real en Storage ({negocio}/cms/{id}/imagen.webp) se
 * resuelve aquí, en el servidor, y la imagen se reenvía en streaming. Solo se sirven las imágenes LISTAS que usa contenido PUBLICADO de ese negocio;
 * en cualquier otro caso, 404 idéntico. Lógica en lib/cms-comercial/imagen-publica.ts.
 */
import { responderImagenCms } from "@/lib/cms-comercial/imagen-publica";
import { crearDepsPublicasCms } from "@/lib/cms-comercial/publico-supabase";

export const runtime = "nodejs";

type Params = { params: Promise<{ slug: string; archivo: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { slug, archivo } = await params;
  return responderImagenCms(slug, archivo, crearDepsPublicasCms());
}
