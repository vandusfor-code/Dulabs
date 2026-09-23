/**
 * Fase 7 — WhatsApp + motor de pedidos para el agente.
 *
 * TODO en memoria: catálogo (repositorio en memoria del catálogo), pedidos
 * (createMemoryOrdersRepository, misma semántica que las funciones SQL,
 * verificadas aparte en supabase/tests/20261108000000_dulabs_catalogo_pedidos.test.sql)
 * y la pausa de la IA. Ni red, ni Supabase, ni IA. Tenants FICTICIOS: ningún
 * dato real de Delacour.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";
import { verificarFirmaMeta } from "@/lib/meta-firma";
import { resolverTelefonoRemitenteMeta } from "@/lib/webhook-meta-remitente";
import { orderWhatsappMessage } from "@/lib/catalogo/pedido";
import { createCatalogService, createPublicCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { ORDER_STATUSES, allowedTransitions, canTransition, publicView, type OrderActor } from "@/lib/catalogo/pedidos/contrato";
import { memoryOrderEventSink, orderEventV2Schema } from "@/lib/catalogo/pedidos/eventos";
import { AGENT_TOOL_NAMES, agentToolDefinitions, runAgentTool, type AgentToolContext, type AgentToolDeps } from "@/lib/catalogo/pedidos/herramientas";
import { recibirPedidoWhatsapp, type IntakeBusiness } from "@/lib/catalogo/pedidos/intake";
import type { OrderLogEntry } from "@/lib/catalogo/pedidos/log";
import { createOrderEngine, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { parseWhatsappOrderText } from "@/lib/catalogo/pedidos/whatsapp";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const NEGOCIO_A: IntakeBusiness = { id_tenant: A.tenantId, phone_number_id: "100000000000001", whatsapp_business_account_id: "200000000000001" };
const NEGOCIO_B: IntakeBusiness = { id_tenant: B.tenantId, phone_number_id: "100000000000002", whatsapp_business_account_id: "200000000000002" };
const CLIENTE = "573001112233";
const OTRO_CLIENTE = "573009998877";
const KEY = Buffer.alloc(32, 5);

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let pedidos: ReturnType<typeof createMemoryOrdersRepository>;
let sink: ReturnType<typeof memoryOrderEventSink>;
let engine: OrderEngine;
let logs: OrderLogEntry[];
let pausas: Array<{ tenantId: string; waId: string; reason: string }>;
let reloj: Date;
let deps: AgentToolDeps;

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  pedidos = createMemoryOrdersRepository();
  sink = memoryOrderEventSink();
  logs = [];
  pausas = [];
  reloj = new Date("2026-09-24T15:00:00Z");
  engine = createOrderEngine({
    orders: pedidos,
    catalog: mem.repo,
    key: KEY,
    sink,
    log: (e) => logs.push(e),
    now: () => reloj,
    handoff: {
      async pauseConversation({ tenantId, contact, reason }) {
        pausas.push({ tenantId, waId: contact.waId, reason });
        return { ok: true };
      },
    },
  });
  for (const [actor, name, phone] of [
    [A, "Joyería de prueba A", "573001110000"],
    [B, "Joyería de prueba B", "573002220000"],
  ] as const) {
    mem.setProfile(actor.tenantId, { name, whatsapp: phone });
    mem.enableModule(actor.tenantId);
  }
  deps = {
    engine,
    catalog: mem.repo,
    log: (e) => logs.push(e),
    ownsPhoneNumber: async (tenantId, pn) => [NEGOCIO_A, NEGOCIO_B].some((n) => n.id_tenant === tenantId && n.phone_number_id === pn),
  };
});

const producto = (actor: CatalogActor, name: string, retail: number, stock: number, wholesale: number | null = null, extra: { color?: string } = {}) =>
  admin.createProduct(actor, { name, retailPrice: retail, wholesalePrice: wholesale, stock, ...extra });

const conv = (negocio = NEGOCIO_A, waId = CLIENTE) => ({ phoneNumberId: negocio.phone_number_id, waId });
const ctx = (over: Partial<AgentToolContext> = {}): AgentToolContext => ({ tenantId: A.tenantId, channel: "retail", conversation: conv(), requestId: "req-test-0001", ...over });
const intake = (text: string, opts: { negocio?: IntakeBusiness; waId?: string; wamid?: string; wabaId?: string | null } = {}) =>
  recibirPedidoWhatsapp(
    {
      business: opts.negocio ?? NEGOCIO_A,
      wabaId: opts.wabaId === undefined ? (opts.negocio ?? NEGOCIO_A).whatsapp_business_account_id : opts.wabaId,
      message: { id: opts.wamid ?? `wamid.${Math.random().toString(36).slice(2)}`, type: "text", text: { body: text } },
      waId: opts.waId ?? CLIENTE,
    },
    { engine, isModuleEnabled: (t) => mem.repo.isModuleEnabled(t), log: (e) => logs.push(e) },
  );

function ok<T = Record<string, unknown>>(r: Awaited<ReturnType<typeof runAgentTool>>): T {
  assert.equal(r.ok, true, r.ok ? "" : `${r.error.code}: ${r.error.message}`);
  return (r as { ok: true; data: T }).data;
}
function err(r: Awaited<ReturnType<typeof runAgentTool>>) {
  assert.equal(r.ok, false, "se esperaba un error");
  return (r as { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }).error;
}
type OrderOut = ReturnType<typeof publicView> & { next_step: string; created?: boolean };

// ---------------------------------------------------------------------------

describe("contrato: estados y transiciones", () => {
  it("la tabla de transiciones de TS es EXACTAMENTE la de la función SQL", () => {
    const sql = readFileSync("supabase/migrations/20261108000000_dulabs_catalogo_pedidos.sql", "utf8");
    const bloque = /transicion_valida[\s\S]*?\(values([\s\S]*?)\) as t\(desde, hacia, actor\)/.exec(sql)?.[1] ?? "";
    const enSql = [...bloque.matchAll(/\('(\w+)', '(\w+)', '(\w+)'\)/g)].map((m) => `${m[1]}>${m[2]}>${m[3]}`).sort();
    const enTs = allowedTransitions()
      .flatMap((t) => t.actors.map((a) => `${t.from}>${t.to}>${a}`))
      .sort();
    assert.ok(enSql.length > 20);
    assert.deepEqual(enSql, enTs);
  });

  it("el agente no confirma sin propuesta, no completa, no cancela; los terminales no salen", () => {
    const agente: OrderActor = "agent";
    assert.equal(canTransition("validated", "confirmed", agente), false);
    assert.equal(canTransition("draft", "confirmed", agente), false);
    assert.equal(canTransition("pending_confirmation", "confirmed", agente), true);
    assert.equal(canTransition("confirmed", "completed", agente), false);
    assert.equal(canTransition("pending_confirmation", "cancelled", agente), false);
    assert.equal(canTransition("pending_confirmation", "confirmed", "system"), false, "el sistema nunca confirma por el cliente");
    for (const terminal of ["completed", "cancelled", "expired"] as const) {
      for (const to of ORDER_STATUSES) for (const actor of ["system", "agent", "human"] as const) assert.equal(canTransition(terminal, to, actor), false);
    }
  });
});

describe("create_order: el backend resuelve y calcula todo", () => {
  it("retail válido con varios productos => propuesta con total calculado por el backend", async () => {
    const p1 = await producto(A, "Anillo Corazón", 58_000, 5, 32_000);
    const p2 = await producto(A, "Aretes Argolla", 42_000, 10, 22_000);
    const d = ok<OrderOut>(
      await runAgentTool(
        "create_order",
        {
          items: [
            { reference: p1.reference, quantity: 2 },
            { reference: p2.reference.toLowerCase(), quantity: 1 },
          ],
          idempotency_key: "pedido-cliente-0001",
        },
        ctx(),
        deps,
      ),
    );
    assert.equal(d.status, "pending_confirmation");
    assert.equal(d.channel, "retail");
    assert.deepEqual(
      d.lines.map((l) => [l.reference, l.quantity, l.unit_price, l.subtotal]),
      [
        [p1.reference, 2, 58_000, 116_000],
        [p2.reference, 1, 42_000, 42_000],
      ],
    );
    assert.equal(d.total, 158_000);
    assert.equal(d.confirmation?.total, 158_000);
    assert.equal(d.next_step, "confirm");
    assert.equal(d.created, true);
  });

  it("wholesale: el canal lo pone el backend (contexto), con el precio mayorista", async () => {
    const p = await producto(A, "Dije", 35_000, 5, 18_000);
    const d = ok<OrderOut>(await runAgentTool("create_order", { items: [{ reference: p.reference, quantity: 3 }], idempotency_key: "mayor-00000001" }, ctx({ channel: "wholesale" }), deps));
    assert.equal(d.channel, "wholesale");
    assert.equal(d.total, 54_000);
  });

  it("referencia inexistente => 'No encontramos la referencia X.' sin sustituir por otra", async () => {
    const p = await producto(A, "Anillo", 10_000, 5);
    const d = ok<OrderOut>(
      await runAgentTool(
        "create_order",
        {
          items: [
            { reference: p.reference, quantity: 1 },
            { reference: "DL-999999", quantity: 1 },
          ],
          idempotency_key: "inexistente-0001",
        },
        ctx(),
        deps,
      ),
    );
    assert.equal(d.status, "draft");
    assert.equal(d.confirmation, null);
    assert.deepEqual(d.issues, [{ code: "reference_not_found", message: "No encontramos la referencia DL-999999." }]);
    assert.deepEqual(
      d.lines.map((l) => l.reference),
      [p.reference],
      "no se inventa una línea para la referencia que no existe",
    );
  });

  it("producto desactivado, agotado y stock insuficiente: cada uno con su problema; la cantidad pedida NO se reduce en silencio", async () => {
    const inactivo = await producto(A, "Dije viejo", 10_000, 5);
    await admin.updateProduct(A, inactivo.id, { status: "INACTIVE" });
    const agotado = await producto(A, "Pulsera", 20_000, 1);
    await admin.updateProduct(A, agotado.id, { stock: 0 });
    const poco = await producto(A, "Cadena", 30_000, 2);
    const d = ok<OrderOut>(
      await runAgentTool(
        "create_order",
        {
          items: [
            { reference: inactivo.reference, quantity: 1 },
            { reference: agotado.reference, quantity: 1 },
            { reference: poco.reference, quantity: 5 },
          ],
          idempotency_key: "problemas-00001",
        },
        ctx(),
        deps,
      ),
    );
    assert.equal(d.status, "draft");
    assert.deepEqual(
      d.issues.map((i) => i.code),
      ["product_unavailable", "sold_out", "insufficient_stock"],
    );
    assert.equal(d.lines.find((l) => l.reference === poco.reference)?.quantity, 5);
  });

  it("idempotencia: misma clave => mismo pedido; misma clave con otro contenido => CONFLICT; otra conversación => otro pedido", async () => {
    const p = await producto(A, "Anillo", 10_000, 50);
    const input = { items: [{ reference: p.reference, quantity: 2 }], idempotency_key: "reintento-0001" };
    const r1 = ok<OrderOut>(await runAgentTool("create_order", input, ctx(), deps));
    const r2 = ok<OrderOut>(await runAgentTool("create_order", input, ctx(), deps));
    assert.equal(r1.order_id, r2.order_id);
    assert.equal(r2.created, false);
    assert.equal(pedidos.orders.length, 1);
    assert.equal(sink.events.filter((e) => e.event_type === "order.created").length, 1, "un solo evento de creación");
    const conflicto = err(await runAgentTool("create_order", { ...input, items: [{ reference: p.reference, quantity: 3 }] }, ctx(), deps));
    assert.equal(conflicto.code, "CONFLICT");
    const otra = ok<OrderOut>(await runAgentTool("create_order", input, ctx({ conversation: conv(NEGOCIO_A, OTRO_CLIENTE) }), deps));
    assert.notEqual(otra.order_id, r1.order_id, "la clave es por conversación");
  });

  it("colisión del id público: se re-deriva, nunca se pisa otro pedido", async () => {
    const p = await producto(A, "Anillo", 10_000, 50);
    // Ocupa el id que derivaría el primer intento de la próxima creación.
    const original = pedidos.create.bind(pedidos);
    let primero = true;
    pedidos.create = async (order, event) => {
      if (primero) {
        primero = false;
        await original({ ...order, idempotencyKey: "otro-pedido-que-ya-existia" }, { ...event, event_id: "evt_00000000000000000000000000" });
      }
      return original(order, event);
    };
    const d = ok<OrderOut>(await runAgentTool("create_order", { items: [{ reference: p.reference, quantity: 1 }], idempotency_key: "colision-00001" }, ctx(), deps));
    assert.equal(pedidos.orders.length, 2);
    assert.notEqual(pedidos.orders[0].orderId, d.order_id);
  });
});

describe("confirmación contextual (un 'sí' suelto no confirma nada)", () => {
  async function propuesto() {
    const p = await producto(A, "Anillo", 100_000, 5);
    const d = ok<OrderOut>(await runAgentTool("create_order", { items: [{ reference: p.reference, quantity: 1 }], idempotency_key: "confirmar-0001" }, ctx(), deps));
    return { p, d };
  }

  it("confirmar exige la propuesta vigente: id correcto => confirmed; repetir => mismo resultado", async () => {
    const { d } = await propuesto();
    const c = ok<OrderOut>(await runAgentTool("confirm_order", { order_id: d.order_id, confirmation_id: d.confirmation!.id }, ctx(), deps));
    assert.equal(c.status, "confirmed");
    assert.equal(c.total, 100_000);
    const again = ok<OrderOut>(await runAgentTool("confirm_order", { order_id: d.order_id, confirmation_id: d.confirmation!.id }, ctx(), deps));
    assert.equal(again.status, "confirmed");
    assert.equal(sink.events.filter((e) => e.transition?.to === "confirmed").length, 1);
  });

  it("id de propuesta equivocado => CONFIRMATION_MISMATCH; vencida => CONFIRMATION_EXPIRED; nada cambia", async () => {
    const { d } = await propuesto();
    assert.equal(err(await runAgentTool("confirm_order", { order_id: d.order_id, confirmation_id: "cf_0000000000000000" }, ctx(), deps)).code, "CONFIRMATION_MISMATCH");
    reloj = new Date(reloj.getTime() + 31 * 60 * 1000);
    assert.equal(err(await runAgentTool("confirm_order", { order_id: d.order_id, confirmation_id: d.confirmation!.id }, ctx(), deps)).code, "CONFIRMATION_EXPIRED");
    assert.equal(pedidos.orders[0].status, "pending_confirmation");
    // Validar de nuevo emite una propuesta NUEVA.
    const v = ok<OrderOut>(await runAgentTool("validate_order", { order_id: d.order_id }, ctx(), deps));
    assert.notEqual(v.confirmation?.id, d.confirmation?.id);
    assert.equal(ok<OrderOut>(await runAgentTool("confirm_order", { order_id: d.order_id, confirmation_id: v.confirmation!.id }, ctx(), deps)).status, "confirmed");
  });

  it("precio cambiado entre la propuesta y el 'sí' => PRICE_CHANGED, vuelve a draft; validar => nueva propuesta con el precio actual", async () => {
    const { p, d } = await propuesto();
    await admin.updateProduct(A, p.id, { retailPrice: 120_000 });
    const e = err(await runAgentTool("confirm_order", { order_id: d.order_id, confirmation_id: d.confirmation!.id }, ctx(), deps));
    assert.equal(e.code, "PRICE_CHANGED");
    assert.match(e.message, /cambió de \$100\.000 a \$120\.000/);
    assert.equal(pedidos.orders[0].status, "draft");
    const v = ok<OrderOut>(await runAgentTool("validate_order", { order_id: d.order_id }, ctx(), deps));
    assert.equal(v.status, "pending_confirmation");
    assert.equal(v.confirmation?.total, 120_000);
  });

  it("stock agotado antes del 'sí' => OUT_OF_STOCK; confirmar un draft => INVALID_TRANSITION", async () => {
    const { p, d } = await propuesto();
    await admin.updateProduct(A, p.id, { stock: 0 });
    assert.equal(err(await runAgentTool("confirm_order", { order_id: d.order_id, confirmation_id: d.confirmation!.id }, ctx(), deps)).code, "OUT_OF_STOCK");
    assert.equal(err(await runAgentTool("confirm_order", { order_id: d.order_id, confirmation_id: d.confirmation!.id }, ctx(), deps)).code, "INVALID_TRANSITION");
  });
});

describe("handoff_to_human", () => {
  it("registra motivo, contexto, pedido y conversación; pausa la IA en ESE chat; el agente ya no confirma", async () => {
    const p = await producto(A, "Anillo", 10_000, 5);
    const d = ok<OrderOut>(await runAgentTool("create_order", { items: [{ reference: p.reference, quantity: 1 }], idempotency_key: "handoff-000001" }, ctx(), deps));
    const h = ok<{ handed_off: true; order: OrderOut }>(
      await runAgentTool("handoff_to_human", { reason: "Quiere grabado personalizado", context: "Pregunta por grabar iniciales", order_id: d.order_id }, ctx(), deps),
    );
    assert.equal(h.order.status, "handoff");
    assert.deepEqual(pausas, [{ tenantId: A.tenantId, waId: CLIENTE, reason: "Quiere grabado personalizado" }]);
    const guardado = pedidos.orders[0];
    assert.equal(guardado.handoff?.reason, "Quiere grabado personalizado");
    assert.equal(guardado.handoff?.context, "Pregunta por grabar iniciales");
    assert.equal(guardado.handoff?.requestedBy, "agent");
    const ev = sink.events.find((e) => e.event_type === "order.handoff_requested");
    assert.equal(ev?.customer?.wa_id, CLIENTE);
    assert.equal(ev?.channel, "retail");
    assert.equal(ev?.transition?.reason, "Quiere grabado personalizado");
    assert.equal(err(await runAgentTool("confirm_order", { order_id: d.order_id, confirmation_id: d.confirmation!.id }, ctx(), deps)).code, "INVALID_TRANSITION");
    // Idempotente: repetirlo no crea otro evento.
    ok(await runAgentTool("handoff_to_human", { reason: "Quiere grabado personalizado", order_id: d.order_id }, ctx(), deps));
    assert.equal(sink.events.filter((e) => e.event_type === "order.handoff_requested").length, 1);
  });

  it("sin pedido también pasa a una asesora (solo la pausa); requiere conversación", async () => {
    ok(await runAgentTool("handoff_to_human", { reason: "Pide hablar con una persona" }, ctx(), deps));
    assert.equal(pausas.length, 1);
    assert.equal(err(await runAgentTool("handoff_to_human", { reason: "x".repeat(10) }, ctx({ conversation: null }), deps)).code, "FORBIDDEN");
  });
});

describe("seguridad: manipulación, alcance y aislamiento", () => {
  it("payload manipulado: precio, total, negocio, canal o id de producto => INVALID_INPUT (sin eco de valores)", async () => {
    const p = await producto(A, "Anillo", 10_000, 5);
    const base = { items: [{ reference: p.reference, quantity: 1 }], idempotency_key: "manipulado-0001" };
    for (const extra of [{ price: 1 }, { total: 1 }, { business_id: B.tenantId }, { channel: "wholesale" }, { tenant_id: B.tenantId }]) {
      const e = err(await runAgentTool("create_order", { ...base, ...extra }, ctx(), deps));
      assert.equal(e.code, "INVALID_INPUT");
      assert.doesNotMatch(JSON.stringify(e), new RegExp(B.tenantId));
    }
    for (const item of [{ unit_price: 1 }, { product_id: p.id }, { subtotal: 1 }]) {
      assert.equal(err(await runAgentTool("create_order", { ...base, items: [{ reference: p.reference, quantity: 1, ...item }] }, ctx(), deps)).code, "INVALID_INPUT");
    }
    assert.equal(pedidos.orders.length, 0);
  });

  it("cantidades negativas, cero, decimales o gigantes => INVALID_INPUT", async () => {
    const p = await producto(A, "Anillo", 10_000, 5);
    for (const quantity of [-1, 0, 1.5, 100, 1e9, Number.NaN, "2"]) {
      const e = err(await runAgentTool("create_order", { items: [{ reference: p.reference, quantity }], idempotency_key: "cantidad-00001" }, ctx(), deps));
      assert.equal(e.code, "INVALID_INPUT", String(quantity));
    }
    assert.equal(err(await runAgentTool("create_order", { items: Array.from({ length: 61 }, () => ({ reference: p.reference, quantity: 1 })), idempotency_key: "muchas-lineas-1" }, ctx(), deps)).code, "INVALID_INPUT");
  });

  it("cross-tenant: B no ve productos ni pedidos de A (NOT_FOUND / REFERENCE_NOT_FOUND, sin revelar nada)", async () => {
    const pA = await producto(A, "Anillo exclusivo A", 10_000, 5);
    const d = ok<OrderOut>(await runAgentTool("create_order", { items: [{ reference: pA.reference, quantity: 1 }], idempotency_key: "tenant-a-00001" }, ctx(), deps));
    const ctxB = ctx({ tenantId: B.tenantId, conversation: conv(NEGOCIO_B) });
    assert.equal(err(await runAgentTool("get_order", { order_id: d.order_id }, ctxB, deps)).code, "NOT_FOUND");
    assert.equal(err(await runAgentTool("confirm_order", { order_id: d.order_id, confirmation_id: d.confirmation!.id }, ctxB, deps)).code, "NOT_FOUND");
    assert.equal(err(await runAgentTool("get_product_by_reference", { reference: pA.reference }, ctxB, deps)).code, "REFERENCE_NOT_FOUND");
    const busqueda = ok<{ candidates: unknown[] }>(await runAgentTool("search_products", { query: "exclusivo" }, ctxB, deps));
    assert.equal(busqueda.candidates.length, 0);
    // B referenciando el pedido de A desde un número propio de A => el número no es de B.
    assert.equal(err(await runAgentTool("get_order", { order_id: d.order_id }, ctx({ tenantId: B.tenantId }), deps)).code, "FORBIDDEN");
  });

  it("otra conversación del MISMO negocio tampoco ve el pedido", async () => {
    const p = await producto(A, "Anillo", 10_000, 5);
    const d = ok<OrderOut>(await runAgentTool("create_order", { items: [{ reference: p.reference, quantity: 1 }], idempotency_key: "privado-000001" }, ctx(), deps));
    assert.equal(err(await runAgentTool("get_order", { order_id: d.order_id }, ctx({ conversation: conv(NEGOCIO_A, OTRO_CLIENTE) }), deps)).code, "NOT_FOUND");
  });

  it("canal: el detal nunca ve el precio mayorista (ni en productos ni en búsquedas)", async () => {
    const p = await producto(A, "Dije", 35_000, 5, 18_000);
    const detal = ok<{ product: { unit_price: number } }>(await runAgentTool("get_product_by_reference", { reference: p.reference }, ctx(), deps));
    assert.equal(detal.product.unit_price, 35_000);
    assert.doesNotMatch(JSON.stringify(detal), /18000/);
    const busqueda = ok<{ candidates: Array<{ unit_price: number }> }>(await runAgentTool("search_products", { query: "dije" }, ctx(), deps));
    assert.deepEqual(busqueda.candidates.map((c) => c.unit_price), [35_000]);
    const mayor = ok<{ product: { unit_price: number } }>(await runAgentTool("get_product_by_reference", { reference: p.reference }, ctx({ channel: "wholesale" }), deps));
    assert.equal(mayor.product.unit_price, 18_000);
  });

  it("alcance: módulo apagado, contexto inválido, número ajeno y herramienta inexistente => FORBIDDEN/INVALID_INPUT", async () => {
    const p = await producto(A, "Anillo", 10_000, 5);
    assert.equal(err(await runAgentTool("get_product_by_reference", { reference: p.reference }, ctx({ tenantId: "no-es-uuid" }), deps)).code, "FORBIDDEN");
    assert.equal(err(await runAgentTool("get_product_by_reference", { reference: p.reference }, ctx({ channel: "vip" as never }), deps)).code, "FORBIDDEN");
    assert.equal(err(await runAgentTool("get_order", {}, ctx({ conversation: { phoneNumberId: "999", waId: CLIENTE } }), deps)).code, "FORBIDDEN");
    assert.equal(err(await runAgentTool("execute_sql", { sql: "select 1" }, ctx(), deps)).code, "INVALID_INPUT");
    assert.equal(err(await runAgentTool("update_stock", { reference: p.reference, stock: 1 }, ctx(), deps)).code, "INVALID_INPUT");
    mem.enableModule(A.tenantId, false);
    assert.equal(err(await runAgentTool("get_product_by_reference", { reference: p.reference }, ctx(), deps)).code, "FORBIDDEN");
  });

  it("las salidas no exponen ids internos (producto, negocio, pedido interno) ni el stock exacto grande", async () => {
    const p = await producto(A, "Cadena", 10_000, 37);
    const salidas = [
      await runAgentTool("get_product_by_reference", { reference: p.reference }, ctx(), deps),
      await runAgentTool("get_product_availability", { reference: p.reference }, ctx(), deps),
      await runAgentTool("search_products", { query: "cadena" }, ctx(), deps),
      await runAgentTool("create_order", { items: [{ reference: p.reference, quantity: 2 }], idempotency_key: "sin-ids-000001" }, ctx(), deps),
      await runAgentTool("get_order", {}, ctx(), deps),
    ].map((r) => JSON.stringify(ok(r)));
    const interno = pedidos.orders[0].id;
    for (const s of salidas) {
      assert.doesNotMatch(s, new RegExp(p.id));
      assert.doesNotMatch(s, new RegExp(A.tenantId));
      assert.doesNotMatch(s, new RegExp(interno));
      assert.doesNotMatch(s, /\b37\b/);
    }
  });

  it("los registros no llevan teléfono, texto del mensaje ni secretos; sí request_id, operación, resultado y duración", async () => {
    const p = await producto(A, "Anillo", 10_000, 5);
    await runAgentTool("create_order", { items: [{ reference: p.reference, quantity: 1 }], idempotency_key: "logs-000000001" }, ctx(), deps);
    await intake(orderWhatsappMessage([{ reference: p.reference, name: "Anillo", quantity: 1 }], "retail"));
    const texto = JSON.stringify(logs);
    assert.doesNotMatch(texto, new RegExp(CLIENTE));
    assert.doesNotMatch(texto, /Hola, me interesan/);
    assert.doesNotMatch(texto, new RegExp(KEY.toString("hex")));
    for (const l of logs) {
      assert.ok(l.request_id && l.business_id && l.operation && l.result && typeof l.duration_ms === "number");
    }
    assert.ok(logs.some((l) => l.operation === "create_order" && l.event_id?.startsWith("evt_")));
  });

  it("migración sin aplicar => UNAVAILABLE en las herramientas de pedidos; las de catálogo siguen funcionando", async () => {
    const p = await producto(A, "Anillo", 10_000, 5);
    pedidos.isAvailable = false;
    assert.equal(err(await runAgentTool("create_order", { items: [{ reference: p.reference, quantity: 1 }], idempotency_key: "sin-migracion-1" }, ctx(), deps)).code, "UNAVAILABLE");
    ok(await runAgentTool("get_product_by_reference", { reference: p.reference }, ctx(), deps));
  });
});

describe("herramientas de catálogo: candidatos, nunca elección", () => {
  it("search_products devuelve candidatos; resolve_product con varios => AMBIGUOUS (pregunta al cliente)", async () => {
    await producto(A, "Anillo Corazón", 58_000, 5, null, { color: "Dorado" });
    await producto(A, "Anillo Corazón", 58_000, 5, null, { color: "Plateado" });
    const s = ok<{ status: string; candidates: unknown[] }>(await runAgentTool("search_products", { query: "Corazón" }, ctx(), deps));
    assert.equal(s.status, "candidates");
    assert.equal(s.candidates.length, 2);
    const amb = err(await runAgentTool("resolve_product", { name: "anillo corazon" }, ctx(), deps));
    assert.equal(amb.code, "AMBIGUOUS");
    assert.equal((amb.details?.candidates as unknown[]).length, 2);
    const uno = ok<{ product: { color: string } }>(await runAgentTool("resolve_product", { name: "ANILLO CORAZÓN", color: "plateado" }, ctx(), deps));
    assert.equal(uno.product.color, "Plateado");
    assert.equal(err(await runAgentTool("resolve_product", { name: "anillo corazones" }, ctx(), deps)).code, "NOT_FOUND", "sin similitud difusa");
  });

  it("get_product_availability: stock discreto y can_fulfill", async () => {
    const poco = await producto(A, "Anillo", 10_000, 3);
    const mucho = await producto(A, "Cadena", 10_000, 37);
    const inactivo = await producto(A, "Dije", 10_000, 5);
    await admin.updateProduct(A, inactivo.id, { status: "INACTIVE" });
    assert.deepEqual(ok(await runAgentTool("get_product_availability", { reference: poco.reference, quantity: 4 }, ctx(), deps)), {
      reference: poco.reference,
      available: true,
      status: "low",
      quantity: 3,
      can_fulfill: false,
    });
    assert.deepEqual(ok(await runAgentTool("get_product_availability", { reference: mucho.reference, quantity: 30 }, ctx(), deps)), {
      reference: mucho.reference,
      available: true,
      status: "available",
      quantity: null,
      can_fulfill: true,
    });
    assert.equal(ok<{ status: string }>(await runAgentTool("get_product_availability", { reference: inactivo.reference }, ctx(), deps)).status, "unavailable");
    assert.equal(err(await runAgentTool("get_product_availability", { reference: "DL-999999" }, ctx(), deps)).code, "REFERENCE_NOT_FOUND");
  });

  it("definiciones para el modelo: 9 herramientas, esquemas cerrados (additionalProperties: false)", () => {
    const defs = agentToolDefinitions();
    assert.deepEqual(AGENT_TOOL_NAMES.sort(), [
      "confirm_order",
      "create_order",
      "get_order",
      "get_product_availability",
      "get_product_by_reference",
      "handoff_to_human",
      "resolve_product",
      "search_products",
      "validate_order",
    ]);
    for (const d of defs) {
      assert.equal((d.input_schema as { additionalProperties?: boolean }).additionalProperties, false, d.name);
      assert.doesNotMatch(JSON.stringify(d.input_schema), /price|total|business|tenant|channel|product_id|stock/);
    }
  });
});

describe("parser del texto de WhatsApp (nunca decide nada)", () => {
  it("lee referencias, cantidades, id y la PISTA de mayorista; reporta cantidades inválidas", () => {
    const texto = orderWhatsappMessage(
      [
        { reference: "DL-000184", name: "Anillo - talla 7", quantity: 2 },
        { reference: "DL-000185", name: "Aretes", quantity: 1 },
      ],
      "wholesale",
      { requestId: "DL-ORD-7K2M9Q", total: 1 },
    );
    assert.deepEqual(parseWhatsappOrderText(texto), {
      requestId: "DL-ORD-7K2M9Q",
      claimsWholesale: true,
      items: [
        { reference: "DL-000184", quantity: 2 },
        { reference: "DL-000185", quantity: 1 },
      ],
      invalid: [],
    });
    const raro = "• DL-000184 · Anillo — 500 unidades\n• DL-000185 · Aretes — 0 unidades\n• DL-000186 · Dije — -3 unidades\n• DL-000187 · Pulsera — muchas";
    assert.deepEqual(parseWhatsappOrderText(raro)?.invalid, [
      { reference: "DL-000184", reason: "out_of_range" },
      { reference: "DL-000185", reason: "out_of_range" },
      { reference: "DL-000186", reason: "out_of_range" },
      { reference: "DL-000187", reason: "unreadable" },
    ]);
    assert.equal(parseWhatsappOrderText("hola, ¿tienen anillos?"), null);
    assert.equal(parseWhatsappOrderText("quiero el DL-000184"), null, "texto libre: lo atiende el agente con sus herramientas");
    assert.deepEqual(parseWhatsappOrderText("• DL-000184 · A — 60 unidades\n• DL-000184 · A — 60 unidades")?.invalid, [{ reference: "DL-000184", reason: "out_of_range" }]);
  });
});

describe("WhatsApp: solicitud del catálogo -> conversación -> pedido", () => {
  let publico: ReturnType<typeof createPublicCatalogService>;
  let slug: string;
  let token: string;

  beforeEach(async () => {
    publico = createPublicCatalogService({ repo: mem.repo, orders: { key: KEY, engine, now: () => reloj } });
    slug = (await admin.ensurePublication(A)).slug;
    token = (await admin.getPublication(A, { includeWholesale: true }))!.wholesalePath!.split("/").pop()!;
  });

  async function solicitar(items: Array<{ reference: string; quantity: number }>, opts: { context?: "retail" | "wholesale" } = {}) {
    const t = opts.context === "wholesale" ? token : undefined;
    const vista = await publico.resolveSelection({ slug, references: items.map((i) => i.reference), context: opts.context, token: t });
    const r = await publico.prepareOrder({ slug, items, quote: vista!.quote!, requestKey: "intento-tienda-000001", context: opts.context, token: t });
    assert.equal(r?.status, "ready");
    return r as Extract<typeof r, { status: "ready" }>;
  }

  it("la tienda guarda la solicitud (validated, sin contacto) y el id del mensaje es el del pedido guardado", async () => {
    const p = await producto(A, "Anillo", 58_000, 5);
    const r = await solicitar([{ reference: p.reference, quantity: 2 }]);
    assert.equal(pedidos.orders.length, 1);
    const o = pedidos.orders[0];
    assert.equal(o.orderId, r.draft.requestId);
    assert.match(r.message, new RegExp(`Solicitud: ${o.orderId}`));
    assert.equal(o.status, "validated");
    assert.equal(o.source, "catalog");
    assert.equal(o.contact, null);
    assert.equal(o.total, 116_000);
    const ev = sink.events.find((e) => e.event_type === "catalog.order_request.created");
    assert.equal(orderEventV2Schema.safeParse(ev).success, true);
    // Doble toque / reintento: el mismo pedido, sin otro evento.
    await solicitar([{ reference: p.reference, quantity: 2 }]);
    assert.equal(pedidos.orders.length, 1);
    assert.equal(sink.events.filter((e) => e.event_type === "catalog.order_request.created").length, 1);
  });

  it("el mensaje llega por WhatsApp => se reclama para ESA conversación, se re-valida y queda propuesto; el reintento de Meta no duplica", async () => {
    const p = await producto(A, "Anillo", 58_000, 5);
    const r = await solicitar([{ reference: p.reference, quantity: 2 }]);
    const res = await intake(r.message, { wamid: "wamid.HBgMNTczMDAxMTEyMjMzFQIAEhgUM0FCQ0RFRg==" });
    assert.equal(res.status, "claimed");
    assert.equal(res.status === "claimed" && res.order.order_id, r.draft.requestId);
    assert.equal(res.status === "claimed" && res.order.status, "pending_confirmation");
    assert.equal(res.status === "claimed" && res.next_step, "confirm");
    assert.deepEqual(pedidos.orders[0].contact, conv());
    const again = await intake(r.message, { wamid: "wamid.HBgMNTczMDAxMTEyMjMzFQIAEhgUM0FCQ0RFRg==" });
    assert.equal(again.status, "duplicate");
    assert.equal(pedidos.orders.length, 1);
    // El agente lo ve y lo confirma con la propuesta del backend.
    const g = ok<OrderOut>(await runAgentTool("get_order", {}, ctx(), deps));
    assert.equal(g.order_id, r.draft.requestId);
    assert.equal(ok<OrderOut>(await runAgentTool("confirm_order", { order_id: g.order_id, confirmation_id: g.confirmation!.id }, ctx(), deps)).status, "confirmed");
  });

  it("mayorista: la solicitud firmada con token conserva su canal y precio al llegar por WhatsApp", async () => {
    const p = await producto(A, "Dije", 35_000, 5, 18_000);
    const r = await solicitar([{ reference: p.reference, quantity: 2 }], { context: "wholesale" });
    const res = await intake(r.message);
    assert.equal(res.status === "claimed" && res.order.channel, "wholesale");
    assert.equal(res.status === "claimed" && res.order.total, 36_000);
  });

  it("texto editado por el cliente => manda la solicitud GUARDADA + problema message_mismatch (draft)", async () => {
    const p = await producto(A, "Anillo", 58_000, 50);
    const r = await solicitar([{ reference: p.reference, quantity: 2 }]);
    const editado = r.message.replace("2 unidades", "20 unidades");
    const res = await intake(editado);
    assert.equal(res.status, "claimed");
    const o = pedidos.orders[0];
    assert.equal(o.status, "draft");
    assert.equal(o.lines[0].quantity, 2, "no se reconstruye desde el texto");
    assert.deepEqual(o.issues.map((i) => i.code), ["message_mismatch"]);
  });

  it("precio cambió entre la tienda y WhatsApp => draft con price_changed; nada se propone con el precio viejo", async () => {
    const p = await producto(A, "Anillo", 58_000, 5);
    const r = await solicitar([{ reference: p.reference, quantity: 1 }]);
    await admin.updateProduct(A, p.id, { retailPrice: 60_000 });
    const res = await intake(r.message);
    assert.equal(res.status === "claimed" && res.order.status, "draft");
    assert.equal(res.status === "claimed" && res.order.issues[0].code, "price_changed");
    assert.equal(pedidos.orders[0].confirmation, null);
  });

  it("otra conversación reenviando el mismo mensaje NO se apropia del pedido: crea el suyo (detal)", async () => {
    const p = await producto(A, "Dije", 35_000, 5, 18_000);
    const r = await solicitar([{ reference: p.reference, quantity: 1 }], { context: "wholesale" });
    await intake(r.message);
    const ajeno = await intake(r.message, { waId: OTRO_CLIENTE });
    assert.equal(ajeno.status, "created");
    assert.notEqual(ajeno.status === "created" && ajeno.order.order_id, r.draft.requestId);
    assert.equal(ajeno.status === "created" && ajeno.order.channel, "retail");
    assert.deepEqual(ajeno.status === "created" && ajeno.order.issues.map((i) => i.code), ["wholesale_unverified"]);
    assert.deepEqual(pedidos.orders[0].contact, conv(), "el original sigue siendo del primer cliente");
  });

  it("mensaje sin id (escrito a mano con el formato) => pedido nuevo de WhatsApp; cantidades inválidas quedan como problema", async () => {
    const p = await producto(A, "Anillo", 10_000, 5);
    const res = await intake(`Hola, me interesan estos productos:\n\n• ${p.reference} · Anillo — 1 unidad\n• ${p.reference.replace(/\d$/, "9")} · X — 500 unidades`, {
      wamid: "wamid.sin-id-0001",
    });
    assert.equal(res.status, "created");
    assert.equal(res.status === "created" && res.order.status, "draft");
    assert.deepEqual(res.status === "created" && res.order.issues.map((i) => i.code).sort(), ["invalid_quantity"]);
    assert.equal(pedidos.orders[0].source, "whatsapp");
    assert.equal((await intake("otra cosa", { wamid: "wamid.sin-id-0001" })).status, "skipped");
    assert.equal(
      (await intake(`Hola, me interesan estos productos:\n\n• ${p.reference} · Anillo — 1 unidad\n• ${p.reference.replace(/\d$/, "9")} · X — 500 unidades`, { wamid: "wamid.sin-id-0001" })).status,
      "duplicate",
      "reintento de Meta (mismo wamid)",
    );
    assert.equal(pedidos.orders.length, 1);
  });

  it("entrada ignorada sin tocar la BD: texto normal, otro tipo, WABA ajeno, módulo apagado, sin migración, número bloqueado", async () => {
    const p = await producto(A, "Anillo", 10_000, 5);
    const pedido = `• ${p.reference} · Anillo — 1 unidad`;
    assert.deepEqual(await intake("hola, buenas tardes"), { status: "skipped", reason: "not_an_order" });
    assert.deepEqual(
      await recibirPedidoWhatsapp({ business: NEGOCIO_A, message: { id: "wamid.img", type: "image" }, waId: CLIENTE }, { engine, isModuleEnabled: async () => true }),
      { status: "skipped", reason: "not_text" },
    );
    assert.deepEqual(await intake(pedido, { wabaId: "WABA-DE-OTRO" }), { status: "skipped", reason: "waba_mismatch" });
    assert.deepEqual(
      await recibirPedidoWhatsapp({ business: NEGOCIO_A, wabaId: null, message: { id: "wamid.bl", type: "text", text: { body: pedido } }, waId: CLIENTE, blocked: true }, { engine, isModuleEnabled: async () => true, log: () => {} }),
      { status: "skipped", reason: "blocked" },
    );
    mem.enableModule(A.tenantId, false);
    assert.deepEqual(await intake(pedido), { status: "skipped", reason: "module_disabled" });
    mem.enableModule(A.tenantId, true);
    pedidos.isAvailable = false;
    assert.deepEqual(await intake(pedido), { status: "skipped", reason: "orders_unavailable" });
    assert.equal(pedidos.orders.length, 0);
  });
});

describe("integración Meta -> webhook -> tenant -> contacto -> pedido -> herramientas (con mocks)", () => {
  /** Payload real de Meta Cloud API (forma documentada). */
  function payloadMeta(negocio: IntakeBusiness, from: string, texto: string, wamid: string) {
    return JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: negocio.whatsapp_business_account_id,
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "573001110000", phone_number_id: negocio.phone_number_id },
                contacts: [{ profile: { name: "Cliente de prueba" }, wa_id: from }],
                messages: [{ from, id: wamid, timestamp: "1790000000", type: "text", text: { body: texto } }],
              },
            },
          ],
        },
      ],
    });
  }

  /** La MISMA cadena que el webhook: firma -> WABA/phone_number_id -> negocio -> remitente -> entrada de pedidos. */
  async function webhook(raw: string, firma: string | null, negocios: IntakeBusiness[]) {
    if (!verificarFirmaMeta(raw, firma)) return { http: 401 as const, results: [] };
    const body = JSON.parse(raw) as { entry: Array<{ id: string; changes: Array<{ value: { metadata: { phone_number_id: string }; contacts: Array<{ wa_id: string }>; messages: Array<{ id: string; type: string; from: string; text: { body: string } }> } }> }> };
    const results = [];
    for (const entry of body.entry) {
      for (const change of entry.changes) {
        // Negocio por phone_number_id (UNIQUE), nunca por nombre ni "el primero".
        const negocio = negocios.find((n) => n.phone_number_id === change.value.metadata.phone_number_id);
        if (!negocio) continue;
        for (const m of change.value.messages) {
          const waId = resolverTelefonoRemitenteMeta(m, change.value.contacts);
          if (!waId) continue;
          results.push(await recibirPedidoWhatsapp({ business: negocio, wabaId: entry.id, message: m, waId }, { engine, isModuleEnabled: (t) => mem.repo.isModuleEnabled(t), log: () => {} }));
        }
      }
    }
    return { http: 200 as const, results };
  }

  const SECRET = "secreto-de-prueba-no-real";
  const firmar = (raw: string) => `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;

  it("flujo completo determinista, con aislamiento entre negocios y firma obligatoria", async () => {
    const previo = process.env.META_APP_SECRET;
    process.env.META_APP_SECRET = SECRET;
    try {
      // Las referencias son POR negocio: A usa DL-000002 y B solo tiene DL-000001.
      await producto(A, "Relleno", 1_000, 5);
      const pA = await producto(A, "Anillo", 58_000, 5);
      await producto(B, "Anillo", 99_000, 5);
      const publico = createPublicCatalogService({ repo: mem.repo, orders: { key: KEY, engine, now: () => reloj } });
      const slug = (await admin.ensurePublication(A)).slug;
      const vista = await publico.resolveSelection({ slug, references: [pA.reference] });
      const tienda = await publico.prepareOrder({ slug, items: [{ reference: pA.reference, quantity: 2 }], quote: vista!.quote!, requestKey: "intento-integracion-01" });
      assert.equal(tienda?.status, "ready");
      const texto = tienda?.status === "ready" ? tienda.message : "";

      // Firma inválida => 401 y nada registrado.
      const raw = payloadMeta(NEGOCIO_A, CLIENTE, texto, "wamid.integracion-0001");
      assert.equal((await webhook(raw, "sha256=00", [NEGOCIO_A, NEGOCIO_B])).http, 401);
      assert.equal((await webhook(raw.replace("2 unidades", "9 unidades"), firmar(raw), [NEGOCIO_A, NEGOCIO_B])).http, 401, "payload alterado después de firmar");
      assert.equal(pedidos.orders[0].contact, null);

      // Válido => reclamado y propuesto para esta conversación.
      const r1 = await webhook(raw, firmar(raw), [NEGOCIO_A, NEGOCIO_B]);
      assert.equal(r1.http, 200);
      assert.equal(r1.results[0].status, "claimed");
      // Reintento de Meta (mismo wamid) => sin duplicados.
      assert.equal((await webhook(raw, firmar(raw), [NEGOCIO_A, NEGOCIO_B])).results[0].status, "duplicate");

      // El MISMO texto enviado al número del negocio B: B no ve la solicitud de A; la referencia no existe en B.
      const rawB = payloadMeta(NEGOCIO_B, CLIENTE, texto, "wamid.integracion-0002");
      const rB = await webhook(rawB, firmar(rawB), [NEGOCIO_A, NEGOCIO_B]);
      const pedidoB = rB.results[0];
      assert.equal(pedidoB.status, "created");
      assert.equal(pedidoB.status === "created" && pedidoB.order.lines.length, 0);
      assert.equal(pedidoB.status === "created" && pedidoB.order.issues.some((i) => i.code === "reference_not_found"), true);
      assert.equal(pedidos.orders.find((o) => o.businessId === B.tenantId)?.total, 0, "nunca el precio de A");

      // Número de B con el WABA de A (payload inconsistente) => ignorado.
      const cruzado = payloadMeta({ ...NEGOCIO_B, whatsapp_business_account_id: NEGOCIO_A.whatsapp_business_account_id }, CLIENTE, texto, "wamid.integracion-0003");
      assert.deepEqual((await webhook(cruzado, firmar(cruzado), [NEGOCIO_A, NEGOCIO_B])).results[0], { status: "skipped", reason: "waba_mismatch" });

      // Herramientas del agente sobre ESA conversación: consultar -> confirmar.
      const g = ok<OrderOut>(await runAgentTool("get_order", {}, ctx(), deps));
      assert.equal(g.total, 116_000);
      const c = ok<OrderOut>(await runAgentTool("confirm_order", { order_id: g.order_id, confirmation_id: g.confirmation!.id }, ctx(), deps));
      assert.equal(c.status, "confirmed");
      // Eventos v2 válidos y deduplicados.
      for (const e of sink.events) assert.equal(orderEventV2Schema.safeParse(e).success, true);
      assert.deepEqual(
        sink.events.filter((e) => e.business.id === A.tenantId).map((e) => `${e.event_type}:${e.order.status}`),
        ["catalog.order_request.created:validated", "order.status_changed:pending_confirmation", "order.status_changed:confirmed"],
      );
    } finally {
      if (previo === undefined) delete process.env.META_APP_SECRET;
      else process.env.META_APP_SECRET = previo;
    }
  });
});
