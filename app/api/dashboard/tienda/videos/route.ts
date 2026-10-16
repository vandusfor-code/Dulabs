/**
 * GET /api/dashboard/tienda/videos — los videos listos del negocio (los que se pueden usar en las fotos y videos de la tienda). Admin, agente y lectura.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { withCms } from "@/lib/cms-comercial/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCms(request, "read", async ({ videos, actor }) => apiOk({ items: await videos.listar(actor) }));
}
