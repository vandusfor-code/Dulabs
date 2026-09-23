/**
 * POST /api/dashboard/catalogo/publicacion/rotar-mayor — regenera el token del
 * link mayorista (solo admin). El link anterior deja de funcionar al instante:
 * úsese si el link mayorista llegó a quien no debía.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { withCatalog } from "@/lib/catalogo/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return withCatalog(request, "write", async ({ service, actor }) => apiOk({ publication: await service.rotateWholesaleToken(actor) }));
}
