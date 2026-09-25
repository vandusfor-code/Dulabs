/**
 * Bloque 27 — OPERACIÓN del pedido real y módulo "Pedidos" del dashboard:
 *
 *   PENDIENTE DE PAGO -> PAGO RECIBIDO -> EN PREPARACIÓN -> ENVIADO (solo domicilio) -> COMPLETADO
 *   CANCELADO / RECHAZADO (liberan la reserva) · vencimiento de 72 h solo sin pago recibido.
 *
 * Pruebas Q–Z, AA–AC y AH del bloque + filtros, permisos y el panel viejo del catálogo. Motor,
 * catálogo y pedidos en memoria (misma semántica que la BD; la BD tiene su propia prueba SQL).
 * Nada toca Supabase. Negocios, clientes y productos ficticios.
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
async function actuar(pedido: string, a: string, esperado: { estado: string; etapa: string | null }, motivo?: string, tenant = A.tenantId) {
  return json<{ pedido: PedidoGestion; repetido: boolean }>(await accionGestion(engine, tenant, pedido, { accion: a, esperado, ...(motivo ? { motivo } : {}) }, ASESORA));
}
async function detalle(pedido: string, tenant = A.tenantId, ver = true) {
  return json<{ pedido: PedidoGestion; historial: HistorialEntrada[] }>(await detalleGestion(engine, tenant, pedido, extras(ver)));
}
async function lista(qs: Record<string, string> = {}, ver = true, tenant = A.tenantId) {
  return json<{ pedidos: PedidoGestion[]; siguiente: string | null }>(await listarGestion(engine, tenant, new URLSearchParams(qs), extras(ver)));
}

// ---------------------------------------------------------------------------

describe("B27 · Q–U etapas de la operación", () => {
  it("Q–U. domicilio: pago recibido -> preparación -> enviado -> completado; cada paso con la persona y en orden", async () => {
    const { order, product } = await confirmado({ entrega: "domicilio" });
    assert.equal(estadoVisible(order), "pendiente_pago");
    assert.deepEqual(accionesPermitidas(order), ["pago_recibido", "cancelar", "rechazar"]);
    assert.equal(mem.inventory.stockOf(product.id), 3, "reservado al confirmar");

    const q = await actuar(order.orderId, "pago_recibido", { estado: "confirmed", etapa: "pendiente_pago" });
    assert.equal(q.status, 200);
    assert.equal(q.body.data.pedido.estado_visible, "pago_recibido");
    assert.equal(q.body.data.pedido.checkout?.estado_pago, "recibido", "Q. el pago queda recibido");
    const r = await actuar(order.orderId, "en_preparacion", { estado: "confirmed", etapa: "pago_recibido" });
    assert.equal(r.body.data.pedido.estado_visible, "en_preparacion");
    const s = await actuar(order.orderId, "enviado", { estado: "confirmed", etapa: "en_preparacion" });
    assert.equal(s.body.data.pedido.estado_visible, "enviado", "S. enviado (domicilio)");
    const u = await actuar(order.orderId, "completar", { estado: "confirmed", etapa: "enviado" });
    assert.equal(u.body.data.pedido.estado_visible, "completado");
    assert.equal(mem.inventory.stockOf(product.id), 3, "U. completar consume la reserva (el stock no vuelve)");
    assert.deepEqual(orders.reservations.map((x) => x.status), ["consumida"]);

    const d = await detalle(order.orderId);
    const pasos = d.body.data.historial.map((h) => `${h.desde ?? "∅"}>${h.hacia}:${h.miembro ?? h.actor}`);
    assert.deepEqual(pasos, [
      "∅>pending_confirmation:null",
      "pending_confirmation>confirmed:agent",
      "pendiente_pago>pago_recibido:Carolina",
      "pago_recibido>en_preparacion:Carolina",
      "en_preparacion>enviado:Carolina",
      "confirmed>completed:Carolina",
    ]);
  });

  it("no hay saltos: completar antes de tiempo, saltar etapas o retroceder => 409, nada cambia", async () => {
    const { order } = await confirmado({ entrega: "domicilio" });
    const saltar = await actuar(order.orderId, "en_preparacion", { estado: "confirmed", etapa: "pendiente_pago" });
    assert.equal(saltar.status, 409);
    const completar = await actuar(order.orderId, "completar", { estado: "confirmed", etapa: "pendiente_pago" });
    assert.equal(completar.status, 409);
    // El motor y el repositorio tampoco lo permiten aunque se llamen directo.
    await assert.rejects(engine.closeOrder({ tenantId: A.tenantId, orderId: order.orderId, action: "complete" }), (e: unknown) => e instanceof OrderError && e.code === "INVALID_TRANSITION");
    await assert.rejects(engine.advanceStage({ tenantId: A.tenantId, orderId: order.orderId, from: "pendiente_pago", to: "en_preparacion", memberId: ASESORA }), (e: unknown) => e instanceof OrderError && e.code === "INVALID_TRANSITION");
    await assert.rejects(orders.setStage({ businessId: A.tenantId, orderId: order.orderId, from: "pago_recibido", to: "pendiente_pago", memberId: ASESORA, reason: null, eventId: "evt_x" }), InvalidTransition);
    assert.equal((await orders.getByOrderId(A.tenantId, order.orderId))!.checkout!.stage, "pendiente_pago");
  });

  it("T. recoger en tienda: 'enviado' se bloquea; se completa desde preparación", async () => {
    const { order } = await confirmado({ entrega: "tienda" });
    await actuar(order.orderId, "pago_recibido", { estado: "confirmed", etapa: "pendiente_pago" });
    await actuar(order.orderId, "en_preparacion", { estado: "confirmed", etapa: "pago_recibido" });
    const t = await actuar(order.orderId, "enviado", { estado: "confirmed", etapa: "en_preparacion" });
    assert.equal(t.status, 409);
    assert.match(t.body.error!.message, /domicilio/);
    // El panel ni siquiera ofrece "enviado" para recoger en tienda.
    const actual = (await orders.getByOrderId(A.tenantId, order.orderId))!;
    assert.deepEqual(accionesPermitidas(actual), ["completar", "cancelar", "rechazar"]);
    await assert.rejects(engine.advanceStage({ tenantId: A.tenantId, orderId: order.orderId, from: "en_preparacion", to: "enviado", memberId: ASESORA }), (e: unknown) => e instanceof OrderError);
    await assert.rejects(orders.setStage({ businessId: A.tenantId, orderId: order.orderId, from: "en_preparacion", to: "enviado", memberId: ASESORA, reason: null, eventId: "evt_y" }), InvalidTransition);
    const u = await actuar(order.orderId, "completar", { estado: "confirmed", etapa: "en_preparacion" });
    assert.equal(u.body.data.pedido.estado_visible, "completado");
  });

  it("el panel viejo del catálogo tampoco se salta las etapas de un pedido del checkout", async () => {
    const { order } = await confirmado({ entrega: "tienda" });
    const r = await cerrarPedido(engine, A.tenantId, order.orderId, { accion: "completar" });
    assert.equal(r.status, 409);
    assert.equal((await orders.getByOrderId(A.tenantId, order.orderId))!.status, "confirmed");
  });
});

describe("B27 · V–W cancelar y rechazar", () => {
  it("V. cancelar exige motivo; libera la reserva; queda quién y por qué; es terminal", async () => {
    const { order, product } = await confirmado({ entrega: "tienda" });
    const sinMotivo = await actuar(order.orderId, "cancelar", { estado: "confirmed", etapa: "pendiente_pago" });
    assert.equal(sinMotivo.status, 400);
    const v = await actuar(order.orderId, "cancelar", { estado: "confirmed", etapa: "pendiente_pago" }, "El cliente desistió");
    assert.equal(v.body.data.pedido.estado_visible, "cancelado");
    assert.equal(mem.inventory.stockOf(product.id), 5, "el stock vuelve");
    const h = (await detalle(order.orderId)).body.data.historial.at(-1)!;
    assert.deepEqual([h.desde, h.hacia, h.miembro, h.motivo], ["confirmed", "cancelled", "Carolina", "El cliente desistió"]);
    assert.deepEqual(v.body.data.pedido.acciones, []);
    const otra = await actuar(order.orderId, "pago_recibido", { estado: "cancelled", etapa: "pendiente_pago" });
    assert.equal(otra.status, 409);
  });

  it("W. rechazar (la empresa): exige motivo, libera la reserva y es terminal", async () => {
    const { order, product } = await confirmado({ entrega: "domicilio" });
    await actuar(order.orderId, "pago_recibido", { estado: "confirmed", etapa: "pendiente_pago" });
    assert.equal((await actuar(order.orderId, "rechazar", { estado: "confirmed", etapa: "pago_recibido" }, "  ")).status, 400);
    const w = await actuar(order.orderId, "rechazar", { estado: "confirmed", etapa: "pago_recibido" }, "Sin cobertura en la zona");
    assert.equal(w.body.data.pedido.estado_visible, "rechazado");
    assert.equal(mem.inventory.stockOf(product.id), 5);
    const h = (await detalle(order.orderId)).body.data.historial.at(-1)!;
    assert.deepEqual([h.hacia, h.miembro, h.motivo], ["rejected", "Carolina", "Sin cobertura en la zona"]);
    for (const a of ["completar", "cancelar", "en_preparacion"]) assert.equal((await actuar(order.orderId, a, { estado: "rejected", etapa: "pago_recibido" }, "x motivo")).status, 409, a);
  });
});

describe("B27 · X–Y vencimiento de la reserva", () => {
  it("X. pendiente de pago: a las 72 h vence y el stock vuelve", async () => {
    const { order, product } = await confirmado();
    clock += 73 * 3_600_000;
    assert.equal(await engine.expireReservations(), 1);
    assert.equal((await orders.getByOrderId(A.tenantId, order.orderId))!.status, "expired");
    assert.equal(mem.inventory.stockOf(product.id), 5);
  });

  it("Y. con el pago recibido NO vence (ni por el cron ni al abrir el panel)", async () => {
    const { order, product } = await confirmado();
    await actuar(order.orderId, "pago_recibido", { estado: "confirmed", etapa: "pendiente_pago" });
    clock += 200 * 3_600_000;
    assert.equal(await engine.expireReservations(), 0);
    await lista();
    const o = (await orders.getByOrderId(A.tenantId, order.orderId))!;
    assert.equal(o.status, "confirmed");
    assert.equal(mem.inventory.stockOf(product.id), 3);
  });
});

describe("B27 · Z, AA aislamiento y permisos", () => {
  it("Z. otro negocio no ve ni cambia el pedido (404), ni aparece en su lista", async () => {
    const { order } = await confirmado();
    assert.equal((await detalle(order.orderId, B.tenantId)).status, 404);
    assert.equal((await actuar(order.orderId, "pago_recibido", { estado: "confirmed", etapa: "pendiente_pago" }, undefined, B.tenantId)).status, 404);
    assert.deepEqual((await lista({}, true, B.tenantId)).body.data.pedidos, []);
    assert.equal((await orders.getByOrderId(A.tenantId, order.orderId))!.checkout!.stage, "pendiente_pago");
  });

  it("AA. roles y módulo: 'lectura' no actúa; sin el módulo 'pedidos' nadie entra; el teléfono solo para quien atiende", async () => {
    assert.equal(decideCatalogAccess({ role: "lectura", mode: "orders", moduleEnabled: true, module: ORDERS_MODULE }).allowed, false);
    assert.equal(decideCatalogAccess({ role: "agente", mode: "orders", moduleEnabled: true, module: ORDERS_MODULE }).allowed, true);
    assert.equal(decideCatalogAccess({ role: "lectura", mode: "read", moduleEnabled: true, module: ORDERS_MODULE }).allowed, true);
    const off = decideCatalogAccess({ role: "admin", mode: "read", moduleEnabled: false, module: ORDERS_MODULE });
    assert.ok(!off.allowed && off.code === "MODULE_DISABLED" && off.message.includes("Pedidos"));
    // requireCatalogo consulta el módulo PEDIDOS (no el del catálogo) para estas rutas.
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
    assert.deepEqual(consultados, ["pedidos"]);
    assert.ok((MODULOS as readonly string[]).includes("pedidos"));
    const item = navSections.flatMap((s) => s.items).find((i) => i.href === "/dashboard/pedidos")!;
    assert.equal(navItemVisible(item, "admin", ["catalogo"]), false, "sin el módulo no aparece en el menú");
    assert.equal(navItemVisible(item, "lectura", ["catalogo", "pedidos"]), true);
    // Teléfono: oculto para lectura (y no se puede buscar por teléfono).
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

describe("B27 · AB–AC historial y pedidos anteriores", () => {
  it("AB. historial inmutable y pedido confirmado inmutable (productos, precio, datos)", async () => {
    const { order } = await confirmado();
    const antes = (await detalle(order.orderId)).body.data.historial;
    // Ninguna API edita el historial; el repositorio no deja cambiar un pedido confirmado.
    const current = (await orders.getByOrderId(A.tenantId, order.orderId))!;
    await assert.rejects(
      orders.transition({ businessId: A.tenantId, id: current.id, from: "confirmed", to: "handoff", actor: "human", changes: { lines: [], total: 0 }, event: null }),
      InvalidTransition,
    );
    await assert.rejects(
      orders.transition({ businessId: A.tenantId, id: current.id, from: "confirmed", to: "handoff", actor: "human", changes: { checkout: { ...current.checkout!, customerName: "Otra" } }, event: null }),
      InvalidTransition,
    );
    assert.deepEqual((await detalle(order.orderId)).body.data.historial, antes);
    assert.equal((await orders.getByOrderId(A.tenantId, order.orderId))!.total, current.total);
  });

  it("AC. pedido anterior al checkout (sin datos): se lee, se completa/cancela/rechaza como antes", async () => {
    const { order } = await confirmado({ checkout: false });
    assert.equal(order.checkout, null);
    assert.equal(estadoVisible(order), "confirmado");
    assert.deepEqual(accionesPermitidas(order), ["completar", "cancelar", "rechazar"]);
    const l = (await lista()).body.data.pedidos;
    assert.equal(l.length, 1);
    assert.equal(l[0].checkout, null);
    const d = await detalle(order.orderId);
    assert.equal(d.status, 200);
    assert.equal((await actuar(order.orderId, "pago_recibido", { estado: "confirmed", etapa: null })).status, 409, "sin etapas");
    assert.equal((await actuar(order.orderId, "completar", { estado: "confirmed", etapa: null })).body.data.pedido.estado_visible, "completado");
  });

  it("una propuesta sin confirmar no es parte del módulo", async () => {
    const p = await admin.createProduct(A, { name: "Aretes", retailPrice: 40_000, stock: 5 });
    const { order } = await engine.createOrder({ tenantId: A.tenantId, channel: "retail", source: "agent", contact: ANA, items: [{ reference: p.reference, quantity: 1 }], idempotencyKey: "agent:propuesta" });
    assert.equal((await detalle(order.orderId)).status, 404);
    assert.equal((await lista()).body.data.pedidos.length, 0);
  });
});

describe("B27 · AH reintentos, recargas y concurrencia en el panel", () => {
  it("doble clic: la segunda vez 'repetido' y UN solo registro; estado visto viejo => 409 sin cambios", async () => {
    const { order } = await confirmado();
    const a = await actuar(order.orderId, "pago_recibido", { estado: "confirmed", etapa: "pendiente_pago" });
    const b = await actuar(order.orderId, "pago_recibido", { estado: "confirmed", etapa: "pendiente_pago" });
    assert.equal(a.body.data.repetido, false);
    assert.equal(b.body.data.repetido, true);
    // Otra pestaña con la vista vieja intenta pasar a preparación desde "pendiente de pago": conflicto.
    const vieja = await actuar(order.orderId, "cancelar", { estado: "confirmed", etapa: "pendiente_pago" }, "vista vieja");
    assert.equal(vieja.status, 409);
    assert.equal(vieja.body.error!.code, "CONFLICT");
    const h = (await detalle(order.orderId)).body.data.historial.filter((x) => x.tipo === "order.stage_changed");
    assert.equal(h.length, 1);
  });

  it("dos personas a la vez sobre la misma etapa: un cambio, un registro", async () => {
    const { order } = await confirmado();
    const [x, y] = await Promise.all([
      actuar(order.orderId, "pago_recibido", { estado: "confirmed", etapa: "pendiente_pago" }),
      actuar(order.orderId, "pago_recibido", { estado: "confirmed", etapa: "pendiente_pago" }),
    ]);
    assert.deepEqual([x.status, y.status], [200, 200]);
    assert.equal([x.body.data.repetido, y.body.data.repetido].filter(Boolean).length, 1);
    assert.equal((await detalle(order.orderId)).body.data.historial.filter((h) => h.tipo === "order.stage_changed").length, 1);
  });

  it("completar dos veces: la reserva se consume UNA vez", async () => {
    const { order, product } = await confirmado({ entrega: "tienda" });
    await actuar(order.orderId, "pago_recibido", { estado: "confirmed", etapa: "pendiente_pago" });
    await actuar(order.orderId, "en_preparacion", { estado: "confirmed", etapa: "pago_recibido" });
    const [x, y] = await Promise.all([
      actuar(order.orderId, "completar", { estado: "confirmed", etapa: "en_preparacion" }),
      actuar(order.orderId, "completar", { estado: "confirmed", etapa: "en_preparacion" }),
    ]);
    assert.ok([x, y].every((r) => r.status === 200 || r.status === 409));
    assert.equal((await orders.getByOrderId(A.tenantId, order.orderId))!.status, "completed");
    assert.deepEqual(orders.reservations.map((r) => r.status), ["consumida"]);
    assert.equal(mem.inventory.stockOf(product.id), 3);
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
    await actuar(a.order.orderId, "pago_recibido", { estado: "confirmed", etapa: "pendiente_pago" });
    const ids = (r: Awaited<ReturnType<typeof lista>>) => r.body.data.pedidos.map((p) => p.pedido);
    assert.deepEqual(ids(await lista()), [a.order.orderId, c.order.orderId, b.order.orderId], "por última actualización");
    assert.deepEqual(ids(await lista({ estado: "pago_recibido" })), [a.order.orderId]);
    assert.deepEqual(ids(await lista({ pago: "pendiente" })), [c.order.orderId, b.order.orderId]);
    assert.deepEqual(ids(await lista({ modalidad: "mayorista" })), [c.order.orderId]);
    assert.deepEqual(ids(await lista({ metodo: "pago_en_tienda" })), [b.order.orderId]);
    assert.deepEqual(ids(await lista({ entrega: "domicilio" })), [b.order.orderId]);
    assert.deepEqual(ids(await lista({ q: b.order.orderId })), [b.order.orderId]);
    assert.deepEqual(ids(await lista({ q: "luis" })), [b.order.orderId], "por nombre del checkout");
    assert.deepEqual(ids(await lista({ q: c.product.reference })), [c.order.orderId], "por referencia de producto");
    assert.deepEqual(ids(await lista({ desde: "2026-09-25" })), []);
    assert.equal(ids(await lista({ desde: "2026-09-24", hasta: "2026-09-24" })).length, 3);
    const p1 = await lista({ limite: "2" });
    assert.equal(p1.body.data.pedidos.length, 2);
    const p2 = await lista({ limite: "2", cursor: p1.body.data.siguiente! });
    assert.deepEqual(ids(p2), [b.order.orderId]);
    assert.equal(p2.body.data.siguiente, null);
    for (const bad of [{ estado: "x" }, { pago: "x" }, { desde: "ayer" }, { cursor: "no-es-un-cursor!" }, { limite: "0" }] as Array<Record<string, string>>) assert.equal((await lista(bad)).status, 400, JSON.stringify(bad));
    // El listado muestra lo que pide el bloque (y nunca ids internos).
    const it0 = (await lista({ q: b.order.orderId })).body.data.pedidos[0];
    assert.equal(it0.checkout?.nombre, "Luis Gómez");
    assert.equal(it0.checkout?.entrega, "domicilio");
    assert.equal(it0.lineas[0].foto, `https://img.test/${b.product.reference}.webp`);
    assert.ok(!JSON.stringify(it0).includes("00000000-0000-4000-8000"));
  });
});
