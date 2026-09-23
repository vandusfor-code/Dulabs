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
  canTransition,
  type Order,
  type OrderActor,
  type OrderChannel,
  type OrderConfirmation,
  type OrderHandoff,
  type OrderIssue,
  type OrderLine,
  type OrderSource,
  type OrderStatus,
} from "@/lib/catalogo/pedidos/contrato";
import type { OrderEvent } from "@/lib/catalogo/pedidos/eventos";

export type OrderContact = { phoneNumberId: string; waId: string };

export type NewOrder = Omit<Order, "id" | "handoff" | "updatedAt">;

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
}

export interface TransitionInput {
  businessId: string;
  id: string;
  from: OrderStatus;
  to: OrderStatus;
  actor: OrderActor;
  changes: OrderChanges;
  event: OrderEvent | null;
}

/** El id público derivado ya lo usa OTRO pedido del negocio (colisión de 30 bits): se re-deriva. */
export class PublicIdTaken extends Error {}
/** Transición no permitida por la máquina de estados (código o BD). */
export class InvalidTransition extends Error {}

export interface OrdersRepository {
  /** false si la migración no está aplicada. */
  available(): Promise<boolean>;
  create(order: NewOrder, event: OrderEvent): Promise<{ created: boolean; order: Order }>;
  /** null = el estado ya no era `from`, el pedido no es de este negocio o el contacto no coincide (nada se escribió). */
  transition(input: TransitionInput): Promise<Order | null>;
  getByOrderId(businessId: string, orderId: string): Promise<Order | null>;
  /** Pedido más reciente de la conversación en alguno de esos estados. */
  latestForContact(businessId: string, contact: OrderContact, statuses: readonly OrderStatus[]): Promise<Order | null>;
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
const COLUMNS =
  "id, id_tenant, pedido_publico, canal, origen, estado, clave_idempotencia, huella_solicitud, contacto_phone_number_id, contacto_wa_id, lineas, total_unidades, total, unidades_sin_precio, moneda, problemas, confirmacion, handoff, created_at, updated_at";

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
  return out;
}

const eventToRow = (e: OrderEvent) => ({ event_id: e.event_id, tipo: e.event_type, motivo: e.transition?.reason ?? null, payload: e });

/** Tabla/función inexistente (migración sin aplicar): Postgres y PostgREST. */
function isMissingSchema(error: PgError): boolean {
  return ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "");
}

function fail(context: string, error: PgError): never {
  throw new Error(`[catalogo/pedidos] ${context}: ${error.code ?? "?"} ${error.message ?? ""}`.trim());
}

const PROBE_TTL_MS = 60_000;

export function createSupabaseOrdersRepository(supabase: SupabaseClient, now: () => number = Date.now): OrdersRepository {
  let probe: { value: boolean; at: number } | null = null;

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
        p_evento: input.event ? eventToRow(input.event) : null,
      });
      if (error) {
        if (error.code === "22023") throw new InvalidTransition(error.message ?? "transición no permitida");
        fail("transition", error);
      }
      return data ? orderFromRow(data as OrderRow) : null;
    },

    async getByOrderId(businessId, orderId) {
      const { data, error } = await supabase.from(T_PEDIDOS).select(COLUMNS).eq("id_tenant", businessId).eq("pedido_publico", orderId).maybeSingle();
      if (error) fail("getByOrderId", error);
      return data ? orderFromRow(data as unknown as OrderRow) : null;
    },

    async latestForContact(businessId, contact, statuses) {
      const { data, error } = await supabase
        .from(T_PEDIDOS)
        .select(COLUMNS)
        .eq("id_tenant", businessId)
        .eq("contacto_phone_number_id", contact.phoneNumberId)
        .eq("contacto_wa_id", contact.waId)
        .in("estado", [...statuses])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail("latestForContact", error);
      return data ? orderFromRow(data as unknown as OrderRow) : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Memoria (pruebas): MISMA semántica que las funciones SQL
// ---------------------------------------------------------------------------

export function createMemoryOrdersRepository(opts: { available?: boolean } = {}) {
  const orders: Order[] = [];
  const events: OrderEvent[] = [];
  let seq = 0;
  const clone = <T>(v: T): T => structuredClone(v);

  const repo: OrdersRepository & { orders: Order[]; events: OrderEvent[]; isAvailable: boolean } = {
    orders,
    events,
    isAvailable: opts.available ?? true,

    async available() {
      return repo.isAvailable;
    },

    async create(order, event) {
      const existing = orders.find((o) => o.businessId === order.businessId && o.idempotencyKey === order.idempotencyKey);
      if (existing) return { created: false, order: clone(existing) };
      if (orders.some((o) => o.businessId === order.businessId && o.orderId === order.orderId)) throw new PublicIdTaken(order.orderId);
      if (!["draft", "validated", "cancelled", "expired"].includes(order.status) && !order.contact) throw new Error("check_violation: contacto requerido");
      const row: Order = { ...clone(order), id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, handoff: null, updatedAt: order.createdAt };
      orders.push(row);
      if (!events.some((e) => e.event_id === event.event_id)) events.push(clone(event));
      return { created: true, order: clone(row) };
    },

    async transition(input) {
      assertTransition(input.from, input.to, input.actor);
      const i = orders.findIndex((o) => o.id === input.id && o.businessId === input.businessId && o.status === input.from);
      if (i < 0) return null;
      const current = orders[i];
      if (input.changes.contact && current.contact && !sameContact(current.contact, input.changes.contact)) return null;
      const next = applyChanges(current, input.to, clone(input.changes), new Date().toISOString());
      if (!["draft", "validated", "cancelled", "expired"].includes(next.status) && !next.contact) throw new Error("check_violation: contacto requerido");
      orders[i] = next;
      if (input.event && !events.some((e) => e.event_id === input.event?.event_id)) events.push(clone(input.event));
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
  };
  return repo;
}
