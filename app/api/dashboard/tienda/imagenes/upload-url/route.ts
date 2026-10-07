/**
 * POST /api/dashboard/tienda/imagenes/upload-url — emite la URL firmada para que el navegador suba la imagen DIRECTO a Storage (sin pasar por esta función).
 * La ruta la decide el servidor ({negocio}/cms/{id}/…); el cliente solo declara tipo y tamaño, que se vuelven a verificar al confirmar. Solo administrador.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { cuerpoSubidaImagen } from "@/lib/cms-comercial/http-esquemas";
import { leerCuerpo, withCms } from "@/lib/cms-comercial/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return withCms(request, "write", async ({ imagenes, actor }) => {
    const body = await leerCuerpo(request, cuerpoSubidaImagen);
    if (!body.ok) return body.response;
    return apiOk({ subida: await imagenes.solicitarSubida(actor, body.data) }, 201);
  });
}
