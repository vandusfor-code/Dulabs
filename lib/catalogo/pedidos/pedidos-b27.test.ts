/**
 * Bloque 27 — OPERACIÓN del pedido real y módulo "Pedidos" del dashboard, con DOS EJES:
 *
 *   pedido  CONFIRMADO -> EN PREPARACIÓN -> ENVIADO (solo domicilio) -> ENTREGADO -> COMPLETADO
 *           CANCELADO / RECHAZADO solo antes de salir · VENCIDO solo si nadie lo tocó (72 h)
 *   pago    PENDIENTE -> RECIBIDO (independiente de la etapa). Completar = entregado + pagado.
 *
 * La atención (asesora, IA pausada) es de la conversación y nunca cambia el estado del pedido.
 * Motor, catálogo y pedidos en memoria (misma semántica que la BD; la BD tiene su propia prueba SQL
 * y la matriz E2E corre todo contra PostgreSQL real). Nada toca Supabase. Datos ficticios.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine, OrderError, type CheckoutData, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { InvalidTransition, createMemoryOrdersRepository, panelSearch } from "@/lib/catalogo/pedidos/repositorio";
import { accionGestion, accionesPermitidas, detalleGestion, estadoVisible, listarGestion, type HistorialEntrada, type PedidoGestion } from "@/lib/catalogo/pedidos/gestion";
import { cerrarPedido, type PanelFuentes } from "@/lib/catalogo/pedidos/panel";
import { ORDERS_MODULE, decideCatalogAccess, requireCatalogo, type CatalogAuthDeps } from "@/lib/catalogo/auth";
import { navItemVisible, navSections } from "@/components/dashboard/shell/nav";
import { MODULOS } from "@/lib/tenant-modulos";
import type { Miembro, Rol } from "@/lib/team";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const PN_A = "100000000000001";
const ANA = { phoneNumberId: PN_A, waId: "573001110001" };
const LUIS = { phoneNumberId: PN_A, waId: "573001110002" };
const ASESORA = 41;

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let orders: ReturnType<typeof createMemoryOrdersRepository>;
let engine: OrderEngine;
let clock: number;
let seq: number;

beforeEach(() => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  clock = Date.parse("2026-09-24T12:00:00Z");
  orders = createMemoryOrdersRepository({ inventory: mem.inventory, now: () => clock });
  engine = createOrderEngine({
    orders,
    catalog: mem.repo,
    key: Buffer.alloc(32, 5),
    log: () => {},
    now: () => new Date(clock),
    handoff: { pauseConversation: async () => ({ ok: true }) },
  });
  for (const actor of [A, B]) mem.enableModule(actor.tenantId);
  seq = 0;
});

const fuentes = (): PanelFuentes => ({
  nombres: async () => new Map([[`${PN_A}|${ANA.waId}`, "Ana (contacto)"]]),
  canales: async () => new Map(),
  confirmados: async () => new Map(),
  asignadas: async () => new Map([[`${PN_A}|${ANA.waId}`, "Carolina"]]),
  fotos: async (_t, refs) => new Map(refs.map((r) => [r, `https://img.test/${r}.webp`])),
  miembros: async (_t, ids) => new Map(ids.map((id) => [id, id === ASESORA ? "Carolina" : `Persona ${id}`])),
  atencion: async (_t, cs) => new Map(cs.map((c) => [`${c.phoneNumberId}|${c.waId}`, { pausadaHasta: "2026-10-24T12:00:00.000Z", conversacion: "pending" as const }])),
});
const extras = (verTelefono = true) => ({ fuentes: fuentes(), verTelefono });

const CHECKOUT = {
  tienda: { customerName: "Ana Pérez", paymentMethod: "transferencia", delivery: "tienda", address: null, city: null, deliveryReference: null },
  domicilio: { customerName: "Luis Gómez", paymentMethod: "pago_en_tienda", delivery: "domicilio", address: "Calle 1 # 2-3", city: "Montería", deliveryReference: "Portón azul" },
} satisfies Record<string, CheckoutData>;

/** Pedido confirmado por el checkout (lo mismo que hace la conversación). */
async function confirmado(opts: { contact?: typeof ANA; entrega?: "tienda" | "domicilio"; qty?: number; stock?: number; checkout?: boolean; channel?: "retail" | "wholesale" } = {}) {
  const p = await admin.createProduct(A, { name: `Anillo ${++seq}`, retailPrice: 50_000, wholesalePrice: 30_000, stock: opts.stock ?? 5 });
  const contact = opts.contact ?? ANA;
  const { order } = await engine.createOrder({ tenantId: A.tenantId, channel: opts.channel ?? "retail", source: "agent", contact, items: [{ reference: p.reference, quantity: opts.qty ?? 2 }], idempotencyKey: `agent:b27-${seq}` });
  const o = await engine.confirmOrder({
    tenantId: A.tenantId,
    contact,
    orderId: order.orderId,
    confirmationId: order.confirmation!.id,
    actor: "agent",
    ...(opts.checkout === false ? {} : { checkout: CHECKOUT[opts.entrega ?? "tienda"] }),
  });
  return { order: o, product: p };
}

async function json<T>(res: Response): Promise<{ status: number; body: { success: boolean; data: T; error?: { code: string; message: string } } }> {
  return { status: res.status, body: await res.json() };
}
type Esperado = { estado: string; etapa: string | null; pago: string | null };
/** Lo que la persona VE en el panel ahora (como tras recargar). */
async function visto(pedido: string): Promise<Esperado> {
  const o = (await orders.getByOrderId(A.tenantId, pedido))!;
  return { estado: o.status, etapa: o.checkout?.stage ?? null, pago: o.checkout?.paymentStatus ?? null };
}
async function actuarCon(pedido: string, a: string, esperado: Esperado, motivo?: string, tenant = A.tenantId) {
  return json<{ pedido: PedidoGestion; repetido: boolean }>(await accionGestion(engine, tenant, pedido, { accion: a, esperado, ...(motivo ? { motivo } : {}) }, ASESORA));
}
/** Acción sobre lo que se ve ahora (el caso normal del panel). */
const actuar = async (pedido: string, a: string, motivo?: string) => actuarCon(pedido, a, await visto(pedido), motivo);
async function detalle(pedido: string, tenant = A.tenantId, ver = true) {
  return json<{ pedido: PedidoGestion; historial: HistorialEntrada[] }>(await detalleGestion(engine, tenant, pedido, extras(ver)));
}
async function lista(qs: Record<string, string> = {}, ver = true, tenant = A.tenantId) {
  return json<{ pedidos: PedidoGestion[]; siguiente: string | null }>(await listarGestion(engine, tenant, new URLSearchParams(qs), extras(ver)));
}
const stockDe = (id: string) => mem.inventory.stockOf(id);

// ---------------------------------------------------------------------------

describe("B27 · dos ejes: estado del pedido y estado del pago", () => {
  it("al confirmar: CONFIRMADO con pago PENDIENTE (confirmado no es pagado); reserva apartada", async () => {
    const { order, product } = await confirmado({ entrega: "domicilio" });
    assert.equal(order.status, "confirmed");
    assert.equal(order.checkout?.stage, "confirmado");
    assert.equal(order.checkout?.paymentStatus, "pendiente");
    assert.equal(estadoVisible(order), "confirmado");
    assert.deepEqual(accionesPermitidas(order), ["pago_recibido", "en_preparacion", "cancelar", "rechazar"]);
    assert.equal(stockDe(product.id), 3);
  });

  it("domicilio + transferencia: preparación -> enviado -> entregado; el pago se registra aparte; completar = entregado + pagado; cada paso con la persona", async () => {
    const { order, product } = await confirmado({ entrega: "domicilio" });
    const id = order.orderId;
    assert.equal((await actuar(id, "completar")).status, 409, "no se completa sin entregar ni pagar");
    assert.equal((await actuar(id, "en_preparacion")).body.data.pedido.estado_visible, "en_preparacion");
    assert.equal((await actuar(id, "enviado")).body.data.pedido.estado_visible, "enviado");
    assert.equal((await actuar(id, "entregado")).body.data.pedido.estado_visible, "entregado");
    const sinPago = await actuar(id, "completar");
    assert.equal(sinPago.status, 409, "entregado sin pago no se completa");
    assert.match(sinPago.body.error!.message, /pago/);
    const pago = await actuar(id, "pago_recibido", "Transferencia verificada");
    assert.deepEqual([pago.body.data.pedido.estado_visible, pago.body.data.pedido.estado_pago], ["entregado", "recibido"], "el pago no mueve la etapa");
    assert.equal((await actuar(id, "completar")).body.data.pedido.estado_visible, "completado");
    assert.equal(stockDe(product.id), 3, "completar consume la reserva (el stock no vuelve)");
    assert.deepEqual(orders.reservations.map((x) => x.status), ["consumida"]);
    const pasos = (await detalle(id)).body.data.historial.map((h) => `${h.tipo}:${h.desde ?? "∅"}>${h.hacia}:${h.miembro ?? h.actor}${h.motivo && h.tipo === "order.payment_changed" ? `:${h.motivo}` : ""}`);
    assert.deepEqual(pasos, [
      "order.created:∅>pending_confirmation:null",
      "order.status_changed:pending_confirmation>confirmed:agent",
      "order.stage_changed:confirmado>en_preparacion:Carolina",
      "order.stage_changed:en_preparacion>enviado:Carolina",
      "order.stage_changed:enviado>entregado:Carolina",
      "order.payment_changed:pendiente>recibido:Carolina:Transferencia verificada",
      "order.status_changed:confirmed>completed:Carolina",
    ]);
  });

  it("recoger + pago en tienda: se prepara SIN pago, se entrega (sin 'enviado'), el cliente paga al recoger y se completa", async () => {
    const { order } = await confirmado({ entrega: "tienda" });
    const id = order.orderId;
    await actuar(id, "en_preparacion");
    const t = await actuar(id, "enviado");
    assert.equal(t.status, 409);
    assert.match(t.body.error!.message, /domicilio/);
    const actual = (await orders.getByOrderId(A.tenantId, id))!;
    assert.deepEqual(accionesPermitidas(actual), ["pago_recibido", "entregado", "cancelar", "rechazar"], "el panel ni ofrece 'enviado'");
    await assert.rejects(engine.advanceStage({ tenantId: A.tenantId, orderId: id, from: "en_preparacion", to: "enviado", memberId: ASESORA }), (e: unknown) => e instanceof OrderError);
    await assert.rejects(orders.setStage({ businessId: A.tenantId, orderId: id, from: "en_preparacion", to: "enviado", memberId: ASESORA, reason: null, eventId: "evt_t" }), InvalidTransition);
    assert.equal((await actuar(id, "entregado")).body.data.pedido.estado_visible, "entregado");
    await actuar(id, "pago_recibido");
    assert.equal((await actuar(id, "completar")).body.data.pedido.estado_visible, "completado");
  });

  it("domicilio no se marca entregado sin enviarlo; no se salta ni se retrocede (panel, motor y repositorio)", async () => {
    const { order } = await confirmado({ entrega: "domicilio" });
    const id = order.orderId;
    await actuar(id, "en_preparacion");
    assert.equal((await actuar(id, "entregado")).status, 409);
    await assert.rejects(engine.advanceStage({ tenantId: A.tenantId, orderId: id, from: "en_preparacion", to: "entregado", memberId: ASESORA }), (e: unknown) => e instanceof OrderError && e.code === "INVALID_TRANSITION");
    await assert.rejects(orders.setStage({ businessId: A.tenantId, orderId: id, from: "en_preparacion", to: "entregado", memberId: ASESORA, reason: null, eventId: "evt_z" }), InvalidTransition);
    await assert.rejects(orders.setStage({ businessId: A.tenantId, orderId: id, from: "en_preparacion", to: "confirmado", memberId: ASESORA, reason: null, eventId: "evt_r" }), InvalidTransition);
    await assert.rejects(engine.closeOrder({ tenantId: A.tenantId, orderId: id, action: "complete" }), (e: unknown) => e instanceof OrderError && e.code === "INVALID_TRANSITION");
    assert.equal((await orders.getByOrderId(A.tenantId, id))!.checkout!.stage, "en_preparacion");
  });
});

describe("B27 · cancelar / rechazar", () => {
  it("cancelar exige motivo, libera la reserva UNA vez, queda quién y por qué; doble cancelación no devuelve stock dos veces", async () => {
    const { order, product } = await confirmado({ entrega: "tienda" });
    const id = order.orderId;
    assert.equal((await actuar(id, "cancelar")).status, 400, "sin motivo");
    const v = await actuar(id, "cancelar", "El cliente desistió");
    assert.equal(v.body.data.pedido.estado_visible, "cancelado");
    assert.equal(stockDe(product.id), 5);
    const otra = await actuar(id, "cancelar", "de nuevo");
    assert.deepEqual([otra.status, otra.body.data.repetido], [200, true]);
    assert.equal(stockDe(product.id), 5, "el stock no vuelve dos veces");
    assert.deepEqual(orders.reservations.map((r) => r.status), ["liberada"]);
    const h = (await detalle(id)).body.data.historial.at(-1)!;
    assert.deepEqual([h.desde, h.hacia, h.miembro, h.motivo], ["confirmed", "cancelled", "Carolina", "El cliente desistió"]);
    assert.equal((await actuar(id, "pago_recibido")).status, 409, "terminal");
  });

  it("rechazar (la empresa) exige motivo, libera la reserva y es terminal", async () => {
    const { order, product } = await confirmado({ entrega: "domicilio" });
    await actuar(order.orderId, "en_preparacion");
    assert.equal((await actuar(order.orderId, "rechazar", "  ")).status, 400);
    const w = await actuar(order.orderId, "rechazar", "Sin cobertura en la zona");
    assert.equal(w.body.data.pedido.estado_visible, "rechazado");
    assert.equal(stockDe(product.id), 5);
    for (const a of ["completar", "cancelar", "enviado", "pago_recibido"]) assert.equal((await actuar(order.orderId, a, "x motivo")).status, 409, a);
  });

  it("un pedido ENVIADO, ENTREGADO o COMPLETADO no se cancela ni se rechaza (panel, motor, repositorio); uno inexistente => 404", async () => {
    const { order, product } = await confirmado({ entrega: "domicilio" });
    const id = order.orderId;
    await actuar(id, "en_preparacion");
    await actuar(id, "enviado");
    for (const a of ["cancelar", "rechazar"]) {
      const r = await actuar(id, a, "ya salió");
      assert.equal(r.status, 409, a);
      assert.match(r.body.error!.message, /salió/);
    }
    await assert.rejects(engine.closeOrder({ tenantId: A.tenantId, orderId: id, action: "cancel", reason: "x" }), (e: unknown) => e instanceof OrderError && e.code === "INVALID_TRANSITION");
    const o = (await orders.getByOrderId(A.tenantId, id))!;
    await assert.rejects(orders.transition({ businessId: A.tenantId, id: o.id, from: "confirmed", to: "cancelled", actor: "human", changes: { confirmation: null }, event: null }), InvalidTransition);
    assert.equal(stockDe(product.id), 3, "la reserva sigue");
    await actuar(id, "entregado");
    await actuar(id, "pago_recibido");
    await actuar(id, "completar");
    assert.equal((await actuar(id, "cancelar", "tarde")).status, 409, "completado");
    assert.equal(stockDe(product.id), 3);
    assert.equal((await actuarCon("DL-ORD-AAAAAA", "cancelar", { estado: "confirmed", etapa: "confirmado", pago: "pendiente" }, "no existe")).status, 404);
  });
});

describe("B27 · vencimiento de 72 h (solo lo que nadie tocó)", () => {
  it("confirmado + pago pendiente: a las 72 h vence y el stock vuelve una vez", async () => {
    const { order, product } = await confirmado();
    clock += 73 * 3_600_000;
    assert.equal(await engine.expireReservations(), 1);
    assert.equal(await engine.expireReservations(), 0, "vencer de nuevo no hace nada");
    assert.equal((await orders.getByOrderId(A.tenantId, order.orderId))!.status, "expired");
    assert.equal(stockDe(product.id), 5);
  });

  it("con el pago recibido, o ya en preparación (aunque el pago siga pendiente), NO vence", async () => {
    const pagado = await confirmado();
    await actuar(pagado.order.orderId, "pago_recibido");
    const preparando = await confirmado();
    await actuar(preparando.order.orderId, "en_preparacion");
    clock += 200 * 3_600_000;
    assert.equal(await engine.expireReservations(), 0);
    await lista();
    for (const x of [pagado, preparando]) {
      assert.equal((await orders.getByOrderId(A.tenantId, x.order.orderId))!.status, "confirmed");
      assert.equal(stockDe(x.product.id), 3);
    }
    // El panel muestra cuándo vence solo lo que puede vencer.
    const fresco = await confirmado();
    const d = (await detalle(fresco.order.orderId)).body.data.pedido;
    assert.ok(d.vence_reserva);
    assert.equal((await detalle(pagado.order.orderId)).body.data.pedido.vence_reserva, null);
  });
});

describe("B27 · la atención es de la conversación, no del pedido", () => {
  it("un traspaso (del modelo o del sistema) con el pedido NO cambia su estado: su reserva y su vencimiento siguen su ciclo", async () => {
    const { order } = await confirmado();
    const r = await engine.requestHandoff({ tenantId: A.tenantId, contact: ANA, reason: "El cliente pregunta por el envío", orderId: order.orderId, actor: "agent" });
    assert.equal(r.paused, true, "la conversación pasa a la asesora");
    const o = (await orders.getByOrderId(A.tenantId, order.orderId))!;
    assert.equal(o.status, "confirmed", "el pedido NO pasa a 'handoff'");
    await assert.rejects(orders.transition({ businessId: A.tenantId, id: o.id, from: "confirmed", to: "handoff", actor: "agent", changes: {}, event: null }), InvalidTransition);
    clock += 73 * 3_600_000;
    assert.equal(await engine.expireReservations(), 1, "sigue sujeto a su vencimiento");
  });

  it("el panel muestra la atención aparte (asesora, IA pausada, Inbox) y el motivo del traspaso como historia", async () => {
    const { order } = await confirmado();
    const d = (await detalle(order.orderId)).body.data.pedido;
    assert.deepEqual(d.atencion, { ia_pausada_hasta: "2026-10-24T12:00:00.000Z", conversacion: "pending", asignada: "Carolina" });
    assert.equal(d.motivo_traspaso, "pedido confirmado");
    assert.equal(d.estado_visible, "confirmado", "la atención no cambia el estado");
  });

  it("el panel viejo del catálogo no opera pedidos del checkout (se gestionan en Pedidos)", async () => {
    const { order } = await confirmado({ entrega: "tienda" });
    for (const accion of ["completar", "cancelar"]) {
      const r = await cerrarPedido(engine, A.tenantId, order.orderId, { accion });
      assert.equal(r.status, 409, accion);
    }
    assert.equal((await orders.getByOrderId(A.tenantId, order.orderId))!.status, "confirmed");
  });
});

describe("B27 · aislamiento y permisos", () => {
  it("otro negocio no ve ni cambia el pedido (404), ni aparece en su lista; cambiar el número de pedido no da acceso", async () => {
    const { order } = await confirmado();
    assert.equal((await detalle(order.orderId, B.tenantId)).status, 404);
    for (const a of ["pago_recibido", "en_preparacion", "cancelar"]) assert.equal((await actuarCon(order.orderId, a, await visto(order.orderId), "ajeno", B.tenantId)).status, 404, a);
    assert.deepEqual((await lista({}, true, B.tenantId)).body.data.pedidos, []);
    assert.equal((await lista({ q: order.orderId }, true, B.tenantId)).body.data.pedidos.length, 0);
    await assert.rejects(engine.markPaymentReceived({ tenantId: B.tenantId, orderId: order.orderId, memberId: 1 }), (e: unknown) => e instanceof OrderError && e.code === "NOT_FOUND");
    const o = (await orders.getByOrderId(A.tenantId, order.orderId))!;
    assert.deepEqual([o.checkout!.stage, o.checkout!.paymentStatus], ["confirmado", "pendiente"]);
  });

  it("roles y módulo: 'lectura' no actúa; sin el módulo 'pedidos' nadie entra; el teléfono solo para quien atiende", async () => {
    assert.equal(decideCatalogAccess({ role: "lectura", mode: "orders", moduleEnabled: true, module: ORDERS_MODULE }).allowed, false);
    assert.equal(decideCatalogAccess({ role: "agente", mode: "orders", moduleEnabled: true, module: ORDERS_MODULE }).allowed, true);
    assert.equal(decideCatalogAccess({ role: "admin", mode: "orders", moduleEnabled: true, module: ORDERS_MODULE }).allowed, true);
    assert.equal(decideCatalogAccess({ role: "lectura", mode: "read", moduleEnabled: true, module: ORDERS_MODULE }).allowed, true);
    const off = decideCatalogAccess({ role: "admin", mode: "read", moduleEnabled: false, module: ORDERS_MODULE });
    assert.ok(!off.allowed && off.code === "MODULE_DISABLED" && off.message.includes("Pedidos"));
    const consultados: string[] = [];
    const member: Miembro = { miembroId: 1, tenantId: A.tenantId, userId: "u", rol: "admin" as Rol, estado: "activo" };
    const deps: CatalogAuthDeps = {
      authenticate: async () => ({ ok: true, supabase: {} as SupabaseClient, member }),
      isModuleEnabled: async (_s, _t, m) => {
        consultados.push(String(m));
        return m === "catalogo";
      },
    };
    const r = await requireCatalogo(new NextRequest("https://x.test/api/dashboard/pedidos", { headers: { authorization: "Bearer t" } }), "read", deps, ORDERS_MODULE);
    assert.equal(r.ok, false);
    assert.deepEqual(consultados, ["pedidos"], "exige el módulo PEDIDOS (no basta el catálogo)");
    // Un rol de lectura que llama la API de acciones: 403 aunque tenga el módulo.
    const lector: Miembro = { ...member, rol: "lectura" as Rol };
    const r2 = await requireCatalogo(new NextRequest("https://x.test/api/dashboard/pedidos/DL-ORD-AAAAAA", { method: "POST", headers: { authorization: "Bearer t" } }), "orders", { ...deps, authenticate: async () => ({ ok: true, supabase: {} as SupabaseClient, member: lector }), isModuleEnabled: async () => true }, ORDERS_MODULE);
    assert.ok(!r2.ok && r2.response.status === 403);
    assert.ok((MODULOS as readonly string[]).includes("pedidos"));
    const item = navSections.flatMap((s) => s.items).find((i) => i.href === "/dashboard/pedidos")!;
    assert.equal(navItemVisible(item, "admin", ["catalogo"]), false);
    assert.equal(navItemVisible(item, "lectura", ["catalogo", "pedidos"]), true);
    const { order } = await confirmado();
    const ro = await detalle(order.orderId, A.tenantId, false);
    assert.equal(ro.body.data.pedido.contacto?.telefono, null);
    assert.equal(ro.body.data.pedido.cliente, null);
    assert.equal(ro.body.data.pedido.contacto?.telefono_parcial, "0001");
    assert.equal((await lista({ q: "3001110001" }, false)).body.data.pedidos.length, 0);
    assert.equal((await lista({ q: "3001110001" }, true)).body.data.pedidos.length, 1);
    assert.deepEqual(panelSearch("3001110001", false), { kind: "none", value: "" });
  });
});

describe("B27 · historial, inmutabilidad y pedidos anteriores", () => {
  it("historial inmutable; pedido confirmado inmutable (productos, precio, datos, modalidad)", async () => {
    const { order } = await confirmado();
    const antes = (await detalle(order.orderId)).body.data.historial;
    const current = (await orders.getByOrderId(A.tenantId, order.orderId))!;
    for (const changes of [{ lines: [], total: 0 }, { checkout: { ...current.checkout!, customerName: "Otra" } }, { checkout: { ...current.checkout!, paymentStatus: "recibido" as const } }]) {
      await assert.rejects(orders.transition({ businessId: A.tenantId, id: current.id, from: "confirmed", to: "completed", actor: "human", changes, event: null }), InvalidTransition);
    }
    assert.deepEqual((await detalle(order.orderId)).body.data.historial, antes);
    assert.equal((await orders.getByOrderId(A.tenantId, order.orderId))!.total, current.total);
  });

  it("pedido anterior al checkout: se lee y se completa/cancela/rechaza como antes; sin etapas ni pago", async () => {
    const { order } = await confirmado({ checkout: false });
    assert.equal(order.checkout, null);
    assert.equal(estadoVisible(order), "confirmado");
    assert.deepEqual(accionesPermitidas(order), ["completar", "cancelar", "rechazar"]);
    assert.equal((await detalle(order.orderId)).status, 200);
    assert.equal((await actuar(order.orderId, "pago_recibido")).status, 409, "sin estado de pago");
    assert.equal((await actuar(order.orderId, "completar")).body.data.pedido.estado_visible, "completado");
  });

  it("una propuesta sin confirmar no es parte del módulo", async () => {
    const p = await admin.createProduct(A, { name: "Aretes", retailPrice: 40_000, stock: 5 });
    const { order } = await engine.createOrder({ tenantId: A.tenantId, channel: "retail", source: "agent", contact: ANA, items: [{ reference: p.reference, quantity: 1 }], idempotencyKey: "agent:propuesta" });
    assert.equal((await detalle(order.orderId)).status, 404);
    assert.equal((await lista()).body.data.pedidos.length, 0);
  });
});

describe("B27 · idempotencia y concurrencia en el panel", () => {
  it("doble clic: la segunda vez 'repetido' y UN solo registro; estado visto viejo => 409 sin cambios", async () => {
    const { order } = await confirmado();
    const vio = await visto(order.orderId);
    const a = await actuarCon(order.orderId, "pago_recibido", vio);
    const b = await actuarCon(order.orderId, "pago_recibido", vio);
    assert.deepEqual([a.body.data.repetido, b.body.data.repetido], [false, true]);
    const vieja = await actuarCon(order.orderId, "cancelar", vio, "vista vieja");
    assert.deepEqual([vieja.status, vieja.body.error!.code], [409, "CONFLICT"]);
    assert.equal((await detalle(order.orderId)).body.data.historial.filter((x) => x.tipo === "order.payment_changed").length, 1);
  });

  it("dos personas a la vez sobre la misma etapa: un cambio, un registro", async () => {
    const { order } = await confirmado();
    const vio = await visto(order.orderId);
    const [x, y] = await Promise.all([actuarCon(order.orderId, "en_preparacion", vio), actuarCon(order.orderId, "en_preparacion", vio)]);
    assert.deepEqual([x.status, y.status], [200, 200]);
    assert.equal([x.body.data.repetido, y.body.data.repetido].filter(Boolean).length, 1);
    assert.equal((await detalle(order.orderId)).body.data.historial.filter((h) => h.tipo === "order.stage_changed").length, 1);
  });

  it("completar dos veces a la vez: la reserva se consume UNA vez", async () => {
    const { order, product } = await confirmado({ entrega: "tienda" });
    for (const a of ["pago_recibido", "en_preparacion", "entregado"]) await actuar(order.orderId, a);
    const vio = await visto(order.orderId);
    const rs = await Promise.all([actuarCon(order.orderId, "completar", vio), actuarCon(order.orderId, "completar", vio)]);
    assert.ok(rs.every((r) => r.status === 200 || r.status === 409));
    assert.equal((await orders.getByOrderId(A.tenantId, order.orderId))!.status, "completed");
    assert.deepEqual(orders.reservations.map((r) => r.status), ["consumida"]);
    assert.equal(stockDe(product.id), 3);
  });
});

describe("B27 · listado: filtros, orden y cursor", () => {
  it("filtra por estado, pago, modalidad, método, entrega, fechas y búsqueda; más reciente primero; cursor", async () => {
    const a = await confirmado({ entrega: "tienda" });
    clock += 60_000;
    const b = await confirmado({ entrega: "domicilio", contact: LUIS });
    clock += 60_000;
    const c = await confirmado({ entrega: "tienda", channel: "wholesale" });
    clock += 60_000;
    await actuar(a.order.orderId, "pago_recibido");
    clock += 60_000;
    await actuar(b.order.orderId, "en_preparacion");
    const ids = (r: Awaited<ReturnType<typeof lista>>) => r.body.data.pedidos.map((p) => p.pedido);
    assert.deepEqual(ids(await lista()), [b.order.orderId, a.order.orderId, c.order.orderId], "por última actualización");
    assert.deepEqual(ids(await lista({ estado: "en_preparacion" })), [b.order.orderId]);
    assert.deepEqual(ids(await lista({ estado: "confirmado" })), [a.order.orderId, c.order.orderId]);
    assert.deepEqual(ids(await lista({ pago: "recibido" })), [a.order.orderId]);
    assert.deepEqual(ids(await lista({ pago: "pendiente" })), [b.order.orderId, c.order.orderId]);
    assert.deepEqual(ids(await lista({ modalidad: "mayorista" })), [c.order.orderId]);
    assert.deepEqual(ids(await lista({ metodo: "pago_en_tienda" })), [b.order.orderId]);
    assert.deepEqual(ids(await lista({ entrega: "domicilio" })), [b.order.orderId]);
    assert.deepEqual(ids(await lista({ q: b.order.orderId })), [b.order.orderId]);
    assert.deepEqual(ids(await lista({ q: "luis" })), [b.order.orderId], "por nombre del checkout");
    assert.deepEqual(ids(await lista({ q: c.product.reference })), [c.order.orderId], "por referencia de producto");
    assert.deepEqual(ids(await lista({ desde: "2026-09-25" })), []);
    assert.equal(ids(await lista({ desde: "2026-09-24", hasta: "2026-09-24" })).length, 3);
    const p1 = await lista({ limite: "2" });
    const p2 = await lista({ limite: "2", cursor: p1.body.data.siguiente! });
    assert.deepEqual([...ids(p1), ...ids(p2)], ids(await lista()));
    assert.equal(p2.body.data.siguiente, null);
    for (const bad of [{ estado: "pendiente_pago" }, { pago: "x" }, { desde: "ayer" }, { cursor: "no-es-un-cursor!" }, { limite: "0" }] as Array<Record<string, string>>) assert.equal((await lista(bad)).status, 400, JSON.stringify(bad));
    const it0 = (await lista({ q: b.order.orderId })).body.data.pedidos[0];
    assert.equal(it0.checkout?.nombre, "Luis Gómez");
    assert.equal(it0.checkout?.entrega, "domicilio");
    assert.equal(it0.checkout?.direccion, "Calle 1 # 2-3");
    assert.equal(it0.estado_pago, "pendiente");
    assert.equal(it0.lineas[0].foto, `https://img.test/${b.product.reference}.webp`);
    assert.ok(it0.confirmado_en && it0.creado);
    assert.ok(!JSON.stringify(it0).includes("00000000-0000-4000-8000"), "sin ids internos");
  });
});
