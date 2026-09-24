/**
 * Bloque 23 — basura operativa de pedidos:
 *
 *   - un pedido SIN ningún producto existente nunca se guarda (antes: borrador con 0 líneas);
 *   - un pedido de conversación sin confirmar (borrador, validado o propuesta sin "sí") que lleva
 *     72 h sin cambios vence (actor sistema, con evento): no queda "abierto" en el panel ni como
 *     pedido activo de la conversación semanas después. Confirmados (tienen su propio vencimiento
 *     por la reserva), con asesora (handoff) y solicitudes del catálogo nunca reclamadas: no.
 *
 * Motor + repositorio en memoria (la misma máquina de estados que la BD) y el repositorio de
 * Supabase contra el PostgREST en memoria para la consulta real. Nada toca Supabase.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { ABANDONED_ORDER_MS, OrderError, createOrderEngine, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository, createSupabaseOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { listarPedidos } from "@/lib/catalogo/pedidos/panel";
import { supabaseAdmin } from "@/lib/supabase";
import { installSupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const ANA = { phoneNumberId: "100000000000001", waId: "573001110001" };
const BETO = { phoneNumberId: "100000000000001", waId: "573001110002" };
const HORA = 60 * 60 * 1000;

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let orders: ReturnType<typeof createMemoryOrdersRepository>;
let sink: ReturnType<typeof memoryOrderEventSink>;
let engine: OrderEngine;
let clock: number;
let seq: number;

beforeEach(() => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  clock = Date.parse("2026-09-24T12:00:00Z");
  orders = createMemoryOrdersRepository({ inventory: mem.inventory, now: () => clock });
  sink = memoryOrderEventSink();
  engine = createOrderEngine({
    orders,
    catalog: mem.repo,
    key: Buffer.alloc(32, 3),
    sink,
    log: () => {},
    now: () => new Date(clock),
    handoff: { pauseConversation: async () => ({ ok: true }) },
  });
  for (const actor of [A, B]) mem.enableModule(actor.tenantId);
  seq = 0;
});

const producto = (actor: CatalogActor, name: string, stock = 5) => admin.createProduct(actor, { name, retailPrice: 50_000, stock });
const crear = (contact: typeof ANA, items: Array<{ reference: string; quantity: number }>, tenant = A.tenantId) =>
  engine.createOrder({ tenantId: tenant, channel: "retail", source: "agent", contact, items, idempotencyKey: `agent:k${++seq}` });
const estadoDe = (orderId: string) => orders.orders.find((o) => o.orderId === orderId)!.status;

describe("un pedido sin ningún producto existente nunca se guarda", () => {
  it("todos los productos de la selección se borraron: error REFERENCE_NOT_FOUND con las referencias; cero pedidos", async () => {
    const p = await producto(A, "Aretes Luna");
    mem.hardDelete(p.id);
    await assert.rejects(crear(ANA, [{ reference: p.reference, quantity: 1 }]), (e: unknown) => {
      assert.ok(e instanceof OrderError);
      assert.equal(e.code, "REFERENCE_NOT_FOUND");
      assert.deepEqual(e.details?.references, [p.reference]);
      return true;
    });
    assert.equal(orders.orders.length, 0);
    assert.equal(sink.events.length, 0, "ni un evento de creación");
  });

  it("parcialmente inválido (uno existe, otro no): SÍ se guarda, como borrador con el problema (el cliente decide)", async () => {
    const vivo = await producto(A, "Aretes Sol");
    const borrado = await producto(A, "Aretes Luna");
    mem.hardDelete(borrado.id);
    const { order } = await crear(ANA, [
      { reference: vivo.reference, quantity: 1 },
      { reference: borrado.reference, quantity: 1 },
    ]);
    assert.equal(order.status, "draft");
    assert.deepEqual(order.lines.map((l) => l.reference), [vivo.reference]);
    assert.deepEqual(order.issues.map((i) => i.code), ["reference_not_found"]);
  });
});

describe("pedidos abandonados vencen a las 72 h sin cambios", () => {
  it("propuesta sin 'sí': a las 71 h sigue abierta; a las 73 h vence (evento con motivo), deja de ser el pedido activo y del panel; idempotente", async () => {
    const p = await producto(A, "Anillo Sol");
    const { order } = await crear(ANA, [{ reference: p.reference, quantity: 1 }]);
    assert.equal(order.status, "pending_confirmation");
    clock += 71 * HORA;
    assert.equal(await engine.expireAbandonedOrders(), 0, "antes del plazo nada vence");
    clock += 2 * HORA;
    assert.equal(await engine.expireAbandonedOrders(), 1);
    assert.equal(estadoDe(order.orderId), "expired");
    const ev = sink.events.at(-1)!;
    assert.deepEqual([ev.event_type, ev.transition?.from, ev.transition?.to, ev.transition?.actor, ev.transition?.reason], ["order.status_changed", "pending_confirmation", "expired", "system", "abandoned"]);
    assert.equal(orders.orders.find((o) => o.orderId === order.orderId)!.confirmation, null, "la propuesta ya no es confirmable");
    await assert.rejects(engine.getOrder({ tenantId: A.tenantId, contact: ANA }), (e: unknown) => e instanceof OrderError && e.code === "NOT_FOUND", "la conversación ya no tiene pedido activo");
    await assert.rejects(
      engine.confirmOrder({ tenantId: A.tenantId, contact: ANA, orderId: order.orderId, confirmationId: order.confirmation!.id, actor: "agent" }),
      (e: unknown) => e instanceof OrderError && e.code === "INVALID_TRANSITION",
      "un 'sí' tardío no confirma un pedido vencido",
    );
    assert.equal(mem.inventory.stockOf(p.id), 5, "nada apartado");
    assert.equal(await engine.expireAbandonedOrders(), 0, "idempotente");
  });

  it("borrador con problemas también vence; confirmado, con asesora y solicitudes del catálogo NO", async () => {
    const p = await producto(A, "Aretes Luna", 10);
    const borrado = await producto(A, "Aretes Borrados");
    mem.hardDelete(borrado.id);
    const borrador = (await crear(ANA, [{ reference: p.reference, quantity: 1 }, { reference: borrado.reference, quantity: 1 }])).order;
    const confirmado = (await crear(BETO, [{ reference: p.reference, quantity: 1 }])).order;
    await engine.confirmOrder({ tenantId: A.tenantId, contact: BETO, orderId: confirmado.orderId, confirmationId: confirmado.confirmation!.id, actor: "agent" });
    const CARLA = { ...ANA, waId: "573001110003" };
    const conAsesora = (await crear(CARLA, [{ reference: p.reference, quantity: 1 }])).order;
    await engine.requestHandoff({ tenantId: A.tenantId, contact: CARLA, orderId: conAsesora.orderId, reason: "pago", actor: "agent" });
    const catalogo = await engine.recordCatalogRequest({
      tenantId: A.tenantId,
      channel: "retail",
      lines: [{ reference: p.reference, productName: "Aretes Luna", quantity: 1, unitPrice: 50_000, subtotal: 50_000 }],
      idempotencyKey: "catalog:k1",
      orderIdFor: () => "DL-ORD-7K4M2Q",
    });
    assert.ok(catalogo);
    clock += ABANDONED_ORDER_MS + HORA;
    assert.equal(await engine.expireAbandonedOrders(), 1);
    assert.equal(estadoDe(borrador.orderId), "expired");
    assert.equal(estadoDe(confirmado.orderId), "confirmed", "lo vence su reserva (Bloque 19), no esta regla");
    assert.equal(estadoDe(conAsesora.orderId), "handoff", "con una asesora nunca vence solo");
    assert.equal(estadoDe(catalogo!.orderId), "validated", "solicitud del catálogo sin conversación: no se toca");
  });

  it("el cliente escribió (el pedido cambió) poco antes: NO vence; el plazo cuenta desde el último cambio", async () => {
    const p = await producto(A, "Anillo Luna");
    const { order } = await crear(ANA, [{ reference: p.reference, quantity: 1 }]);
    clock += 70 * HORA;
    await engine.validateOrder({ tenantId: A.tenantId, contact: ANA, orderId: order.orderId, actor: "agent" }); // renueva la propuesta
    clock += 5 * HORA; // 75 h desde la creación, 5 h desde el último cambio
    assert.equal(await engine.expireAbandonedOrders(), 0);
    assert.equal(estadoDe(order.orderId), "pending_confirmation");
  });

  it("abrir el panel vence los abandonados SOLO de ese negocio (el cron vence todos)", async () => {
    const pa = await producto(A, "Aretes A");
    const pb = await producto(B, "Aretes B");
    const deA = (await crear(ANA, [{ reference: pa.reference, quantity: 1 }])).order;
    const deB = (await crear(ANA, [{ reference: pb.reference, quantity: 1 }], B.tenantId)).order;
    clock += ABANDONED_ORDER_MS + HORA;
    const r = await listarPedidos(engine, A.tenantId);
    assert.equal(r.status, 200);
    assert.deepEqual(((await r.json()) as { data: { pedidos: unknown[] } }).data.pedidos, [], "el panel ya no muestra la propuesta abandonada");
    assert.equal(estadoDe(deA.orderId), "expired");
    assert.equal(estadoDe(deB.orderId), "pending_confirmation", "otro negocio: intacto");
    assert.equal(await engine.expireAbandonedOrders(), 1);
    assert.equal(estadoDe(deB.orderId), "expired");
  });
});

describe("repositorio de Supabase: la consulta de abandonados", () => {
  it("filtra estado, antigüedad, contacto presente y (opcional) negocio; los más viejos primero", async () => {
    const db = installSupabaseMemoria(process.env.SUPABASE_URL);
    try {
      const base = { canal: "retail", origen: "agent", clave_idempotencia: "k", huella_solicitud: "h", lineas: [], total_unidades: 0, total: 0, unidades_sin_precio: 0, moneda: "COP", problemas: [], confirmacion: null, handoff: null };
      const fila = (n: number, estado: string, updated: string, extra: Record<string, unknown> = {}) => ({
        ...base,
        id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
        id_tenant: A.tenantId,
        pedido_publico: `DL-ORD-00000${n}`,
        estado,
        contacto_phone_number_id: ANA.phoneNumberId,
        contacto_wa_id: ANA.waId,
        created_at: updated,
        updated_at: updated,
        ...extra,
      });
      db.table("dulabs_catalogo_pedidos").push(
        fila(1, "pending_confirmation", "2026-09-20T00:00:00.000Z"),
        fila(2, "draft", "2026-09-19T00:00:00.000Z"),
        fila(3, "confirmed", "2026-09-18T00:00:00.000Z"),
        fila(4, "validated", "2026-09-17T00:00:00.000Z", { contacto_phone_number_id: null, contacto_wa_id: null, origen: "catalog" }),
        fila(5, "pending_confirmation", "2026-09-24T00:00:00.000Z"),
        fila(6, "draft", "2026-09-16T00:00:00.000Z", { id_tenant: B.tenantId }),
      );
      const repo = createSupabaseOrdersRepository(supabaseAdmin());
      const q = { statuses: ["draft", "validated", "pending_confirmation"] as const, updatedBefore: "2026-09-21T00:00:00.000Z", limit: 50 };
      assert.deepEqual((await repo.listStale(q)).map((o) => o.orderId), ["DL-ORD-000006", "DL-ORD-000002", "DL-ORD-000001"]);
      assert.deepEqual((await repo.listStale({ ...q, businessId: A.tenantId })).map((o) => o.orderId), ["DL-ORD-000002", "DL-ORD-000001"]);
      const consulta = db.requests.filter((r) => r.path.endsWith("/dulabs_catalogo_pedidos")).at(-1)!.query;
      assert.equal(consulta.get("contacto_wa_id"), "not.is.null");
    } finally {
      db.uninstall();
    }
  });
});
