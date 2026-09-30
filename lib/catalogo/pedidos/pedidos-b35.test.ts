/**
 * Bloque 35 — módulo "Pedidos" más limpio: pestañas con contador (Todos, Pendientes, En preparación,
 * Enviados, Entregados, Completados, Cancelados), periodo y ELIMINAR pedidos cerrados (solo admin; el
 * activo se cancela primero para que el stock vuelva). Motor y pedidos en memoria (misma semántica
 * que la BD; la función SQL tiene su propia prueba en PostgreSQL real). Datos ficticios.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine, type CheckoutData, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { GRUPOS, accionGestion, detalleGestion, eliminarGestion, filtrosGestion, listarGestion, type GrupoPedidos, type HistorialEntrada, type PedidoGestion } from "@/lib/catalogo/pedidos/gestion";
import type { PanelFuentes } from "@/lib/catalogo/pedidos/panel";
import { ORDERS_MODULE, decideCatalogAccess } from "@/lib/catalogo/auth";
import { hace, rangoPeriodo } from "@/components/dashboard/pedidos/ui";

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
  const { order } = await engine.createOrder({ tenantId: A.tenantId, channel: opts.channel ?? "retail", source: "agent", contact, items: [{ reference: p.reference, quantity: opts.qty ?? 2 }], idempotencyKey: `agent:b35-${seq}` });
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
  return json<{ pedidos: PedidoGestion[]; siguiente: string | null; conteos: Record<GrupoPedidos, number> | null }>(await listarGestion(engine, tenant, new URLSearchParams(qs), extras(ver)));
}
const stockDe = (id: string) => mem.inventory.stockOf(id);

/** Un pedido en cada pestaña: A pendiente, B en preparación, C enviado, D entregado, E completado, F cancelado, G rechazado. */
async function unoDeCada() {
  const a = (await confirmado()).order.orderId;
  const b = (await confirmado()).order.orderId;
  await actuar(b, "en_preparacion");
  const c = (await confirmado({ entrega: "domicilio", contact: LUIS })).order.orderId;
  await actuar(c, "en_preparacion");
  await actuar(c, "enviado");
  const d = (await confirmado()).order.orderId;
  await actuar(d, "en_preparacion");
  await actuar(d, "entregado");
  const e = (await confirmado({ channel: "wholesale" })).order.orderId;
  await actuar(e, "pago_recibido");
  await actuar(e, "en_preparacion");
  await actuar(e, "entregado");
  await actuar(e, "completar");
  const f = (await confirmado()).order.orderId;
  await actuar(f, "cancelar", "El cliente ya no lo quiere");
  const g = (await confirmado()).order.orderId;
  await actuar(g, "rechazar", "Sin stock real en tienda");
  return { a, b, c, d, e, f, g };
}

describe("B35 · pestañas con contador", () => {
  it("cada pestaña trae sus pedidos y el contador de TODAS (primera página)", async () => {
    const x = await unoDeCada();
    const r = await lista();
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.conteos, { todos: 7, pendientes: 1, en_preparacion: 1, enviados: 1, entregados: 1, completados: 1, cancelados: 2 });
    const de = async (grupo: string) => (await lista({ grupo })).body.data.pedidos.map((p) => p.pedido).sort();
    assert.deepEqual(await de("pendientes"), [x.a]);
    assert.deepEqual(await de("en_preparacion"), [x.b]);
    assert.deepEqual(await de("enviados"), [x.c]);
    assert.deepEqual(await de("entregados"), [x.d]);
    assert.deepEqual(await de("completados"), [x.e]);
    assert.deepEqual(await de("cancelados"), [x.f, x.g].sort(), "cancelados + rechazados (+ vencidos)");
    assert.equal((await de("todos")).length, 7);
  });

  it("los contadores respetan los DEMÁS filtros (entrega, modalidad, búsqueda) pero no la pestaña", async () => {
    await unoDeCada();
    const dom = (await lista({ entrega: "domicilio", grupo: "completados" })).body.data;
    assert.deepEqual(dom.conteos, { todos: 1, pendientes: 0, en_preparacion: 0, enviados: 1, entregados: 0, completados: 0, cancelados: 0 });
    assert.equal(dom.pedidos.length, 0);
    const may = (await lista({ modalidad: "mayorista" })).body.data.conteos!;
    assert.deepEqual([may.todos, may.completados], [1, 1]);
    const luis = (await lista({ q: "Luis" })).body.data.conteos!;
    assert.equal(luis.todos, 1);
  });

  it("periodo: solo pedidos creados en esas fechas (hora de Colombia)", async () => {
    await confirmado();
    assert.equal((await lista({ desde: "2026-09-24", hasta: "2026-09-24" })).body.data.conteos!.todos, 1);
    assert.equal((await lista({ desde: "2026-09-25" })).body.data.conteos!.todos, 0);
  });

  it("páginas siguientes (cursor) no recalculan los contadores; pestaña inválida => 400; la pestaña manda sobre `estado`", async () => {
    for (let i = 0; i < 3; i++) await confirmado();
    const p1 = (await lista({ limite: "2" })).body.data;
    assert.ok(p1.siguiente);
    const p2 = (await lista({ limite: "2", cursor: p1.siguiente! })).body.data;
    assert.equal(p2.conteos, null);
    assert.equal((await lista({ grupo: "inventado" })).status, 400);
    const f = filtrosGestion(new URLSearchParams({ estado: "completado", grupo: "pendientes" }), true);
    assert.ok(f.ok);
    assert.deepEqual([f.ok && f.filtros.statuses, f.ok && f.filtros.stages], [["confirmed"], ["confirmado"]]);
    assert.equal(GRUPOS.length, 7);
  });

  it("aislamiento: los contadores son del negocio de la sesión", async () => {
    await unoDeCada();
    assert.equal((await lista({}, true, B.tenantId)).body.data.conteos!.todos, 0);
  });
});

describe("B35 · eliminar pedidos", () => {
  const eliminar = async (pedido: string, tenant = A.tenantId) => json<{ eliminado: string }>(await eliminarGestion(engine, tenant, pedido, ASESORA));

  it("un pedido ACTIVO no se elimina: 409 y sigue igual (primero se cancela para que el stock vuelva)", async () => {
    const { order, product } = await confirmado();
    const stock = stockDe(product.id);
    const r = await eliminar(order.orderId);
    assert.equal(r.status, 409);
    assert.equal(r.body.error?.code, "ACTIVE_ORDER");
    assert.match(r.body.error!.message, /Cancélalo primero/);
    assert.ok(await orders.getByOrderId(A.tenantId, order.orderId));
    assert.equal(stockDe(product.id), stock);
    assert.equal((await detalle(order.orderId)).body.data.pedido.eliminable, false);
  });

  it("cancelado: se elimina con su historial; copia en la auditoría (quién); desaparece del módulo; el stock no cambia", async () => {
    const { order, product } = await confirmado();
    await actuar(order.orderId, "cancelar", "Pedido de prueba");
    const stock = stockDe(product.id);
    assert.equal((await detalle(order.orderId)).body.data.pedido.eliminable, true);
    const r = await eliminar(order.orderId);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.eliminado, order.orderId);
    assert.equal(await orders.getByOrderId(A.tenantId, order.orderId), null);
    assert.equal((await detalle(order.orderId)).status, 404);
    assert.equal((await lista()).body.data.conteos!.todos, 0);
    assert.equal(orders.history.filter((h) => h.orderId === order.id).length, 0, "sin historial huérfano");
    assert.deepEqual(orders.deleted.map((d) => [d.order.orderId, d.memberId]), [[order.orderId, ASESORA]]);
    assert.equal(stockDe(product.id), stock, "el stock ya había vuelto al cancelar");
    assert.equal((await eliminar(order.orderId)).status, 404, "repetir: ya no existe");
  });

  it("completado: se elimina y el stock vendido no vuelve (no se regala inventario)", async () => {
    const { order, product } = await confirmado();
    for (const a of ["pago_recibido", "en_preparacion", "entregado", "completar"]) await actuar(order.orderId, a);
    const stock = stockDe(product.id);
    assert.equal((await eliminar(order.orderId)).status, 200);
    assert.equal(stockDe(product.id), stock);
  });

  it("otro negocio, un número inválido o una propuesta sin confirmar => 404, sin tocar nada", async () => {
    const { order } = await confirmado();
    await actuar(order.orderId, "cancelar", "Prueba");
    assert.equal((await eliminar(order.orderId, B.tenantId)).status, 404);
    assert.equal((await eliminar("DL-ORD-NOEXIS")).status, 404);
    assert.equal((await eliminar("hola")).status, 404);
    const p = await admin.createProduct(A, { name: "Borrador", retailPrice: 10_000, wholesalePrice: 5_000, stock: 5 });
    const { order: prop } = await engine.createOrder({ tenantId: A.tenantId, channel: "retail", source: "agent", contact: ANA, items: [{ reference: p.reference, quantity: 1 }], idempotencyKey: "agent:b35-prop" });
    assert.equal((await eliminar(prop.orderId)).status, 404, "las propuestas del chat no son del módulo");
    assert.ok(await orders.getByOrderId(A.tenantId, order.orderId));
  });

  it("solo administradores: la ruta DELETE exige 'write' y el módulo Pedidos; una asesora (agente) no puede", () => {
    const s = readFileSync("app/api/dashboard/pedidos/[pedido]/route.ts", "utf8");
    assert.match(s, /export async function DELETE[\s\S]*withCatalog\(\s*request,\s*"write",[\s\S]*eliminarGestion[\s\S]*module: ORDERS_MODULE/);
    assert.equal(decideCatalogAccess({ role: "agente", mode: "write", moduleEnabled: true, module: ORDERS_MODULE }).allowed, false);
    assert.equal(decideCatalogAccess({ role: "admin", mode: "write", moduleEnabled: true, module: ORDERS_MODULE }).allowed, true);
  });
});

describe("B35 · tarjeta compacta: tiempo relativo y periodo", () => {
  const t = (es: string) => es;
  const ahora = Date.parse("2026-09-30T15:00:00Z");
  it("'Hace 2 h', 'en 3 h', días, y fecha si pasó más de una semana", () => {
    assert.equal(hace("2026-09-30T13:00:00Z", t, ahora), "Hace 2 h");
    assert.equal(hace("2026-09-30T14:59:40Z", t, ahora), "Ahora");
    assert.equal(hace("2026-09-30T14:20:00Z", t, ahora), "Hace 40 min");
    assert.equal(hace("2026-09-30T18:00:00Z", t, ahora), "en 3 h");
    assert.equal(hace("2026-09-29T15:00:00Z", t, ahora), "Hace 1 día");
    assert.equal(hace("2026-09-26T15:00:00Z", t, ahora), "Hace 4 días");
    assert.match(hace("2026-09-01T15:00:00Z", t, ahora), /sept?/);
    assert.equal(hace(null, t, ahora), "—");
  });
  it("periodo en días de Colombia: hoy, 7, 30, 90; 'todo' sin fechas", () => {
    // 2026-10-01 03:00 UTC = 30 sep 22:00 en Colombia.
    const noche = Date.parse("2026-10-01T03:00:00Z");
    assert.deepEqual(rangoPeriodo("hoy", noche), { desde: "2026-09-30", hasta: "2026-09-30" });
    assert.deepEqual(rangoPeriodo("7d", noche), { desde: "2026-09-24", hasta: "2026-09-30" });
    assert.deepEqual(rangoPeriodo("30d", noche), { desde: "2026-09-01", hasta: "2026-09-30" });
    assert.deepEqual(rangoPeriodo("todo", noche), {});
  });
});
