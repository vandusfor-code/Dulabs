/**
 * PANEL DE PEDIDOS de la asesora (Bloque 19): ver los pedidos abiertos con su stock apartado y
 * cerrarlos (completar = venta cerrada; cancelar = el stock vuelve). Solo lo que una persona necesita:
 * número público del pedido, estado, líneas, total, cliente (el mismo teléfono que ve en el Inbox),
 * y hasta cuándo está apartado el stock. Nunca ids internos, negocio, confirmaciones ni eventos.
 */
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import type { Order } from "@/lib/catalogo/pedidos/contrato";
import { CLOSED_STATUSES, OrderError, type ClosedStatus, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import type { OrderCursor, ReservationSummary } from "@/lib/catalogo/pedidos/repositorio";

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

/**
 * Pedido CERRADO en el historial (Bloque 21): lo mismo que la asesora ve en abiertos, más cuándo
 * se cerró y qué pasó con el stock (vendido = la reserva se consumió; devuelto = volvió al
 * inventario). Nunca ids internos, negocio, confirmaciones ni eventos.
 */
export interface PedidoHistorial extends Omit<PedidoPanel, "stock"> {
  cerrado: string;
  stock: { estado: "vendido" | "devuelto" | "sin_reserva"; unidades: number };
}

export function pedidoHistorial(order: Order, reservations: readonly ReservationSummary[]): PedidoHistorial {
  const { stock: _abierto, ...base } = pedidoPanel(order, []);
  void _abierto;
  const suma = (estado: ReservationSummary["status"]) => reservations.filter((r) => r.status === estado).reduce((n, r) => n + r.quantity, 0);
  const vendido = suma("consumida");
  const devuelto = suma("liberada");
  return {
    ...base,
    cerrado: order.updatedAt,
    stock: vendido > 0 ? { estado: "vendido", unidades: vendido } : devuelto > 0 ? { estado: "devuelto", unidades: devuelto } : { estado: "sin_reserva", unidades: 0 },
  };
}

export const HISTORIAL_POR_PAGINA = 25;
const HISTORIAL_MAX = 50;
// Marca de tiempo tal como la devuelve Postgres/PostgREST (ISO, hasta microsegundos, con zona).
const MARCA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Cursor OPACO del historial: base64url de {c: creación exacta, p: número público}. Sin ids internos. */
export function codificarCursor(cursor: OrderCursor): string {
  return Buffer.from(JSON.stringify({ c: cursor.createdAt, p: cursor.orderId })).toString("base64url");
}

/** null si el cursor no es uno que emitimos (se rechaza, no se interpreta). */
export function decodificarCursor(valor: string): OrderCursor | null {
  if (valor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(valor)) return null;
  try {
    const x = JSON.parse(Buffer.from(valor, "base64url").toString("utf8")) as { c?: unknown; p?: unknown };
    if (typeof x.c !== "string" || typeof x.p !== "string" || !MARCA.test(x.c) || Number.isNaN(Date.parse(x.c)) || !PEDIDO_PUBLICO.test(x.p)) return null;
    return { createdAt: x.c, orderId: x.p };
  } catch {
    return null;
  }
}

/**
 * GET historial: ?estado=completed|cancelled|expired (opcional), ?limite=1..50, ?cursor=<opaco>.
 * Respuesta: { pedidos, siguiente } (siguiente = cursor de la próxima página o null).
 */
export async function listarHistorial(engine: OrderEngine | null, tenantId: string, params: URLSearchParams): Promise<Response> {
  if (!engine) return apiError("UNAVAILABLE", "Los pedidos no están activados.", 503);
  const estado = params.get("estado");
  if (estado !== null && estado !== "todos" && !(CLOSED_STATUSES as readonly string[]).includes(estado)) {
    return apiError("VALIDATION_ERROR", "estado debe ser completed, cancelled, expired o todos.", 400);
  }
  const limiteTexto = params.get("limite");
  const limite = limiteTexto === null ? HISTORIAL_POR_PAGINA : Number(limiteTexto);
  if (!Number.isInteger(limite) || limite < 1 || limite > HISTORIAL_MAX) return apiError("VALIDATION_ERROR", `limite debe ser un entero entre 1 y ${HISTORIAL_MAX}.`, 400);
  const cursorTexto = params.get("cursor");
  const cursor = cursorTexto ? decodificarCursor(cursorTexto) : null;
  if (cursorTexto && !cursor) return apiError("VALIDATION_ERROR", "cursor inválido.", 400);
  try {
    const r = await engine.listClosedOrders(tenantId, { status: estado && estado !== "todos" ? (estado as ClosedStatus) : undefined, cursor, limit: limite });
    return apiOk({ pedidos: r.items.map((i) => pedidoHistorial(i.order, i.reservations)), siguiente: r.next ? codificarCursor(r.next) : null });
  } catch (err) {
    return errorPedido(err);
  }
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
