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
import type { CustomerChannel, CustomerChannelOrigin } from "@/lib/agente/clasificacion";

export const PEDIDO_PUBLICO = /^DL-ORD-[0-9A-HJKMNP-TV-Z]{6}$/;

export interface PedidoPanel {
  pedido: string;
  estado: Order["status"];
  canal: Order["channel"];
  origen: Order["source"];
  cliente: string | null;
  lineas: Array<{ referencia: string; nombre: string; cantidad: number; precio_unitario: number | null; subtotal: number | null; foto?: string | null }>;
  unidades: number;
  total: number;
  sin_precio: number;
  /** apartado: stock descontado y vigente; sin_reserva: no aplica (sin inventario controlado o aún sin confirmar). */
  stock: { estado: "apartado" | "sin_reserva"; unidades: number; vence: string | null };
  creado: string;
  actualizado: string;
  // --- Bloque 25 (solo con PanelExtras; ver enriquecerPedidos) ---
  contacto?: PedidoContacto | null;
  /** Cuándo el cliente confirmó (evento del motor). */
  confirmado?: string | null;
  /** Vence la reserva (confirmado) o la propuesta (esperando confirmación). */
  vence?: string | null;
  asesora?: PedidoAsesora | null;
}

/** Bloque 25 — el cliente del pedido, tal como lo ve la asesora. */
export interface PedidoContacto {
  /** Número del negocio que atendió (para abrir el chat en el Inbox). */
  numero: string;
  /** Teléfono completo: SOLO para quien puede atender (admin / agente). */
  telefono: string | null;
  /** Últimos 4 dígitos (para cualquiera con acceso al catálogo). */
  telefono_parcial: string;
  nombre: string | null;
  /** Modalidad del contacto (detal / mayorista). null = sin clasificar. */
  tipo: Order["channel"] | null;
  tipo_origen: CustomerChannelOrigin | null;
  tipo_desde: string | null;
}

export interface PedidoAsesora {
  /** Motivo del traspaso (el que registró el motor). */
  motivo: string | null;
  pedida_por: "system" | "agent" | "human" | null;
  desde: string | null;
  /** Persona del equipo que tiene asignada la conversación (Inbox). */
  asignada: string | null;
}

/**
 * Fuentes del enriquecimiento (inyectables; en producción, panel-fuentes.ts). Cada una puede fallar
 * sin romper el panel: lo que no se pudo leer queda en null.
 */
export interface PanelFuentes {
  /** clave `${phoneNumberId}|${waId}` -> nombre conocido. */
  nombres(tenantId: string, contactos: ReadonlyArray<{ phoneNumberId: string; waId: string }>): Promise<Map<string, string>>;
  canales(tenantId: string, contactos: ReadonlyArray<{ phoneNumberId: string; waId: string }>): Promise<Map<string, CustomerChannel>>;
  /** id INTERNO del pedido -> cuándo pasó a confirmado. */
  confirmados(tenantId: string, orderIds: readonly string[]): Promise<Map<string, string>>;
  /** clave `${phoneNumberId}|${waId}` -> nombre (o correo) de la persona asignada. */
  asignadas(tenantId: string, contactos: ReadonlyArray<{ phoneNumberId: string; waId: string }>): Promise<Map<string, string>>;
  /** referencia -> miniatura del producto. */
  fotos(tenantId: string, references: readonly string[]): Promise<Map<string, string | null>>;
  /** Bloque 27: id de la persona del equipo -> nombre (o correo), solo del negocio. Historial del pedido. */
  miembros?(tenantId: string, ids: readonly number[]): Promise<Map<number, string>>;
}

export interface PanelExtras {
  fuentes: PanelFuentes;
  /** Rol que atiende (admin / agente): ve el teléfono completo. */
  verTelefono: boolean;
}

const claveContacto = (c: { phoneNumberId: string; waId: string }) => `${c.phoneNumberId}|${c.waId}`;
const leer = async <T>(p: Promise<Map<string, T>>): Promise<Map<string, T>> => {
  try {
    return await p;
  } catch (err) {
    console.error("[catalogo/pedidos/panel] enriquecer:", err instanceof Error ? err.message : "?");
    return new Map();
  }
};

/**
 * Bloque 25 — agrega a cada pedido lo que la asesora necesita para atenderlo (cliente, modalidad,
 * fechas, fotos, asesora). Solo LECTURA: nada de esto se puede cambiar desde aquí.
 */
export async function enriquecerPedidos<P extends PedidoPanel | PedidoHistorial>(tenantId: string, items: Array<{ vista: P; order: Order; reservations: readonly ReservationSummary[] }>, extras: PanelExtras): Promise<P[]> {
  const contactos = [...new Map(items.flatMap((i) => (i.order.contact ? [[claveContacto(i.order.contact), i.order.contact] as const] : []))).values()];
  const refs = [...new Set(items.flatMap((i) => i.order.lines.map((l) => l.reference)))];
  const conConfirmacion = items.filter((i) => ["confirmed", "handoff", "completed", "cancelled", "expired", "rejected"].includes(i.order.status)).map((i) => i.order.id);
  const [nombres, canales, confirmados, asignadas, fotos] = await Promise.all([
    contactos.length ? leer(extras.fuentes.nombres(tenantId, contactos)) : new Map<string, string>(),
    contactos.length ? leer(extras.fuentes.canales(tenantId, contactos)) : new Map<string, CustomerChannel>(),
    conConfirmacion.length ? leer(extras.fuentes.confirmados(tenantId, conConfirmacion)) : new Map<string, string>(),
    contactos.length ? leer(extras.fuentes.asignadas(tenantId, contactos)) : new Map<string, string>(),
    refs.length ? leer(extras.fuentes.fotos(tenantId, refs)) : new Map<string, string | null>(),
  ]);
  return items.map(({ vista, order, reservations }) => {
    const c = order.contact;
    const k = c ? claveContacto(c) : null;
    const canal = k ? canales.get(k) : undefined;
    const activas = reservations.filter((r) => r.status === "activa").map((r) => r.expiresAt).sort();
    const vence = order.status === "confirmed" ? (activas[0] ?? null) : order.status === "pending_confirmation" ? (order.confirmation?.expiresAt ?? null) : null;
    return {
      ...vista,
      cliente: extras.verTelefono ? vista.cliente : null,
      lineas: vista.lineas.map((l) => ({ ...l, foto: fotos.get(l.referencia) ?? null })),
      contacto:
        c && k
          ? {
              numero: c.phoneNumberId,
              telefono: extras.verTelefono ? c.waId : null,
              telefono_parcial: c.waId.slice(-4),
              nombre: nombres.get(k) ?? null,
              tipo: canal?.channel ?? null,
              tipo_origen: canal?.origin ?? null,
              tipo_desde: canal?.updatedAt ?? null,
            }
          : null,
      confirmado: confirmados.get(order.id) ?? null,
      vence,
      asesora:
        order.handoff || (k && asignadas.has(k))
          ? { motivo: order.handoff?.reason ?? null, pedida_por: order.handoff?.requestedBy ?? null, desde: order.handoff?.at ?? null, asignada: (k && asignadas.get(k)) || null }
          : null,
    };
  });
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
 * GET historial: ?estado=completed|cancelled|expired|rejected (opcional), ?limite=1..50, ?cursor=<opaco>.
 * Respuesta: { pedidos, siguiente } (siguiente = cursor de la próxima página o null).
 */
export async function listarHistorial(engine: OrderEngine | null, tenantId: string, params: URLSearchParams, extras?: PanelExtras): Promise<Response> {
  if (!engine) return apiError("UNAVAILABLE", "Los pedidos no están activados.", 503);
  const estado = params.get("estado");
  if (estado !== null && estado !== "todos" && !(CLOSED_STATUSES as readonly string[]).includes(estado)) {
    return apiError("VALIDATION_ERROR", "estado debe ser completed, cancelled, expired, rejected o todos.", 400);
  }
  const limiteTexto = params.get("limite");
  const limite = limiteTexto === null ? HISTORIAL_POR_PAGINA : Number(limiteTexto);
  if (!Number.isInteger(limite) || limite < 1 || limite > HISTORIAL_MAX) return apiError("VALIDATION_ERROR", `limite debe ser un entero entre 1 y ${HISTORIAL_MAX}.`, 400);
  const cursorTexto = params.get("cursor");
  const cursor = cursorTexto ? decodificarCursor(cursorTexto) : null;
  if (cursorTexto && !cursor) return apiError("VALIDATION_ERROR", "cursor inválido.", 400);
  try {
    const r = await engine.listClosedOrders(tenantId, { status: estado && estado !== "todos" ? (estado as ClosedStatus) : undefined, cursor, limit: limite });
    const base = r.items.map((i) => ({ vista: pedidoHistorial(i.order, i.reservations), order: i.order, reservations: i.reservations }));
    const pedidos = extras ? await enriquecerPedidos(tenantId, base, extras) : base.map((b) => b.vista);
    return apiOk({ pedidos, siguiente: r.next ? codificarCursor(r.next) : null });
  } catch (err) {
    return errorPedido(err);
  }
}

const HTTP: Partial<Record<OrderError["code"], number>> = { NOT_FOUND: 404, INVALID_TRANSITION: 409, CONFLICT: 409, UNAVAILABLE: 503 };

export async function listarPedidos(engine: OrderEngine | null, tenantId: string, extras?: PanelExtras): Promise<Response> {
  if (!engine) return apiError("UNAVAILABLE", "Los pedidos no están activados.", 503);
  try {
    const rows = await engine.listOpenOrders(tenantId, 100);
    const base = rows.map((r) => ({ vista: pedidoPanel(r.order, r.reservations), order: r.order, reservations: r.reservations }));
    return apiOk({ pedidos: extras ? await enriquecerPedidos(tenantId, base, extras) : base.map((b) => b.vista) });
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
