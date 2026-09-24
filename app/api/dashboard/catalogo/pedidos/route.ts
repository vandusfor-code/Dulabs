/**
 * GET /api/dashboard/catalogo/pedidos — pedidos abiertos del negocio de la sesión con su stock
 * apartado (Bloque 19). Cualquier rol con acceso al catálogo. El negocio sale de la sesión.
 */
import type { NextRequest } from "next/server";
import { withCatalog } from "@/lib/catalogo/http";
import { listarPedidos } from "@/lib/catalogo/pedidos/panel";
import { productionOrderEngine } from "@/lib/catalogo/pedidos/produccion";
import { productionPanelFuentes } from "@/lib/catalogo/pedidos/panel-fuentes";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // Bloque 25: con el cliente (nombre, modalidad; teléfono solo para quien atiende), fechas, fotos y asesora.
  return withCatalog(request, "read", async ({ supabase, actor, canManageOrders }) =>
    listarPedidos(productionOrderEngine(supabase), actor.tenantId, { fuentes: productionPanelFuentes(supabase), verTelefono: canManageOrders }),
  );
}
