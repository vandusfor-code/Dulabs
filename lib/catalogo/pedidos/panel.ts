/**
 * PANEL DE PEDIDOS de la asesora (Bloque 19): ver los pedidos abiertos con su stock apartado y
 * cerrarlos (completar = venta cerrada; cancelar = el stock vuelve). Solo lo que una persona necesita:
 * número público del pedido, estado, líneas, total, cliente (el mismo teléfono que ve en el Inbox),
 * y hasta cuándo está apartado el stock. Nunca ids internos, negocio, confirmaciones ni eventos.
 */
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import type { Order } from "@/lib/catalogo/pedidos/contrato";
import { OrderError, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import type { ReservationSummary } from "@/lib/catalogo/pedidos/repositorio";

export const PEDIDO_PUBLICO = /^DL-ORD-[0-9A-HJKMNP-TV-Z]{6}$/;

export interface PedidoPanel {
  pedido: string;
  estado: Order["status"];
  canal: Order["channel"];
  origen: Order["source"];
  cliente: string | null;
  lineas: Array<{ referencia: string; nombre: string; cantidad: number; precio_unitario: number | null; subtotal: number | null }>;
  unidades: number;
  total: number;
  sin_precio: number;
  /** apartado: stock descontado y vigente; sin_reserva: no aplica (sin inventario controlado o aún sin confirmar). */
  stock: { estado: "apartado" | "sin_reserva"; unidades: number; vence: string | null };
  creado: string;
  actualizado: string;
}

export function pedidoPanel(order: Order, reservations: readonly ReservationSummary[]): PedidoPanel {
  const activas = reservations.filter((r) => r.status === "activa");
  return {
    pedido: order.orderId,
    estado: order.status,
    canal: order.channel,
    origen: order.source,
    cliente: order.contact?.waId ?? null,
    lineas: order.lines.map((l) => ({ referencia: l.reference, nombre: l.productName, cantidad: l.quantity, precio_unitario: l.unitPrice, subtotal: l.subtotal })),
    unidades: order.totalUnits,
    total: order.total,
    sin_precio: order.unpricedUnits,
    stock:
      activas.length > 0
        ? { estado: "apartado", unidades: activas.reduce((n, r) => n + r.quantity, 0), vence: activas.map((r) => r.expiresAt).sort()[0] }
        : { estado: "sin_reserva", unidades: 0, vence: null },
    creado: order.createdAt,
    actualizado: order.updatedAt,
  };
}

const HTTP: Partial<Record<OrderError["code"], number>> = { NOT_FOUND: 404, INVALID_TRANSITION: 409, CONFLICT: 409, UNAVAILABLE: 503 };

export async function listarPedidos(engine: OrderEngine | null, tenantId: string): Promise<Response> {
  if (!engine) return apiError("UNAVAILABLE", "Los pedidos no están activados.", 503);
  try {
    const rows = await engine.listOpenOrders(tenantId, 100);
    return apiOk({ pedidos: rows.map((r) => pedidoPanel(r.order, r.reservations)) });
  } catch (err) {
    return errorPedido(err);
  }
}

export async function cerrarPedido(engine: OrderEngine | null, tenantId: string, pedido: string, body: unknown): Promise<Response> {
  if (!engine) return apiError("UNAVAILABLE", "Los pedidos no están activados.", 503);
  if (!PEDIDO_PUBLICO.test(pedido)) return apiError("NOT_FOUND", "No encontramos ese pedido.", 404);
  const accion = (body as { accion?: unknown } | null)?.accion;
  if (accion !== "completar" && accion !== "cancelar") return apiError("VALIDATION_ERROR", "accion debe ser 'completar' o 'cancelar'.", 400);
  try {
    const r = await engine.closeOrder({ tenantId, orderId: pedido, action: accion === "completar" ? "complete" : "cancel" });
    return apiOk({ pedido: pedidoPanel(r.order, []), repetido: r.result === "duplicate" });
  } catch (err) {
    return errorPedido(err);
  }
}

function errorPedido(err: unknown): Response {
  if (err instanceof OrderError) return apiError(err.code, err.message, HTTP[err.code] ?? 422);
  console.error("[catalogo/pedidos/panel]", err instanceof Error ? err.message : "?");
  return apiError("INTERNAL_ERROR", "No se pudo completar la operación.", 500);
}
