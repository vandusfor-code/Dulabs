/**
 * POST /api/dashboard/tienda/videos/[id]/confirmar — el servidor lee lo subido y lo analiza otra vez (que sea un MP4 de verdad, H.264, sin sonido, de las medidas y la duración del espacio
 * donde se va a usar); si cumple, lo deja listo con el índice de reproducción al principio, y si no, borra lo subido y dice qué arreglar. Cuerpo: `{ archivo }` (el espacio). Idempotente. Solo administrador.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { cuerpoConfirmarVideo } from "@/lib/cms-comercial/http-esquemas";
import { leerCuerpo, leerIdRuta, withCms } from "@/lib/cms-comercial/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: crudo } = await params;
  return withCms(request, "write", async ({ videos, actor }) => {
    const id = leerIdRuta(crudo, "El video");
    if (!id.ok) return id.response;
    const body = await leerCuerpo(request, cuerpoConfirmarVideo);
    if (!body.ok) return body.response;
    return apiOk(await videos.confirmar(actor, id.data, body.data));
  });
}
