/**
 * Bloque 19 — reserva de stock al confirmar (capa TypeScript).
 *
 * La verdad es la BD (trigger + funciones: supabase/tests/20261116000000_*.test.sql y la prueba de
 * CONCURRENCIA REAL *.concurrencia.sh). Aquí: el motor, el panel de la asesora y los permisos, con
 * el repositorio en memoria que emula la MISMA regla sobre el inventario del catálogo en memoria.
 * Ni Gemini ni el navegador deciden inventario: todo pasa por el motor. Nada toca Supabase.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { decideCatalogAccess } from "@/lib/catalogo/auth";
import { createCatalogService, createPublicCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { OrderError, createOrderEngine, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { ProductNotSellable, RESERVATION_TTL_MS, StockUnavailable, createMemoryOrdersRepository, createSupabaseOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { cerrarPedido, listarPedidos } from "@/lib/catalogo/pedidos/panel";
import { supabaseAdmin } from "@/lib/supabase";
import { installSupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const ANA = { phoneNumberId: "100000000000001", waId: "573001110001" };
const BETO = { phoneNumberId: "100000000000001", waId: "573001110002" };

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
  engine = createOrderEngine({ orders, catalog: mem.repo, key: Buffer.alloc(32, 3), log: () => {}, now: () => new Date(clock) });
  for (const actor of [A, B]) mem.enableModule(actor.tenantId);
  seq = 0;
});

const stockDe = (id: string) => mem.inventory.stockOf(id);
async function producto(actor: CatalogActor, name: string, stock: number) {
  return admin.createProduct(actor, { name, retailPrice: 50_000, stock });
}
/** Un pedido listo para confirmar (validado por el backend con el stock de ESE momento). */
async function propuesta(contact: typeof ANA, items: Array<{ reference: string; quantity: number }>, tenant = A.tenantId) {
  const { order } = await engine.createOrder({ tenantId: tenant, channel: "retail", source: "agent", contact, items, idempotencyKey: `agent:k${++seq}` });
  assert.equal(order.status, "pending_confirmation", JSON.stringify(order.issues));
  return order;
}
const confirmar = (o: { orderId: string; confirmation: { id: string } | null }, contact: typeof ANA, tenant = A.tenantId) =>
  engine.confirmOrder({ tenantId: tenant, contact, orderId: o.orderId, confirmationId: o.confirmation!.id, actor: "agent" });

describe("confirmar aparta el stock (todo o nada)", () => {
  it("confirmar descuenta; la tienda y el agente ven el stock real enseguida", async () => {
    const p = await producto(A, "Anillo Luna", 3);
    await confirmar(await propuesta(ANA, [{ reference: p.reference, quantity: 2 }]), ANA);
    assert.equal(stockDe(p.id), 1);
    assert.deepEqual(
      orders.reservations.map((r) => [r.reference, r.quantity, r.status]),
      [[p.reference, 2, "activa"]],
    );
    const publico = createPublicCatalogService({ repo: mem.repo });
    const pub = await admin.ensurePublication(A);
    mem.setProfile(A.tenantId, { name: "A", whatsapp: "573000000000" });
    const ficha = await publico.getProduct({ slug: pub.slug, reference: p.reference });
    assert.equal(ficha?.maxQuantity, 1, "la tienda muestra lo que queda");
  });

  it("dos clientes vieron la última unidad: el primero la aparta; el segundo recibe 'agotado' y su pedido vuelve a borrador", async () => {
    const p = await producto(A, "Aretes Sol", 1);
    const deAna = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    const deBeto = await propuesta(BETO, [{ reference: p.reference, quantity: 1 }]);
    await confirmar(deAna, ANA);
    await assert.rejects(confirmar(deBeto, BETO), (e: unknown) => e instanceof OrderError && e.code === "OUT_OF_STOCK");
    const beto = await engine.getOrder({ tenantId: A.tenantId, contact: BETO, orderId: deBeto.orderId });
    assert.equal(beto.status, "draft");
    assert.equal(beto.confirmation, null);
    assert.deepEqual(beto.issues.map((i) => i.code), ["sold_out"]);
    assert.equal(stockDe(p.id), 0);
    assert.equal(orders.reservations.filter((r) => r.status === "activa").length, 1);
  });

  it("todo o nada: si una línea no alcanza, ninguna se descuenta", async () => {
    const hay = await producto(A, "Hay", 5);
    const poco = await producto(A, "Poco", 2);
    const o = await propuesta(ANA, [{ reference: hay.reference, quantity: 2 }, { reference: poco.reference, quantity: 2 }]);
    mem.inventory.setStock(poco.id, 1); // otro canal vendió una entre la propuesta y el "sí"
    await assert.rejects(confirmar(o, ANA), (e: unknown) => e instanceof OrderError && e.code === "OUT_OF_STOCK");
    assert.equal(stockDe(hay.id), 5);
    assert.equal(stockDe(poco.id), 1);
    assert.equal(orders.reservations.length, 0);
    const back = await engine.getOrder({ tenantId: A.tenantId, contact: ANA, orderId: o.orderId });
    assert.deepEqual(back.issues.map((i) => [i.code, "available" in i ? i.available : null]), [["insufficient_stock", 1]]);
  });

  it("idempotente: el mismo 'sí' dos veces (reintento de Meta / doble mensaje) descuenta una sola vez", async () => {
    const p = await producto(A, "Dije", 4);
    const o = await propuesta(ANA, [{ reference: p.reference, quantity: 3 }]);
    const [r1, r2] = await Promise.all([confirmar(o, ANA), confirmar(o, ANA).catch((e: unknown) => e)]);
    assert.equal(r1.status, "confirmed");
    assert.ok(r2 instanceof OrderError ? r2.code === "CONFLICT" : (r2 as { status: string }).status === "confirmed");
    assert.equal((await confirmar(o, ANA)).status, "confirmed", "el tercero es 'ya confirmado'");
    assert.equal(stockDe(p.id), 1);
  });

  it("sin inventario controlado no se aparta nada; producto retirado => no se confirma", async () => {
    const libre = await producto(A, "Por encargo", 0);
    mem.setStock(libre.id, false, 0);
    await confirmar(await propuesta(ANA, [{ reference: libre.reference, quantity: 3 }]), ANA);
    assert.equal(orders.reservations.length, 0);

    const retirado = await producto(A, "Retirado", 5);
    const o = await propuesta(BETO, [{ reference: retirado.reference, quantity: 1 }]);
    await admin.updateProduct(A, retirado.id, { status: "INACTIVE" });
    await assert.rejects(confirmar(o, BETO), (e: unknown) => e instanceof OrderError && e.code === "PRODUCT_UNAVAILABLE");
    assert.equal(stockDe(retirado.id), 5);
  });
});

describe("la asesora cierra el pedido; el stock vuelve cuando corresponde", () => {
  it("venta cerrada: la reserva se consume (el stock no vuelve); repetir es idempotente", async () => {
    const p = await producto(A, "Pulsera", 5);
    const o = await confirmar(await propuesta(ANA, [{ reference: p.reference, quantity: 2 }]), ANA);
    assert.deepEqual((await engine.closeOrder({ tenantId: A.tenantId, orderId: o.orderId, action: "complete" })).result, "ok");
    assert.equal(stockDe(p.id), 3);
    assert.equal(orders.reservations[0].status, "consumida");
    assert.equal((await engine.closeOrder({ tenantId: A.tenantId, orderId: o.orderId, action: "complete" })).result, "duplicate");
    await assert.rejects(engine.closeOrder({ tenantId: A.tenantId, orderId: o.orderId, action: "cancel" }), (e: unknown) => e instanceof OrderError && e.code === "INVALID_TRANSITION");
    assert.equal(stockDe(p.id), 3, "cancelar una venta cerrada no devuelve stock");
  });

  it("cancelar devuelve el stock una sola vez", async () => {
    const p = await producto(A, "Cadena", 5);
    const o = await confirmar(await propuesta(ANA, [{ reference: p.reference, quantity: 4 }]), ANA);
    assert.equal(stockDe(p.id), 1);
    await engine.closeOrder({ tenantId: A.tenantId, orderId: o.orderId, action: "cancel" });
    await engine.closeOrder({ tenantId: A.tenantId, orderId: o.orderId, action: "cancel" });
    assert.equal(stockDe(p.id), 5);
    assert.equal(orders.reservations[0].status, "liberada");
  });

  it("no se completa lo que no se confirmó; otro negocio no puede tocar el pedido", async () => {
    const p = await producto(A, "Topos", 5);
    const o = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    await assert.rejects(engine.closeOrder({ tenantId: A.tenantId, orderId: o.orderId, action: "complete" }), (e: unknown) => e instanceof OrderError && e.code === "INVALID_TRANSITION");
    await assert.rejects(engine.closeOrder({ tenantId: B.tenantId, orderId: o.orderId, action: "cancel" }), (e: unknown) => e instanceof OrderError && e.code === "NOT_FOUND");
  });
});

describe("vencimiento", () => {
  it("un confirmado sin cerrar a las 72 h vence y el stock vuelve; uno con asesora no vence solo", async () => {
    const p = await producto(A, "Argollas", 5);
    const solo = await confirmar(await propuesta(ANA, [{ reference: p.reference, quantity: 2 }]), ANA);
    const conAsesora = await confirmar(await propuesta(BETO, [{ reference: p.reference, quantity: 1 }]), BETO);
    await engine.requestHandoff({ tenantId: A.tenantId, contact: BETO, orderId: conAsesora.orderId, reason: "pago", actor: "agent" }).catch(() => undefined);
    assert.equal(stockDe(p.id), 2);

    clock += RESERVATION_TTL_MS - 60_000;
    assert.equal(await engine.expireReservations(), 0, "antes del plazo nada vence");
    clock += 120_000;
    assert.equal(await engine.expireReservations(), 1);
    assert.equal((await engine.getOrder({ tenantId: A.tenantId, contact: ANA, orderId: solo.orderId })).status, "expired");
    assert.equal((await engine.getOrder({ tenantId: A.tenantId, contact: BETO, orderId: conAsesora.orderId })).status, "handoff");
    assert.equal(stockDe(p.id), 4);
    assert.equal(await engine.expireReservations(), 0, "idempotente");
  });
});

describe("panel de pedidos de la asesora", () => {
  it("lista con el stock apartado y su vencimiento, sin ids internos; al abrirlo vence lo vencido", async () => {
    const p = await producto(A, "Solitario", 5);
    const o = await confirmar(await propuesta(ANA, [{ reference: p.reference, quantity: 2 }]), ANA);
    await propuesta(BETO, [{ reference: p.reference, quantity: 1 }]);
    const r = await listarPedidos(engine, A.tenantId);
    const body = (await r.json()) as { data: { pedidos: Array<Record<string, unknown> & { pedido: string; stock: { estado: string; unidades: number; vence: string | null } }> } };
    assert.equal(r.status, 200);
    const fila = body.data.pedidos.find((x) => x.pedido === o.orderId)!;
    assert.deepEqual(fila.stock, { estado: "apartado", unidades: 2, vence: new Date(clock + RESERVATION_TTL_MS).toISOString() });
    assert.equal(body.data.pedidos.length, 2);
    const json = JSON.stringify(body);
    assert.ok(!json.includes(A.tenantId) && !json.includes(p.id) && !json.includes(o.id), "sin negocio ni ids internos");

    clock += RESERVATION_TTL_MS + 1;
    const despues = (await (await listarPedidos(engine, A.tenantId)).json()) as { data: { pedidos: Array<{ pedido: string }> } };
    assert.ok(!despues.data.pedidos.some((x) => x.pedido === o.orderId), "el vencido ya no está abierto");
    assert.equal(stockDe(p.id), 5);
  });

  it("cerrar desde el panel: acción validada, pedido del negocio de la sesión, formato estricto", async () => {
    const p = await producto(A, "Broche", 5);
    const o = await confirmar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]), ANA);
    assert.equal((await cerrarPedido(engine, A.tenantId, o.orderId, { accion: "borrar" })).status, 400);
    assert.equal((await cerrarPedido(engine, A.tenantId, "DL-ORD-XX'--", { accion: "cancelar" })).status, 404);
    assert.equal((await cerrarPedido(engine, B.tenantId, o.orderId, { accion: "cancelar" })).status, 404, "otro negocio");
    assert.equal(stockDe(p.id), 4);
    const ok = await cerrarPedido(engine, A.tenantId, o.orderId, { accion: "completar" });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { data: { pedido: { estado: string } } }).data.pedido.estado, "completed");
    assert.equal((await cerrarPedido(null, A.tenantId, o.orderId, { accion: "cancelar" })).status, 503);
  });

  it("permisos: admin y asesora cierran pedidos; lectura solo mira", () => {
    assert.equal(decideCatalogAccess({ role: "admin", mode: "orders", moduleEnabled: true }).allowed, true);
    assert.equal(decideCatalogAccess({ role: "agente", mode: "orders", moduleEnabled: true }).allowed, true);
    assert.equal(decideCatalogAccess({ role: "lectura", mode: "orders", moduleEnabled: true }).allowed, false);
    assert.equal(decideCatalogAccess({ role: "lectura", mode: "read", moduleEnabled: true }).allowed, true);
    assert.equal(decideCatalogAccess({ role: "agente", mode: "write", moduleEnabled: true }).allowed, false, "cerrar pedidos no da permiso de editar el catálogo");
    assert.equal(decideCatalogAccess({ role: "admin", mode: "orders", moduleEnabled: false }).allowed, false);
  });
});

describe("errores de la BD traducidos (repositorio Supabase)", () => {
  it("CT010 => StockUnavailable con lo que falta; CT011 => ProductNotSellable; sin migración de reservas => [] / 0", async () => {
    const db = installSupabaseMemoria(process.env.SUPABASE_URL);
    try {
      const repo = createSupabaseOrdersRepository(supabaseAdmin());
      const input = { businessId: A.tenantId, id: "00000000-0000-4000-8000-000000000001", from: "pending_confirmation" as const, to: "confirmed" as const, actor: "agent" as const, changes: {}, event: null };
      db.rpc("dulabs_catalogo_pedido_transicion", () => ({ error: { code: "CT010", message: "stock_insuficiente", details: '[{"referencia": "DL-000002", "pedido": 2, "disponible": 1}]' } }));
      await assert.rejects(repo.transition(input), (e: unknown) => e instanceof StockUnavailable && e.shortages[0].reference === "DL-000002" && e.shortages[0].available === 1 && e.shortages[0].requested === 2);
      db.rpc("dulabs_catalogo_pedido_transicion", () => ({ error: { code: "CT011", message: "producto_no_disponible", details: '["DL-000004"]' } }));
      await assert.rejects(repo.transition(input), (e: unknown) => e instanceof ProductNotSellable && e.references[0] === "DL-000004");
      assert.deepEqual(await repo.reservationsFor(A.tenantId, ["00000000-0000-4000-8000-000000000001"]), []);
      assert.equal(await repo.expireReservations(10), 0);
      db.rpc("dulabs_catalogo_reservas_vencer", (args) => ({ data: Number(args.p_limite) === 10 ? 3 : -1 }));
      assert.equal(await repo.expireReservations(10), 3);
    } finally {
      db.uninstall();
    }
  });
});
