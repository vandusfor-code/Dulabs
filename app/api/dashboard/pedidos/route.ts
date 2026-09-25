/**
 * GET /api/dashboard/pedidos — Bloque 27, módulo "Pedidos": pedidos YA confirmados del negocio de la
 * sesión, por última actualización, con filtros (estado, pago, modalidad, método, entrega, fechas,
 * búsqueda) y cursor. Exige el módulo "pedidos" del negocio. Cualquier rol con acceso lo ve; el
 * teléfono (y buscar por teléfono) solo quien atiende (admin / agente).
 */
import type { NextRequest } from "next/server";
import { withCatalog } from "@/lib/catalogo/http";
import { ORDERS_MODULE } from "@/lib/catalogo/auth";
import { listarGestion } from "@/lib/catalogo/pedidos/gestion";
import { productionOrderEngine } from "@/lib/catalogo/pedidos/produccion";
import { productionPanelFuentes } from "@/lib/catalogo/pedidos/panel-fuentes";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCatalog(
    request,
    "read",
    async ({ supabase, actor, canManageOrders }) =>
      listarGestion(productionOrderEngine(supabase), actor.tenantId, request.nextUrl.searchParams, { fuentes: productionPanelFuentes(supabase), verTelefono: canManageOrders }),
    { module: ORDERS_MODULE, recurso: "pedidos_lectura" },
  );
}
