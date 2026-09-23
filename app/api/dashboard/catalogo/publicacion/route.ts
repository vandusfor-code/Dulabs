/**
 * GET /api/dashboard/catalogo/publicacion — links públicos del catálogo
 * (detal y, solo para administradores, mayor). Para un admin es idempotente
 * y crea los links la primera vez (slug derivado del nombre del negocio).
 * Otros roles solo ven el link detal, si ya existe.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { withCatalog } from "@/lib/catalogo/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCatalog(request, "read", async ({ service, actor, canWrite }) =>
    apiOk({ publication: canWrite ? await service.ensurePublication(actor) : await service.getPublication(actor, { includeWholesale: false }) }),
  );
}
