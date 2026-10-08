/**
 * GET /api/dashboard/tienda/imagenes — la galería de imágenes listas del negocio (las que se pueden usar en el contenido). Admin, agente y lectura.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { withCms } from "@/lib/cms-comercial/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCms(request, "read", async ({ imagenes, actor }) => apiOk({ items: await imagenes.listar(actor) }));
}
