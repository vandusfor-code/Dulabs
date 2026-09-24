/**
 * Bloque 21 — HISTORIAL de pedidos cerrados del panel (cursor/keyset). Motor + adaptador HTTP con
 * el repositorio en memoria (misma regla de inventario), y el repositorio SUPABASE contra el
 * PostgREST en memoria (la consulta real del cursor: marcas con microsegundos y empates).
 * Recorrido real contra Postgres: supabase/tests/20261118000000_*.test.sql y scripts/perf/bench.ts.
 * Nada toca Supabase.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository, createSupabaseOrdersRepository, RESERVATION_TTL_MS } from "@/lib/catalogo/pedidos/repositorio";
import { codificarCursor, decodificarCursor, listarHistorial, type PedidoHistorial } from "@/lib/catalogo/pedidos/panel";
import { supabaseAdmin } from "@/lib/supabase";
import { installSupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const ANA = { phoneNumberId: "100000000000001", waId: "573001110001" };

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

async function pedidoConfirmado(tenantId: string, reference: string, quantity = 1) {
  const { order } = await engine.createOrder({ tenantId, channel: "retail", source: "agent", contact: ANA, items: [{ reference, quantity }], idempotencyKey: `agent:h${++seq}` });
  await engine.confirmOrder({ tenantId, contact: ANA, orderId: order.orderId, confirmationId: order.confirmation!.id, actor: "agent" });
  return order;
}

async function historial(tenantId: string, query = ""): Promise<{ status: number; body: { data?: { pedidos: PedidoHistorial[]; siguiente: string | null }; error?: { code: string } } }> {
  const r = await listarHistorial(engine, tenantId, new URLSearchParams(query));
  return { status: r.status, body: (await r.json()) as never };
}

async function recorrer(tenantId: string, extra = "", limite = 2): Promise<PedidoHistorial[]> {
  const todos: PedidoHistorial[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 100; i++) {
    const r = await historial(tenantId, `limite=${limite}${extra}${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    todos.push(...r.body.data!.pedidos);
    cursor = r.body.data!.siguiente;
    if (!cursor) return todos;
  }
  throw new Error("el cursor no termina");
}

describe("historial de pedidos cerrados", () => {
  it("solo cerrados (vendido / devuelto / vencido), más recientes primero, página por página sin repetir ni saltar", async () => {
    const p = await admin.createProduct(A, { name: "Anillo Luna", retailPrice: 50_000, stock: 50 });
    const vendido = await pedidoConfirmado(A.tenantId, p.reference, 2);
    await engine.closeOrder({ tenantId: A.tenantId, orderId: vendido.orderId, action: "complete" });
    clock += 60_000;
    const cancelado = await pedidoConfirmado(A.tenantId, p.reference, 3);
    await engine.closeOrder({ tenantId: A.tenantId, orderId: cancelado.orderId, action: "cancel" });
    clock += 60_000;
    const vencido = await pedidoConfirmado(A.tenantId, p.reference, 1);
    clock += RESERVATION_TTL_MS + 60_000;
    await engine.expireReservations();
    clock += 60_000;
    const abierto = await pedidoConfirmado(A.tenantId, p.reference, 1); // sigue abierto: NO va al historial
    const sinConfirmar = (await engine.createOrder({ tenantId: A.tenantId, channel: "retail", source: "agent", contact: ANA, items: [{ reference: p.reference, quantity: 1 }], idempotencyKey: "agent:nc" })).order;
    await engine.closeOrder({ tenantId: A.tenantId, orderId: sinConfirmar.orderId, action: "cancel" });

    const todos = await recorrer(A.tenantId, "", 2);
    assert.deepEqual(
      todos.map((x) => [x.pedido, x.estado, x.stock.estado, x.stock.unidades]),
      [
        [sinConfirmar.orderId, "cancelled", "sin_reserva", 0],
        [vencido.orderId, "expired", "devuelto", 1],
        [cancelado.orderId, "cancelled", "devuelto", 3],
        [vendido.orderId, "completed", "vendido", 2],
      ],
    );
    assert.ok(!todos.some((x) => x.pedido === abierto.orderId), "los abiertos siguen en la otra pestaña");
    assert.equal(todos[3].total, 100_000);
    assert.ok(todos.every((x) => typeof x.cerrado === "string" && !Number.isNaN(Date.parse(x.cerrado))));
  });

  it("filtro por estado y nunca pedidos de otro negocio (aunque el cursor venga de otro negocio)", async () => {
    const pa = await admin.createProduct(A, { name: "Aretes", retailPrice: 30_000, stock: 20 });
    const pb = await admin.createProduct(B, { name: "Aretes", retailPrice: 30_000, stock: 20 });
    for (let i = 0; i < 3; i++) {
      const a = await pedidoConfirmado(A.tenantId, pa.reference);
      await engine.closeOrder({ tenantId: A.tenantId, orderId: a.orderId, action: i === 0 ? "cancel" : "complete" });
      const b = await pedidoConfirmado(B.tenantId, pb.reference);
      await engine.closeOrder({ tenantId: B.tenantId, orderId: b.orderId, action: "complete" });
      clock += 1000;
    }
    const soloVentas = await recorrer(A.tenantId, "&estado=completed", 1);
    assert.equal(soloVentas.length, 2);
    assert.ok(soloVentas.every((x) => x.estado === "completed"));
    const deB = await recorrer(B.tenantId);
    const deA = await recorrer(A.tenantId);
    assert.equal(deB.length, 3);
    assert.ok(deB.every((x) => !deA.some((y) => y.pedido === x.pedido)), "aislado por negocio");
    // Un cursor de A usado por B solo posiciona: B sigue viendo SOLO lo suyo.
    const paginaA = await historial(A.tenantId, "limite=1");
    const conCursorDeA = await historial(B.tenantId, `limite=50&cursor=${paginaA.body.data!.siguiente}`);
    assert.equal(conCursorDeA.status, 200);
    assert.ok(conCursorDeA.body.data!.pedidos.every((x) => deB.some((y) => y.pedido === x.pedido)));
  });

  it("muchos pedidos en el MISMO instante: el desempate por número público no repite ni pierde ninguno", async () => {
    const p = await admin.createProduct(A, { name: "Dije", retailPrice: 10_000, stock: 100 });
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) {
      const o = await pedidoConfirmado(A.tenantId, p.reference);
      await engine.closeOrder({ tenantId: A.tenantId, orderId: o.orderId, action: "cancel" });
      ids.push(o.orderId);
    }
    const todos = await recorrer(A.tenantId, "", 3);
    assert.deepEqual(todos.map((x) => x.pedido).sort(), [...ids].sort());
    assert.equal(new Set(todos.map((x) => x.pedido)).size, 11);
  });

  it("sin datos internos: ni ids de pedido/negocio, ni confirmación, ni eventos", async () => {
    const p = await admin.createProduct(A, { name: "Pulsera", retailPrice: 20_000, stock: 5 });
    const o = await pedidoConfirmado(A.tenantId, p.reference);
    await engine.closeOrder({ tenantId: A.tenantId, orderId: o.orderId, action: "complete" });
    const r = await historial(A.tenantId);
    const texto = JSON.stringify(r.body);
    const interno = (await orders.getByOrderId(A.tenantId, o.orderId))!;
    assert.doesNotMatch(texto, new RegExp(`${interno.id}|${A.tenantId}|${interno.confirmation!.id}|${p.id}`));
    assert.deepEqual(Object.keys(r.body.data!.pedidos[0]).sort(), ["canal", "cerrado", "cliente", "creado", "estado", "actualizado", "lineas", "origen", "pedido", "sin_precio", "stock", "total", "unidades"].sort());
  });

  it("entradas inválidas: 400 sin interpretar nada; cursor manipulado rechazado", async () => {
    for (const q of ["estado=confirmed", "estado=x", "limite=0", "limite=51", "limite=abc", "limite=2.5", "cursor=%%%", "cursor=" + "a".repeat(300)]) {
      assert.equal((await historial(A.tenantId, q)).status, 400, q);
    }
    const falsos = [
      Buffer.from("no-json").toString("base64url"),
      Buffer.from(JSON.stringify({ c: "2026-09-24T12:00:00Z", p: "no-es-un-pedido" })).toString("base64url"),
      Buffer.from(JSON.stringify({ c: '2026-09-24T12:00:00Z",id_tenant.eq.bbbbbbbb', p: "DL-ORD-ABCDEF" })).toString("base64url"),
      Buffer.from(JSON.stringify({ c: "ayer", p: "DL-ORD-ABCDEF" })).toString("base64url"),
      Buffer.from(JSON.stringify({ c: "2026-13-45T99:00:00Z", p: "DL-ORD-ABCDEF" })).toString("base64url"),
    ];
    for (const c of falsos) {
      assert.equal(decodificarCursor(c), null, c);
      assert.equal((await historial(A.tenantId, `cursor=${c}`)).status, 400);
    }
    const ok = { createdAt: "2026-09-24T12:00:00.123456+00:00", orderId: "DL-ORD-ABCDEF" };
    assert.deepEqual(decodificarCursor(codificarCursor(ok)), ok, "ida y vuelta exacta (microsegundos)");
    assert.equal((await listarHistorial(null, A.tenantId, new URLSearchParams())).status, 503);
  });
});

describe("repositorio Supabase: la consulta del cursor (PostgREST en memoria)", () => {
  it("marcas con microsegundos y empates: recorre exacto, filtra por negocio y usa lte + or", async () => {
    const db = installSupabaseMemoria(process.env.SUPABASE_URL);
    try {
      db.table("dulabs_catalogo_pedidos");
      const fila = (tenant: string, n: number, created: string, estado = "completed") => ({
        id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
        id_tenant: tenant,
        pedido_publico: `DL-ORD-${String(n).padStart(6, "0").replace(/[01]/g, "A")}`,
        canal: "retail",
        origen: "agent",
        estado,
        clave_idempotencia: `k-${tenant}-${n}`,
        huella_solicitud: null,
        contacto_phone_number_id: "100000000000001",
        contacto_wa_id: "573001110001",
        lineas: [],
        total_unidades: 0,
        total: 0,
        unidades_sin_precio: 0,
        problemas: [],
        confirmacion: null,
        handoff: null,
        created_at: created,
        updated_at: created,
      });
      const marcas = ["2026-09-24T12:00:00.000001+00:00", "2026-09-24T12:00:00.000002+00:00", "2026-09-24T12:00:00.000002+00:00", "2026-09-24T12:00:00.000002+00:00", "2026-09-24T12:00:00.000009+00:00"];
      marcas.forEach((m, i) => db.rows("dulabs_catalogo_pedidos").push(fila(A.tenantId, i + 2, m)));
      db.rows("dulabs_catalogo_pedidos").push(fila(A.tenantId, 90, "2026-09-24T12:00:00.000005+00:00", "confirmed"));
      db.rows("dulabs_catalogo_pedidos").push(fila(B.tenantId, 91, "2026-09-24T12:00:00.000003+00:00"));

      const repo = createSupabaseOrdersRepository(supabaseAdmin());
      const vistos: string[] = [];
      let before: { createdAt: string; orderId: string } | null = null;
      for (let i = 0; i < 10; i++) {
        const page = await repo.listClosed(A.tenantId, { statuses: ["completed", "cancelled", "expired"], before, limit: 2 });
        vistos.push(...page.map((x) => x.order.orderId));
        if (page.length < 2) break;
        const last = page.at(-1)!;
        before = { createdAt: last.createdAtRaw, orderId: last.order.orderId };
        assert.match(last.createdAtRaw, /\.\d{6}\+00:00$/, "el cursor conserva los microsegundos");
      }
      assert.equal(vistos.length, 5);
      assert.equal(new Set(vistos).size, 5);
      const conCursor = db.requests.filter((r) => r.path.endsWith("/dulabs_catalogo_pedidos") && r.query.get("or"));
      assert.ok(conCursor.length > 0);
      for (const r of conCursor) {
        assert.equal(r.query.get("id_tenant"), `eq.${A.tenantId}`);
        assert.match(r.query.get("created_at") ?? "", /^lte\./);
        assert.match(r.query.get("or") ?? "", /^\(created_at\.lt\."[^"]+",pedido_publico\.lt\."DL-ORD-[A-Z0-9]{6}"\)$/);
      }
    } finally {
      db.uninstall();
    }
  });
});
