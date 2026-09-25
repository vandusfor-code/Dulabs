/**
 * Bloque 27 — módulo "PEDIDOS" del dashboard: la operación de un pedido REAL después de confirmado.
 *
 * DOS EJES independientes (ninguna vista los guarda; se derivan del motor):
 *   pedido  CONFIRMADO -> EN PREPARACIÓN -> ENVIADO (solo domicilio) -> ENTREGADO -> COMPLETADO
 *           (recoger en tienda: EN PREPARACIÓN -> ENTREGADO) · CANCELADO / RECHAZADO solo antes de
 *           salir (confirmado / en preparación) · VENCIDO (72 h sin que nadie lo tocara).
 *   pago    PENDIENTE -> RECIBIDO (en cualquier etapa del pedido activo). "Confirmado" no es pagado.
 *   Completar = entregado Y pago recibido.
 *
 * La ATENCIÓN (asesora, IA pausada, estado del Inbox) es de la CONVERSACIÓN y se muestra aparte:
 * nunca cambia el estado del pedido. Cada acción la valida el backend (esta capa) Y la BD (RPC con
 * compare-and-set + trigger de reglas), con la persona del equipo que la hizo. Nunca se editan
 * productos, precios, stock, reservas ni datos del checkout. Pedidos anteriores al Bloque 27 (sin
 * checkout) se leen igual y solo se completan/cancelan/rechazan.
 */
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import type { Order, OrderStage, OrderStatus, PaymentStatus } from "@/lib/catalogo/pedidos/contrato";
import { canCancelStage, canCompleteStage, nextStage, reservationCanExpire } from "@/lib/catalogo/pedidos/contrato";
import { OrderError, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import type { OrderHistoryEntry, PanelQuery, ReservationSummary } from "@/lib/catalogo/pedidos/repositorio";
import { PEDIDO_PUBLICO, enriquecerPedidos, pedidoPanel, type PanelExtras, type PedidoPanel } from "@/lib/catalogo/pedidos/panel";

export const ESTADOS_VISIBLES = [
  "confirmado",
  "en_preparacion",
  "enviado",
  "entregado",
  "completado",
  "cancelado",
  "rechazado",
  "vencido",
  /** Pedido anterior al checkout, en manos de una asesora (estado 'handoff' del motor). */
  "con_asesora",
] as const;
export type EstadoVisible = (typeof ESTADOS_VISIBLES)[number];

export const ACCIONES = ["pago_recibido", "en_preparacion", "enviado", "entregado", "completar", "cancelar", "rechazar"] as const;
export type AccionPedido = (typeof ACCIONES)[number];

const ACTIVOS: readonly OrderStatus[] = ["confirmed", "handoff"];

export function estadoVisible(o: Order): EstadoVisible {
  if (o.status === "completed") return "completado";
  if (o.status === "cancelled") return "cancelado";
  if (o.status === "rejected") return "rechazado";
  if (o.status === "expired") return "vencido";
  if (o.checkout && ACTIVOS.includes(o.status)) return o.checkout.stage;
  return o.status === "handoff" ? "con_asesora" : "confirmado";
}

/** Acciones que la persona puede pedir AHORA (el backend y la BD las vuelven a validar). */
export function accionesPermitidas(o: Order): AccionPedido[] {
  if (!ACTIVOS.includes(o.status)) return [];
  if (!o.checkout) return ["completar", "cancelar", "rechazar"];
  if (o.status !== "confirmed") return [];
  const { stage, delivery, paymentStatus } = o.checkout;
  const out: AccionPedido[] = [];
  if (paymentStatus === "pendiente") out.push("pago_recibido");
  const siguiente = nextStage(stage, delivery);
  // nextStage nunca vuelve a "confirmado": siempre es una acción de avance.
  if (siguiente && siguiente !== "confirmado") out.push(siguiente);
  if (canCompleteStage(stage, paymentStatus)) out.push("completar");
  if (canCancelStage(stage)) out.push("cancelar", "rechazar");
  return out;
}

/** ¿Esa acción ya quedó aplicada? (un reintento, doble clic o recarga no la repite) */
function yaAplicada(o: Order, a: AccionPedido): boolean {
  if (a === "completar") return o.status === "completed";
  if (a === "cancelar") return o.status === "cancelled";
  if (a === "rechazar") return o.status === "rejected";
  if (a === "pago_recibido") return o.checkout?.paymentStatus === "recibido";
  return o.checkout?.stage === a;
}

/** Atención de la CONVERSACIÓN (no del pedido): IA pausada, estado del Inbox y persona asignada. */
export interface AtencionConversacion {
  ia_pausada_hasta: string | null;
  conversacion: "open" | "pending" | "closed" | null;
  asignada: string | null;
}

export interface PedidoGestion extends PedidoPanel {
  estado_visible: EstadoVisible;
  estado_pago: PaymentStatus | null;
  acciones: AccionPedido[];
  checkout: {
    nombre: string;
    metodo_pago: "pago_en_tienda" | "transferencia";
    estado_pago: PaymentStatus;
    entrega: "tienda" | "domicilio";
    direccion: string | null;
    ciudad: string | null;
    referencia_entrega: string | null;
    etapa: OrderStage;
  } | null;
  confirmado_en: string | null;
  /** Cuándo vence la reserva si nadie lo gestiona (null = ya no vence). */
  vence_reserva: string | null;
  /** Motivo con que el pedido se pasó a una asesora (historia; la atención actual va en `atencion`). */
  motivo_traspaso: string | null;
  atencion: AtencionConversacion | null;
  /** Estado del pedido + etapa + pago que la persona VIO (compare-and-set de las acciones). */
  version: { estado: OrderStatus; etapa: OrderStage | null; pago: PaymentStatus | null };
}

export interface HistorialEntrada {
  tipo: OrderHistoryEntry["type"];
  desde: string | null;
  hacia: string | null;
  actor: OrderHistoryEntry["actor"];
  miembro: string | null;
  motivo: string | null;
  fecha: string;
}

export function pedidoGestion(order: Order, reservations: readonly ReservationSummary[]): PedidoGestion {
  const c = order.checkout;
  const activas = reservations.filter((r) => r.status === "activa").map((r) => r.expiresAt).sort();
  const puedeVencer = order.status === "confirmed" && (!c || reservationCanExpire(c.stage, c.paymentStatus));
  return {
    ...pedidoPanel(order, reservations),
    estado_visible: estadoVisible(order),
    estado_pago: c?.paymentStatus ?? null,
    acciones: accionesPermitidas(order),
    checkout: c
      ? {
          nombre: c.customerName,
          metodo_pago: c.paymentMethod,
          estado_pago: c.paymentStatus,
          entrega: c.delivery,
          direccion: c.address,
          ciudad: c.city,
          referencia_entrega: c.deliveryReference,
          etapa: c.stage,
        }
      : null,
    confirmado_en: order.confirmedAt,
    vence_reserva: puedeVencer ? (activas[0] ?? null) : null,
    motivo_traspaso: order.handoff?.reason ?? null,
    atencion: null,
    version: { estado: order.status, etapa: c?.stage ?? null, pago: c?.paymentStatus ?? null },
  };
}

/** Atención de cada conversación (fuente opcional; si falla, el pedido se muestra sin ella). */
async function conAtencion(tenantId: string, pedidos: PedidoGestion[], orders: Order[], extras: PanelExtras): Promise<PedidoGestion[]> {
  const contactos = [...new Map(orders.flatMap((o) => (o.contact ? [[`${o.contact.phoneNumberId}|${o.contact.waId}`, o.contact] as const] : []))).values()];
  const mapa = contactos.length && extras.fuentes.atencion ? await extras.fuentes.atencion(tenantId, contactos).catch(() => new Map()) : new Map();
  return pedidos.map((p, i) => {
    const c = orders[i].contact;
    const a = c ? mapa.get(`${c.phoneNumberId}|${c.waId}`) : undefined;
    return { ...p, atencion: c ? { ia_pausada_hasta: a?.pausadaHasta ?? null, conversacion: a?.conversacion ?? null, asignada: p.asesora?.asignada ?? null } : null };
  });
}

// ---------------------------------------------------------------------------
// Lectura: GET lista (filtros + cursor) y GET detalle
// ---------------------------------------------------------------------------

export const PEDIDOS_POR_PAGINA = 25;
const MAX_POR_PAGINA = 50;
const MARCA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function codificarCursorGestion(c: { updatedAt: string; orderId: string }): string {
  return Buffer.from(JSON.stringify({ u: c.updatedAt, p: c.orderId })).toString("base64url");
}

export function decodificarCursorGestion(valor: string): { updatedAt: string; orderId: string } | null {
  if (valor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(valor)) return null;
  try {
    const x = JSON.parse(Buffer.from(valor, "base64url").toString("utf8")) as { u?: unknown; p?: unknown };
    if (typeof x.u !== "string" || typeof x.p !== "string" || !MARCA.test(x.u) || Number.isNaN(Date.parse(x.u)) || !PEDIDO_PUBLICO.test(x.p)) return null;
    return { updatedAt: x.u, orderId: x.p };
  } catch {
    return null;
  }
}

/** Fecha del filtro (YYYY-MM-DD, hora de Colombia) -> instante. `fin` = inicio del día siguiente. */
function dia(valor: string, fin: boolean): string | null {
  if (!FECHA.test(valor)) return null;
  const t = Date.parse(`${valor}T00:00:00-05:00`);
  if (Number.isNaN(t)) return null;
  return new Date(t + (fin ? 86_400_000 : 0)).toISOString();
}

type Filtros = Omit<PanelQuery, "before" | "limit">;

/** Filtros del query string. Todo validado contra listas cerradas; texto libre solo en `q` (saneado en el repositorio). */
export function filtrosGestion(params: URLSearchParams, verTelefono: boolean): { ok: true; filtros: Filtros } | { ok: false; message: string } {
  const f: Filtros = {};
  const estado = params.get("estado");
  if (estado && estado !== "todos") {
    if (!(ESTADOS_VISIBLES as readonly string[]).includes(estado)) return { ok: false, message: "estado no válido." };
    const e = estado as EstadoVisible;
    if (e === "completado") f.statuses = ["completed"];
    else if (e === "cancelado") f.statuses = ["cancelled"];
    else if (e === "rechazado") f.statuses = ["rejected"];
    else if (e === "vencido") f.statuses = ["expired"];
    else if (e === "con_asesora") f.statuses = ["handoff"];
    else {
      f.statuses = ["confirmed"];
      f.stages = [e];
    }
  }
  const pago = params.get("pago");
  if (pago) {
    if (pago !== "pendiente" && pago !== "recibido") return { ok: false, message: "pago no válido." };
    f.paymentStatus = pago;
  }
  const modalidad = params.get("modalidad");
  if (modalidad) {
    if (modalidad !== "detal" && modalidad !== "mayorista") return { ok: false, message: "modalidad no válida." };
    f.channel = modalidad === "detal" ? "retail" : "wholesale";
  }
  const metodo = params.get("metodo");
  if (metodo) {
    if (metodo !== "pago_en_tienda" && metodo !== "transferencia") return { ok: false, message: "método de pago no válido." };
    f.paymentMethod = metodo;
  }
  const entrega = params.get("entrega");
  if (entrega) {
    if (entrega !== "tienda" && entrega !== "domicilio") return { ok: false, message: "entrega no válida." };
    f.delivery = entrega;
  }
  const desde = params.get("desde");
  if (desde) {
    const d = dia(desde, false);
    if (!d) return { ok: false, message: "desde debe ser una fecha AAAA-MM-DD." };
    f.from = d;
  }
  const hasta = params.get("hasta");
  if (hasta) {
    const d = dia(hasta, true);
    if (!d) return { ok: false, message: "hasta debe ser una fecha AAAA-MM-DD." };
    f.to = d;
  }
  const q = params.get("q");
  if (q) {
    if (q.length > 60) return { ok: false, message: "La búsqueda admite máximo 60 caracteres." };
    f.search = q;
    // El teléfono solo se busca si quien consulta puede verlo.
    f.searchPhone = verTelefono;
  }
  return { ok: true, filtros: f };
}

const HTTP: Partial<Record<OrderError["code"], number>> = { NOT_FOUND: 404, INVALID_TRANSITION: 409, CONFLICT: 409, UNAVAILABLE: 503, INVALID_INPUT: 400 };

function errorGestion(err: unknown): Response {
  if (err instanceof OrderError) return apiError(err.code, err.message, HTTP[err.code] ?? 422);
  console.error("[catalogo/pedidos/gestion]", err instanceof Error ? err.message : "?");
  return apiError("INTERNAL_ERROR", "No se pudo completar la operación.", 500);
}

export async function listarGestion(engine: OrderEngine | null, tenantId: string, params: URLSearchParams, extras: PanelExtras): Promise<Response> {
  if (!engine) return apiError("UNAVAILABLE", "Los pedidos no están activados.", 503);
  const f = filtrosGestion(params, extras.verTelefono);
  if (!f.ok) return apiError("VALIDATION_ERROR", f.message, 400);
  const limiteTexto = params.get("limite");
  const limite = limiteTexto === null ? PEDIDOS_POR_PAGINA : Number(limiteTexto);
  if (!Number.isInteger(limite) || limite < 1 || limite > MAX_POR_PAGINA) return apiError("VALIDATION_ERROR", `limite debe ser un entero entre 1 y ${MAX_POR_PAGINA}.`, 400);
  const cursorTexto = params.get("cursor");
  const cursor = cursorTexto ? decodificarCursorGestion(cursorTexto) : null;
  if (cursorTexto && !cursor) return apiError("VALIDATION_ERROR", "cursor inválido.", 400);
  try {
    const r = await engine.panelOrders(tenantId, { ...f.filtros, before: cursor, limit: limite });
    const base = r.items.map((i) => ({ vista: pedidoGestion(i.order, i.reservations), order: i.order, reservations: i.reservations }));
    const pedidos = await conAtencion(tenantId, await enriquecerPedidos(tenantId, base, extras), base.map((b) => b.order), extras);
    return apiOk({ pedidos, siguiente: r.next ? codificarCursorGestion(r.next) : null });
  } catch (err) {
    return errorGestion(err);
  }
}

export async function detalleGestion(engine: OrderEngine | null, tenantId: string, pedido: string, extras: PanelExtras): Promise<Response> {
  if (!engine) return apiError("UNAVAILABLE", "Los pedidos no están activados.", 503);
  if (!PEDIDO_PUBLICO.test(pedido)) return apiError("NOT_FOUND", "No encontramos ese pedido.", 404);
  try {
    const found = await engine.panelOrder(tenantId, pedido);
    // Un pedido que nunca se confirmó (propuesta, borrador) no es parte del módulo.
    if (!found || !found.order.confirmedAt) return apiError("NOT_FOUND", "No encontramos ese pedido.", 404);
    const [enriquecido] = await enriquecerPedidos(tenantId, [{ vista: pedidoGestion(found.order, found.reservations), order: found.order, reservations: found.reservations }], extras);
    const [vista] = await conAtencion(tenantId, [enriquecido], [found.order], extras);
    const historia = await engine.orderHistory(tenantId, found.order);
    const ids = [...new Set(historia.flatMap((h) => (h.memberId !== null ? [h.memberId] : [])))];
    const nombres = ids.length && extras.fuentes.miembros ? await extras.fuentes.miembros(tenantId, ids).catch(() => new Map<number, string>()) : new Map<number, string>();
    const historial: HistorialEntrada[] = historia.map((h) => ({
      tipo: h.type,
      desde: h.from,
      hacia: h.to,
      actor: h.actor,
      miembro: h.memberId !== null ? (nombres.get(h.memberId) ?? `#${h.memberId}`) : null,
      motivo: h.reason,
      fecha: h.at,
    }));
    return apiOk({ pedido: vista, historial });
  } catch (err) {
    return errorGestion(err);
  }
}

// ---------------------------------------------------------------------------
// Acciones: POST { accion, esperado: { estado, etapa, pago }, motivo? }
// ---------------------------------------------------------------------------

export async function accionGestion(engine: OrderEngine | null, tenantId: string, pedido: string, body: unknown, memberId: number): Promise<Response> {
  if (!engine) return apiError("UNAVAILABLE", "Los pedidos no están activados.", 503);
  if (!PEDIDO_PUBLICO.test(pedido)) return apiError("NOT_FOUND", "No encontramos ese pedido.", 404);
  const b = (body ?? {}) as { accion?: unknown; esperado?: { estado?: unknown; etapa?: unknown; pago?: unknown } | null; motivo?: unknown };
  if (typeof b.accion !== "string" || !(ACCIONES as readonly string[]).includes(b.accion)) return apiError("VALIDATION_ERROR", "accion no válida.", 400);
  const accion = b.accion as AccionPedido;
  const esperadoEstado = b.esperado?.estado;
  const esperadaEtapa = b.esperado?.etapa ?? null;
  const esperadoPago = b.esperado?.pago ?? null;
  if (typeof esperadoEstado !== "string") return apiError("VALIDATION_ERROR", "Falta el estado que viste del pedido (esperado.estado).", 400);
  const motivo = typeof b.motivo === "string" ? b.motivo.trim() : "";
  if ((accion === "cancelar" || accion === "rechazar") && (motivo.length < 3 || motivo.length > 300)) {
    return apiError("VALIDATION_ERROR", "Escribe el motivo (entre 3 y 300 caracteres).", 400);
  }
  if (motivo.length > 300) return apiError("VALIDATION_ERROR", "El motivo admite máximo 300 caracteres.", 400);
  try {
    const found = await engine.panelOrder(tenantId, pedido);
    if (!found || !found.order.confirmedAt) return apiError("NOT_FOUND", "No encontramos ese pedido.", 404);
    const order = found.order;
    // Reintento (doble clic, recarga): lo que ya se aplicó no se aplica dos veces.
    if (yaAplicada(order, accion)) return apiOk({ pedido: pedidoGestion(order, found.reservations), repetido: true });
    // Compare-and-set: la persona decidió sobre lo que VIO; si cambió, que lo vuelva a ver.
    if (order.status !== esperadoEstado || (order.checkout?.stage ?? null) !== esperadaEtapa || (order.checkout?.paymentStatus ?? null) !== esperadoPago) {
      return apiError("CONFLICT", "El pedido cambió mientras lo revisabas. Actualiza y vuelve a intentarlo.", 409);
    }
    if (!accionesPermitidas(order).includes(accion)) {
      const porque =
        accion === "enviado"
          ? "Solo los pedidos a domicilio se marcan como enviados."
          : accion === "completar"
            ? "Para completar, el pedido debe estar entregado y con el pago recibido."
            : accion === "cancelar" || accion === "rechazar"
              ? "Un pedido que ya salió (enviado o entregado) no se cancela ni se rechaza."
              : "Esa acción no está permitida en el estado actual del pedido.";
      return apiError("INVALID_TRANSITION", porque, 409);
    }
    let result: { order: Order; result: "ok" | "duplicate" };
    if (accion === "pago_recibido") {
      result = await engine.markPaymentReceived({ tenantId, orderId: pedido, memberId, reason: motivo || null });
    } else if (accion === "en_preparacion" || accion === "enviado" || accion === "entregado") {
      // La etapa desde la que se avanza es la que la persona vio (ya verificada arriba).
      result = await engine.advanceStage({ tenantId, orderId: pedido, from: order.checkout!.stage, to: accion, memberId, reason: motivo || null });
    } else {
      result = await engine.closeOrder({
        tenantId,
        orderId: pedido,
        action: accion === "completar" ? "complete" : accion === "rechazar" ? "reject" : "cancel",
        memberId,
        reason: motivo || null,
        expectedStatus: order.status,
      });
    }
    const after = await engine.panelOrder(tenantId, pedido);
    return apiOk({ pedido: pedidoGestion(after?.order ?? result.order, after?.reservations ?? []), repetido: result.result === "duplicate" });
  } catch (err) {
    return errorGestion(err);
  }
}
