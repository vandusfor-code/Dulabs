/**
 * Persistencia de pedidos (migración 20261108000000_dulabs_catalogo_pedidos.sql).
 *
 * Toda escritura va por las funciones TRANSACCIONALES de la BD:
 *   - crear: pedido + evento en una transacción, idempotente por
 *     (negocio, clave de idempotencia);
 *   - transición: compare-and-set del estado + evento, con la máquina de
 *     estados validada TAMBIÉN en la BD.
 * Toda lectura filtra por negocio (el tenant lo pone el backend, nunca la IA).
 *
 * Sin la migración aplicada, `available()` responde false y el motor queda
 * inactivo (convivencia segura, igual que la carga masiva en la Fase 4).
 *
 * `createMemoryOrdersRepository` replica la MISMA semántica en memoria para
 * las pruebas (ningún test toca Supabase).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TERMINAL_STATUSES,
  canCompleteStage,
  canTransition,
  type Order,
  type OrderActor,
  type OrderChannel,
  type OrderCheckout,
  type OrderConfirmation,
  type OrderStage,
  type OrderHandoff,
  type OrderIssue,
  type OrderLine,
  type OrderSource,
  type OrderStatus,
} from "@/lib/catalogo/pedidos/contrato";
import type { OrderEvent } from "@/lib/catalogo/pedidos/eventos";

export type OrderContact = { phoneNumberId: string; waId: string };

export type NewOrder = Omit<Order, "id" | "handoff" | "updatedAt" | "checkout" | "confirmedAt">;

/** Lo único que una transición puede cambiar (negocio, canal, origen, id público y clave son inmutables). */
export interface OrderChanges {
  lines?: OrderLine[];
  totalUnits?: number;
  total?: number;
  unpricedUnits?: number;
  issues?: OrderIssue[];
  confirmation?: OrderConfirmation | null;
  handoff?: OrderHandoff | null;
  /** Solo se fija si el pedido no tenía contacto (o es el mismo). */
  contact?: OrderContact;
  /** Bloque 27: datos del checkout (solo al confirmar; después son inmutables). */
  checkout?: OrderCheckout;
  confirmedAt?: string;
}

export interface TransitionInput {
  businessId: string;
  id: string;
  from: OrderStatus;
  to: OrderStatus;
  actor: OrderActor;
  changes: OrderChanges;
  event: OrderEvent | null;
  /** Bloque 27: persona del equipo que hizo el cambio (historial). */
  memberId?: number | null;
}

/** Bloque 27 — una entrada del historial del pedido (inmutable), tal como la ve el panel. */
export interface OrderHistoryEntry {
  type: "order.created" | "catalog.order_request.created" | "order.status_changed" | "order.handoff_requested" | "order.stage_changed";
  from: string | null;
  to: string | null;
  actor: OrderActor | null;
  memberId: number | null;
  reason: string | null;
  at: string;
}

export type StageChangeResult =
  | { result: "ok" | "sin_cambio"; order: Order }
  | { result: "conflicto"; stage: OrderStage | null; status: OrderStatus | null }
  | { result: "no_encontrado" };

/** Bloque 27 — filtros del panel "Pedidos" (todos opcionales; el negocio lo pone el backend). */
export interface PanelQuery {
  statuses?: readonly OrderStatus[];
  stages?: readonly OrderStage[];
  paymentStatus?: "pendiente" | "recibido";
  channel?: OrderChannel;
  paymentMethod?: "pago_en_tienda" | "transferencia";
  delivery?: "tienda" | "domicilio";
  from?: string;
  to?: string;
  /** Número de pedido, nombre o referencia de producto; teléfono solo si `searchPhone`. */
  search?: string;
  searchPhone?: boolean;
  before: { updatedAt: string; orderId: string } | null;
  limit: number;
}

/** El id público derivado ya lo usa OTRO pedido del negocio (colisión de 30 bits): se re-deriva. */
export class PublicIdTaken extends Error {}
/** Transición no permitida por la máquina de estados (código o BD). */
export class InvalidTransition extends Error {}

/**
 * Bloque 19 — confirmar APARTA el stock (trigger de la BD, todo o nada). Si no alcanza, la BD
 * revierte la transición entera (CT010) y dice qué falta; si un producto ya no se vende, CT011.
 */
export class StockUnavailable extends Error {
  constructor(readonly shortages: Array<{ reference: string; requested: number; available: number }>) {
    super("stock_insuficiente");
  }
}
export class ProductNotSellable extends Error {
  constructor(readonly references: string[]) {
    super("producto_no_disponible");
  }
}

/** Plazo de la reserva de un pedido confirmado sin cerrar (igual que dulabs_catalogo_reserva_ttl()). */
export const RESERVATION_TTL_MS = 72 * 60 * 60 * 1000;

export interface ReservationSummary {
  /** id INTERNO del pedido (el público no se guarda en la reserva). */
  orderId: string;
  reference: string;
  quantity: number;
  status: "activa" | "liberada" | "consumida";
  expiresAt: string;
}

/** Posición en el historial: creación exacta (como la guarda la BD) + número público del pedido. */
export interface OrderCursor {
  createdAt: string;
  orderId: string;
}

export interface OrdersRepository {
  /** false si la migración no está aplicada. */
  available(): Promise<boolean>;
  create(order: NewOrder, event: OrderEvent): Promise<{ created: boolean; order: Order }>;
  /** null = el estado ya no era `from`, el pedido no es de este negocio o el contacto no coincide (nada se escribió). */
  transition(input: TransitionInput): Promise<Order | null>;
  getByOrderId(businessId: string, orderId: string): Promise<Order | null>;
  /** Pedido más reciente de la conversación en alguno de esos estados. */
  latestForContact(businessId: string, contact: OrderContact, statuses: readonly OrderStatus[]): Promise<Order | null>;
  /** Pedidos del negocio en esos estados, más recientes primero (panel de la asesora). */
  listForBusiness(businessId: string, statuses: readonly OrderStatus[], limit: number): Promise<Order[]>;
  /**
   * Historial (Bloque 21): pedidos CERRADOS del negocio en esos estados, del más reciente al más
   * antiguo por (creación, número público), desde el cursor `before` (keyset; nunca OFFSET).
   * `createdAtRaw` es la marca EXACTA de la BD (microsegundos) para armar el cursor siguiente.
   */
  listClosed(businessId: string, query: { statuses: readonly OrderStatus[]; before: OrderCursor | null; limit: number }): Promise<Array<{ order: Order; createdAtRaw: string }>>;
  /** Reservas de stock de esos pedidos (ids internos) del negocio. Sin la migración: []. */
  reservationsFor(businessId: string, orderIds: readonly string[]): Promise<ReservationSummary[]>;
  /** Vence los pedidos confirmados cuya reserva pasó su plazo (el stock vuelve). Sin la migración: 0. */
  expireReservations(limit: number): Promise<number>;
  /**
   * Bloque 23 — pedidos de una CONVERSACIÓN (con contacto) en esos estados sin ningún cambio desde
   * `updatedBefore`, los más viejos primero (todos los negocios, o solo `businessId`).
   */
  listStale(query: { statuses: readonly OrderStatus[]; updatedBefore: string; businessId?: string; limit: number }): Promise<Order[]>;
  /** Bloque 27 — cambia la etapa operativa (compare-and-set + evento; misma etapa = sin cambio). */
  setStage(input: { businessId: string; orderId: string; from: OrderStage; to: OrderStage; memberId: number; reason: string | null; eventId: string }): Promise<StageChangeResult>;
  /** Bloque 27 — pedidos YA confirmados del negocio, por actualización (más recientes primero). */
  listPanel(businessId: string, query: PanelQuery): Promise<Array<{ order: Order; updatedAtRaw: string }>>;
  /** Bloque 27 — historial completo del pedido (id interno), del más viejo al más nuevo. */
  historyFor(businessId: string, orderId: string): Promise<OrderHistoryEntry[]>;
}

/** Aplica cambios a un pedido (misma regla que la función SQL): para armar el evento ANTES de escribir. */
export function applyChanges(order: Order, to: OrderStatus, changes: OrderChanges, updatedAt: string): Order {
  return {
    ...order,
    status: to,
    ...(changes.lines !== undefined ? { lines: changes.lines } : {}),
    ...(changes.totalUnits !== undefined ? { totalUnits: changes.totalUnits } : {}),
    ...(changes.total !== undefined ? { total: changes.total } : {}),
    ...(changes.unpricedUnits !== undefined ? { unpricedUnits: changes.unpricedUnits } : {}),
    ...(changes.issues !== undefined ? { issues: changes.issues } : {}),
    ...(changes.confirmation !== undefined ? { confirmation: changes.confirmation } : {}),
    ...(changes.handoff !== undefined ? { handoff: changes.handoff } : {}),
    ...(changes.contact !== undefined ? { contact: order.contact ?? changes.contact } : {}),
    ...(changes.checkout !== undefined ? { checkout: changes.checkout } : {}),
    ...(changes.confirmedAt !== undefined ? { confirmedAt: changes.confirmedAt } : {}),
    updatedAt,
  };
}

function assertTransition(from: OrderStatus, to: OrderStatus, actor: OrderActor) {
  if (from === to) {
    if (TERMINAL_STATUSES.has(from) || from === "confirmed" || from === "handoff") throw new InvalidTransition(`actualización no permitida en ${from}`);
    return;
  }
  if (!canTransition(from, to, actor)) throw new InvalidTransition(`transición no permitida: ${from} -> ${to} (${actor})`);
}

const sameContact = (a: OrderContact | null, b: OrderContact) => a !== null && a.waId === b.waId && a.phoneNumberId === b.phoneNumberId;

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

const T_PEDIDOS = "dulabs_catalogo_pedidos";
const BASE_COLUMNS =
  "id, id_tenant, pedido_publico, canal, origen, estado, clave_idempotencia, huella_solicitud, contacto_phone_number_id, contacto_wa_id, lineas, total_unidades, total, unidades_sin_precio, moneda, problemas, confirmacion, handoff, created_at, updated_at";
/** Bloque 27: columnas del checkout (si la migración 20261121 aún no está, se lee sin ellas). */
const CHECKOUT_COLUMNS = "checkout, cliente_nombre, metodo_pago, estado_pago, tipo_entrega, direccion, ciudad, referencia_entrega, etapa, confirmado_at";
const COLUMNS = `${BASE_COLUMNS}, ${CHECKOUT_COLUMNS}`;

interface PgError {
  code?: string;
  message?: string;
}

interface OrderRow {
  id: string;
  id_tenant: string;
  pedido_publico: string;
  canal: OrderChannel;
  origen: OrderSource;
  estado: OrderStatus;
  clave_idempotencia: string;
  huella_solicitud: string | null;
  contacto_phone_number_id: string | null;
  contacto_wa_id: string | null;
  lineas: Array<{ reference: string; product_name: string; quantity: number; unit_price: number | null; subtotal: number | null }>;
  total_unidades: number;
  total: number | string;
  unidades_sin_precio: number;
  problemas: OrderIssue[];
  confirmacion: { id: string; total: number; unpriced_units: number; expires_at: string } | null;
  handoff: { reason: string; context?: string | null; requested_by: OrderActor; at: string } | null;
  created_at: string;
  updated_at: string;
  checkout?: boolean | null;
  cliente_nombre?: string | null;
  metodo_pago?: OrderCheckout["paymentMethod"] | null;
  estado_pago?: OrderCheckout["paymentStatus"] | null;
  tipo_entrega?: OrderCheckout["delivery"] | null;
  direccion?: string | null;
  ciudad?: string | null;
  referencia_entrega?: string | null;
  etapa?: OrderStage | null;
  confirmado_at?: string | null;
}

function checkoutFromRow(r: OrderRow): OrderCheckout | null {
  if (!r.checkout || !r.cliente_nombre || !r.metodo_pago || !r.estado_pago || !r.tipo_entrega || !r.etapa) return null;
  return {
    customerName: r.cliente_nombre,
    paymentMethod: r.metodo_pago,
    paymentStatus: r.estado_pago,
    delivery: r.tipo_entrega,
    address: r.direccion ?? null,
    city: r.ciudad ?? null,
    deliveryReference: r.referencia_entrega ?? null,
    stage: r.etapa,
  };
}

const iso = (value: string) => new Date(value).toISOString();

export function orderFromRow(r: OrderRow): Order {
  return {
    id: r.id,
    orderId: r.pedido_publico,
    businessId: r.id_tenant,
    channel: r.canal,
    source: r.origen,
    status: r.estado,
    contact: r.contacto_wa_id && r.contacto_phone_number_id ? { phoneNumberId: r.contacto_phone_number_id, waId: r.contacto_wa_id } : null,
    lines: (r.lineas ?? []).map((l) => ({ reference: l.reference, productName: l.product_name, quantity: l.quantity, unitPrice: l.unit_price, subtotal: l.subtotal })),
    totalUnits: r.total_unidades,
    total: Number(r.total),
    unpricedUnits: r.unidades_sin_precio,
    currency: "COP",
    issues: r.problemas ?? [],
    confirmation: r.confirmacion ? { id: r.confirmacion.id, total: r.confirmacion.total, unpricedUnits: r.confirmacion.unpriced_units, expiresAt: r.confirmacion.expires_at } : null,
    handoff: r.handoff ? { reason: r.handoff.reason, context: r.handoff.context ?? null, requestedBy: r.handoff.requested_by, at: r.handoff.at } : null,
    checkout: checkoutFromRow(r),
    confirmedAt: r.confirmado_at ? iso(r.confirmado_at) : null,
    idempotencyKey: r.clave_idempotencia,
    requestFingerprint: r.huella_solicitud,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const linesToRow = (lines: OrderLine[]) =>
  lines.map((l) => ({ reference: l.reference, product_name: l.productName, quantity: l.quantity, unit_price: l.unitPrice, subtotal: l.subtotal }));
const confirmationToRow = (c: OrderConfirmation | null) => (c ? { id: c.id, total: c.total, unpriced_units: c.unpricedUnits, expires_at: c.expiresAt } : null);
const handoffToRow = (h: OrderHandoff | null) => (h ? { reason: h.reason, context: h.context, requested_by: h.requestedBy, at: h.at } : null);

function changesToRow(c: OrderChanges): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (c.lines !== undefined) out.lineas = linesToRow(c.lines);
  if (c.totalUnits !== undefined) out.total_unidades = c.totalUnits;
  if (c.total !== undefined) out.total = c.total;
  if (c.unpricedUnits !== undefined) out.unidades_sin_precio = c.unpricedUnits;
  if (c.issues !== undefined) out.problemas = c.issues;
  if (c.confirmation !== undefined) out.confirmacion = confirmationToRow(c.confirmation);
  if (c.handoff !== undefined) out.handoff = handoffToRow(c.handoff);
  if (c.contact !== undefined) {
    out.contacto_phone_number_id = c.contact.phoneNumberId;
    out.contacto_wa_id = c.contact.waId;
  }
  if (c.checkout !== undefined) {
    out.checkout = true;
    out.cliente_nombre = c.checkout.customerName;
    out.metodo_pago = c.checkout.paymentMethod;
    out.estado_pago = c.checkout.paymentStatus;
    out.tipo_entrega = c.checkout.delivery;
    out.direccion = c.checkout.address;
    out.ciudad = c.checkout.city;
    out.referencia_entrega = c.checkout.deliveryReference;
    out.etapa = c.checkout.stage;
  }
  if (c.confirmedAt !== undefined) out.confirmado_at = c.confirmedAt;
  return out;
}

const eventToRow = (e: OrderEvent, memberId?: number | null) => ({
  event_id: e.event_id,
  tipo: e.event_type,
  motivo: e.transition?.reason ?? null,
  payload: e,
  ...(memberId ? { miembro_id: memberId } : {}),
});

/** Tabla/función inexistente (migración sin aplicar): Postgres y PostgREST. */
function isMissingSchema(error: PgError): boolean {
  return ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "");
}

function fail(context: string, error: PgError): never {
  throw new Error(`[catalogo/pedidos] ${context}: ${error.code ?? "?"} ${error.message ?? ""}`.trim());
}

const PROBE_TTL_MS = 60_000;

/**
 * Bloque 27 — búsqueda del panel, SIEMPRE tipada y saneada (nunca se interpola texto libre):
 * número de pedido, referencia de producto, teléfono (solo con permiso) o nombre del cliente.
 */
export function panelSearch(raw: string | undefined, allowPhone: boolean): { kind: "order" | "reference" | "phone" | "name" | "none"; value: string } | null {
  const t = (raw ?? "").trim().slice(0, 60);
  if (!t) return null;
  const up = t.toUpperCase();
  if (/^DL-ORD-[0-9A-HJKMNP-TV-Z]{6}$/.test(up)) return { kind: "order", value: up };
  if (/^[A-Z]{1,6}-\d{6,}$/.test(up)) return { kind: "reference", value: up };
  const digits = t.replace(/\D/g, "");
  // Buscar por teléfono sin permiso para verlo: no coincide con nada (nunca revela quién es).
  if (/^[\d\s()+-]+$/.test(t) && digits.length >= 4) return allowPhone ? { kind: "phone", value: digits.slice(-12) } : { kind: "none", value: "" };
  const name = t.replace(/[^\p{L}\p{N} .'-]/gu, "").trim();
  return name.length >= 2 ? { kind: "name", value: name } : null;
}

export function createSupabaseOrdersRepository(supabase: SupabaseClient, now: () => number = Date.now): OrdersRepository {
  let probe: { value: boolean; at: number } | null = null;
  // Bloque 27: sin la migración 20261121 las columnas del checkout no existen: se lee sin ellas
  // (los pedidos quedan sin checkout) en vez de romper el motor.
  let columns = COLUMNS;
  const read = async <T>(run: (cols: string) => PromiseLike<{ data: T; error: PgError | null }>) => {
    let r = await run(columns);
    if (r.error && columns !== BASE_COLUMNS && (r.error.code === "42703" || r.error.code === "PGRST204")) {
      columns = BASE_COLUMNS;
      r = await run(columns);
    }
    return r;
  };

  return {
    async available() {
      if (probe && now() - probe.at < PROBE_TTL_MS) return probe.value;
      // GET con limit(0) (no HEAD): así llega el código que distingue "falta la migración" de una caída.
      const { error } = await supabase.from(T_PEDIDOS).select("id").limit(0);
      if (error && !isMissingSchema(error)) fail("available", error);
      probe = { value: !error, at: now() };
      return probe.value;
    },

    async create(order, event) {
      const pedido = {
        id_tenant: order.businessId,
        pedido_publico: order.orderId,
        canal: order.channel,
        origen: order.source,
        estado: order.status,
        clave_idempotencia: order.idempotencyKey,
        huella_solicitud: order.requestFingerprint,
        contacto_phone_number_id: order.contact?.phoneNumberId ?? null,
        contacto_wa_id: order.contact?.waId ?? null,
        lineas: linesToRow(order.lines),
        total_unidades: order.totalUnits,
        total: order.total,
        unidades_sin_precio: order.unpricedUnits,
        problemas: order.issues,
        confirmacion: confirmationToRow(order.confirmation),
        created_at: order.createdAt,
      };
      const { data, error } = await supabase.rpc("dulabs_catalogo_pedido_crear", { p_pedido: pedido, p_evento: eventToRow(event) });
      if (error) {
        if (error.code === "23505" && /pedido_publico|_publico/.test(error.message ?? "")) throw new PublicIdTaken(order.orderId);
        fail("create", error);
      }
      const result = data as { creado: boolean; pedido: OrderRow };
      return { created: result.creado, order: orderFromRow(result.pedido) };
    },

    async transition(input) {
      assertTransition(input.from, input.to, input.actor);
      const { data, error } = await supabase.rpc("dulabs_catalogo_pedido_transicion", {
        p_tenant: input.businessId,
        p_pedido: input.id,
        p_desde: input.from,
        p_hacia: input.to,
        p_actor: input.actor,
        p_cambios: changesToRow(input.changes),
        p_evento: input.event ? eventToRow(input.event, input.memberId) : null,
      });
      if (error) {
        if (error.code === "22023") throw new InvalidTransition(error.message ?? "transición no permitida");
        if (error.code === "CT010") throw new StockUnavailable(parseShortages(error.details));
        if (error.code === "CT011") throw new ProductNotSellable(parseReferences(error.details));
        fail("transition", error);
      }
      return data ? orderFromRow(data as OrderRow) : null;
    },

    async getByOrderId(businessId, orderId) {
      const { data, error } = await read((cols) => supabase.from(T_PEDIDOS).select(cols).eq("id_tenant", businessId).eq("pedido_publico", orderId).maybeSingle());
      if (error) fail("getByOrderId", error);
      return data ? orderFromRow(data as unknown as OrderRow) : null;
    },

    async latestForContact(businessId, contact, statuses) {
      const { data, error } = await read((cols) =>
        supabase
          .from(T_PEDIDOS)
          .select(cols)
          .eq("id_tenant", businessId)
          .eq("contacto_phone_number_id", contact.phoneNumberId)
          .eq("contacto_wa_id", contact.waId)
          .in("estado", [...statuses])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      if (error) fail("latestForContact", error);
      return data ? orderFromRow(data as unknown as OrderRow) : null;
    },

    async listForBusiness(businessId, statuses, limit) {
      const { data, error } = await read((cols) =>
        supabase
          .from(T_PEDIDOS)
          .select(cols)
          .eq("id_tenant", businessId)
          .in("estado", [...statuses])
          .order("updated_at", { ascending: false })
          .limit(Math.min(Math.max(limit, 1), 200)),
      );
      if (error) fail("listForBusiness", error);
      return ((data ?? []) as unknown as OrderRow[]).map(orderFromRow);
    },

    async listClosed(businessId, { statuses, before, limit }) {
      const { data, error } = await read((cols) => {
        let query = supabase.from(T_PEDIDOS).select(cols).eq("id_tenant", businessId).in("estado", [...statuses]);
        // Keyset por (created_at, pedido_publico) DESC: el `lte` acota el rango del índice parcial
        // del historial; el `or` deja fuera lo ya mostrado con la misma marca. Ambos valores del
        // cursor llegan validados (fecha ISO y número público), nunca texto libre.
        if (before) query = query.lte("created_at", before.createdAt).or(`created_at.lt."${before.createdAt}",pedido_publico.lt."${before.orderId}"`);
        return query
          .order("created_at", { ascending: false })
          .order("pedido_publico", { ascending: false })
          .limit(Math.min(Math.max(limit, 1), 101));
      });
      if (error) fail("listClosed", error);
      return ((data ?? []) as unknown as OrderRow[]).map((r) => ({ order: orderFromRow(r), createdAtRaw: r.created_at }));
    },

    async reservationsFor(businessId, orderIds) {
      if (orderIds.length === 0) return [];
      const { data, error } = await supabase
        .from("dulabs_catalogo_reservas")
        .select("pedido_id, referencia, cantidad, estado, vence_at")
        .eq("id_tenant", businessId)
        .in("pedido_id", [...orderIds]);
      if (error) {
        if (isMissingSchema(error)) return [];
        fail("reservationsFor", error);
      }
      return ((data ?? []) as Array<{ pedido_id: string; referencia: string; cantidad: number; estado: ReservationSummary["status"]; vence_at: string }>).map((r) => ({
        orderId: r.pedido_id,
        reference: r.referencia,
        quantity: r.cantidad,
        status: r.estado,
        expiresAt: iso(r.vence_at),
      }));
    },

    async listStale({ statuses, updatedBefore, businessId, limit }) {
      const { data, error } = await read((cols) => {
        let query = supabase.from(T_PEDIDOS).select(cols).in("estado", [...statuses]).lt("updated_at", updatedBefore).not("contacto_wa_id", "is", null);
        if (businessId) query = query.eq("id_tenant", businessId);
        return query.order("updated_at", { ascending: true }).limit(Math.min(Math.max(limit, 1), 500));
      });
      if (error) fail("listStale", error);
      return ((data ?? []) as unknown as OrderRow[]).map(orderFromRow);
    },

    async setStage(input) {
      const { data, error } = await supabase.rpc("dulabs_catalogo_pedido_etapa", {
        p_tenant: input.businessId,
        p_pedido: input.orderId,
        p_desde: input.from,
        p_hacia: input.to,
        p_miembro: input.memberId,
        p_motivo: input.reason,
        p_evento_id: input.eventId,
      });
      if (error) {
        // 22023: etapa no permitida; 23514: "enviado" en un pedido para recoger en tienda (CHECK de la BD).
        if (error.code === "22023" || error.code === "23514") throw new InvalidTransition(error.message ?? "etapa no permitida");
        fail("setStage", error);
      }
      const r = (data ?? {}) as { resultado?: string; etapa?: OrderStage | null; estado?: OrderStatus | null; pedido?: OrderRow };
      if ((r.resultado === "ok" || r.resultado === "sin_cambio") && r.pedido) return { result: r.resultado, order: orderFromRow(r.pedido) };
      if (r.resultado === "conflicto") return { result: "conflicto", stage: r.etapa ?? null, status: r.estado ?? null };
      return { result: "no_encontrado" };
    },

    async listPanel(businessId, q) {
      if (panelSearch(q.search, q.searchPhone === true)?.kind === "none") return [];
      const { data, error } = await read((cols) => {
        let query = supabase.from(T_PEDIDOS).select(cols).eq("id_tenant", businessId).not("confirmado_at", "is", null);
        if (q.statuses?.length) query = query.in("estado", [...q.statuses]);
        if (q.stages?.length) query = query.in("etapa", [...q.stages]);
        if (q.paymentStatus) query = query.eq("estado_pago", q.paymentStatus);
        if (q.channel) query = query.eq("canal", q.channel);
        if (q.paymentMethod) query = query.eq("metodo_pago", q.paymentMethod);
        if (q.delivery) query = query.eq("tipo_entrega", q.delivery);
        if (q.from) query = query.gte("created_at", q.from);
        if (q.to) query = query.lt("created_at", q.to);
        const search = panelSearch(q.search, q.searchPhone === true);
        if (search?.kind === "order") query = query.eq("pedido_publico", search.value);
        // jsonb: el valor va como JSON (un arreglo JS lo serializaría como arreglo de Postgres). Referencia ya validada.
        else if (search?.kind === "reference") query = query.contains("lineas", JSON.stringify([{ reference: search.value }]));
        else if (search?.kind === "phone") query = query.like("contacto_wa_id", `%${search.value}%`);
        else if (search?.kind === "name") query = query.ilike("cliente_nombre", `%${search.value}%`);
        // Keyset por (updated_at, pedido_publico) DESC; ambos valores llegan validados (nunca texto libre).
        if (q.before) query = query.lte("updated_at", q.before.updatedAt).or(`updated_at.lt."${q.before.updatedAt}",pedido_publico.lt."${q.before.orderId}"`);
        return query
          .order("updated_at", { ascending: false })
          .order("pedido_publico", { ascending: false })
          .limit(Math.min(Math.max(q.limit, 1), 101));
      });
      if (error) fail("listPanel", error);
      return ((data ?? []) as unknown as OrderRow[]).map((r) => ({ order: orderFromRow(r), updatedAtRaw: r.updated_at }));
    },

    async historyFor(businessId, orderId) {
      const base = "tipo, estado_desde, estado_hacia, actor, motivo, created_at";
      const run = (cols: string) =>
        supabase.from("dulabs_catalogo_pedido_eventos").select(cols).eq("id_tenant", businessId).eq("pedido_id", orderId).order("id", { ascending: true }).limit(500);
      let { data, error } = await run(`${base}, miembro_id`);
      if (error && (error.code === "42703" || error.code === "PGRST204")) ({ data, error } = await run(base));
      if (error) {
        if (isMissingSchema(error)) return [];
        fail("historyFor", error);
      }
      return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
        type: r.tipo as OrderHistoryEntry["type"],
        from: (r.estado_desde as string | null) ?? null,
        to: (r.estado_hacia as string | null) ?? null,
        actor: (r.actor as OrderActor | null) ?? null,
        memberId: typeof r.miembro_id === "number" ? r.miembro_id : r.miembro_id != null ? Number(r.miembro_id) : null,
        reason: (r.motivo as string | null) ?? null,
        at: iso(String(r.created_at)),
      }));
    },


    async expireReservations(limit) {
      const { data, error } = await supabase.rpc("dulabs_catalogo_reservas_vencer", { p_limite: limit });
      if (error) {
        if (isMissingSchema(error)) return 0;
        fail("expireReservations", error);
      }
      return Number(data ?? 0);
    },
  };
}

/** detail de CT010: [{referencia, pedido, disponible}] (texto JSON de la BD). */
function parseShortages(details: unknown): StockUnavailable["shortages"] {
  try {
    const list = JSON.parse(String(details ?? "[]")) as Array<{ referencia?: unknown; pedido?: unknown; disponible?: unknown }>;
    return list.map((x) => ({ reference: String(x.referencia ?? ""), requested: Number(x.pedido ?? 0), available: Math.max(0, Number(x.disponible ?? 0)) }));
  } catch {
    return [];
  }
}

function parseReferences(details: unknown): string[] {
  try {
    return (JSON.parse(String(details ?? "[]")) as unknown[]).map(String);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Memoria (pruebas): MISMA semántica que las funciones SQL
// ---------------------------------------------------------------------------

/**
 * Inventario de pruebas (lo implementa el catálogo en memoria): la MISMA regla de reserva que
 * el trigger de la BD se emula sobre él. Sin inventario, el repositorio no reserva (pruebas viejas).
 */
export interface MemoryInventory {
  product(tenantId: string, reference: string): { id: string; active: boolean; tracked: boolean; stock: number } | null;
  setStock(productId: string, stock: number): void;
  stockOf(productId: string): number | null;
}

type MemoryReservation = ReservationSummary & { businessId: string; productId: string };

export function createMemoryOrdersRepository(opts: { available?: boolean; inventory?: MemoryInventory; now?: () => number } = {}) {
  const orders: Order[] = [];
  const events: OrderEvent[] = [];
  const reservations: MemoryReservation[] = [];
  const history: Array<{ businessId: string; orderId: string; entry: OrderHistoryEntry }> = [];
  let seq = 0;
  const clone = <T>(v: T): T => structuredClone(v);
  const clock = opts.now ?? Date.now;

  /** Ajusta las reservas activas a las líneas: primero VALIDA todo, después aplica (todo o nada). */
  function reconcile(order: Order) {
    const inv = opts.inventory;
    if (!inv) return;
    const want = new Map<string, number>();
    for (const l of order.lines) if (l.quantity > 0) want.set(l.reference.toUpperCase(), (want.get(l.reference.toUpperCase()) ?? 0) + l.quantity);
    const active = reservations.filter((r) => r.orderId === order.id && r.status === "activa");
    const refs = [...new Set([...want.keys(), ...active.map((r) => r.reference)])].sort();
    const plan: Array<() => void> = [];
    const shortages: StockUnavailable["shortages"] = [];
    const notSellable: string[] = [];
    for (const ref of refs) {
      const q = want.get(ref) ?? 0;
      const current = active.find((r) => r.reference === ref);
      const have = current?.quantity ?? 0;
      if (q === have) continue;
      if (q < have && current) {
        plan.push(() => {
          const s = inv.stockOf(current.productId);
          if (s !== null) inv.setStock(current.productId, s + (have - q));
          if (q === 0) current.status = "liberada";
          else current.quantity = q;
        });
        continue;
      }
      const p = inv.product(order.businessId, ref);
      if (!p || !p.active) {
        notSellable.push(ref);
        continue;
      }
      if (!p.tracked) continue;
      const delta = q - have;
      if (p.stock < delta) {
        shortages.push({ reference: ref, requested: q, available: p.stock + have });
        continue;
      }
      plan.push(() => {
        inv.setStock(p.id, (inv.stockOf(p.id) ?? 0) - delta);
        if (current) current.quantity = q;
        else
          reservations.push({ businessId: order.businessId, orderId: order.id, productId: p.id, reference: ref, quantity: q, status: "activa", expiresAt: new Date(clock() + RESERVATION_TTL_MS).toISOString() });
      });
    }
    if (notSellable.length > 0) throw new ProductNotSellable(notSellable);
    if (shortages.length > 0) throw new StockUnavailable(shortages);
    for (const step of plan) step();
  }

  function close(orderId: string, status: "liberada" | "consumida") {
    for (const r of reservations.filter((x) => x.orderId === orderId && x.status === "activa")) {
      if (status === "liberada" && opts.inventory) {
        const s = opts.inventory.stockOf(r.productId);
        if (s !== null) opts.inventory.setStock(r.productId, s + r.quantity);
      }
      r.status = status;
    }
  }

  /** Misma regla que el trigger dulabs_catalogo_pedidos_checkout_reglas (Bloque 27). */
  function applyCheckoutRules(before: Order, after: Order) {
    if (!before.checkout) return;
    const frozen = (o: Order) =>
      JSON.stringify([o.lines, o.total, o.channel, o.contact?.waId ?? null, o.confirmedAt, o.checkout?.customerName, o.checkout?.paymentMethod, o.checkout?.delivery, o.checkout?.address, o.checkout?.city, o.checkout?.deliveryReference]);
    if (!after.checkout || frozen(before) !== frozen(after)) throw new InvalidTransition(`el pedido ${before.orderId} ya está confirmado: sus productos y datos no se editan`);
    if (after.checkout.stage !== before.checkout.stage || after.checkout.paymentStatus !== before.checkout.paymentStatus)
      throw new InvalidTransition("la etapa y el pago solo cambian con setStage");
    if (after.status === "completed" && before.status !== "completed" && !canCompleteStage(before.checkout.stage, before.checkout.delivery))
      throw new InvalidTransition(`el pedido ${before.orderId} aún no se puede completar (etapa ${before.checkout.stage})`);
  }

  function record(order: Order, entry: Omit<OrderHistoryEntry, "at">) {
    history.push({ businessId: order.businessId, orderId: order.id, entry: { ...entry, at: new Date(clock()).toISOString() } });
  }

  /** Misma regla que el trigger dulabs_catalogo_pedido_reservas_trigger. */
  function applyReservationRule(before: Order, after: Order) {
    const linesChanged = JSON.stringify(before.lines) !== JSON.stringify(after.lines);
    if (before.status === after.status && !linesChanged) return;
    if (after.status === "confirmed") reconcile(after);
    else if (after.status === "handoff") {
      if (linesChanged && reservations.some((r) => r.orderId === after.id && r.status === "activa")) reconcile(after);
    } else if (after.status === "completed") close(after.id, "consumida");
    else close(after.id, "liberada");
  }

  const repo: OrdersRepository & { orders: Order[]; events: OrderEvent[]; reservations: MemoryReservation[]; history: typeof history; isAvailable: boolean } = {
    orders,
    events,
    reservations,
    history,
    isAvailable: opts.available ?? true,

    async available() {
      return repo.isAvailable;
    },

    async create(order, event) {
      const existing = orders.find((o) => o.businessId === order.businessId && o.idempotencyKey === order.idempotencyKey);
      if (existing) return { created: false, order: clone(existing) };
      if (orders.some((o) => o.businessId === order.businessId && o.orderId === order.orderId)) throw new PublicIdTaken(order.orderId);
      if (!["draft", "validated", "cancelled", "expired"].includes(order.status) && !order.contact) throw new Error("check_violation: contacto requerido");
      const row: Order = { ...clone(order), id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, handoff: null, checkout: null, confirmedAt: null, updatedAt: order.createdAt };
      orders.push(row);
      if (!events.some((e) => e.event_id === event.event_id)) {
        events.push(clone(event));
        record(row, { type: event.event_type, from: null, to: row.status, actor: null, memberId: null, reason: null });
      }
      return { created: true, order: clone(row) };
    },

    async transition(input) {
      assertTransition(input.from, input.to, input.actor);
      const i = orders.findIndex((o) => o.id === input.id && o.businessId === input.businessId && o.status === input.from);
      if (i < 0) return null;
      const current = orders[i];
      if (input.changes.contact && current.contact && !sameContact(current.contact, input.changes.contact)) return null;
      const next = applyChanges(current, input.to, clone(input.changes), new Date(clock()).toISOString());
      if (!["draft", "validated", "cancelled", "expired"].includes(next.status) && !next.contact) throw new Error("check_violation: contacto requerido");
      if (next.checkout && !["draft", "validated", "pending_confirmation"].includes(next.status)) {
        const c = next.checkout;
        if (!next.confirmedAt || !next.contact || (c.delivery === "domicilio" && (!c.address || !c.city))) throw new Error("check_violation: checkout incompleto");
      }
      applyCheckoutRules(current, next);
      applyReservationRule(current, next); // lanza (sin escribir nada) si no alcanza el stock
      orders[i] = next;
      if (input.event && !events.some((e) => e.event_id === input.event?.event_id)) {
        events.push(clone(input.event));
        record(next, { type: input.event.event_type, from: input.from, to: input.to, actor: input.actor, memberId: input.memberId ?? null, reason: input.event.transition?.reason ?? null });
      }
      return clone(next);
    },

    async getByOrderId(businessId, orderId) {
      const o = orders.find((x) => x.businessId === businessId && x.orderId === orderId);
      return o ? clone(o) : null;
    },

    async latestForContact(businessId, contact, statuses) {
      const found = orders
        .filter((o) => o.businessId === businessId && sameContact(o.contact, contact) && statuses.includes(o.status))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0];
      return found ? clone(found) : null;
    },

    async listForBusiness(businessId, statuses, limit) {
      return orders
        .filter((o) => o.businessId === businessId && statuses.includes(o.status))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, limit)
        .map(clone);
    },

    async listClosed(businessId, { statuses, before, limit }) {
      return orders
        .filter((o) => o.businessId === businessId && statuses.includes(o.status))
        .filter((o) => !before || o.createdAt < before.createdAt || (o.createdAt === before.createdAt && o.orderId < before.orderId))
        .sort((a, b) => (a.createdAt === b.createdAt ? (a.orderId < b.orderId ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, limit)
        .map((o) => ({ order: clone(o), createdAtRaw: o.createdAt }));
    },

    async reservationsFor(businessId, orderIds) {
      return reservations
        .filter((r) => r.businessId === businessId && orderIds.includes(r.orderId))
        .map(({ orderId, reference, quantity, status, expiresAt }) => ({ orderId, reference, quantity, status, expiresAt }));
    },

    async listStale({ statuses, updatedBefore, businessId, limit }) {
      return orders
        .filter((o) => o.contact !== null && statuses.includes(o.status) && o.updatedAt < updatedBefore && (!businessId || o.businessId === businessId))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))
        .slice(0, limit)
        .map(clone);
    },

    async expireReservations(limit) {
      let n = 0;
      for (const o of orders) {
        if (n >= limit) break;
        if (o.status !== "confirmed") continue;
        if (o.checkout?.paymentStatus === "recibido") continue;
        if (!reservations.some((r) => r.orderId === o.id && r.status === "activa" && Date.parse(r.expiresAt) <= clock())) continue;
        const next = applyChanges(o, "expired", { confirmation: null }, new Date(clock()).toISOString());
        applyReservationRule(o, next);
        orders[orders.indexOf(o)] = next;
        record(next, { type: "order.status_changed", from: "confirmed", to: "expired", actor: "system", memberId: null, reason: "reservation_expired" });
        n++;
      }
      return n;
    },

    async setStage(input) {
      const ok = (input.from === "pendiente_pago" && input.to === "pago_recibido") || (input.from === "pago_recibido" && input.to === "en_preparacion") || (input.from === "en_preparacion" && input.to === "enviado");
      if (!ok) throw new InvalidTransition(`etapa no permitida: ${input.from} -> ${input.to}`);
      if (!input.memberId) throw new Error("solo una persona del equipo cambia la etapa");
      const i = orders.findIndex((o) => o.businessId === input.businessId && o.orderId === input.orderId);
      if (i < 0) return { result: "no_encontrado" };
      const o = orders[i];
      if (!o.checkout) throw new InvalidTransition(`el pedido ${o.orderId} no tiene etapas`);
      if (o.checkout.stage === input.to) return { result: "sin_cambio", order: clone(o) };
      if (o.checkout.stage !== input.from || !["confirmed", "handoff"].includes(o.status)) return { result: "conflicto", stage: o.checkout.stage, status: o.status };
      if (input.to === "enviado" && o.checkout.delivery !== "domicilio") throw new InvalidTransition("enviado solo aplica a domicilio");
      const next: Order = {
        ...o,
        checkout: { ...o.checkout, stage: input.to, paymentStatus: input.to === "pago_recibido" ? "recibido" : o.checkout.paymentStatus },
        updatedAt: new Date(clock()).toISOString(),
      };
      orders[i] = next;
      record(next, { type: "order.stage_changed", from: input.from, to: input.to, actor: "human", memberId: input.memberId, reason: input.reason?.slice(0, 500) ?? null });
      return { result: "ok", order: clone(next) };
    },

    async listPanel(businessId, q) {
      const search = panelSearch(q.search, q.searchPhone === true);
      return orders
        .filter((o) => o.businessId === businessId && o.confirmedAt !== null)
        .filter((o) => !q.statuses?.length || q.statuses.includes(o.status))
        .filter((o) => !q.stages?.length || (o.checkout !== null && q.stages.includes(o.checkout.stage)))
        .filter((o) => !q.paymentStatus || o.checkout?.paymentStatus === q.paymentStatus)
        .filter((o) => !q.channel || o.channel === q.channel)
        .filter((o) => !q.paymentMethod || o.checkout?.paymentMethod === q.paymentMethod)
        .filter((o) => !q.delivery || o.checkout?.delivery === q.delivery)
        .filter((o) => !q.from || o.createdAt >= q.from)
        .filter((o) => !q.to || o.createdAt < q.to)
        .filter((o) => {
          if (!search) return true;
          if (search.kind === "order") return o.orderId === search.value;
          if (search.kind === "reference") return o.lines.some((l) => l.reference === search.value);
          if (search.kind === "phone") return (o.contact?.waId ?? "").includes(search.value);
          if (search.kind === "none") return false;
          return (o.checkout?.customerName ?? "").toLowerCase().includes(search.value.toLowerCase());
        })
        .filter((o) => !q.before || o.updatedAt < q.before.updatedAt || (o.updatedAt === q.before.updatedAt && o.orderId < q.before.orderId))
        .sort((a, b) => (a.updatedAt === b.updatedAt ? (a.orderId < b.orderId ? 1 : -1) : a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, q.limit)
        .map((o) => ({ order: clone(o), updatedAtRaw: o.updatedAt }));
    },

    async historyFor(businessId, orderId) {
      return history.filter((h) => h.businessId === businessId && h.orderId === orderId).map((h) => clone(h.entry));
    },
  };
  return repo;
}
