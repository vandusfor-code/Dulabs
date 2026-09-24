/**
 * POST /api/dashboard/catalogo/pedidos/{DL-ORD-XXXXXX}  body: { accion: "completar" | "cancelar" }
 * La asesora (admin o agente) cierra un pedido del negocio de SU sesión (Bloque 19):
 * completar consume la reserva de stock; cancelar la devuelve. Idempotente.
 */
import type { NextRequest } from "next/server";
import { withCatalog } from "@/lib/catalogo/http";
import { cerrarPedido } from "@/lib/catalogo/pedidos/panel";
import { productionOrderEngine } from "@/lib/catalogo/pedidos/produccion";

export const runtime = "nodejs";

type Params = { params: Promise<{ pedido: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { pedido } = await params;
  return withCatalog(
    request,
    "orders",
    async ({ supabase, actor }) => {
      const body = await request.json().catch(() => null);
      return cerrarPedido(productionOrderEngine(supabase), actor.tenantId, pedido.toUpperCase(), body);
    },
    { recurso: "catalogo_pedidos" },
  );
}
