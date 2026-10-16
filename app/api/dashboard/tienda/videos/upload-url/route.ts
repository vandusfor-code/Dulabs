/**
 * POST /api/dashboard/tienda/videos/upload-url — emite la URL firmada para que el navegador suba el video DIRECTO a Storage (sin pasar por esta función).
 * La ruta la decide el servidor ({negocio}/cms/{id}/…); el cliente solo declara tipo y tamaño (hasta 3 MB), que se vuelven a verificar al confirmar. Solo administrador.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { cuerpoSubidaVideo } from "@/lib/cms-comercial/http-esquemas";
import { leerCuerpo, withCms } from "@/lib/cms-comercial/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return withCms(request, "write", async ({ videos, actor }) => {
    const body = await leerCuerpo(request, cuerpoSubidaVideo);
    if (!body.ok) return body.response;
    return apiOk({ subida: await videos.solicitarSubida(actor, body.data) }, 201);
  });
}
