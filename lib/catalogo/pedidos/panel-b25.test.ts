/**
 * Bloque 25 — panel de pedidos de la asesora: cliente (nombre, modalidad detal / mayorista,
 * teléfono solo para quien atiende), fechas, fotos, asesora; y el CAMBIO DE MODALIDAD de un
 * cliente (solo admin / agente, con motivo, compare-and-set, del negocio de la sesión).
 * Motor y catálogo en memoria; las fuentes reales contra el PostgREST en memoria. Nada toca Supabase.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { listarHistorial, listarPedidos, type PanelFuentes, type PedidoHistorial, type PedidoPanel } from "@/lib/catalogo/pedidos/panel";
import { productionPanelFuentes } from "@/lib/catalogo/pedidos/panel-fuentes";
import { cambiarCanalCliente } from "@/lib/catalogo/pedidos/clientes-canal";
import { decideCatalogAccess } from "@/lib/catalogo/auth";
import { createMemoryCustomerChannelStore, createSupabaseCustomerChannelStore } from "@/lib/agente/clasificacion";
import { supabaseAdmin } from "@/lib/supabase";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const PN_A = "100000000000001";
const PN_B = "100000000000002";
const ANA = { phoneNumberId: PN_A, waId: "573001110001" };
const LUIS = { phoneNumberId: PN_A, waId: "573001110002" };

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let orders: ReturnType<typeof createMemoryOrdersRepository>;
let engine: OrderEngine;
let canales: ReturnType<typeof createMemoryCustomerChannelStore>;
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
    key: Buffer.alloc(32, 3),
    log: () => {},
    now: () => new Date(clock),
    handoff: { pauseConversation: async () => ({ ok: true }) },
  });
  for (const actor of [A, B]) mem.enableModule(actor.tenantId);
  canales = createMemoryCustomerChannelStore({ [PN_A]: A.tenantId, [PN_B]: B.tenantId });
  seq = 0;
});

/** Fuentes en memoria con la MISMA forma que las reales. */
function fuentes(over: Partial<PanelFuentes> = {}): PanelFuentes & { confirmedAt: Map<string, string> } {
  const confirmedAt = new Map<string, string>();
  return {
    confirmedAt,
    nombres: async () => new Map([[`${PN_A}|${ANA.waId}`, "Ana Pérez"]]),
    canales: async (tenantId, cs) => {
      const out = new Map();
      for (const c of cs) {
        const x = await canales.get({ tenantId, ...c });
        if (x) out.set(`${c.phoneNumberId}|${c.waId}`, x);
      }
      return out;
    },
    confirmados: async (_t, ids) => new Map([...confirmedAt].filter(([id]) => ids.includes(id))),
    asignadas: async () => new Map([[`${PN_A}|${ANA.waId}`, "Carolina"]]),
    fotos: async (_t, refs) => new Map(refs.map((r) => [r, `https://img.test/${r}.webp`])),
    ...over,
  };
}

async function crear(contact: typeof ANA, reference: string, quantity: number, channel: "retail" | "wholesale" = "retail") {
  return (await engine.createOrder({ tenantId: A.tenantId, channel, source: "agent", contact, items: [{ reference, quantity }], idempotencyKey: `agent:b25-${++seq}` })).order;
}

async function abiertos(f: PanelFuentes | null, verTelefono = true): Promise<PedidoPanel[]> {
  const r = await listarPedidos(engine, A.tenantId, f ? { fuentes: f, verTelefono } : undefined);
  assert.equal(r.status, 200);
  return ((await r.json()) as { data: { pedidos: PedidoPanel[] } }).data.pedidos;
}

describe("B25 · panel de pedidos: cliente, modalidad, fechas, fotos y asesora", () => {
  it("cada pedido trae lo que la asesora necesita; nunca ids internos", async () => {
    const p = await admin.createProduct(A, { name: "Anillo Luna", retailPrice: 50_000, wholesalePrice: 30_000, stock: 10 });
    await canales.setInitial({ tenantId: A.tenantId, ...ANA }, "wholesale", "cliente");
    const f = fuentes();
    // Confirmado (reserva) de Ana, propuesta de Luis, y un pedido con asesora.
    const conf = await crear(ANA, p.reference, 2, "wholesale");
    await engine.confirmOrder({ tenantId: A.tenantId, contact: ANA, orderId: conf.orderId, confirmationId: conf.confirmation!.id, actor: "agent" });
    f.confirmedAt.set(conf.id, "2026-09-24T12:05:00.000Z");
    const prop = await crear(LUIS, p.reference, 1);
    const pedidos = await abiertos(f);
    const c = pedidos.find((x) => x.pedido === conf.orderId)!;
    assert.deepEqual(c.contacto, { numero: PN_A, telefono: ANA.waId, telefono_parcial: "0001", nombre: "Ana Pérez", tipo: "wholesale", tipo_origen: "cliente", tipo_desde: c.contacto!.tipo_desde });
    assert.equal(c.canal, "wholesale", "tipo de precio del pedido");
    assert.equal(c.confirmado, "2026-09-24T12:05:00.000Z");
    assert.equal(c.vence, c.stock.vence, "confirmado: vence la reserva");
    assert.equal(c.stock.estado, "apartado");
    assert.deepEqual(c.lineas.map((l) => [l.referencia, l.cantidad, l.precio_unitario, l.subtotal, l.foto]), [[p.reference, 2, 30_000, 60_000, `https://img.test/${p.reference}.webp`]]);
    assert.deepEqual(c.asesora, { motivo: null, pedida_por: null, desde: null, asignada: "Carolina" });
    const l = pedidos.find((x) => x.pedido === prop.orderId)!;
    assert.equal(l.contacto?.tipo, null, "sin clasificar");
    assert.equal(l.vence, prop.confirmation!.expiresAt, "propuesta: vence la propuesta");
    assert.equal(l.asesora, null);
    const json = JSON.stringify(pedidos);
    for (const interno of [conf.id, prop.id, A.tenantId]) assert.ok(!json.includes(interno), `sin id interno ${interno}`);
  });

  it("pedido con asesora: motivo, quién la pidió y desde cuándo (del motor)", async () => {
    const p = await admin.createProduct(A, { name: "Aretes", retailPrice: 20_000, stock: 5 });
    const o = await crear(LUIS, p.reference, 1);
    await engine.requestHandoff({ tenantId: A.tenantId, contact: LUIS, orderId: o.orderId, reason: "Pedido DL mayorista de un cliente registrado al detal", actor: "system" });
    const [x] = await abiertos(fuentes());
    assert.equal(x.estado, "handoff");
    assert.deepEqual([x.asesora?.motivo, x.asesora?.pedida_por, typeof x.asesora?.desde], ["Pedido DL mayorista de un cliente registrado al detal", "system", "string"]);
  });

  it("rol de solo lectura: sin teléfono completo (solo los últimos 4)", async () => {
    const p = await admin.createProduct(A, { name: "Aretes", retailPrice: 20_000, stock: 5 });
    await crear(ANA, p.reference, 1);
    const [x] = await abiertos(fuentes(), false);
    assert.equal(x.cliente, null);
    assert.equal(x.contacto?.telefono, null);
    assert.equal(x.contacto?.telefono_parcial, "0001");
    assert.ok(!JSON.stringify(x).includes(ANA.waId));
  });

  it("si una fuente falla, el panel igual responde (lo que falta queda en null)", async () => {
    const p = await admin.createProduct(A, { name: "Aretes", retailPrice: 20_000, stock: 5 });
    await crear(ANA, p.reference, 1);
    const falla = async () => {
      throw new Error("tabla ausente");
    };
    const [x] = await abiertos(fuentes({ canales: falla, nombres: falla, fotos: falla, asignadas: falla, confirmados: falla }));
    assert.deepEqual([x.contacto?.nombre, x.contacto?.tipo, x.lineas[0].foto, x.asesora], [null, null, null, null]);
    assert.equal(x.contacto?.telefono, ANA.waId);
  });

  it("sin extras, el panel responde EXACTAMENTE como antes (compatibilidad)", async () => {
    const p = await admin.createProduct(A, { name: "Aretes", retailPrice: 20_000, stock: 5 });
    await crear(ANA, p.reference, 1);
    const [x] = await abiertos(null);
    assert.equal(x.cliente, ANA.waId);
    assert.equal("contacto" in x, false);
    assert.equal("foto" in x.lineas[0], false);
  });

  it("historial: venta cerrada, cancelado y vencido con cliente, modalidad y fotos", async () => {
    const p = await admin.createProduct(A, { name: "Anillo", retailPrice: 50_000, stock: 10 });
    await canales.setInitial({ tenantId: A.tenantId, ...ANA }, "retail", "cliente");
    const v = await crear(ANA, p.reference, 1);
    await engine.confirmOrder({ tenantId: A.tenantId, contact: ANA, orderId: v.orderId, confirmationId: v.confirmation!.id, actor: "agent" });
    await engine.closeOrder({ tenantId: A.tenantId, orderId: v.orderId, action: "complete" });
    const c = await crear(ANA, p.reference, 1);
    await engine.closeOrder({ tenantId: A.tenantId, orderId: c.orderId, action: "cancel" });
    const e = await crear(ANA, p.reference, 1);
    clock += 73 * 3_600_000;
    await engine.expireAbandonedOrders({ businessId: A.tenantId });
    const r = await listarHistorial(engine, A.tenantId, new URLSearchParams(), { fuentes: fuentes(), verTelefono: true });
    const h = ((await r.json()) as { data: { pedidos: PedidoHistorial[] } }).data.pedidos;
    assert.deepEqual(
      new Map(h.map((x) => [x.pedido, [x.estado, x.contacto?.tipo, x.lineas[0].foto !== null]])),
      new Map([
        [v.orderId, ["completed", "retail", true]],
        [c.orderId, ["cancelled", "retail", true]],
        [e.orderId, ["expired", "retail", true]],
      ]),
    );
  });
});

describe("B25 · cambio de modalidad (API)", () => {
  const sesion = { tenantId: A.tenantId, memberId: 41 };
  const deps = () => ({ store: canales, numeroDelNegocio: async (t: string, pn: string) => (t === A.tenantId && pn === PN_A) || (t === B.tenantId && pn === PN_B) });
  const body = (over: Record<string, unknown> = {}) => ({ numero: PN_A, telefono: ANA.waId, canal: "wholesale", canal_actual: "retail", motivo: "Tiene NIT, compra por docena", ...over });
  const leer = async (r: Response) => ({ status: r.status, body: (await r.json()) as { data?: { resultado: string; canal: string }; error?: { code: string; message: string } } });

  it("solo admin y agente (lectura no puede)", () => {
    assert.equal(decideCatalogAccess({ role: "lectura", mode: "orders", moduleEnabled: true }).allowed, false);
    assert.equal(decideCatalogAccess({ role: "agente", mode: "orders", moduleEnabled: true }).allowed, true);
    assert.equal(decideCatalogAccess({ role: "admin", mode: "orders", moduleEnabled: true }).allowed, true);
  });

  it("explícito y trazable: con motivo, quién y de qué a qué", async () => {
    await canales.setInitial({ tenantId: A.tenantId, ...ANA }, "retail", "cliente");
    const r = await leer(await cambiarCanalCliente(deps(), sesion, body()));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, { resultado: "cambiado", canal: "wholesale" });
    const [ev] = await canales.history({ tenantId: A.tenantId, ...ANA });
    assert.deepEqual([ev.from, ev.to, ev.origin, ev.memberId, ev.reason], ["retail", "wholesale", "asesora", 41, "Tiene NIT, compra por docena"]);
  });

  it("si cambió mientras tanto: 409 y no toca nada; sin motivo o con datos extra: 400", async () => {
    await canales.setInitial({ tenantId: A.tenantId, ...ANA }, "wholesale", "cliente");
    const r = await leer(await cambiarCanalCliente(deps(), sesion, body({ canal: "retail", canal_actual: "retail" })));
    assert.equal(r.status, 409);
    assert.match(r.body.error!.message, /al por mayor/);
    assert.equal((await canales.get({ tenantId: A.tenantId, ...ANA }))?.channel, "wholesale");
    assert.equal((await leer(await cambiarCanalCliente(deps(), sesion, body({ motivo: "  " })))).status, 400);
    assert.equal((await leer(await cambiarCanalCliente(deps(), sesion, body({ precio: 1 })))).status, 400, "no acepta otros campos (stock, precio…)");
    assert.equal((await leer(await cambiarCanalCliente(deps(), sesion, body({ telefono: "+57 300" })))).status, 400);
  });

  it("aislamiento: un número de OTRO negocio => 404, sin tocar nada", async () => {
    const r = await leer(await cambiarCanalCliente(deps(), sesion, body({ numero: PN_B, canal_actual: null })));
    assert.equal(r.status, 404);
    assert.equal(canales.rows.size, 0);
  });

  it("sin clasificar: la asesora lo clasifica (canal_actual null)", async () => {
    const r = await leer(await cambiarCanalCliente(deps(), sesion, body({ canal_actual: null })));
    assert.deepEqual(r.body.data, { resultado: "cambiado", canal: "wholesale" });
  });
});

describe("B25 · adaptadores Supabase (PostgREST en memoria)", () => {
  let db: SupabaseMemoria;
  beforeEach(() => {
    db = installSupabaseMemoria();
  });
  afterEach(() => db.uninstall());

  it("clasificación: lectura acotada al negocio y RPC con los parámetros exactos", async () => {
    db.table("dulabs_catalogo_clientes_canal").push(
      { id_tenant: A.tenantId, phone_number_id: PN_A, wa_id: ANA.waId, canal: "wholesale", origen: "cliente", updated_at: "2026-09-24T12:00:00Z", actualizado_por: null },
      { id_tenant: B.tenantId, phone_number_id: PN_A, wa_id: LUIS.waId, canal: "wholesale", origen: "cliente", updated_at: "2026-09-24T12:00:00Z", actualizado_por: null },
    );
    const calls: Record<string, unknown>[] = [];
    db.rpc("dulabs_catalogo_cliente_canal_fijar", (args) => {
      calls.push(args);
      return { data: { resultado: "cambiado", canal: "retail", origen: "asesora" } };
    });
    const store = createSupabaseCustomerChannelStore(supabaseAdmin());
    assert.equal((await store.get({ tenantId: A.tenantId, ...ANA }))?.channel, "wholesale");
    assert.equal(await store.get({ tenantId: A.tenantId, ...LUIS }), null, "fila de otro negocio: invisible");
    const many = await store.getMany({ tenantId: A.tenantId, phoneNumberId: PN_A, waIds: [ANA.waId, LUIS.waId, "x"] });
    assert.deepEqual([...many.keys()], [ANA.waId]);
    await store.change({ tenantId: A.tenantId, ...ANA }, { channel: "retail", expected: null, memberId: 7, reason: "motivo" });
    await store.setInitial({ tenantId: A.tenantId, ...LUIS }, "retail", "cliente");
    assert.deepEqual(calls, [
      { p_tenant: A.tenantId, p_pn: PN_A, p_wa: ANA.waId, p_canal: "retail", p_origen: "asesora", p_miembro: 7, p_motivo: "motivo", p_esperado: "ninguno" },
      { p_tenant: A.tenantId, p_pn: PN_A, p_wa: LUIS.waId, p_canal: "retail", p_origen: "cliente", p_miembro: null, p_motivo: null, p_esperado: null },
    ]);
  });

  it("fuentes del panel: nombres, confirmación, asesora asignada (solo miembros del negocio)", async () => {
    db.table("dulabs_clientes_conocidos").push({ phone_number_id: PN_A, telefono_cliente: ANA.waId, nombre: " Ana Pérez " }, { phone_number_id: PN_B, telefono_cliente: ANA.waId, nombre: "Otra" });
    db.table("dulabs_catalogo_pedido_eventos").push(
      { id_tenant: A.tenantId, pedido_id: "p1", estado_hacia: "confirmed", created_at: "2026-09-24T12:00:00Z" },
      { id_tenant: A.tenantId, pedido_id: "p1", estado_hacia: "confirmed", created_at: "2026-09-24T13:00:00Z" },
      { id_tenant: B.tenantId, pedido_id: "p2", estado_hacia: "confirmed", created_at: "2026-09-24T12:00:00Z" },
      { id_tenant: A.tenantId, pedido_id: "p2", estado_hacia: "handoff", created_at: "2026-09-24T12:00:00Z" },
    );
    db.table("dulabs_conversacion_asignaciones").push({ phone_number_id: PN_A, telefono_cliente: ANA.waId, miembro_id: 5 }, { phone_number_id: PN_A, telefono_cliente: LUIS.waId, miembro_id: 9 });
    db.table("dulabs_miembros_equipo").push({ id: 5, tenant_id: A.tenantId, nombre: "Carolina", email: "c@x.test" }, { id: 9, tenant_id: B.tenantId, nombre: "Ajena", email: "a@x.test" });
    const f = productionPanelFuentes(supabaseAdmin());
    assert.deepEqual([...(await f.nombres(A.tenantId, [ANA]))], [[`${PN_A}|${ANA.waId}`, "Ana Pérez"]]);
    assert.deepEqual([...(await f.confirmados(A.tenantId, ["p1", "p2"]))], [["p1", "2026-09-24T13:00:00Z"]], "la última confirmación, solo de este negocio");
    assert.deepEqual([...(await f.asignadas(A.tenantId, [ANA, LUIS]))], [[`${PN_A}|${ANA.waId}`, "Carolina"]], "un miembro de otro negocio nunca aparece");
  });
});
