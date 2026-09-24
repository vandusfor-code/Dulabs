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
 *
 * Solo se sirve la URL canónica (la `v` vigente); otra `v` redirige a ella. Lógica en
 * lib/catalogo/foto-http.ts.
 */
import { responderFoto } from "@/lib/catalogo/foto-http";

export const runtime = "nodejs";

type Params = { params: Promise<{ slug: string; referencia: string; archivo: string }> };

export async function GET(request: Request, { params }: Params) {
  return responderFoto(request, await params);
}
