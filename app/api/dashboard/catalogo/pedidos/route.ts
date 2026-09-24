/**
 * GET /api/dashboard/catalogo/pedidos — pedidos abiertos del negocio de la sesión con su stock
 * apartado (Bloque 19). Cualquier rol con acceso al catálogo. El negocio sale de la sesión.
 */
import type { NextRequest } from "next/server";
import { withCatalog } from "@/lib/catalogo/http";
import { listarPedidos } from "@/lib/catalogo/pedidos/panel";
import { productionOrderEngine } from "@/lib/catalogo/pedidos/produccion";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCatalog(request, "read", async ({ supabase, actor }) => listarPedidos(productionOrderEngine(supabase), actor.tenantId));
}
