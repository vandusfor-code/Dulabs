/**
 * GET /api/dashboard/catalogo/pedidos/historial — pedidos CERRADOS (completados, cancelados,
 * vencidos) del negocio de la sesión, paginados por cursor (Bloque 21). Cualquier rol con acceso
 * al catálogo. El negocio sale de la sesión; el cursor solo indica la posición.
 */
import type { NextRequest } from "next/server";
import { withCatalog } from "@/lib/catalogo/http";
import { listarHistorial } from "@/lib/catalogo/pedidos/panel";
import { productionOrderEngine } from "@/lib/catalogo/pedidos/produccion";
import { productionPanelFuentes } from "@/lib/catalogo/pedidos/panel-fuentes";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCatalog(request, "read", async ({ supabase, actor, canManageOrders }) =>
    listarHistorial(productionOrderEngine(supabase), actor.tenantId, request.nextUrl.searchParams, { fuentes: productionPanelFuentes(supabase), verTelefono: canManageOrders }),
  );
}
