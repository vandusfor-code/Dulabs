/**
 * Bloque 27 — un pedido del módulo "Pedidos" (negocio de la sesión; exige el módulo "pedidos").
 *
 *   GET  detalle: cliente, productos con foto, total, entrega, pago, estado, asesora e historial.
 *   POST acción de la operación (solo admin / agente):
 *        { accion: "pago_recibido" | "en_preparacion" | "enviado" | "entregado" | "completar" | "cancelar" | "rechazar",
 *          esperado: { estado, etapa, pago },   // lo que la persona VIO (compare-and-set)
 *          motivo?: string }              // obligatorio para cancelar y rechazar
 *        Queda en el historial con la persona que la hizo. Repetir la misma acción no la repite.
 */
import type { NextRequest } from "next/server";
import { withCatalog } from "@/lib/catalogo/http";
import { ORDERS_MODULE } from "@/lib/catalogo/auth";
import { accionGestion, detalleGestion } from "@/lib/catalogo/pedidos/gestion";
import { productionOrderEngine } from "@/lib/catalogo/pedidos/produccion";
import { productionPanelFuentes } from "@/lib/catalogo/pedidos/panel-fuentes";

export const runtime = "nodejs";

type Params = { params: Promise<{ pedido: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { pedido } = await params;
  return withCatalog(
    request,
    "read",
    async ({ supabase, actor, canManageOrders }) =>
      detalleGestion(productionOrderEngine(supabase), actor.tenantId, pedido.toUpperCase(), { fuentes: productionPanelFuentes(supabase), verTelefono: canManageOrders }),
    { module: ORDERS_MODULE, recurso: "pedidos_lectura" },
  );
}

export async function POST(request: NextRequest, { params }: Params) {
  const { pedido } = await params;
  return withCatalog(
    request,
    "orders",
    async ({ supabase, actor, memberId }) => {
      const body = await request.json().catch(() => null);
      return accionGestion(productionOrderEngine(supabase), actor.tenantId, pedido.toUpperCase(), body, memberId);
    },
    { module: ORDERS_MODULE, recurso: "pedidos_escritura" },
  );
}
