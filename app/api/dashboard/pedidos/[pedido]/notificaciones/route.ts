/**
 * Bloque 31 — POST /api/dashboard/pedidos/{DL-ORD-XXXXXX}/notificaciones  body: { tipo }
 * Reintenta la notificación por WhatsApp de una transición (fallida, ventana vencida u omitida).
 * Solo admin / agente del negocio de la sesión, con el módulo "pedidos". Idempotente: dos clics o
 * dos personas a la vez => un solo envío (compare-and-set en la BD). Nunca reenvía una enviada ni
 * una que ya no describe el estado actual del pedido.
 */
import type { NextRequest } from "next/server";
import { withCatalog } from "@/lib/catalogo/http";
import { ORDERS_MODULE } from "@/lib/catalogo/auth";
import { reintentarNotificacionGestion } from "@/lib/catalogo/pedidos/gestion";
import { productionOrderEngine } from "@/lib/catalogo/pedidos/produccion";
import { productionNotificadorDelPanel } from "@/lib/catalogo/pedidos/avisos-etapa-produccion";

export const runtime = "nodejs";

type Params = { params: Promise<{ pedido: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { pedido } = await params;
  return withCatalog(
    request,
    "orders",
    async ({ supabase, actor }) => {
      const body = await request.json().catch(() => null);
      return reintentarNotificacionGestion(productionOrderEngine(supabase), actor.tenantId, pedido.toUpperCase(), body, productionNotificadorDelPanel(supabase));
    },
    { module: ORDERS_MODULE, recurso: "pedidos_escritura" },
  );
}
