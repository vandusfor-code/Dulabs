/**
 * FASE 3B.7 — PANEL OPERATIVO "POR ACEPTAR": lo que el panel muestra y permite sobre los pedidos pendientes de
 * aceptación humana. TODO en memoria, con las MISMAS reglas que la BD (repositorio de pedidos en memoria) y el
 * motor real. Los manejadores son los mismos que usan las rutas.
 *
 *   1. Lista: vacía, con pendientes, orden, paginación por cursor sin tope silencioso, datos incompletos.
 *   2. Detalle: todo lo que la persona necesita; documento SOLO enmascarado; un pedido ya procesado devuelve su
 *      estado actual (no un error) y nunca datos del cliente.
 *   3. Acceso: quién puede decidir (responsable, respaldo, admins si el negocio lo eligió), quién no.
 *   4. Aceptar / rechazar / cancelar: acceptOrder (nunca confirmOrder), estado incorrecto, doble clic, a la vez.
 *   5. Conversación y responsable: se enlaza el Inbox que ya existe; quién la tiene; IA pausada.
 *   6. Multi-negocio: cada negocio ve y decide SOLO lo suyo; nada que llegue del cliente web cambia el negocio.
 *   7. Gancho de la Fase 3B.8: se llama una vez por decisión aplicada; en producción no hay ninguno.
 *
 * Negocios, personas, clientes, productos y políticas FICTICIOS. Nada toca Supabase, Gemini ni Meta.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString("base64");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine, type CheckoutData, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import type { AcceptancePolicy, Order } from "@/lib/catalogo/pedidos/contrato";
import { camposFaltantes, decidirPorAceptar, detallePorAceptar, listarPorAceptar, type DecisionPorAceptar, type PedidoPorAceptar, type PorAceptarCtx } from "@/lib/catalogo/pedidos/por-aceptar";
import { productionPorAceptarCtx } from "@/lib/catalogo/pedidos/por-aceptar-produccion";
import type { PanelFuentes } from "@/lib/catalogo/pedidos/panel";
import { canalPanel, createAcceptanceRouter, createMemoryAsignacionesStore, type ConfigAceptacion } from "@/lib/agente/aceptacion-humana";
import { createMemoryMiembrosStore, type MiembroEquipo } from "@/lib/agente/responsable";
import { cifrarSecreto } from "@/lib/crypto";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const PN_A = "100000000000001";
const PN_B = "100000000000002";
const ANA = { phoneNumberId: PN_A, waId: "573001110001" };
const BETO = { phoneNumberId: PN_B, waId: "573001110002" };
const DOC = "1.020.345.678";
const MIN = 60_000;

const RESPONSABLE_A = 41;
const ADMIN_A = 42;
const RESPALDO_A = 43;
const AGENTE_A = 44;
const RESPONSABLE_B = 51;
const ADMIN_B = 52;
const NOMBRES = new Map<number, string>([
  [RESPONSABLE_A, "Responsable A"],
  [ADMIN_A, "Admin A"],
  [RESPALDO_A, "Respaldo A"],
  [AGENTE_A, "Agente A"],
  [RESPONSABLE_B, "Responsable B"],
  [ADMIN_B, "Admin B"],
]);
const MIEMBROS: MiembroEquipo[] = [
  { id: RESPONSABLE_A, tenantId: A.tenantId, estado: "activo", rol: "agente", email: null },
  { id: ADMIN_A, tenantId: A.tenantId, estado: "activo", rol: "admin", email: null },
  { id: RESPALDO_A, tenantId: A.tenantId, estado: "activo", rol: "agente", email: null },
  { id: AGENTE_A, tenantId: A.tenantId, estado: "activo", rol: "agente", email: null },
  { id: RESPONSABLE_B, tenantId: B.tenantId, estado: "activo", rol: "agente", email: null },
  { id: ADMIN_B, tenantId: B.tenantId, estado: "activo", rol: "admin", email: null },
];

const SIN_RESERVA: AcceptancePolicy = { reservation: { kind: "none" }, expiration: { kind: "none" }, document: { kind: "not_collected" } };
const CON_DOCUMENTO: AcceptancePolicy = { ...SIN_RESERVA, document: { kind: "required_for_office", allowedTypes: ["no_especificado"], retention: { kind: "no_automatic_deletion" } } };
const DOMICILIO: CheckoutData = { customerName: "Laura Gómez", paymentMethod: "contra_entrega", delivery: "domicilio", address: "Calle 10 # 20-30", city: "Bogotá", deliveryReference: "Portería azul", contactPhone: "573001234567", department: "Cundinamarca", neighborhood: "Chapinero" };
const OFICINA: CheckoutData = { customerName: "Laura Gómez", paymentMethod: "contra_entrega", delivery: "oficina_transportadora", address: null, city: "Medellín", deliveryReference: null, contactPhone: "573001234567", department: "Antioquia", neighborhood: null, carrierOffice: "Oficina Centro" };

const configA = (over: Partial<ConfigAceptacion> = {}): ConfigAceptacion => ({
  responsable: { miembro_id: RESPONSABLE_A, respaldo_miembro_id: RESPALDO_A, canales: ["panel"] },
  aceptan: "solo_responsable",
  reservaTrasAceptar: { kind: "platform" },
  textoTrasAviso: "Respuesta de prueba tras el aviso",
  siYaRespondioPersona: "no_responder",
  notaEnvio: "Envío GRATIS",
  ...over,
});
const configB = (): ConfigAceptacion => configA({ responsable: { miembro_id: RESPONSABLE_B, respaldo_miembro_id: null, canales: ["panel"] }, notaEnvio: null });

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let pedidos: ReturnType<typeof createMemoryOrdersRepository>;
let engine: OrderEngine;
let asign: ReturnType<typeof createMemoryAsignacionesStore>;
let llamadas: { confirmOrder: number; acceptOrder: number };
let configs: Map<string, ConfigAceptacion | null>;
let atenciones: Map<string, { pausadaHasta: string | null; conversacion: "open" | "pending" | "closed" | null }>;
let reloj: number;
let seq: number;

const lector = async (tenantId: string, phoneNumberId: string) => configs.get(`${tenantId}|${phoneNumberId}`) ?? null;

function construir() {
  const miembros = createMemoryMiembrosStore(MIEMBROS);
  const router = createAcceptanceRouter({
    config: lector,
    miembros,
    asignaciones: { asignar: async (i) => asign.asignar(i) },
    notificador: { canales: { panel: canalPanel } },
    handoff: { pauseConversation: async () => ({ ok: true }) },
    log: () => {},
  });
  const motor = createOrderEngine({
    orders: pedidos,
    catalog: mem.repo,
    key: Buffer.alloc(32, 5),
    sink: memoryOrderEventSink(),
    log: () => {},
    now: () => new Date(reloj),
    documentCipher: { encrypt: cifrarSecreto },
    handoff: { pauseConversation: async () => ({ ok: true }) },
    acceptanceRouter: { check: (i) => router.check(i), route: (i) => router.route(i) },
  });
  // Espías: aceptar usa acceptOrder y NUNCA confirmOrder.
  const confirmOrder = motor.confirmOrder;
  const acceptOrder = motor.acceptOrder;
  motor.confirmOrder = async (i) => {
    llamadas.confirmOrder++;
    return confirmOrder(i);
  };
  motor.acceptOrder = async (i) => {
    llamadas.acceptOrder++;
    return acceptOrder(i);
  };
  return motor;
}

beforeEach(() => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  reloj = Date.parse("2026-10-02T15:00:00Z");
  pedidos = createMemoryOrdersRepository({ inventory: mem.inventory, now: () => reloj });
  asign = createMemoryAsignacionesStore({ [PN_A]: A.tenantId, [PN_B]: B.tenantId });
  llamadas = { confirmOrder: 0, acceptOrder: 0 };
  atenciones = new Map();
  configs = new Map([
    [`${A.tenantId}|${PN_A}`, configA()],
    [`${B.tenantId}|${PN_B}`, configB()],
  ]);
  seq = 0;
  engine = construir();
  for (const actor of [A, B]) {
    mem.setProfile(actor.tenantId, { name: "Tienda", whatsapp: "573001110000" });
    mem.enableModule(actor.tenantId);
  }
});

const producto = (actor: CatalogActor, name: string, stock: number, price = 50_000) => admin.createProduct(actor, { name, retailPrice: price, stock });
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
/** Un pedido PENDIENTE DE ACEPTACIÓN con el aviso ya enviado (como lo deja el checkout). */
async function pendiente(opts: { qty?: number; stock?: number; checkout?: CheckoutData; policy?: AcceptancePolicy; contact?: typeof ANA; document?: { type: string; number: string } | null; sinAviso?: boolean; producto?: Awaited<ReturnType<typeof producto>> } = {}) {
  const p = opts.producto ?? (await producto(A, "Licuadora", opts.stock ?? 5));
  const o = await enviar(await propuesta(opts.contact ?? ANA, [{ reference: p.reference, quantity: opts.qty ?? 1 }]), { checkout: opts.checkout, policy: opts.policy, contact: opts.contact, document: opts.document });
  const conAviso = opts.sinAviso ? o : await engine.recordAcceptanceNotice({ tenantId: A.tenantId, contact: opts.contact ?? ANA, orderId: o.orderId });
  return { producto: p, orden: conAviso };
}

// --- Panel -------------------------------------------------------------------
const fuentes = (): PanelFuentes => ({
  nombres: async () => new Map(),
  canales: async () => new Map(),
  confirmados: async () => new Map(),
  asignadas: async () => new Map([...asign.filas].filter(([, m]) => m !== null).map(([k, m]) => [k, NOMBRES.get(m as number) ?? `Miembro ${m}`])),
  fotos: async () => new Map(),
  miembros: async (_t, ids) => new Map(ids.map((i) => [i, NOMBRES.get(i) ?? `Miembro ${i}`])),
  atencion: async () => atenciones,
});
type Persona = { miembroId: number; esAdmin: boolean };
const RESP: Persona = { miembroId: RESPONSABLE_A, esAdmin: false };
const ctxA = (persona: Persona = RESP, over: Partial<PorAceptarCtx> = {}): PorAceptarCtx => ({
  engine,
  tenantId: A.tenantId,
  persona,
  extras: { fuentes: fuentes(), verTelefono: true },
  config: (pn) => lector(A.tenantId, pn),
  ...over,
});
const ctxB = (persona: Persona = { miembroId: RESPONSABLE_B, esAdmin: false }): PorAceptarCtx => ({
  engine,
  tenantId: B.tenantId,
  persona,
  extras: { fuentes: fuentes(), verTelefono: true },
  config: (pn) => lector(B.tenantId, pn),
});
type Resp = { success: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
const leer = async (r: Response): Promise<{ status: number; body: Resp }> => ({ status: r.status, body: (await r.json()) as Resp });
const pagina = async (ctx: PorAceptarCtx, params: Record<string, string> = {}) => leer(await listarPorAceptar(ctx, new URLSearchParams(params)));
const lista = async (ctx: PorAceptarCtx) => ((await pagina(ctx)).body.data?.pedidos ?? []) as PedidoPorAceptar[];
const detalle = async (ctx: PorAceptarCtx, pedido: string) => leer(await detallePorAceptar(ctx, pedido));
const decidir = async (ctx: PorAceptarCtx, pedido: string, accion: string, motivo?: string) => leer(await decidirPorAceptar(ctx, pedido, { accion, ...(motivo ? { motivo } : {}) }));
const estadoDe = (o: Order) => pedidos.orders.find((x) => x.id === o.id)!.status;
const reservasActivas = (o: Order) => pedidos.reservations.filter((r) => r.orderId === o.id && r.status === "activa").length;

// ===========================================================================
// 1. Lista
// ===========================================================================
describe("3B.7 · lista de pedidos por aceptar", () => {
  it("A) lista vacía: sin pedidos y sin cursor (no es un error)", async () => {
    const r = await pagina(ctxA());
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, { pedidos: [], siguiente: null });
  });

  it("B) lista con pendientes: cada fila trae lo que la persona necesita, y el estado es 'por aceptar' (nunca confirmado)", async () => {
    const { orden } = await pendiente({ qty: 2 });
    const [v] = await lista(ctxA());
    assert.equal(v.pedido, orden.orderId);
    assert.equal(v.estado, "por_aceptar");
    assert.equal(v.unidades, 2);
    assert.equal(v.total, 100_000);
    assert.equal(v.lineas.length, 1);
    assert.equal(v.lineas[0].nombre, "Licuadora");
    assert.equal(v.lineas[0].cantidad, 2);
    assert.match(v.lineas[0].referencia, /\S/);
    assert.equal(v.pago, "contra_entrega");
    assert.equal(v.entrega, "domicilio");
    assert.equal(v.envio, "Envío GRATIS");
    assert.deepEqual({ ...v.cliente, telefono_parcial: undefined }, {
      nombre: "Laura Gómez",
      telefono: "573001234567",
      telefono_parcial: undefined,
      ciudad: "Bogotá",
      departamento: "Cundinamarca",
      direccion: "Calle 10 # 20-30",
      barrio: "Chapinero",
      referencia_entrega: "Portería azul",
      oficina: null,
    });
    assert.ok(v.aviso_enviado, "el aviso quedó registrado");
    assert.equal(v.respuesta_cliente, null, "el cliente todavía no respondió");
    assert.deepEqual(v.faltantes, []);
    assert.equal(Date.parse(v.creado) > 0, true);
    assert.equal(v.version.estado, "pending_acceptance");
    assert.equal(estadoDe(orden), "pending_acceptance", "listar no cambia nada");
  });

  it("B2) el cliente respondió 'sí': aparece la fecha, pero el pedido SIGUE pendiente (el 'sí' no acepta)", async () => {
    const { orden } = await pendiente();
    await engine.recordCustomerReplyOnce({ tenantId: A.tenantId, contact: ANA, orderId: orden.orderId });
    const [v] = await lista(ctxA());
    assert.ok(v.respuesta_cliente);
    assert.equal(v.estado, "por_aceptar");
    assert.equal(estadoDe(orden), "pending_acceptance");
    assert.equal(pedidos.reservations.length, 0);
  });

  it("orden: más recientes primero (por creación y número público), estable entre páginas", async () => {
    const p = await producto(A, "Licuadora", 50);
    const creados: string[] = [];
    for (let i = 0; i < 5; i++) {
      reloj += MIN;
      creados.push((await pendiente({ producto: p })).orden.orderId);
    }
    const vistos = (await lista(ctxA())).map((v) => v.pedido);
    assert.deepEqual(vistos, [...creados].reverse());
  });

  it("paginación por cursor: páginas de 2, sin repetir ni perder ninguno, y el último trae siguiente = null", async () => {
    const p = await producto(A, "Licuadora", 50);
    const creados: string[] = [];
    for (let i = 0; i < 5; i++) {
      reloj += MIN;
      creados.push((await pendiente({ producto: p })).orden.orderId);
    }
    const vistos: string[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const r = await pagina(ctxA(), { limite: "2", ...(cursor ? { cursor } : {}) });
      assert.equal(r.status, 200);
      const data = r.body.data as { pedidos: PedidoPorAceptar[]; siguiente: string | null };
      assert.ok(data.pedidos.length <= 2);
      vistos.push(...data.pedidos.map((v) => v.pedido));
      cursor = data.siguiente;
      paginas++;
    } while (cursor && paginas < 10);
    assert.equal(paginas, 3);
    assert.equal(new Set(vistos).size, 5, "sin repetidos");
    assert.deepEqual(vistos, [...creados].reverse());
  });

  it("sin tope silencioso: más de 100 pendientes se recorren completos (antes se cortaba en 100)", async () => {
    const p = await producto(A, "Licuadora", 500);
    for (let i = 0; i < 105; i++) {
      reloj += 1_000;
      await pendiente({ producto: p });
    }
    const vistos = new Set<string>();
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const r = await pagina(ctxA(), { limite: "50", ...(cursor ? { cursor } : {}) });
      const data = r.body.data as { pedidos: PedidoPorAceptar[]; siguiente: string | null };
      for (const v of data.pedidos) vistos.add(v.pedido);
      cursor = data.siguiente;
      paginas++;
    } while (cursor && paginas < 10);
    assert.equal(vistos.size, 105);
    assert.equal(paginas, 3);
  });

  it("parámetros inválidos: limite fuera de 1..50 o no entero, y cursor que no emitimos => 400 (no se interpretan)", async () => {
    await pendiente();
    for (const limite of ["0", "51", "-1", "2.5", "abc", ""]) assert.equal((await pagina(ctxA(), { limite })).status, 400, `limite=${limite}`);
    for (const cursor of ["x", "no-es-un-cursor", Buffer.from("{}").toString("base64url"), Buffer.from(JSON.stringify({ c: "ayer", p: "DL-ORD-AAAAAA" })).toString("base64url"), "a".repeat(300)]) {
      const r = await pagina(ctxA(), { cursor });
      assert.equal(r.status, 400, cursor.slice(0, 20));
      assert.equal(r.body.error?.code, "VALIDATION_ERROR");
    }
  });

  it("un cursor de otro negocio no trae pedidos de otro negocio (el negocio sale de la sesión, no del cursor)", async () => {
    const { orden: deA } = await pendiente();
    const pb = await producto(B, "Anillo", 3);
    const ob = await engine.createOrder({ tenantId: B.tenantId, channel: "retail", source: "agent", contact: BETO, items: [{ reference: pb.reference, quantity: 1 }], idempotencyKey: "agent:b1" });
    await engine.submitForAcceptance({ tenantId: B.tenantId, contact: BETO, orderId: ob.order.orderId, confirmationId: ob.order.confirmation!.id, checkout: DOMICILIO, policy: SIN_RESERVA });
    const primera = await pagina(ctxB(), { limite: "1" });
    assert.equal((primera.body.data!.pedidos as PedidoPorAceptar[]).length, 1);
    const cursorDeB = primera.body.data!.siguiente as string | null;
    // Con el cursor que apunta "después" de lo más nuevo de A, B igual solo ve lo suyo.
    const forzado = Buffer.from(JSON.stringify({ c: new Date(reloj + DIA).toISOString(), p: deA.orderId })).toString("base64url");
    const r = await pagina(ctxB(), { cursor: forzado });
    assert.equal(r.status, 200);
    assert.ok(!(r.body.data!.pedidos as PedidoPorAceptar[]).some((v) => v.pedido === deA.orderId));
    assert.equal(cursorDeB, null);
  });

  it("datos incompletos: faltantes por modalidad (la lista los marca; el pedido sigue siendo visible y decidible)", async () => {
    // El motor ya exige nombre, dirección y ciudad (domicilio); el negocio decide lo demás: el panel marca lo que falte.
    const incompleto: CheckoutData = { ...DOMICILIO, department: null, neighborhood: null, contactPhone: null };
    const { orden } = await pendiente({ checkout: incompleto });
    const [v] = await lista(ctxA());
    assert.equal(v.pedido, orden.orderId);
    assert.deepEqual(v.faltantes, ["telefono", "departamento", "barrio"]);
    assert.equal(v.puede_decidir, true);
    assert.equal(v.cliente.telefono, null);
  });

  it("camposFaltantes: tienda solo exige nombre y teléfono; oficina exige ciudad, departamento y oficina", () => {
    const base = { customerName: "Laura", paymentMethod: "contra_entrega", delivery: "tienda", address: null, city: null, deliveryReference: null, contactPhone: "573001234567", department: null, neighborhood: null, carrierOffice: null, noticeSentAt: null, customerReplyAt: null, reservationMinutes: null, expiresAt: null } as const;
    assert.deepEqual(camposFaltantes({ ...base }), []);
    assert.deepEqual(camposFaltantes({ ...base, customerName: " ", contactPhone: "" }), ["nombre", "telefono"]);
    assert.deepEqual(camposFaltantes({ ...base, delivery: "oficina_transportadora" }), ["ciudad", "departamento", "oficina"]);
    assert.deepEqual(camposFaltantes({ ...base, delivery: "oficina_transportadora", city: "Cali", department: "Valle", carrierOffice: "Oficina 1" }), []);
  });

  it("la lista solo trae pendientes: un pedido ya aceptado, rechazado o cancelado no aparece", async () => {
    const p = await producto(A, "Licuadora", 20);
    const a = (await pendiente({ producto: p })).orden;
    const r = (await pendiente({ producto: p })).orden;
    const c = (await pendiente({ producto: p })).orden;
    const quedan = (await pendiente({ producto: p })).orden;
    assert.equal((await decidir(ctxA(), a.orderId, "aceptar")).status, 200);
    assert.equal((await decidir(ctxA(), r.orderId, "rechazar", "motivo de prueba")).status, 200);
    assert.equal((await decidir(ctxA(), c.orderId, "cancelar", "motivo de prueba")).status, 200);
    assert.deepEqual((await lista(ctxA())).map((v) => v.pedido), [quedan.orderId]);
  });

  it("sin motor de pedidos (módulo apagado / sin migración): 503 claro, no un error interno", async () => {
    const r = await leer(await listarPorAceptar({ ...ctxA(), engine: null }));
    assert.equal(r.status, 503);
    assert.equal(r.body.error?.code, "UNAVAILABLE");
  });
});
const DIA = 86_400_000;

// ===========================================================================
// 2. Detalle
// ===========================================================================
describe("3B.7 · detalle", () => {
  it("C) detalle de un pendiente: el pedido completo, sin 'procesado', con historial", async () => {
    const { orden } = await pendiente();
    const r = await detalle(ctxA(), orden.orderId);
    assert.equal(r.status, 200);
    const data = r.body.data as { pedido: PedidoPorAceptar; procesado: unknown; historial: Array<{ tipo: string; hacia: string | null }> };
    assert.equal(data.pedido.pedido, orden.orderId);
    assert.equal(data.pedido.estado, "por_aceptar");
    assert.equal(data.procesado, null);
    assert.ok(data.historial.some((h) => h.hacia === "pending_acceptance"));
    assert.equal(estadoDe(orden), "pending_acceptance", "ver el detalle no cambia nada");
  });

  it("el número de pedido de la URL no distingue mayúsculas en la ruta (la ruta lo normaliza) y uno mal formado es 404 sin tocar la BD", async () => {
    const { orden } = await pendiente();
    assert.equal((await detalle(ctxA(), orden.orderId)).status, 200);
    for (const malo of ["", "DL-ORD-AAA", "dl-ord-aaaaaa", "../../etc/passwd", "DL-ORD-AAAAAA' OR 1=1", orden.orderId + "0", "DL-ORD-ILOUUU"]) assert.equal((await detalle(ctxA(), malo)).status, 404, malo);
  });

  it("N) el documento sale SIEMPRE enmascarado: ni en la lista, ni en el detalle, ni en el historial, ni tras decidir", async () => {
    const { orden } = await pendiente({ checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "no_especificado", number: DOC } });
    const l = await pagina(ctxA());
    const d = await detalle(ctxA(), orden.orderId);
    const [v] = l.body.data!.pedidos as PedidoPorAceptar[];
    assert.deepEqual(v.documento, { tipo: "no_especificado", enmascarado: "•••• 5678" });
    for (const cuerpo of [JSON.stringify(l.body), JSON.stringify(d.body)]) {
      assert.ok(!cuerpo.includes("1020345678") && !cuerpo.includes(DOC) && !cuerpo.includes("345.678") && !cuerpo.includes("020345"), "el número completo no sale");
    }
    const aceptado = await decidir(ctxA(), orden.orderId, "aceptar");
    assert.ok(!JSON.stringify(aceptado.body).includes("1020345678"));
    const despues = await detalle(ctxA(), orden.orderId);
    assert.ok(!JSON.stringify(despues.body).includes("1020345678") && !JSON.stringify(despues.body).includes("5678"), "tampoco el 'procesado' lo trae");
  });

  it("detalle de un pedido que YA se procesó: no es un error, es el estado actual (quién, cuándo, motivo) y sin datos del cliente", async () => {
    const { orden } = await pendiente({ checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "no_especificado", number: DOC } });
    assert.equal((await decidir(ctxA({ miembroId: RESPALDO_A, esAdmin: false }), orden.orderId, "rechazar", "Producto no disponible")).status, 200);
    const r = await detalle(ctxA(), orden.orderId);
    assert.equal(r.status, 200);
    const data = r.body.data as { pedido: unknown; procesado: { pedido: string; estado: string; por: string | null; motivo: string | null; fecha: string | null } };
    assert.equal(data.pedido, null);
    assert.equal(data.procesado.pedido, orden.orderId);
    assert.equal(data.procesado.estado, "rejected");
    assert.equal(data.procesado.por, "Respaldo A");
    assert.equal(data.procesado.motivo, "Producto no disponible");
    assert.ok(data.procesado.fecha);
    const texto = JSON.stringify(r.body);
    for (const dato of ["Laura", "Calle 10", "573001234567", "Medellín", "5678", "Oficina Centro"]) assert.ok(!texto.includes(dato), `no trae ${dato}`);
  });

  it("detalle de un aceptado: 'procesado' confirmed por quien lo aceptó (nombre del equipo)", async () => {
    const { orden } = await pendiente();
    assert.equal((await decidir(ctxA(), orden.orderId, "aceptar")).status, 200);
    const data = (await detalle(ctxA({ miembroId: AGENTE_A, esAdmin: false }), orden.orderId)).body.data as { procesado: { estado: string; por: string | null } };
    assert.equal(data.procesado.estado, "confirmed");
    assert.equal(data.procesado.por, "Responsable A");
  });

  it("detalle de uno VENCIDO (lo cerró el sistema): 'procesado' expired, sin persona", async () => {
    const { orden } = await pendiente({ policy: { ...SIN_RESERVA, expiration: { kind: "after", minutes: 10 } } });
    reloj += 11 * MIN;
    assert.equal(await engine.expireAcceptance(), 1);
    const data = (await detalle(ctxA(), orden.orderId)).body.data as { pedido: unknown; procesado: { estado: string; por: string | null } };
    assert.equal(data.pedido, null);
    assert.equal(data.procesado.estado, "expired");
    assert.equal(data.procesado.por, null);
  });

  it("M) pedido inexistente => 404; y un pedido que NUNCA pasó por la aceptación (venta de siempre) no es de esta vista", async () => {
    assert.equal((await detalle(ctxA(), "DL-ORD-AAAAAA")).status, 404);
    for (const accion of ["aceptar", "rechazar", "cancelar"]) assert.equal((await decidir(ctxA(), "DL-ORD-AAAAAA", accion, "motivo de prueba")).status, 404, accion);
    // Un pedido confirmado por el camino de siempre (Delacour): confirmOrder, sin pasar por pending_acceptance.
    const p = await producto(A, "Licuadora", 5);
    const o = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    const confirmado = await engine.confirmOrder({ tenantId: A.tenantId, contact: ANA, orderId: o.orderId, confirmationId: o.confirmation!.id, actor: "agent" });
    assert.equal(confirmado.status, "confirmed");
    assert.equal((await detalle(ctxA(), o.orderId)).status, 404);
    // Decidir sobre él: no es de esta vista (nunca estuvo pendiente de aceptación) y no se toca nada.
    for (const accion of ["aceptar", "rechazar", "cancelar"]) assert.equal((await decidir(ctxA(), o.orderId, accion, "motivo de prueba")).status, 409, accion);
    assert.equal(estadoDe(o), "confirmed");
    assert.equal(llamadas.acceptOrder, 0);
  });
});

// ===========================================================================
// 3. Acceso: quién puede decidir
// ===========================================================================
describe("3B.7 · acceso: quién puede decidir y quién no", () => {
  it("D) la responsable y su respaldo pueden decidir; un agente cualquiera ve el pedido pero SIN acciones", async () => {
    await pendiente();
    for (const persona of [RESP, { miembroId: RESPALDO_A, esAdmin: false }]) {
      const [v] = await lista(ctxA(persona));
      assert.equal(v.puede_decidir, true);
      assert.deepEqual(v.acciones, ["aceptar", "rechazar", "cancelar"]);
    }
    const [otro] = await lista(ctxA({ miembroId: AGENTE_A, esAdmin: false }));
    assert.equal(otro.puede_decidir, false);
    assert.deepEqual(otro.acciones, []);
  });

  it("administrador: puede decidir solo si el negocio eligió 'responsable_y_admins'", async () => {
    await pendiente();
    const admina = { miembroId: ADMIN_A, esAdmin: true };
    assert.equal((await lista(ctxA(admina)))[0].puede_decidir, false, "con 'solo_responsable' un admin no decide");
    configs.set(`${A.tenantId}|${PN_A}`, configA({ aceptan: "responsable_y_admins" }));
    assert.equal((await lista(ctxA(admina)))[0].puede_decidir, true);
    assert.equal((await lista(ctxA({ miembroId: AGENTE_A, esAdmin: false })))[0].puede_decidir, false, "un agente no se vuelve decisor por eso");
  });

  it("E) quien no puede decidir recibe 403 en las tres acciones y NO cambia nada (ni se llama a acceptOrder)", async () => {
    const { orden, producto: p } = await pendiente();
    const sinPermiso = ctxA({ miembroId: AGENTE_A, esAdmin: false });
    for (const accion of ["aceptar", "rechazar", "cancelar"]) {
      const r = await decidir(sinPermiso, orden.orderId, accion, "motivo de prueba");
      assert.equal(r.status, 403, accion);
      assert.equal(r.body.error?.code, "FORBIDDEN");
    }
    assert.equal(estadoDe(orden), "pending_acceptance");
    assert.equal(llamadas.acceptOrder, 0);
    assert.equal(pedidos.reservations.length, 0);
    assert.equal(mem.inventory.stockOf(p.id), 5);
  });

  it("fail-closed: sin configuración de aceptación (o inválida) nadie decide: 503, nada cambia; el detalle sigue visible sin acciones", async () => {
    const { orden } = await pendiente();
    configs.set(`${A.tenantId}|${PN_A}`, null);
    for (const accion of ["aceptar", "rechazar", "cancelar"]) assert.equal((await decidir(ctxA(), orden.orderId, accion, "motivo de prueba")).status, 503, accion);
    assert.equal(estadoDe(orden), "pending_acceptance");
    const [v] = await lista(ctxA());
    assert.equal(v.puede_decidir, false);
    assert.deepEqual(v.acciones, []);
    assert.equal(v.responsable, null);
    const falla = ctxA(RESP, { config: async () => { throw new Error("BD caída"); } });
    assert.equal((await decidir(falla, orden.orderId, "aceptar")).status, 503);
    assert.equal(estadoDe(orden), "pending_acceptance");
  });

  it("el teléfono completo solo sale para quien atiende (verTelefono); si no, solo los últimos 4 y no hay enlace al chat", async () => {
    await pendiente();
    const [v] = await lista(ctxA(RESP, { extras: { fuentes: fuentes(), verTelefono: false } }));
    assert.equal(v.cliente.telefono, null);
    assert.equal(v.cliente.telefono_parcial, "4567");
    assert.equal(v.conversacion?.telefono, null);
  });
});

// ===========================================================================
// 4. Decisión
// ===========================================================================
describe("3B.7 · aceptar, rechazar, cancelar", () => {
  it("G) aceptar: acceptOrder (NUNCA confirmOrder), nace la venta y el stock se aparta según la política", async () => {
    const { orden, producto: p } = await pendiente({ qty: 2 });
    const r = await decidir(ctxA(), orden.orderId, "aceptar");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, { pedido: orden.orderId, estado: "confirmed", repetido: false, mensaje_cliente: null });
    assert.equal(llamadas.acceptOrder, 1);
    assert.equal(llamadas.confirmOrder, 0, "jamás confirmOrder");
    assert.equal(estadoDe(orden), "confirmed");
    assert.equal(reservasActivas(orden), 1);
    assert.equal(mem.inventory.stockOf(p.id), 3);
  });

  it("aceptar sin stock suficiente: no se confirma NADA y el pedido sigue pendiente (409)", async () => {
    const { orden, producto: p } = await pendiente({ qty: 3 });
    mem.inventory.setStock(p.id, 1);
    const r = await decidir(ctxA(), orden.orderId, "aceptar");
    assert.equal(r.status, 409);
    assert.equal(estadoDe(orden), "pending_acceptance");
    assert.equal(pedidos.reservations.filter((x) => x.orderId === orden.id).length, 0, "sin reserva parcial");
    assert.equal(mem.inventory.stockOf(p.id), 1);
    assert.equal((await lista(ctxA())).length, 1, "sigue visible en Por aceptar");
  });

  it("H) aceptar dos veces: la segunda no repite nada (repetido: true), UNA venta y UNA reserva", async () => {
    const { orden, producto: p } = await pendiente({ qty: 2 });
    const primera = await decidir(ctxA(), orden.orderId, "aceptar");
    const segunda = await decidir(ctxA(), orden.orderId, "aceptar");
    assert.equal(primera.status, 200);
    assert.equal(segunda.status, 200);
    assert.equal((primera.body.data as { repetido: boolean }).repetido, false);
    assert.equal((segunda.body.data as { repetido: boolean }).repetido, true);
    assert.equal(reservasActivas(orden), 1);
    assert.equal(mem.inventory.stockOf(p.id), 3);
    assert.equal(pedidos.history.filter((h) => h.orderId === orden.id && h.entry.to === "confirmed").length, 1);
  });

  it("I) aceptar a la vez (la responsable y su respaldo): UNA venta, UNA reserva, una sola transición", async () => {
    const { orden, producto: p } = await pendiente({ qty: 2 });
    const [x, y] = await Promise.all([decidir(ctxA(RESP), orden.orderId, "aceptar"), decidir(ctxA({ miembroId: RESPALDO_A, esAdmin: false }), orden.orderId, "aceptar")]);
    assert.equal(x.status, 200);
    assert.equal(y.status, 200);
    assert.equal([x, y].filter((r) => (r.body.data as { repetido: boolean }).repetido === false).length, 1, "exactamente una decisión se aplicó");
    assert.equal(estadoDe(orden), "confirmed");
    assert.equal(reservasActivas(orden), 1);
    assert.equal(mem.inventory.stockOf(p.id), 3);
    assert.equal(pedidos.history.filter((h) => h.orderId === orden.id && h.entry.to === "confirmed").length, 1);
  });

  it("aceptar y rechazar A LA VEZ: gana UNA; nunca venta y rechazo juntos; quien perdió ve el estado actualizado", async () => {
    const { orden, producto: p } = await pendiente({ qty: 2 });
    const [x, y] = await Promise.all([decidir(ctxA(RESP), orden.orderId, "aceptar"), decidir(ctxA({ miembroId: RESPALDO_A, esAdmin: false }), orden.orderId, "rechazar", "motivo de prueba")]);
    const final = estadoDe(orden);
    assert.ok(final === "confirmed" || final === "rejected", final);
    assert.equal(pedidos.history.filter((h) => h.orderId === orden.id && (h.entry.to === "confirmed" || h.entry.to === "rejected")).length, 1);
    assert.equal(reservasActivas(orden), final === "confirmed" ? 1 : 0);
    assert.equal(mem.inventory.stockOf(p.id), final === "confirmed" ? 3 : 5);
    assert.ok([x.status, y.status].includes(200));
    const vista = (await detalle(ctxA(), orden.orderId)).body.data as { pedido: unknown; procesado: { estado: string } };
    assert.equal(vista.pedido, null);
    assert.equal(vista.procesado.estado, final);
  });

  it("J) rechazar: sin venta ni reserva, el motivo es obligatorio (3–300) y queda en el historial con quién y por qué", async () => {
    const { orden, producto: p } = await pendiente();
    for (const motivo of [undefined, "", "  ", "ab", "x".repeat(301)]) {
      const r = await decidir(ctxA(), orden.orderId, "rechazar", motivo);
      assert.equal(r.status, 400, String(motivo)?.slice(0, 10));
    }
    assert.equal(estadoDe(orden), "pending_acceptance", "sin motivo no se rechaza");
    const r = await decidir(ctxA(), orden.orderId, "rechazar", "Producto no disponible en esa ciudad");
    assert.deepEqual(r.body.data, { pedido: orden.orderId, estado: "rejected", repetido: false, mensaje_cliente: null });
    assert.equal(estadoDe(orden), "rejected");
    assert.equal(pedidos.orders.find((o) => o.id === orden.id)!.confirmedAt, null, "nunca fue venta");
    assert.equal(pedidos.reservations.filter((x) => x.orderId === orden.id && x.status === "activa").length, 0);
    assert.equal(mem.inventory.stockOf(p.id), 5);
    assert.equal(llamadas.acceptOrder, 0);
    const h = pedidos.history.find((x) => x.orderId === orden.id && x.entry.to === "rejected");
    assert.equal(h?.entry.reason, "Producto no disponible en esa ciudad");
    assert.equal(h?.entry.memberId, RESPONSABLE_A);
  });

  it("K) cancelar: igual que rechazar (sin venta ni reserva, motivo obligatorio) y sin estados nuevos", async () => {
    const { orden, producto: p } = await pendiente();
    assert.equal((await decidir(ctxA(), orden.orderId, "cancelar")).status, 400);
    const r = await decidir(ctxA(), orden.orderId, "cancelar", "El cliente ya no lo quiere");
    assert.deepEqual(r.body.data, { pedido: orden.orderId, estado: "cancelled", repetido: false, mensaje_cliente: null });
    assert.equal(estadoDe(orden), "cancelled");
    assert.equal(pedidos.orders.find((o) => o.id === orden.id)!.confirmedAt, null);
    assert.equal(mem.inventory.stockOf(p.id), 5);
    assert.equal(llamadas.acceptOrder, 0);
  });

  it("rechazar o cancelar dos veces: inocuo (repetido: true), UN solo evento", async () => {
    const { orden } = await pendiente();
    const a = await decidir(ctxA(), orden.orderId, "rechazar", "motivo de prueba");
    const b = await decidir(ctxA(), orden.orderId, "rechazar", "motivo de prueba");
    assert.equal((a.body.data as { repetido: boolean }).repetido, false);
    assert.equal((b.body.data as { repetido: boolean }).repetido, true);
    assert.equal(pedidos.history.filter((h) => h.orderId === orden.id && h.entry.to === "rejected").length, 1);
  });

  it("L) estado incorrecto: no se acepta uno rechazado, no se rechaza uno ya aceptado, no se cancela uno vencido (409, nada cambia)", async () => {
    const p = await producto(A, "Licuadora", 20);
    const rechazado = (await pendiente({ producto: p })).orden;
    const aceptado = (await pendiente({ producto: p })).orden;
    const vencido = (await pendiente({ producto: p, policy: { ...SIN_RESERVA, expiration: { kind: "after", minutes: 5 } } })).orden;
    await decidir(ctxA(), rechazado.orderId, "rechazar", "motivo de prueba");
    await decidir(ctxA(), aceptado.orderId, "aceptar");
    reloj += 6 * MIN;
    await engine.expireAcceptance();
    assert.equal(estadoDe(vencido), "expired");
    const llamadasAntes = llamadas.acceptOrder;

    assert.equal((await decidir(ctxA(), rechazado.orderId, "aceptar")).status, 409);
    assert.equal((await decidir(ctxA(), aceptado.orderId, "rechazar", "motivo de prueba")).status, 409);
    assert.equal((await decidir(ctxA(), aceptado.orderId, "cancelar", "motivo de prueba")).status, 409);
    assert.equal((await decidir(ctxA(), vencido.orderId, "cancelar", "motivo de prueba")).status, 409);
    assert.equal((await decidir(ctxA(), vencido.orderId, "aceptar")).status, 409);
    assert.equal((await decidir(ctxA(), rechazado.orderId, "cancelar", "motivo de prueba")).status, 409);
    assert.equal(llamadas.acceptOrder, llamadasAntes, "ni siquiera se intenta aceptar lo que no está pendiente");
    assert.equal(estadoDe(rechazado), "rejected");
    assert.equal(estadoDe(aceptado), "confirmed");
    assert.equal(estadoDe(vencido), "expired");
  });

  it("acción o cuerpo inválido: 400 sin tocar nada", async () => {
    const { orden } = await pendiente();
    for (const cuerpo of [null, {}, { accion: "confirmar" }, { accion: 5 }, { accion: ["aceptar"] }, { accion: "ACEPTAR" }]) {
      const r = await leer(await decidirPorAceptar(ctxA(), orden.orderId, cuerpo));
      assert.equal(r.status, 400, JSON.stringify(cuerpo));
    }
    assert.equal(estadoDe(orden), "pending_acceptance");
    assert.equal(llamadas.acceptOrder, 0);
  });
});

// ===========================================================================
// 5. Conversación y responsable
// ===========================================================================
describe("3B.7 · conversación y responsable (el Inbox que ya existe)", () => {
  it("O) el pedido enlaza su conversación: número, teléfono, a quién se le asignó, estado del Inbox", async () => {
    await pendiente();
    atenciones.set(`${PN_A}|${ANA.waId}`, { pausadaHasta: null, conversacion: "open" });
    const [v] = await lista(ctxA());
    assert.deepEqual(v.conversacion, { numero: PN_A, telefono: ANA.waId, asignada: "Responsable A", ia_pausada: false, ia_pausada_hasta: null, estado: "open" });
    assert.equal(v.asignada, "Responsable A");
  });

  it("IA pausada en esa conversación: se informa con la fecha (la pausa es de la conversación, no del pedido)", async () => {
    await pendiente();
    const hasta = new Date(reloj + 60 * MIN).toISOString();
    atenciones.set(`${PN_A}|${ANA.waId}`, { pausadaHasta: hasta, conversacion: "pending" });
    const [v] = await lista(ctxA());
    assert.equal(v.conversacion?.ia_pausada, true);
    assert.equal(v.conversacion?.ia_pausada_hasta, hasta);
    assert.equal(v.conversacion?.estado, "pending");
  });

  it("sin dato de atención (la lectura falla o no existe): el pedido se muestra igual, sin inventar nada", async () => {
    await pendiente();
    const sinAtencion = ctxA(RESP, { extras: { fuentes: { ...fuentes(), atencion: async () => { throw new Error("BD caída"); } }, verTelefono: true } });
    const [v] = await lista(sinAtencion);
    assert.equal(v.conversacion?.ia_pausada, false);
    assert.equal(v.conversacion?.estado, null);
    const sinFuente = ctxA(RESP, { extras: { fuentes: { ...fuentes(), atencion: undefined }, verTelefono: true } });
    assert.equal((await lista(sinFuente))[0].conversacion?.estado, null);
  });

  it("P) responsable: nombre de la responsable y de su respaldo (de este negocio) y quién puede aceptar", async () => {
    await pendiente();
    const [v] = await lista(ctxA());
    assert.deepEqual(v.responsable, { principal: "Responsable A", respaldo: "Respaldo A", quien_acepta: "solo_responsable" });
    configs.set(`${A.tenantId}|${PN_A}`, configA({ responsable: { miembro_id: RESPONSABLE_A, respaldo_miembro_id: null, canales: ["panel"] }, aceptan: "responsable_y_admins" }));
    const [w] = await lista(ctxA());
    assert.deepEqual(w.responsable, { principal: "Responsable A", respaldo: null, quien_acepta: "responsable_y_admins" });
  });

  it("la conversación asignada a OTRA persona se ve tal cual: el panel no la reasigna ni la libera", async () => {
    const { orden } = await pendiente();
    const antes = [...asign.filas.entries()];
    const [v] = await lista(ctxA({ miembroId: AGENTE_A, esAdmin: false }));
    assert.equal(v.asignada, "Responsable A");
    await detalle(ctxA({ miembroId: AGENTE_A, esAdmin: false }), orden.orderId);
    assert.deepEqual([...asign.filas.entries()], antes, "mirar el pedido no cambia quién tiene la conversación");
  });
});

// ===========================================================================
// 6. Multi-negocio
// ===========================================================================
describe("3B.7 · multi-negocio", () => {
  async function pedidoDeB() {
    const pb = await producto(B, "Anillo", 3);
    const ob = await engine.createOrder({ tenantId: B.tenantId, channel: "retail", source: "agent", contact: BETO, items: [{ reference: pb.reference, quantity: 1 }], idempotencyKey: "agent:b1" });
    const o = await engine.submitForAcceptance({ tenantId: B.tenantId, contact: BETO, orderId: ob.order.orderId, confirmationId: ob.order.confirmation!.id, checkout: DOMICILIO, policy: SIN_RESERVA });
    return o;
  }

  it("F) cada negocio ve SOLO lo suyo: A no ve el de B ni B el de A", async () => {
    const { orden: deA } = await pendiente();
    const deB = await pedidoDeB();
    assert.deepEqual((await lista(ctxA())).map((v) => v.pedido), [deA.orderId]);
    assert.deepEqual((await lista(ctxB())).map((v) => v.pedido), [deB.orderId]);
  });

  it("F) la persona de B no ve, no acepta, no rechaza, no cancela ni lee el documento de un pedido de A: 404 sin revelar nada", async () => {
    const { orden } = await pendiente({ checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "no_especificado", number: DOC } });
    const ctx = ctxB();
    const det = await detalle(ctx, orden.orderId);
    assert.equal(det.status, 404);
    for (const accion of ["aceptar", "rechazar", "cancelar"]) {
      const r = await decidir(ctx, orden.orderId, accion, "intento de otro negocio");
      assert.equal(r.status, 404, accion);
      assert.equal(r.body.error?.code, "NOT_FOUND");
    }
    for (const cuerpo of [JSON.stringify(det.body)]) for (const dato of ["Laura", "5678", "Medellín", "573001234567"]) assert.ok(!cuerpo.includes(dato), dato);
    assert.equal(estadoDe(orden), "pending_acceptance");
    assert.equal(llamadas.acceptOrder, 0);
  });

  it("F) tampoco un pedido YA procesado de A se lee desde B (el 'procesado' también es del negocio de la sesión)", async () => {
    const { orden } = await pendiente();
    await decidir(ctxA(), orden.orderId, "aceptar");
    assert.equal((await detalle(ctxB(), orden.orderId)).status, 404);
    assert.equal((await detalle(ctxA(), orden.orderId)).status, 200);
  });

  it("F) un negocio sin aceptación humana (Delacour: config null) no ve ni decide pedidos de ASLC; su lista está vacía", async () => {
    const { orden } = await pendiente();
    const delacour = ctxB({ miembroId: ADMIN_B, esAdmin: true });
    assert.deepEqual(await lista(delacour), []);
    assert.equal((await detalle(delacour, orden.orderId)).status, 404);
    configs.set(`${B.tenantId}|${PN_B}`, null);
    for (const accion of ["aceptar", "rechazar", "cancelar"]) assert.equal((await decidir(delacour, orden.orderId, accion, "motivo de prueba")).status, 404, accion);
    assert.equal(estadoDe(orden), "pending_acceptance");
  });

  it("F) el negocio sale SIEMPRE de la sesión: ni tenant_id/tenantId del cuerpo, ni mayúsculas/minúsculas, ni IDs manipulados lo cambian", async () => {
    const { orden } = await pendiente();
    // Ni la lista acepta un negocio por parámetro (con un pedido pendiente de A que B NO debe ver).
    const lis = await pagina(ctxB(), { tenant_id: A.tenantId, tenantId: A.tenantId, negocio: A.tenantId });
    assert.equal(lis.status, 200);
    assert.deepEqual(lis.body.data!.pedidos, []);
    const r = await leer(await decidirPorAceptar(ctxB(), orden.orderId.toLowerCase(), { accion: "aceptar", tenant_id: A.tenantId, tenantId: A.tenantId, business_id: A.tenantId }));
    assert.equal(r.status, 404);
    const r2 = await leer(await decidirPorAceptar(ctxA({ miembroId: RESPONSABLE_A, esAdmin: false }), orden.orderId, { accion: "rechazar", motivo: "motivo de prueba", tenant_id: B.tenantId, tenantId: B.tenantId }));
    assert.equal(r2.status, 200, "decide con el negocio de la sesión (A), ignorando el del cuerpo");
    assert.equal(estadoDe(orden), "rejected");
  });

  it("F) configuración con el responsable de OTRO negocio: ese miembro no decide en este (puedeDecidir compara ids de este negocio)", async () => {
    await pendiente();
    // RESPONSABLE_B (negocio B) con la sesión del negocio A: no es la responsable ni el respaldo de A.
    const [v] = await lista(ctxA({ miembroId: RESPONSABLE_B, esAdmin: false }));
    assert.equal(v.puede_decidir, false);
  });
});

// ===========================================================================
// 7. Gancho de la Fase 3B.8 y límites de esta fase
// ===========================================================================
describe("3B.7 · gancho para 3B.8 (no se envía nada al cliente)", () => {
  const registrar = () => {
    const eventos: DecisionPorAceptar[] = [];
    return { eventos, ctx: (persona: Persona = RESP) => ctxA(persona, { alDecidir: async (d) => void eventos.push(d) }) };
  };

  it("se llama UNA vez por decisión aplicada, con lo mínimo (negocio, pedido, acción, estado, quién y el contacto)", async () => {
    const { eventos, ctx } = registrar();
    const p = await producto(A, "Licuadora", 20);
    const a = (await pendiente({ producto: p })).orden;
    const r = (await pendiente({ producto: p })).orden;
    const c = (await pendiente({ producto: p })).orden;
    await decidir(ctx(), a.orderId, "aceptar");
    await decidir(ctx(), r.orderId, "rechazar", "motivo de prueba");
    await decidir(ctx(), c.orderId, "cancelar", "motivo de prueba");
    assert.deepEqual(eventos, [
      { tenantId: A.tenantId, pedido: a.orderId, accion: "aceptar", estado: "confirmed", miembroId: RESPONSABLE_A, contacto: ANA, motivo: null },
      { tenantId: A.tenantId, pedido: r.orderId, accion: "rechazar", estado: "rejected", miembroId: RESPONSABLE_A, contacto: ANA, motivo: "motivo de prueba" },
      { tenantId: A.tenantId, pedido: c.orderId, accion: "cancelar", estado: "cancelled", miembroId: RESPONSABLE_A, contacto: ANA, motivo: "motivo de prueba" },
    ]);
  });

  it("NO se llama cuando no se aplicó nada: repetida, sin permiso, estado incorrecto, inexistente, otro negocio, sin configuración", async () => {
    const { eventos, ctx } = registrar();
    const { orden } = await pendiente();
    await decidir(ctx(), orden.orderId, "aceptar");
    assert.equal(eventos.length, 1);
    await decidir(ctx(), orden.orderId, "aceptar"); // repetida
    await decidir(ctx({ miembroId: AGENTE_A, esAdmin: false }), orden.orderId, "rechazar", "motivo de prueba"); // sin permiso
    await decidir(ctx(), orden.orderId, "rechazar", "motivo de prueba"); // estado incorrecto
    await decidir(ctx(), "DL-ORD-AAAAAA", "aceptar"); // inexistente
    await decidir({ ...ctxB(), alDecidir: async (d) => void eventos.push(d) }, orden.orderId, "aceptar"); // otro negocio
    assert.equal(eventos.length, 1, "solo la primera decisión aplicada");
  });

  it("un gancho que falla NO deshace ni cambia la decisión (la respuesta es la misma)", async () => {
    const { orden } = await pendiente();
    const r = await decidir(ctxA(RESP, { alDecidir: async () => { throw new Error("falló el envío de la 3B.8"); } }), orden.orderId, "aceptar");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, { pedido: orden.orderId, estado: "confirmed", repetido: false, mensaje_cliente: { estado: "no_disponible", motivo: null, repetida: false } });
    assert.equal(estadoDe(orden), "confirmed");
  });

  it("PRODUCCIÓN: el contexto de las rutas trae el gancho de la 3B.8 (que solo envía el texto configurado por el negocio) y el negocio es el de la sesión", () => {
    const ctx = productionPorAceptarCtx({ supabase: {} as SupabaseClient, tenantId: A.tenantId, memberId: 7, esAdmin: false, canManageOrders: true });
    assert.equal(typeof ctx.alDecidir, "function");
    assert.equal(ctx.tenantId, A.tenantId);
    assert.deepEqual(ctx.persona, { miembroId: 7, esAdmin: false });
    assert.equal(ctx.extras.verTelefono, true);
  });

  it("el panel (manejadores, interfaz y rutas) no importa ningún envío al cliente: el único camino es el gancho que conecta la 3B.8", () => {
    for (const archivo of ["lib/catalogo/pedidos/por-aceptar.ts", "components/dashboard/pedidos/PorAceptar.tsx", "app/api/dashboard/pedidos/por-aceptar/route.ts", "app/api/dashboard/pedidos/[pedido]/aceptacion/route.ts"]) {
      const src = readFileSync(join(process.cwd(), archivo), "utf8");
      assert.ok(!/graph\.facebook|enviarMensaje|sendWhatsApp|enviarWhatsApp|enviarPlantilla|sendTemplate|notificaciones\/|\/whatsapp\/send|textoTrasAviso/.test(src), `${archivo} no envía mensajes al cliente`);
    }
  });
});
