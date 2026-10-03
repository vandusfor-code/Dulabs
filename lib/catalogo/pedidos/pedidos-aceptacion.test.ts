/**
 * FASE 3B.2 — pedido PENDIENTE DE ACEPTACIÓN (motor + repositorio en memoria con las MISMAS reglas que la BD).
 *
 *   1. Enviar a aceptación: NO es venta (sin confirmOrder, confirmedAt, etapa, pago ni compra), sin reserva
 *      salvo política explícita (nunca 72 h), políticas obligatorias (fail-closed), idempotente.
 *   2. Aceptar: solo una persona; ahí empieza la venta y se aparta el stock con el plazo elegido.
 *   3. Cerrar sin venta, vencimientos (solo si se configuran) y abandono (nunca hereda las 72 h).
 *   4. Aviso y respuesta del cliente: una sola vez; la respuesta no acepta nada.
 *   5. Documento: solo con oficina, cifrado (formato v1 real), enmascarado, nunca en registros ni eventos.
 *   6. Multi-negocio: un negocio nunca envía, acepta, cierra, marca ni lee lo de otro.
 *   7. El flujo de siempre (Delacour) no cambia.
 *
 * Negocios, clientes, productos y políticas FICTICIOS (valores de prueba, no decisiones comerciales).
 * Nada toca Supabase.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { OPEN_STATUSES, OrderError, createOrderEngine, nextStepOf, validAcceptancePolicy, type CheckoutData, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { InvalidTransition, RESERVATION_TTL_MS, createMemoryOrdersRepository, createSupabaseOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { allowedTransitions, canTransition, type AcceptancePolicy, type Order } from "@/lib/catalogo/pedidos/contrato";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { accionesPermitidas, estadoVisible } from "@/lib/catalogo/pedidos/gestion";
import { maskDocument, normalizeDocumentNumber, type DocumentCipher } from "@/lib/catalogo/pedidos/documento";
import { cifrarSecreto, descifrarSecreto } from "@/lib/crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { installSupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const ANA = { phoneNumberId: "100000000000001", waId: "573001110001" };
const BETO = { phoneNumberId: "100000000000002", waId: "573001110002" };
const MIEMBRO = 41;
const MIN = 60_000;

// Políticas de PRUEBA (las reales las decide el negocio: D5, D6, D4).
const SIN_RESERVA: AcceptancePolicy = { reservation: { kind: "none" }, expiration: { kind: "none" }, document: { kind: "not_collected" } };
const CON_RESERVA: AcceptancePolicy = { reservation: { kind: "ttl", minutes: 90 }, expiration: { kind: "none" }, document: { kind: "not_collected" } };
const CON_DOCUMENTO: AcceptancePolicy = { ...SIN_RESERVA, document: { kind: "required_for_office", allowedTypes: ["cc", "ce"], retention: { kind: "no_automatic_deletion" } } };

const DOMICILIO: CheckoutData = {
  customerName: "Laura Gómez",
  paymentMethod: "contra_entrega",
  delivery: "domicilio",
  address: "Calle 10 # 20-30",
  city: "Bogotá",
  deliveryReference: null,
  contactPhone: "3001234567",
  department: "Cundinamarca",
  neighborhood: "Chapinero",
};
const OFICINA: CheckoutData = {
  customerName: "Laura Gómez",
  paymentMethod: "contra_entrega",
  delivery: "oficina_transportadora",
  address: null,
  city: "Medellín",
  deliveryReference: null,
  contactPhone: "3001234567",
  department: "Antioquia",
  neighborhood: null,
  carrierOffice: "Oficina Centro",
};
const DOC_NUMERO = "1.020.345.678";

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let orders: ReturnType<typeof createMemoryOrdersRepository>;
let sink: ReturnType<typeof memoryOrderEventSink>;
let logs: Array<Record<string, unknown>>;
let engine: OrderEngine;
let clock: number;
let seq: number;
const cipher: DocumentCipher = { encrypt: cifrarSecreto };

function buildEngine(extra: { documentCipher?: DocumentCipher | null } = {}) {
  return createOrderEngine({
    orders,
    catalog: mem.repo,
    key: Buffer.alloc(32, 3),
    sink,
    log: (e) => logs.push({ ...e }),
    now: () => new Date(clock),
    handoff: { pauseConversation: async () => ({ ok: true }) },
    ...(extra.documentCipher === null ? {} : { documentCipher: extra.documentCipher ?? cipher }),
  });
}

beforeEach(() => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  clock = Date.parse("2026-10-02T15:00:00Z");
  orders = createMemoryOrdersRepository({ inventory: mem.inventory, now: () => clock });
  sink = memoryOrderEventSink();
  logs = [];
  engine = buildEngine();
  for (const actor of [A, B]) mem.enableModule(actor.tenantId);
  seq = 0;
});

const stockDe = (id: string) => mem.inventory.stockOf(id);
const producto = (actor: CatalogActor, name: string, stock: number) => admin.createProduct(actor, { name, retailPrice: 50_000, stock });
async function propuesta(contact: typeof ANA, items: Array<{ reference: string; quantity: number }>, tenant = A.tenantId) {
  const { order } = await engine.createOrder({ tenantId: tenant, channel: "retail", source: "agent", contact, items, idempotencyKey: `agent:k${++seq}` });
  assert.equal(order.status, "pending_confirmation", JSON.stringify(order.issues));
  return order;
}
const enviar = (o: Order, opts: { contact?: typeof ANA; tenant?: string; checkout?: CheckoutData; policy?: AcceptancePolicy; document?: { type: string; number: string } | null } = {}) =>
  engine.submitForAcceptance({
    tenantId: opts.tenant ?? A.tenantId,
    contact: opts.contact ?? ANA,
    orderId: o.orderId,
    confirmationId: o.confirmation!.id,
    checkout: opts.checkout ?? DOMICILIO,
    policy: opts.policy ?? SIN_RESERVA,
    ...(opts.document !== undefined ? { document: opts.document } : {}),
  });
const aceptar = (o: Order, reservation: { kind: "platform" } | { kind: "ttl"; minutes: number } = { kind: "platform" }, tenant = A.tenantId) =>
  engine.acceptOrder({ tenantId: tenant, orderId: o.orderId, memberId: MIEMBRO, reservation });
const historial = (o: Order) => orders.history.filter((h) => h.orderId === o.id).map((h) => h.entry);
const esError = (code: string) => (e: unknown) => e instanceof OrderError && e.code === code;

// ===========================================================================
// 1. Enviar a aceptación
// ===========================================================================

describe("Aceptación · enviar (pending_confirmation -> pending_acceptance) NO es una venta", () => {
  it("queda pendiente de aceptación con sus datos, sin confirmedAt, etapa, pago ni checkout de venta", async () => {
    const p = await producto(A, "Licuadora", 5);
    const o = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 2 }]));
    assert.equal(o.status, "pending_acceptance");
    assert.equal(o.confirmedAt, null);
    assert.equal(o.checkout, null, "sin etapa ni estado de pago");
    assert.deepEqual(
      { ...o.acceptance },
      {
        customerName: "Laura Gómez",
        paymentMethod: "contra_entrega",
        delivery: "domicilio",
        address: "Calle 10 # 20-30",
        city: "Bogotá",
        deliveryReference: null,
        contactPhone: "3001234567",
        department: "Cundinamarca",
        neighborhood: "Chapinero",
        carrierOffice: null,
        noticeSentAt: null,
        customerReplyAt: null,
        reservationMinutes: null,
        expiresAt: null,
      },
    );
    assert.equal(nextStepOf(o), "wait_human");
    assert.ok(OPEN_STATUSES.includes("pending_acceptance"));
  });

  it("nunca pasa por 'confirmed' (no usa confirmOrder) y no cuenta como compra", async () => {
    const p = await producto(A, "Licuadora", 5);
    const o = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]));
    const cambios = historial(o).filter((h) => h.type === "order.status_changed");
    assert.deepEqual(cambios.map((h) => [h.from, h.to, h.actor, h.reason]), [["pending_confirmation", "pending_acceptance", "agent", "submitted_for_acceptance"]]);
    assert.ok(!sink.events.some((e) => e.order.status === "confirmed"), "ningún evento de venta confirmada");
    assert.equal(await engine.hasPurchase({ tenantId: A.tenantId, contact: ANA }), false, "las estadísticas de compra no lo ven");
    assert.equal(estadoVisible(o), "por_aceptar", "el panel nunca lo muestra como confirmado");
    assert.deepEqual(accionesPermitidas(o), [], "sin acciones de venta (etapas, pago, completar)");
  });

  it("sin reserva salvo política explícita: el stock no se toca", async () => {
    const p = await producto(A, "Licuadora", 5);
    await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 2 }]), { policy: SIN_RESERVA });
    assert.equal(stockDe(p.id), 5);
    assert.equal(orders.reservations.length, 0);
  });

  it("reserva con plazo PROPIO (nunca las 72 h de los confirmados)", async () => {
    const p = await producto(A, "Licuadora", 5);
    const o = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 2 }]), { policy: CON_RESERVA });
    assert.equal(stockDe(p.id), 3);
    assert.equal(o.acceptance?.reservationMinutes, 90);
    const r = orders.reservations.filter((x) => x.orderId === o.id);
    assert.deepEqual(r.map((x) => [x.quantity, x.status, x.expiresAt]), [[2, "activa", new Date(clock + 90 * MIN).toISOString()]]);
    assert.notEqual(r[0].expiresAt, new Date(clock + RESERVATION_TTL_MS).toISOString());
  });

  it("política faltante o inválida: no se envía nada (fail-closed) y el pedido sigue igual", async () => {
    const p = await producto(A, "Licuadora", 5);
    const o = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    const malas: unknown[] = [
      undefined,
      { reservation: { kind: "none" }, expiration: { kind: "none" } },
      { ...SIN_RESERVA, reservation: { kind: "ttl", minutes: 0 } },
      { ...SIN_RESERVA, reservation: { kind: "ttl", minutes: 43_201 } },
      { ...SIN_RESERVA, expiration: { kind: "after" } },
      { ...SIN_RESERVA, document: { kind: "required_for_office", allowedTypes: [], retention: { kind: "no_automatic_deletion" } } },
      { ...SIN_RESERVA, reservation: { kind: "72h" } },
    ];
    for (const policy of malas) {
      assert.equal(validAcceptancePolicy(policy as AcceptancePolicy), false, JSON.stringify(policy));
      await assert.rejects(
        engine.submitForAcceptance({ tenantId: A.tenantId, contact: ANA, orderId: o.orderId, confirmationId: o.confirmation!.id, checkout: DOMICILIO, policy: policy as AcceptancePolicy }),
        esError("INVALID_INPUT"),
        JSON.stringify(policy),
      );
    }
    const igual = await engine.getOrder({ tenantId: A.tenantId, contact: ANA, orderId: o.orderId });
    assert.equal(igual.status, "pending_confirmation");
  });

  it("idempotente: repetir el envío de la MISMA propuesta no cambia nada", async () => {
    const p = await producto(A, "Licuadora", 5);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    const uno = await enviar(prop, { policy: CON_RESERVA });
    const dos = await enviar(prop, { policy: CON_RESERVA });
    assert.equal(dos.status, "pending_acceptance");
    assert.equal(dos.updatedAt, uno.updatedAt);
    assert.equal(stockDe(p.id), 4, "una sola reserva");
    assert.equal(historial(uno).filter((h) => h.to === "pending_acceptance").length, 1);
  });

  it("solo la propuesta VIGENTE: vencida o ajena no se envía", async () => {
    const p = await producto(A, "Licuadora", 5);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    await assert.rejects(engine.submitForAcceptance({ tenantId: A.tenantId, contact: ANA, orderId: prop.orderId, confirmationId: "cf_0000000000000000", checkout: DOMICILIO, policy: SIN_RESERVA }), esError("CONFIRMATION_MISMATCH"));
    clock += 31 * MIN;
    await assert.rejects(enviar(prop), esError("CONFIRMATION_EXPIRED"));
  });

  it("si el precio cambió, vuelve a borrador con el problema (como confirmar)", async () => {
    const p = await producto(A, "Licuadora", 5);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    await admin.updateProduct(A, p.id, { retailPrice: 60_000 });
    await assert.rejects(enviar(prop), esError("PRICE_CHANGED"));
    assert.equal((await engine.getOrder({ tenantId: A.tenantId, contact: ANA, orderId: prop.orderId })).status, "draft");
  });

  it("con reserva y sin stock: OUT_OF_STOCK, vuelve a borrador y nada queda apartado", async () => {
    const p = await producto(A, "Licuadora", 2);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 2 }]);
    mem.inventory.setStock(p.id, 1);
    await assert.rejects(enviar(prop, { policy: CON_RESERVA }), esError("OUT_OF_STOCK"));
    assert.equal(stockDe(p.id), 1);
    assert.equal(orders.reservations.length, 0);
    assert.equal((await engine.getOrder({ tenantId: A.tenantId, contact: ANA, orderId: prop.orderId })).status, "draft");
  });

  it("vencimiento solo si la política lo trae", async () => {
    const p = await producto(A, "Licuadora", 5);
    const sin = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]));
    assert.equal(sin.acceptance?.expiresAt, null);
    const con = await enviar(await propuesta(BETO, [{ reference: p.reference, quantity: 1 }]), { contact: BETO, policy: { ...SIN_RESERVA, expiration: { kind: "after", minutes: 60 } } });
    assert.equal(con.acceptance?.expiresAt, new Date(clock + 60 * MIN).toISOString());
  });

  it("datos inválidos (teléfono, oficina sin entrega en oficina, domicilio sin dirección): no se envía", async () => {
    const p = await producto(A, "Licuadora", 5);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    for (const checkout of [
      { ...DOMICILIO, contactPhone: "300-123" },
      { ...DOMICILIO, carrierOffice: "Oficina Centro" },
      { ...DOMICILIO, address: null },
      { ...OFICINA, carrierOffice: null },
      { ...DOMICILIO, department: "x" },
    ]) {
      await assert.rejects(enviar(prop, { checkout }), esError("INVALID_INPUT"), JSON.stringify(checkout));
    }
  });
});

// ===========================================================================
// 2. Aceptar
// ===========================================================================

describe("Aceptación · aceptar (pending_acceptance -> confirmed) lo decide una PERSONA", () => {
  it("ahí empieza la venta: etapa 'confirmado', pago pendiente, confirmedAt y los datos nuevos en el checkout", async () => {
    const p = await producto(A, "Licuadora", 5);
    const pend = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 2 }]));
    clock += 10 * MIN;
    const { order, result } = await aceptar(pend);
    assert.equal(result, "ok");
    assert.equal(order.status, "confirmed");
    assert.equal(order.confirmedAt, new Date(clock).toISOString());
    assert.deepEqual(order.checkout, {
      customerName: "Laura Gómez",
      paymentMethod: "contra_entrega",
      paymentStatus: "pendiente",
      delivery: "domicilio",
      address: "Calle 10 # 20-30",
      city: "Bogotá",
      deliveryReference: null,
      stage: "confirmado",
      contactPhone: "3001234567",
      department: "Cundinamarca",
      neighborhood: "Chapinero",
      carrierOffice: null,
    });
    assert.equal(order.acceptance, null);
    assert.equal(await engine.hasPurchase({ tenantId: A.tenantId, contact: ANA }), true, "ahora sí es una compra");
    const ultimo = historial(order).filter((h) => h.type === "order.status_changed").at(-1)!;
    assert.deepEqual([ultimo.from, ultimo.to, ultimo.actor, ultimo.memberId], ["pending_acceptance", "confirmed", "human", MIEMBRO]);
  });

  it("aparta el stock al aceptar con el plazo elegido (plataforma o propio), contado desde la aceptación", async () => {
    const p = await producto(A, "Licuadora", 5);
    const uno = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]));
    clock += 5 * MIN;
    await aceptar(uno, { kind: "platform" });
    assert.deepEqual(orders.reservations.filter((r) => r.orderId === uno.id).map((r) => r.expiresAt), [new Date(clock + RESERVATION_TTL_MS).toISOString()]);
    // Con reserva mientras esperaba: al aceptar se renueva desde la aceptación (nunca queda el plazo anterior).
    const dos = await enviar(await propuesta(BETO, [{ reference: p.reference, quantity: 1 }]), { contact: BETO, policy: CON_RESERVA });
    clock += 30 * MIN;
    await aceptar(dos, { kind: "ttl", minutes: 240 });
    assert.deepEqual(orders.reservations.filter((r) => r.orderId === dos.id).map((r) => [r.quantity, r.status, r.expiresAt]), [[1, "activa", new Date(clock + 240 * MIN).toISOString()]]);
    assert.equal(stockDe(p.id), 3);
  });

  it("sin persona o sin política de reserva no se acepta", async () => {
    const p = await producto(A, "Licuadora", 5);
    const pend = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]));
    await assert.rejects(engine.acceptOrder({ tenantId: A.tenantId, orderId: pend.orderId, memberId: 0, reservation: { kind: "platform" } }), esError("FORBIDDEN"));
    await assert.rejects(engine.acceptOrder({ tenantId: A.tenantId, orderId: pend.orderId, memberId: MIEMBRO, reservation: undefined as never }), esError("INVALID_INPUT"));
    await assert.rejects(engine.acceptOrder({ tenantId: A.tenantId, orderId: pend.orderId, memberId: MIEMBRO, reservation: { kind: "ttl", minutes: 0 } }), esError("INVALID_INPUT"));
  });

  it("si ya no alcanza el stock, sigue PENDIENTE y se dice qué falta", async () => {
    const p = await producto(A, "Licuadora", 2);
    const pend = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 2 }]));
    mem.inventory.setStock(p.id, 1);
    await assert.rejects(aceptar(pend), esError("OUT_OF_STOCK"));
    const sigue = await engine.getOrder({ tenantId: A.tenantId, contact: ANA, orderId: pend.orderId });
    assert.equal(sigue.status, "pending_acceptance");
    assert.equal(stockDe(p.id), 1);
  });

  it("ni el agente ni el sistema aceptan; confirmOrder no puede saltarse la aceptación", async () => {
    assert.equal(canTransition("pending_acceptance", "confirmed", "agent"), false);
    assert.equal(canTransition("pending_acceptance", "confirmed", "system"), false);
    assert.equal(canTransition("pending_acceptance", "confirmed", "human"), true);
    const p = await producto(A, "Licuadora", 5);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    const pend = await enviar(prop);
    await assert.rejects(engine.confirmOrder({ tenantId: A.tenantId, contact: ANA, orderId: pend.orderId, confirmationId: prop.confirmation!.id, actor: "agent" }), esError("INVALID_TRANSITION"));
    await assert.rejects(
      orders.transition({ businessId: A.tenantId, id: pend.id, from: "pending_acceptance", to: "confirmed", actor: "agent", changes: { accept: { reservationMinutes: null }, confirmedAt: new Date(clock).toISOString() }, event: null }),
      InvalidTransition,
    );
  });

  it("aceptar dos veces no repite nada", async () => {
    const p = await producto(A, "Licuadora", 5);
    const pend = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]));
    await aceptar(pend);
    const otra = await aceptar(pend);
    assert.equal(otra.result, "duplicate");
    assert.equal(stockDe(p.id), 4);
  });

  it("los datos de un pendiente no se editan (solo se acepta o se cierra)", async () => {
    const p = await producto(A, "Licuadora", 5);
    const pend = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]));
    await assert.rejects(
      orders.transition({ businessId: A.tenantId, id: pend.id, from: "pending_acceptance", to: "pending_acceptance", actor: "human", changes: {}, event: null }),
      InvalidTransition,
    );
    const a = pend.acceptance!;
    const data = {
      customerName: a.customerName,
      paymentMethod: a.paymentMethod,
      delivery: a.delivery,
      address: "Otra dirección 1 # 2-3",
      city: a.city,
      deliveryReference: a.deliveryReference,
      contactPhone: a.contactPhone,
      department: a.department,
      neighborhood: a.neighborhood,
      carrierOffice: a.carrierOffice,
    };
    await assert.rejects(
      orders.transition({ businessId: A.tenantId, id: pend.id, from: "pending_acceptance", to: "cancelled", actor: "human", changes: { acceptance: { data, reservationMinutes: a.reservationMinutes, expiresAt: a.expiresAt, document: null } }, event: null }),
      InvalidTransition,
    );
  });
});

// ===========================================================================
// 3. Cerrar sin venta, vencimientos y abandono
// ===========================================================================

describe("Aceptación · cerrar sin venta, vencer (solo si se configura) y nunca heredar las 72 h", () => {
  it("una persona lo cancela o rechaza: se conserva el registro y se libera lo apartado", async () => {
    const p = await producto(A, "Licuadora", 5);
    const uno = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 2 }]), { policy: CON_RESERVA });
    const dos = await enviar(await propuesta(BETO, [{ reference: p.reference, quantity: 1 }]), { contact: BETO });
    assert.equal(stockDe(p.id), 3);
    const c = await engine.closeOrder({ tenantId: A.tenantId, orderId: uno.orderId, action: "cancel", memberId: MIEMBRO, reason: "el cliente no recibe" });
    assert.equal(c.order.status, "cancelled");
    assert.equal(c.order.acceptance?.customerName, "Laura Gómez");
    assert.equal(stockDe(p.id), 5);
    const r = await engine.closeOrder({ tenantId: A.tenantId, orderId: dos.orderId, action: "reject", memberId: MIEMBRO });
    assert.equal(r.order.status, "rejected");
    assert.equal(await engine.hasPurchase({ tenantId: A.tenantId, contact: ANA }), false);
  });

  it("nunca se 'completa' un pendiente; el cliente (sistema) no lo cancela por el bot", async () => {
    const p = await producto(A, "Licuadora", 5);
    const pend = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]));
    await assert.rejects(engine.closeOrder({ tenantId: A.tenantId, orderId: pend.orderId, action: "complete", memberId: MIEMBRO }), esError("INVALID_TRANSITION"));
    await assert.rejects(engine.cancelProposal({ tenantId: A.tenantId, contact: ANA, orderId: pend.orderId, reason: "checkout_cancelled_by_customer" }), esError("INVALID_TRANSITION"));
    assert.equal(canTransition("pending_acceptance", "cancelled", "system"), false);
  });

  it("el abandono de 72 h NO lo vence: queda para la persona responsable", async () => {
    const p = await producto(A, "Licuadora", 5);
    const pend = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]));
    clock += 30 * 24 * 60 * MIN;
    assert.equal(await engine.expireAbandonedOrders({}), 0);
    assert.equal(await engine.expireReservations(), 0);
    assert.equal(await engine.expireAcceptance(), 0, "sin políticas no vence nada");
    assert.equal((await engine.getOrder({ tenantId: A.tenantId, contact: ANA, orderId: pend.orderId })).status, "pending_acceptance");
  });

  it("vencimiento configurado: pasado el plazo vence y libera; la reserva vencida libera stock sin cerrar el pedido", async () => {
    const p = await producto(A, "Licuadora", 5);
    const vence = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]), { policy: { ...CON_RESERVA, expiration: { kind: "after", minutes: 120 } } });
    const reserva = await enviar(await propuesta(BETO, [{ reference: p.reference, quantity: 2 }]), { contact: BETO, policy: CON_RESERVA });
    assert.equal(stockDe(p.id), 2);
    clock += 91 * MIN; // pasó la reserva (90) de ambos, no el vencimiento (120)
    assert.equal(await engine.expireAcceptance(), 2);
    assert.equal(stockDe(p.id), 5, "el stock vuelve");
    assert.equal((await engine.getOrder({ tenantId: A.tenantId, contact: BETO, orderId: reserva.orderId })).status, "pending_acceptance", "el pedido sigue pendiente");
    clock += 30 * MIN; // pasó el vencimiento del primero
    assert.equal(await engine.expireAcceptance(), 1);
    const vencido = await engine.getOrder({ tenantId: A.tenantId, contact: ANA, orderId: vence.orderId });
    assert.equal(vencido.status, "expired");
    assert.deepEqual(historial(vencido).filter((h) => h.to === "expired").map((h) => [h.actor, h.reason]), [["system", "acceptance_expired"]]);
  });
});

// ===========================================================================
// 4. Aviso y respuesta del cliente
// ===========================================================================

describe("Aceptación · aviso y respuesta (una sola vez; la respuesta no acepta nada)", () => {
  it("el aviso se registra una vez; la respuesta solo después del aviso y sin cambiar el estado", async () => {
    const p = await producto(A, "Licuadora", 5);
    const pend = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]));
    await assert.rejects(engine.recordCustomerReply({ tenantId: A.tenantId, contact: ANA, orderId: pend.orderId }), esError("INVALID_TRANSITION"));
    const aviso = await engine.recordAcceptanceNotice({ tenantId: A.tenantId, contact: ANA, orderId: pend.orderId });
    assert.equal(aviso.acceptance?.noticeSentAt, new Date(clock).toISOString());
    clock += MIN;
    const otra = await engine.recordAcceptanceNotice({ tenantId: A.tenantId, contact: ANA, orderId: pend.orderId });
    assert.equal(otra.acceptance?.noticeSentAt, aviso.acceptance?.noticeSentAt, "no se reescribe");
    const resp = await engine.recordCustomerReply({ tenantId: A.tenantId, contact: ANA, orderId: pend.orderId });
    assert.equal(resp.status, "pending_acceptance", "decir que sí NO acepta el pedido");
    assert.equal(resp.acceptance?.customerReplyAt, new Date(clock).toISOString());
    assert.equal(resp.confirmedAt, null);
    assert.deepEqual(historial(pend).map((h) => h.type).filter((t) => t !== "order.created" && t !== "order.status_changed"), ["order.acceptance_notice_sent", "order.customer_replied"]);
  });

  it("en un pedido que no está pendiente de aceptación no se registra nada", async () => {
    const p = await producto(A, "Licuadora", 5);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    await assert.rejects(engine.recordAcceptanceNotice({ tenantId: A.tenantId, contact: ANA, orderId: prop.orderId }), esError("INVALID_TRANSITION"));
  });
});

// ===========================================================================
// 5. Documento
// ===========================================================================

describe("Aceptación · documento (solo oficina, cifrado, enmascarado, nunca en registros)", () => {
  it("con oficina y política que lo pide: se guarda CIFRADO (v1 real) y solo se ve enmascarado", async () => {
    const p = await producto(A, "Licuadora", 5);
    const pend = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]), { checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "cc", number: DOC_NUMERO } });
    assert.equal(pend.acceptance?.carrierOffice, "Oficina Centro");
    assert.equal(orders.documents.length, 1);
    const d = orders.documents[0];
    assert.match(d.cipherText, /^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/, "mismo formato que exige la BD");
    assert.ok(!d.cipherText.includes("1020345678"), "nunca en claro");
    assert.equal(descifrarSecreto(d.cipherText), normalizeDocumentNumber(DOC_NUMERO), "se puede descifrar con la clave del servidor");
    assert.deepEqual(await engine.acceptanceDocument(A.tenantId, pend), { type: "cc", masked: maskDocument("5678") });
    assert.equal(d.deleteAfter, null, "sin borrado automático: lo dice la política, no el código");
  });

  it("el número nunca aparece en el pedido, los eventos, el historial, los registros ni la consola", async () => {
    const p = await producto(A, "Licuadora", 5);
    const salida: string[] = [];
    const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    for (const k of ["log", "info", "warn", "error"] as const) console[k] = (...a: unknown[]) => salida.push(a.map(String).join(" "));
    let pend: Order;
    try {
      pend = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]), { checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "cc", number: DOC_NUMERO } });
      await engine.submitForAcceptance({ tenantId: A.tenantId, contact: ANA, orderId: pend.orderId, confirmationId: "cf_0000000000000000", checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "cc", number: DOC_NUMERO } }).catch(() => null);
    } finally {
      Object.assign(console, original);
    }
    const todo = JSON.stringify([pend!, sink.events, orders.history, orders.events, logs, salida, orders.orders]);
    for (const forma of ["1020345678", "1.020.345.678", "020345678"]) assert.ok(!todo.includes(forma), `el documento (${forma}) se filtró`);
  });

  it("retención por días: fecha de borrado según la política", async () => {
    const p = await producto(A, "Licuadora", 5);
    const policy: AcceptancePolicy = { ...SIN_RESERVA, document: { kind: "required_for_office", allowedTypes: ["cc"], retention: { kind: "days", days: 30 } } };
    await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]), { checkout: OFICINA, policy, document: { type: "cc", number: DOC_NUMERO } });
    assert.equal(orders.documents[0].deleteAfter, new Date(clock + 30 * 24 * 60 * MIN).toISOString());
  });

  it("solo cuando corresponde: falta, tipo no permitido, número inválido, sin oficina o sin política => no se envía", async () => {
    const p = await producto(A, "Licuadora", 5);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    const casos: Array<[string, Parameters<typeof enviar>[1]]> = [
      ["falta con oficina", { checkout: OFICINA, policy: CON_DOCUMENTO, document: null }],
      ["tipo no permitido", { checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "pasaporte", number: DOC_NUMERO } }],
      ["número inválido", { checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "cc", number: "12" } }],
      ["domicilio con documento", { checkout: DOMICILIO, policy: CON_DOCUMENTO, document: { type: "cc", number: DOC_NUMERO } }],
      ["política sin documento", { checkout: OFICINA, policy: SIN_RESERVA, document: { type: "cc", number: DOC_NUMERO } }],
    ];
    for (const [nombre, opts] of casos) await assert.rejects(enviar(prop, opts), esError("INVALID_INPUT"), nombre);
    assert.equal(orders.documents.length, 0);
  });

  it("sin cifrador no se guarda ningún documento (UNAVAILABLE), nunca en claro", async () => {
    engine = buildEngine({ documentCipher: null });
    const p = await producto(A, "Licuadora", 5);
    await assert.rejects(enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]), { checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "cc", number: DOC_NUMERO } }), esError("UNAVAILABLE"));
    engine = buildEngine({ documentCipher: { encrypt: (s) => s } }); // un "cifrador" que devuelve el texto en claro
    await assert.rejects(enviar(await propuesta(BETO, [{ reference: p.reference, quantity: 1 }]), { contact: BETO, checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "cc", number: DOC_NUMERO } }), esError("UNAVAILABLE"));
    assert.equal(orders.documents.length, 0);
  });

  it("el documento se va con el pedido cuando se elimina", async () => {
    const p = await producto(A, "Licuadora", 5);
    const pend = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]), { checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "cc", number: DOC_NUMERO } });
    await engine.closeOrder({ tenantId: A.tenantId, orderId: pend.orderId, action: "cancel", memberId: MIEMBRO });
    assert.equal(await engine.deleteClosedOrder({ tenantId: A.tenantId, orderId: pend.orderId, memberId: MIEMBRO }), "eliminado");
    assert.equal(orders.documents.length, 0);
  });
});

// ===========================================================================
// 6. Multi-negocio
// ===========================================================================

describe("Aceptación · multi-negocio: B nunca toca lo de A", () => {
  it("B no envía, acepta, cierra, marca ni lee el documento de un pedido de A", async () => {
    const p = await producto(A, "Licuadora", 5);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    await assert.rejects(enviar(prop, { tenant: B.tenantId }), esError("NOT_FOUND"));
    const pend = await enviar(prop, { checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "cc", number: DOC_NUMERO } });
    await assert.rejects(aceptar(pend, { kind: "platform" }, B.tenantId), esError("NOT_FOUND"));
    await assert.rejects(engine.closeOrder({ tenantId: B.tenantId, orderId: pend.orderId, action: "cancel", memberId: MIEMBRO }), esError("NOT_FOUND"));
    await assert.rejects(engine.recordAcceptanceNotice({ tenantId: B.tenantId, contact: ANA, orderId: pend.orderId }), esError("NOT_FOUND"));
    assert.equal(await engine.acceptanceDocument(B.tenantId, pend), null);
    assert.equal(await orders.documentFor!(B.tenantId, pend.id), null);
    assert.equal(await orders.getByOrderId(B.tenantId, pend.orderId), null, "B no lee el pedido de A");
    assert.equal((await engine.getOrder({ tenantId: A.tenantId, contact: ANA, orderId: pend.orderId })).status, "pending_acceptance", "A sigue intacto");
  });

  it("otra conversación del MISMO negocio tampoco envía ni marca el pedido de esta", async () => {
    const p = await producto(A, "Licuadora", 5);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    await assert.rejects(enviar(prop, { contact: BETO }), esError("NOT_FOUND"));
    const pend = await enviar(prop);
    await assert.rejects(engine.recordAcceptanceNotice({ tenantId: A.tenantId, contact: BETO, orderId: pend.orderId }), esError("NOT_FOUND"));
  });

  it("B no usa el catálogo de A: la referencia de A no existe para B", async () => {
    const p = await producto(A, "Licuadora", 5);
    await assert.rejects(
      engine.createOrder({ tenantId: B.tenantId, channel: "retail", source: "agent", contact: BETO, items: [{ reference: p.reference, quantity: 1 }], idempotencyKey: "agent:b1" }),
      esError("REFERENCE_NOT_FOUND"),
    );
  });
});

// ===========================================================================
// 7. El flujo de siempre (Delacour) no cambia
// ===========================================================================

describe("Aceptación · el checkout de siempre (Delacour) no cambia", () => {
  it("confirmar sigue igual: confirmado con etapa, pago pendiente y reserva de 72 h; sin datos de aceptación", async () => {
    const p = await producto(A, "Anillo", 3);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    const o = await engine.confirmOrder({
      tenantId: A.tenantId,
      contact: ANA,
      orderId: prop.orderId,
      confirmationId: prop.confirmation!.id,
      actor: "agent",
      checkout: { customerName: "Ana Ruiz", paymentMethod: "transferencia", delivery: "tienda", address: null, city: null, deliveryReference: null },
    });
    assert.equal(o.status, "confirmed");
    assert.deepEqual(o.checkout, { customerName: "Ana Ruiz", paymentMethod: "transferencia", paymentStatus: "pendiente", delivery: "tienda", address: null, city: null, deliveryReference: null, stage: "confirmado" });
    assert.equal(o.acceptance, undefined, "un pedido de siempre no tiene datos de aceptación");
    assert.deepEqual(orders.reservations.map((r) => r.expiresAt), [new Date(clock + RESERVATION_TTL_MS).toISOString()]);
    assert.equal(estadoVisible(o), "confirmado");
  });

  it("confirmar directo con oficina o datos nuevos se rechaza (solo existen con aceptación)", async () => {
    const p = await producto(A, "Anillo", 3);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    for (const checkout of [OFICINA, { ...DOMICILIO, paymentMethod: "transferencia" as const }]) {
      await assert.rejects(engine.confirmOrder({ tenantId: A.tenantId, contact: ANA, orderId: prop.orderId, confirmationId: prop.confirmation!.id, actor: "agent", checkout }), esError("INVALID_INPUT"));
    }
  });

  it("pasar la conversación a una persona no mueve un pendiente a 'handoff'", async () => {
    const p = await producto(A, "Licuadora", 5);
    const pend = await enviar(await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]));
    const r = await engine.requestHandoff({ tenantId: A.tenantId, contact: ANA, reason: "pedido pendiente de aceptación", orderId: pend.orderId, actor: "system", pauseUntil: "released" });
    assert.equal(r.paused, true);
    assert.equal(r.order?.status, "pending_acceptance");
  });

  it("la máquina de estados solo agrega las transiciones de la aceptación", () => {
    const nuevas = allowedTransitions().filter((t) => t.from === "pending_acceptance" || t.to === "pending_acceptance");
    assert.deepEqual(
      nuevas.map((t) => `${t.from}->${t.to}:${[...t.actors].join(",")}`).sort(),
      ["pending_acceptance->cancelled:human", "pending_acceptance->confirmed:human", "pending_acceptance->expired:system", "pending_acceptance->rejected:human", "pending_confirmation->pending_acceptance:agent"],
    );
    // Las de siempre siguen iguales (muestra).
    assert.equal(canTransition("pending_confirmation", "confirmed", "agent"), true);
    assert.equal(canTransition("confirmed", "expired", "system"), true);
    assert.equal(canTransition("pending_acceptance", "handoff", "system"), false);
  });
});

// ===========================================================================
// 8. Orden de despliegue: el código puede llegar ANTES que la migración 20261207000000
// ===========================================================================

describe("Aceptación · repositorio Supabase sin la migración nueva (orden de despliegue indiferente)", () => {
  it("sin las columnas nuevas se lee como antes (una sola consulta fallida por proceso) y lo nuevo responde 'nada'", async () => {
    const db = installSupabaseMemoria(process.env.SUPABASE_URL);
    const real = globalThis.fetch;
    const selects: string[] = [];
    // Postgres sin la migración: pedir una columna nueva => 42703.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const u = new URL(req.url);
      if (u.pathname.endsWith("/dulabs_catalogo_pedidos") && req.method === "GET") {
        const sel = u.searchParams.get("select") ?? "";
        selects.push(sel);
        if (sel.includes("telefono_contacto")) return new Response(JSON.stringify({ code: "42703", message: 'column "telefono_contacto" does not exist', details: null, hint: null }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return real(input, init);
    }) as typeof fetch;
    try {
      db.table("dulabs_catalogo_pedidos").push({
        id: "00000000-0000-4000-8000-0000000000d1", id_tenant: A.tenantId, pedido_publico: "DL-ORD-7F42KQ", canal: "retail", origen: "agent", estado: "confirmed",
        clave_idempotencia: "agent:clave-delacour-1", huella_solicitud: null, contacto_phone_number_id: ANA.phoneNumberId, contacto_wa_id: ANA.waId,
        lineas: [{ reference: "DL-000184", product_name: "Anillo", quantity: 1, unit_price: 50000, subtotal: 50000 }], total_unidades: 1, total: 50000, unidades_sin_precio: 0,
        moneda: "COP", problemas: [], confirmacion: null, handoff: null, created_at: "2026-10-01T10:00:00.000Z", updated_at: "2026-10-01T10:00:00.000Z",
        checkout: true, cliente_nombre: "Ana Ruiz", metodo_pago: "transferencia", estado_pago: "pendiente", tipo_entrega: "tienda", direccion: null, ciudad: null,
        referencia_entrega: null, etapa: "confirmado", confirmado_at: "2026-10-01T10:00:00.000Z",
      });
      const repo = createSupabaseOrdersRepository(supabaseAdmin());
      const o = await repo.getByOrderId(A.tenantId, "DL-ORD-7F42KQ");
      assert.deepEqual(o?.checkout, { customerName: "Ana Ruiz", paymentMethod: "transferencia", paymentStatus: "pendiente", delivery: "tienda", address: null, city: null, deliveryReference: null, stage: "confirmado" });
      assert.equal(o?.acceptance, undefined);
      await repo.getByOrderId(A.tenantId, "DL-ORD-7F42KQ");
      assert.equal(selects.filter((s) => s.includes("telefono_contacto")).length, 1, "la columna inexistente se intenta una sola vez");
      assert.ok(selects.at(-1)?.includes("cliente_nombre") && !selects.at(-1)?.includes("telefono_contacto"), "después lee con las columnas de siempre");
      // Lo nuevo, sin migración: nada que vencer y ningún documento (no rompe).
      db.missing("dulabs_catalogo_pedido_documentos");
      assert.equal(await repo.expireAcceptance!(10), 0);
      assert.equal(await repo.documentFor!(A.tenantId, "00000000-0000-4000-8000-0000000000d1"), null);
    } finally {
      globalThis.fetch = real;
      db.uninstall();
    }
  });
});
