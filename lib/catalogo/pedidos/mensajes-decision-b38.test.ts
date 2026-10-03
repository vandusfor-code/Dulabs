/**
 * FASE 3B.8 — MENSAJE AL CLIENTE TRAS UNA DECISIÓN HUMANA (aceptar, rechazar, cancelar). TODO en memoria, con las MISMAS reglas que la
 * BD (repositorio de pedidos y de notificaciones en memoria, con la misma clave única por (pedido, tipo)), el motor real y los
 * manejadores reales del panel "Por aceptar".
 *
 *   - el texto es del NEGOCIO (configuración): sin texto no se envía nada, y nunca se usa el de otro negocio;
 *   - idempotente por (pedido, decisión): doble clic, decisión repetida, dos procesos o un reintento no mandan dos mensajes;
 *   - enviar un mensaje NO cambia el pedido (ni estado, ni reserva, ni historial);
 *   - el documento y los datos sensibles nunca salen; el motivo solo si la plantilla lo pide y la persona lo escribió.
 *
 * Negocios, personas, clientes, textos y políticas FICTICIOS. Nada toca Supabase, Gemini ni Meta.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString("base64");

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine, type CheckoutData, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import type { AcceptancePolicy, Order } from "@/lib/catalogo/pedidos/contrato";
import { decidirPorAceptar, listarPorAceptar, type DecisionPorAceptar, type PedidoPorAceptar, type PorAceptarCtx } from "@/lib/catalogo/pedidos/por-aceptar";
import type { PanelFuentes } from "@/lib/catalogo/pedidos/panel";
import { ErrorEnvioWhatsapp, createMemoryNotificacionesStore, reintentarNotificacion, type CanalWhatsapp, type EnviadorWhatsapp, type NotificadorDeps } from "@/lib/catalogo/pedidos/notificaciones";
import { TIPO_MENSAJE_DECISION, aMensajeAlCliente, enviarMensajeDecision, type MensajesDecisionDeps } from "@/lib/catalogo/pedidos/mensajes-decision";
import { canalPanel, createAcceptanceRouter, createMemoryAsignacionesStore, type ConfigAceptacion } from "@/lib/agente/aceptacion-humana";
import { createMemoryMiembrosStore, type MiembroEquipo } from "@/lib/agente/responsable";
import { atenderRespuestaTrasAviso, type RespuestaAvisoDeps } from "@/lib/agente/respuesta-aviso";
import { cifrarSecreto } from "@/lib/crypto";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const PN_A = "100000000000001";
const PN_B = "100000000000002";
const ANA = { phoneNumberId: PN_A, waId: "573001110001" };
const BETO = { phoneNumberId: PN_B, waId: "573001110002" };
const DOC = "1.020.345.678";
const MIN = 60_000;
const HORA = 60 * MIN;
const RESPONSABLE_A = 41;
const RESPALDO_A = 43;
const RESPONSABLE_B = 51;
const MIEMBROS: MiembroEquipo[] = [
  { id: RESPONSABLE_A, tenantId: A.tenantId, estado: "activo", rol: "agente", email: null },
  { id: RESPALDO_A, tenantId: A.tenantId, estado: "activo", rol: "agente", email: null },
  { id: RESPONSABLE_B, tenantId: B.tenantId, estado: "activo", rol: "agente", email: null },
];

const SIN_RESERVA: AcceptancePolicy = { reservation: { kind: "none" }, expiration: { kind: "none" }, document: { kind: "not_collected" } };
const CON_DOCUMENTO: AcceptancePolicy = { ...SIN_RESERVA, document: { kind: "required_for_office", allowedTypes: ["no_especificado"], retention: { kind: "no_automatic_deletion" } } };
const DOMICILIO: CheckoutData = { customerName: "Laura Gómez", paymentMethod: "contra_entrega", delivery: "domicilio", address: "Calle 10 # 20-30", city: "Bogotá", deliveryReference: null, contactPhone: "573001234567", department: "Cundinamarca", neighborhood: "Chapinero" };
const OFICINA: CheckoutData = { customerName: "Laura Gómez", paymentMethod: "contra_entrega", delivery: "oficina_transportadora", address: null, city: "Medellín", deliveryReference: null, contactPhone: "573001234567", department: "Antioquia", neighborhood: null, carrierOffice: "Oficina Centro" };

// Textos de PRUEBA del negocio A (los reales los define cada negocio al aprovisionar; "Patricia" solo existe en esta configuración).
const T_ACEPTADO_A = "Perfecto 👍 Tu pedido {pedido} fue aceptado. Patricia continuará con la gestión (texto de prueba).";
const T_RECHAZADO_A = "Tu pedido {pedido} no pudo continuar. Motivo: {motivo}";
const T_CANCELADO_A = "Cancelamos tu pedido {pedido}. Detalle: {motivo}";
const configA = (over: Partial<ConfigAceptacion> = {}): ConfigAceptacion => ({
  responsable: { miembro_id: RESPONSABLE_A, respaldo_miembro_id: RESPALDO_A, canales: ["panel"] },
  aceptan: "solo_responsable",
  reservaTrasAceptar: { kind: "platform" },
  textoTrasAviso: "Respuesta de prueba tras el aviso",
  siYaRespondioPersona: "no_responder",
  notaEnvio: null,
  textosDecision: { aceptado: T_ACEPTADO_A, rechazado: T_RECHAZADO_A, cancelado: T_CANCELADO_A },
  ...over,
});
const configB = (): ConfigAceptacion =>
  configA({
    responsable: { miembro_id: RESPONSABLE_B, respaldo_miembro_id: null, canales: ["panel"] },
    textosDecision: { aceptado: "[B] aceptado {pedido}", rechazado: "[B] rechazado {pedido}: {motivo}", cancelado: "[B] cancelado {pedido}: {motivo}" },
  });

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let pedidos: ReturnType<typeof createMemoryOrdersRepository>;
let engine: OrderEngine;
let asign: ReturnType<typeof createMemoryAsignacionesStore>;
let configs: Map<string, ConfigAceptacion | null>;
let reloj: number;
let seq: number;
let enviados: Array<{ phoneNumberId: string; telefono: string; texto: string }>;
let almacen: ReturnType<typeof createMemoryNotificacionesStore>;
let falloEnvio: ErrorEnvioWhatsapp | null;
let enviador: EnviadorWhatsapp;

const lector = async (tenantId: string, phoneNumberId: string) => configs.get(`${tenantId}|${phoneNumberId}`) ?? null;
const canal = (tenantId: string, pn: string): CanalWhatsapp & { tenantId: string } => ({ tenantId, phoneNumberId: pn, token: "token-de-prueba", nombreNegocio: "Tienda de prueba" });

function construir() {
  const router = createAcceptanceRouter({
    config: lector,
    miembros: createMemoryMiembrosStore(MIEMBROS),
    asignaciones: { asignar: async (i) => asign.asignar(i) },
    notificador: { canales: { panel: canalPanel } },
    handoff: { pauseConversation: async () => ({ ok: true }) },
    log: () => {},
  });
  return createOrderEngine({
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
}

beforeEach(() => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  reloj = Date.parse("2026-10-02T15:00:00Z");
  pedidos = createMemoryOrdersRepository({ inventory: mem.inventory, now: () => reloj });
  asign = createMemoryAsignacionesStore({ [PN_A]: A.tenantId, [PN_B]: B.tenantId });
  configs = new Map([
    [`${A.tenantId}|${PN_A}`, configA()],
    [`${B.tenantId}|${PN_B}`, configB()],
  ]);
  seq = 0;
  enviados = [];
  falloEnvio = null;
  almacen = createMemoryNotificacionesStore({
    habilitados: [A.tenantId, B.tenantId],
    canales: { [PN_A]: canal(A.tenantId, PN_A), [PN_B]: canal(B.tenantId, PN_B) },
    now: () => reloj,
  });
  // La conversación está abierta: el cliente escribió hace 5 minutos.
  almacen.entrante(PN_A, ANA.waId, new Date(reloj - 5 * MIN).toISOString());
  almacen.entrante(PN_B, BETO.waId, new Date(reloj - 5 * MIN).toISOString());
  enviador = {
    async enviar(c, telefono, texto) {
      if (falloEnvio) throw falloEnvio;
      enviados.push({ phoneNumberId: c.phoneNumberId, telefono, texto });
      return { messageId: `wamid.dec.${++seq}` };
    },
    async registrar() {},
  };
  engine = construir();
  for (const actor of [A, B]) {
    mem.setProfile(actor.tenantId, { name: "Tienda", whatsapp: "573001110000" });
    mem.enableModule(actor.tenantId);
  }
});

const notificador = (): NotificadorDeps => ({ store: almacen.store, enviador, now: () => reloj, log: () => {} });
const deps = (over: Partial<MensajesDecisionDeps> = {}): MensajesDecisionDeps => ({ engine, config: lector, notificador: notificador(), log: () => {}, ...over });

const producto = (actor: CatalogActor, name: string, stock: number, price = 50_000) => admin.createProduct(actor, { name, retailPrice: price, stock });
async function pendiente(opts: { tenant?: CatalogActor; contact?: typeof ANA; checkout?: CheckoutData; policy?: AcceptancePolicy; document?: { type: string; number: string } | null; producto?: Awaited<ReturnType<typeof producto>>; qty?: number } = {}) {
  const tenant = opts.tenant ?? A;
  const contact = opts.contact ?? ANA;
  const p = opts.producto ?? (await producto(tenant, "Licuadora", 20));
  const { order } = await engine.createOrder({ tenantId: tenant.tenantId, channel: "retail", source: "agent", contact, items: [{ reference: p.reference, quantity: opts.qty ?? 1 }], idempotencyKey: `agent:k${++seq}` });
  const o = await engine.submitForAcceptance({
    tenantId: tenant.tenantId,
    contact,
    orderId: order.orderId,
    confirmationId: order.confirmation!.id,
    checkout: opts.checkout ?? DOMICILIO,
    policy: opts.policy ?? SIN_RESERVA,
    ...(opts.document !== undefined ? { document: opts.document } : {}),
  });
  return engine.recordAcceptanceNotice({ tenantId: tenant.tenantId, contact, orderId: o.orderId });
}

// --- Panel con el gancho de la 3B.8 conectado (lo mismo que cablea producción, con el Supabase reemplazado por memoria) ---
const fuentes = (): PanelFuentes => ({
  nombres: async () => new Map(),
  canales: async () => new Map(),
  confirmados: async () => new Map(),
  asignadas: async () => new Map(),
  fotos: async () => new Map(),
  miembros: async (_t, ids) => new Map(ids.map((i) => [i, `Miembro ${i}`])),
});
const ALDECIDIR = (d: MensajesDecisionDeps) => async (x: DecisionPorAceptar) => aMensajeAlCliente(await enviarMensajeDecision(d, x));
const ctxA = (over: Partial<PorAceptarCtx> = {}, persona = { miembroId: RESPONSABLE_A, esAdmin: false }): PorAceptarCtx => ({
  engine,
  tenantId: A.tenantId,
  persona,
  extras: { fuentes: fuentes(), verTelefono: true },
  config: (pn) => lector(A.tenantId, pn),
  alDecidir: ALDECIDIR(deps()),
  ...over,
});
type Resp = { success: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
const leer = async (r: Response): Promise<{ status: number; body: Resp }> => ({ status: r.status, body: (await r.json()) as Resp });
const decidir = async (ctx: PorAceptarCtx, pedido: string, accion: string, motivo?: string) => leer(await decidirPorAceptar(ctx, pedido, { accion, ...(motivo ? { motivo } : {}) }));
const mensajeCliente = (r: { body: Resp }) => r.body.data?.mensaje_cliente as { estado: string; motivo: string | null; repetida: boolean } | null;
const estadoDe = (o: Order) => pedidos.orders.find((x) => x.id === o.id)!;
const instantanea = (o: Order) => {
  const f = estadoDe(o);
  return JSON.stringify({ status: f.status, confirmedAt: f.confirmedAt, checkout: f.checkout, acceptance: f.acceptance, updatedAt: f.updatedAt, historial: pedidos.history.filter((h) => h.orderId === o.id).length, reservas: pedidos.reservations.filter((r) => r.orderId === o.id).map((r) => [r.status, r.quantity]) });
};
/** Decisión aplicada tal como la entrega el panel a la 3B.8 (para llamar al notificador directamente). */
const decision = (o: Order, accion: DecisionPorAceptar["accion"], estado: Order["status"], motivo: string | null, over: Partial<DecisionPorAceptar> = {}): DecisionPorAceptar => ({ tenantId: A.tenantId, pedido: o.orderId, accion, estado, miembroId: RESPONSABLE_A, contacto: ANA, motivo, ...over });

// ===========================================================================
describe("3B.8 · aceptar / rechazar / cancelar: el cliente recibe el texto del NEGOCIO (E, F, G)", () => {
  it("E) aceptar: UN mensaje con el texto configurado y el número de pedido; el panel informa que se envió", async () => {
    const o = await pendiente();
    const r = await decidir(ctxA(), o.orderId, "aceptar");
    assert.equal(r.status, 200);
    assert.deepEqual(enviados, [{ phoneNumberId: PN_A, telefono: ANA.waId, texto: `Perfecto 👍 Tu pedido ${o.orderId} fue aceptado. Patricia continuará con la gestión (texto de prueba).` }]);
    assert.deepEqual(mensajeCliente(r), { estado: "enviada", motivo: null, repetida: false });
    assert.equal(almacen.filas.length, 1);
    assert.equal(almacen.filas[0].tipo, "aceptado");
    assert.equal(almacen.filas[0].estado, "enviada");
    assert.equal(almacen.filas[0].miembroId, RESPONSABLE_A);
  });

  it("F) rechazar: el texto de RECHAZO con SOLO el motivo que registró la persona (sin inventar nada más)", async () => {
    const o = await pendiente();
    const r = await decidir(ctxA(), o.orderId, "rechazar", "No tenemos esa referencia disponible");
    assert.equal(r.status, 200);
    assert.deepEqual(enviados.map((e) => e.texto), [`Tu pedido ${o.orderId} no pudo continuar. Motivo: No tenemos esa referencia disponible`]);
    assert.equal(almacen.filas[0].tipo, "rechazado");
    assert.ok(!/culp|transportadora|reposici|disponible pronto|alternativa/i.test(enviados[0].texto.replace("No tenemos esa referencia disponible", "")), "nada agregado por el sistema");
  });

  it("G) cancelar: su PROPIO texto (distinto del de rechazo), con el motivo registrado", async () => {
    const o = await pendiente();
    const r = await decidir(ctxA(), o.orderId, "cancelar", "El cliente pidió cancelarlo");
    assert.equal(r.status, 200);
    assert.deepEqual(enviados.map((e) => e.texto), [`Cancelamos tu pedido ${o.orderId}. Detalle: El cliente pidió cancelarlo`]);
    assert.equal(almacen.filas[0].tipo, "cancelado");
    assert.notEqual(TIPO_MENSAJE_DECISION.rechazar, TIPO_MENSAJE_DECISION.cancelar);
  });

  it("el motivo se limpia (saltos de línea y espacios) y no se interpreta como plantilla: una llave en el motivo no se vuelve a reemplazar", async () => {
    const o = await pendiente();
    await decidir(ctxA(), o.orderId, "rechazar", "  No hay\nstock {pedido}  de eso ");
    assert.equal(enviados[0].texto, `Tu pedido ${o.orderId} no pudo continuar. Motivo: No hay stock {pedido} de eso`);
  });

  it("plantillas SIN {motivo}: se envían tal cual (con {pedido}) y el motivo de la persona NO sale (queda solo para el equipo)", async () => {
    configs.set(`${A.tenantId}|${PN_A}`, configA({ textosDecision: { aceptado: null, rechazado: "No pudimos continuar con tu pedido {pedido}.", cancelado: null } }));
    const o = await pendiente();
    await decidir(ctxA(), o.orderId, "rechazar", "motivo interno que el cliente no debe leer");
    assert.deepEqual(enviados.map((e) => e.texto), [`No pudimos continuar con tu pedido ${o.orderId}.`]);
    assert.ok(!enviados[0].texto.includes("interno"));
  });

  it("el panel le avisa a la persona ANTES de decidir qué mensajes tiene el negocio y si el motivo lo lee el cliente (sin mostrar los textos)", async () => {
    await pendiente();
    const lista = ((await leer(await listarPorAceptar(ctxA()))).body.data!.pedidos as PedidoPorAceptar[])[0];
    assert.deepEqual(lista.avisa_al_cliente, { aceptar: true, rechazar: true, cancelar: true, motivo_al_cliente: { rechazar: true, cancelar: true } });
    assert.ok(!JSON.stringify(lista).includes("Patricia"), "los textos no se exponen en la vista");
    configs.set(`${A.tenantId}|${PN_A}`, configA({ textosDecision: { aceptado: null, rechazado: "Sin motivo {pedido}", cancelado: null } }));
    const otra = ((await leer(await listarPorAceptar(ctxA()))).body.data!.pedidos as PedidoPorAceptar[])[0];
    assert.deepEqual(otra.avisa_al_cliente, { aceptar: false, rechazar: true, cancelar: false, motivo_al_cliente: { rechazar: false, cancelar: false } });
  });
});

// ===========================================================================
describe("3B.8 · faltas de configuración: nunca se inventa un texto (H)", () => {
  it("H) sin texto configurado para esa decisión: NO se envía nada, no se crea ninguna fila y la decisión queda igual de válida", async () => {
    configs.set(`${A.tenantId}|${PN_A}`, configA({ textosDecision: { aceptado: null, rechazado: T_RECHAZADO_A, cancelado: null } }));
    const o = await pendiente();
    const r = await decidir(ctxA(), o.orderId, "aceptar");
    assert.equal(r.status, 200);
    assert.deepEqual(mensajeCliente(r), { estado: "no_aplica", motivo: "sin_texto", repetida: false });
    assert.deepEqual(enviados, []);
    assert.equal(almacen.filas.length, 0, "ni siquiera una fila: no hay nada que registrar");
    assert.equal(estadoDe(o).status, "confirmed");
  });

  it("H) sin la sección de textos (configuración antigua, textosDecision ausente): tampoco se envía nada", async () => {
    configs.set(`${A.tenantId}|${PN_A}`, configA({ textosDecision: undefined }));
    const o = await pendiente();
    const r = await decidir(ctxA(), o.orderId, "cancelar", "motivo de prueba");
    assert.equal(r.status, 200);
    assert.equal(mensajeCliente(r)?.motivo, "sin_texto");
    assert.deepEqual(enviados, []);
  });

  it("H) sin configuración de aceptación para ese número (null): nada se envía y no se usa ningún texto por defecto", async () => {
    const o = await pendiente();
    await engine.acceptOrder({ tenantId: A.tenantId, orderId: o.orderId, memberId: RESPONSABLE_A, reservation: { kind: "platform" } });
    configs.set(`${A.tenantId}|${PN_A}`, null);
    const r = await enviarMensajeDecision(deps(), decision(o, "aceptar", "confirmed", null));
    assert.deepEqual(r, { estado: "no_aplica", motivo: "sin_configuracion" });
    assert.deepEqual(enviados, []);
  });

  it("H) la lectura de la configuración falla: no se envía (nunca se improvisa) y nunca lanza", async () => {
    const o = await pendiente();
    await engine.acceptOrder({ tenantId: A.tenantId, orderId: o.orderId, memberId: RESPONSABLE_A, reservation: { kind: "platform" } });
    const r = await enviarMensajeDecision(deps({ config: async () => { throw new Error("BD caída"); } }), decision(o, "aceptar", "confirmed", null));
    assert.deepEqual(r, { estado: "no_disponible" });
    assert.deepEqual(enviados, []);
  });

  it("H) plantilla que pide {motivo} y no hay un motivo utilizable (vacío, muy corto): no se envía, no se improvisa un motivo", async () => {
    const o = await pendiente();
    await engine.closeOrder({ tenantId: A.tenantId, orderId: o.orderId, action: "reject", memberId: RESPONSABLE_A, reason: "motivo de prueba", expectedStatus: "pending_acceptance" });
    for (const motivo of [null, "", "  ", "ab"]) {
      const r = await enviarMensajeDecision(deps(), decision(o, "rechazar", "rejected", motivo));
      assert.deepEqual(r, { estado: "no_aplica", motivo: "sin_motivo" }, String(motivo));
    }
    assert.deepEqual(enviados, []);
    assert.equal(almacen.filas.length, 0);
  });

  it("H) las plantillas inválidas guardadas (marcador desconocido, llaves sueltas) no se envían: se detecta al enviar aunque se cuelen en la configuración", async () => {
    const o = await pendiente();
    await engine.acceptOrder({ tenantId: A.tenantId, orderId: o.orderId, memberId: RESPONSABLE_A, reservation: { kind: "platform" } });
    for (const mala of ["Hola {nombre}", "Hola {pedido", "Hola {{pedido}}", "} hola", "Tu {motivo}"]) {
      configs.set(`${A.tenantId}|${PN_A}`, configA({ textosDecision: { aceptado: mala, rechazado: null, cancelado: null } }));
      const r = await enviarMensajeDecision(deps(), decision(o, "aceptar", "confirmed", null));
      assert.deepEqual(r, { estado: "no_aplica", motivo: "plantilla_invalida" }, mala);
    }
    assert.deepEqual(enviados, []);
  });

  it("H) módulo de notificaciones apagado para el negocio (como está hoy en ASLC): no se envía ni se registra nada", async () => {
    almacen.habilitar(A.tenantId, false);
    const o = await pendiente();
    const r = await decidir(ctxA(), o.orderId, "aceptar");
    assert.equal(r.status, 200);
    assert.equal(mensajeCliente(r)?.estado, "desactivada");
    assert.deepEqual(enviados, []);
    assert.equal(almacen.filas.length, 0);
    assert.equal(estadoDe(o).status, "confirmed");
  });

  it("sin gancho (sin el cableado de la 3B.8) el panel funciona igual y no informa ningún mensaje", async () => {
    const o = await pendiente();
    const r = await decidir(ctxA({ alDecidir: undefined }), o.orderId, "aceptar");
    assert.equal(r.status, 200);
    assert.equal(mensajeCliente(r), null);
    assert.deepEqual(enviados, []);
  });
});

// ===========================================================================
describe("3B.8 · aislamiento entre negocios (I)", () => {
  async function pedidoDeB() {
    const pb = await producto(B, "Anillo", 5);
    const { order } = await engine.createOrder({ tenantId: B.tenantId, channel: "retail", source: "agent", contact: BETO, items: [{ reference: pb.reference, quantity: 1 }], idempotencyKey: "agent:b1" });
    const o = await engine.submitForAcceptance({ tenantId: B.tenantId, contact: BETO, orderId: order.orderId, confirmationId: order.confirmation!.id, checkout: DOMICILIO, policy: SIN_RESERVA });
    return engine.recordAcceptanceNotice({ tenantId: B.tenantId, contact: BETO, orderId: o.orderId });
  }

  it("I) cada negocio envía SU texto por SU número: ASLC no recibe textos de otro y el otro no recibe los de ASLC (ni 'Patricia')", async () => {
    const deA = await pendiente();
    const deB = await pedidoDeB();
    const ctxB: PorAceptarCtx = { ...ctxA(), tenantId: B.tenantId, persona: { miembroId: RESPONSABLE_B, esAdmin: false }, config: (pn) => lector(B.tenantId, pn) };
    await decidir(ctxA(), deA.orderId, "aceptar");
    await decidir(ctxB, deB.orderId, "aceptar");
    const aA = enviados.find((e) => e.phoneNumberId === PN_A)!;
    const aB = enviados.find((e) => e.phoneNumberId === PN_B)!;
    assert.match(aA.texto, /Patricia/);
    assert.ok(!aA.texto.includes("[B]"));
    assert.equal(aB.texto, `[B] aceptado ${deB.orderId}`);
    assert.ok(!aB.texto.includes("Patricia"), "'Patricia' solo está en la configuración de ASLC");
    assert.equal(aA.telefono, ANA.waId);
    assert.equal(aB.telefono, BETO.waId);
    assert.deepEqual(almacen.filas.map((f) => f.tenantId).sort(), [A.tenantId, B.tenantId].sort());
  });

  it("I) una decisión con el negocio equivocado no envía nada: el pedido de ASLC no existe para el negocio B", async () => {
    const o = await pendiente();
    await engine.acceptOrder({ tenantId: A.tenantId, orderId: o.orderId, memberId: RESPONSABLE_A, reservation: { kind: "platform" } });
    const r = await enviarMensajeDecision(deps(), decision(o, "aceptar", "confirmed", null, { tenantId: B.tenantId }));
    assert.deepEqual(r, { estado: "no_aplica", motivo: "sin_pedido" });
    assert.deepEqual(enviados, []);
    assert.equal(almacen.filas.length, 0);
  });

  it("I) la persona de otro negocio no puede decidir (404) y por tanto no se envía ningún mensaje", async () => {
    const o = await pendiente();
    const ctxB: PorAceptarCtx = { ...ctxA(), tenantId: B.tenantId, persona: { miembroId: RESPONSABLE_B, esAdmin: false }, config: (pn) => lector(B.tenantId, pn) };
    for (const accion of ["aceptar", "rechazar", "cancelar"]) assert.equal((await decidir(ctxB, o.orderId, accion, "intento de otro negocio")).status, 404, accion);
    assert.deepEqual(enviados, []);
    assert.equal(estadoDe(o).status, "pending_acceptance");
  });

  it("I) el número del pedido debe ser del negocio: si el canal no es suyo (o no tiene token), no se escribe con otro número", async () => {
    const o = await pendiente();
    await engine.acceptOrder({ tenantId: A.tenantId, orderId: o.orderId, memberId: RESPONSABLE_A, reservation: { kind: "platform" } });
    const ajeno = createMemoryNotificacionesStore({ habilitados: [A.tenantId], canales: { [PN_A]: canal(B.tenantId, PN_A) }, now: () => reloj });
    ajeno.entrante(PN_A, ANA.waId, new Date(reloj - MIN).toISOString());
    const r1 = await enviarMensajeDecision(deps({ notificador: { store: ajeno.store, enviador, now: () => reloj, log: () => {} } }), decision(o, "aceptar", "confirmed", null));
    assert.equal(r1.estado, "omitida");
    assert.equal("motivo" in r1 ? r1.motivo : null, "sin_canal");
    const sinToken = createMemoryNotificacionesStore({ habilitados: [A.tenantId], canales: { [PN_A]: { ...canal(A.tenantId, PN_A), token: null } }, now: () => reloj });
    sinToken.entrante(PN_A, ANA.waId, new Date(reloj - MIN).toISOString());
    const r2 = await enviarMensajeDecision(deps({ notificador: { store: sinToken.store, enviador, now: () => reloj, log: () => {} } }), decision(o, "aceptar", "confirmed", null));
    assert.equal("motivo" in r2 ? r2.motivo : null, "sin_token");
    assert.deepEqual(enviados, []);
  });

  it("I) un tenant_id, texto o plantilla en el cuerpo de la decisión no cambian nada: el texto sale de la configuración del negocio de la sesión", async () => {
    const o = await pendiente();
    const r = await leer(await decidirPorAceptar(ctxA(), o.orderId, { accion: "aceptar", tenant_id: B.tenantId, tenantId: B.tenantId, texto: "TEXTO INVENTADO", plantilla: "OTRO", mensaje: "OTRO" }));
    assert.equal(r.status, 200);
    assert.equal(enviados.length, 1);
    assert.match(enviados[0].texto, /Patricia/);
    assert.ok(!/INVENTADO|OTRO|\[B\]/.test(enviados[0].texto));
  });
});

// ===========================================================================
describe("3B.8 · idempotencia: una sola vez por (pedido, decisión) (O, P)", () => {
  it("O) el mismo mensaje pedido dos veces (webhook repetido, reintento): se envía UNA vez y la segunda se reconoce como repetida", async () => {
    const o = await pendiente();
    await engine.acceptOrder({ tenantId: A.tenantId, orderId: o.orderId, memberId: RESPONSABLE_A, reservation: { kind: "platform" } });
    const d = decision(o, "aceptar", "confirmed", null);
    const r1 = await enviarMensajeDecision(deps(), d);
    const r2 = await enviarMensajeDecision(deps(), d);
    assert.equal(r1.estado, "enviada");
    assert.equal(r2.estado, "enviada");
    assert.equal("repetida" in r2 ? r2.repetida : null, true);
    assert.equal(enviados.length, 1);
    assert.equal(almacen.filas.length, 1);
  });

  it("O) a la vez (dos procesos con su propio notificador y el MISMO almacén): UN solo envío; el candado es de la BD, no de la memoria del proceso", async () => {
    const o = await pendiente();
    await engine.acceptOrder({ tenantId: A.tenantId, orderId: o.orderId, memberId: RESPONSABLE_A, reservation: { kind: "platform" } });
    const d = decision(o, "aceptar", "confirmed", null);
    const resultados = await Promise.all(Array.from({ length: 6 }, () => enviarMensajeDecision(deps({ notificador: notificador() }), d)));
    assert.equal(enviados.length, 1);
    assert.equal(almacen.filas.length, 1);
    assert.equal(resultados.filter((r) => "repetida" in r && r.repetida === false).length, 1, "exactamente uno la creó");
  });

  it("O) un proceso que se cayó a mitad (fila en 'enviando', sin envío confirmado): NO se reenvía por su cuenta (prefiere no mandar a mandar dos veces)", async () => {
    const o = await pendiente();
    await engine.acceptOrder({ tenantId: A.tenantId, orderId: o.orderId, memberId: RESPONSABLE_A, reservation: { kind: "platform" } });
    const colgada = await almacen.store.reservar({ tenantId: A.tenantId, pedidoId: o.id, pedidoPublico: o.orderId, tipo: "aceptado", estadoDesde: null, estadoHacia: "confirmado", phoneNumberId: PN_A, telefono: ANA.waId, miembroId: RESPONSABLE_A });
    assert.equal(colgada?.registro.estado, "enviando");
    const r = await enviarMensajeDecision(deps(), decision(o, "aceptar", "confirmed", null));
    assert.deepEqual(enviados, []);
    assert.equal("repetida" in r ? r.repetida : null, true);
    assert.equal(almacen.filas.length, 1);
  });

  it("P) decisión duplicada en el panel: aceptar dos veces => la segunda es 'repetido' y NO envía otro mensaje", async () => {
    const o = await pendiente();
    const ctx = ctxA();
    const a = await decidir(ctx, o.orderId, "aceptar");
    const b = await decidir(ctx, o.orderId, "aceptar");
    assert.equal((a.body.data as { repetido: boolean }).repetido, false);
    assert.equal((b.body.data as { repetido: boolean }).repetido, true);
    assert.equal(mensajeCliente(b), null, "la repetida no vuelve a avisar");
    assert.equal(enviados.length, 1);
  });

  it("P) dos personas deciden a la vez lo mismo (responsable y respaldo): una sola venta y UN solo mensaje", async () => {
    const o = await pendiente();
    const [x, y] = await Promise.all([decidir(ctxA(), o.orderId, "aceptar"), decidir(ctxA({}, { miembroId: RESPALDO_A, esAdmin: false }), o.orderId, "aceptar")]);
    assert.equal(x.status, 200);
    assert.equal(y.status, 200);
    assert.equal(enviados.length, 1);
    assert.equal(almacen.filas.filter((f) => f.tipo === "aceptado").length, 1);
  });

  it("P) aceptar y rechazar a la vez: gana UNA decisión y SOLO sale el mensaje de la que ganó", async () => {
    const o = await pendiente();
    await Promise.all([decidir(ctxA(), o.orderId, "aceptar"), decidir(ctxA({}, { miembroId: RESPALDO_A, esAdmin: false }), o.orderId, "rechazar", "motivo de prueba")]);
    const final = estadoDe(o).status;
    assert.ok(final === "confirmed" || final === "rejected", final);
    assert.equal(enviados.length, 1);
    assert.equal(almacen.filas[0].tipo, final === "confirmed" ? "aceptado" : "rechazado");
    assert.ok(final === "confirmed" ? /fue aceptado/.test(enviados[0].texto) : /no pudo continuar/.test(enviados[0].texto));
  });

  it("el motivo queda CONGELADO en el primer envío: repetir la decisión con otro motivo no manda otro mensaje", async () => {
    const o = await pendiente();
    await decidir(ctxA(), o.orderId, "rechazar", "Primer motivo registrado");
    await decidir(ctxA(), o.orderId, "rechazar", "Otro motivo distinto");
    assert.equal(enviados.length, 1);
    assert.match(enviados[0].texto, /Primer motivo registrado/);
  });
});

// ===========================================================================
describe("3B.8 · el mensaje NO cambia el pedido (R) y no filtra datos (Q)", () => {
  it("R) enviar el mensaje (cualquier resultado) no cambia el estado, la reserva ni el historial del pedido", async () => {
    for (const caso of ["enviada", "ventana", "fallo", "desactivada", "sin_texto"] as const) {
      const o = await pendiente({ producto: await producto(A, `Producto ${caso}`, 10) });
      await engine.acceptOrder({ tenantId: A.tenantId, orderId: o.orderId, memberId: RESPONSABLE_A, reservation: { kind: "platform" } });
      const antes = instantanea(o);
      if (caso === "ventana") almacen.entrante(PN_A, ANA.waId, new Date(reloj - 48 * HORA).toISOString());
      if (caso === "fallo") falloEnvio = new ErrorEnvioWhatsapp("131000", "falla de prueba", false);
      if (caso === "desactivada") almacen.habilitar(A.tenantId, false);
      if (caso === "sin_texto") configs.set(`${A.tenantId}|${PN_A}`, configA({ textosDecision: { aceptado: null, rechazado: null, cancelado: null } }));
      await enviarMensajeDecision(deps(), decision(o, "aceptar", "confirmed", null));
      assert.equal(instantanea(o), antes, caso);
      // Restablece para el siguiente caso.
      falloEnvio = null;
      almacen.habilitar(A.tenantId, true);
      almacen.entrante(PN_A, ANA.waId, new Date(reloj - 5 * MIN).toISOString());
      configs.set(`${A.tenantId}|${PN_A}`, configA());
    }
  });

  it("R) ni el mensaje de aceptación crea una venta por sí solo: sobre un pedido que NO está aceptado, no se envía nada", async () => {
    const o = await pendiente();
    // El pedido sigue pendiente de aceptación: un 'aceptar' que no ocurrió no se informa.
    const r = await enviarMensajeDecision(deps(), decision(o, "aceptar", "confirmed", null));
    assert.deepEqual(r, { estado: "no_aplica", motivo: "estado_no_coincide" });
    for (const [accion, estado] of [["rechazar", "rejected"], ["cancelar", "cancelled"]] as const) {
      assert.deepEqual(await enviarMensajeDecision(deps(), decision(o, accion, estado, "motivo de prueba")), { estado: "no_aplica", motivo: "estado_no_coincide" }, accion);
    }
    assert.deepEqual(enviados, []);
    assert.equal(estadoDe(o).status, "pending_acceptance");
    assert.equal(estadoDe(o).confirmedAt, null);
    assert.equal(pedidos.reservations.length, 0);
  });

  it("R) un mensaje de RECHAZO no sale si el pedido en realidad quedó aceptado (y al revés): solo se informa lo que el pedido realmente es", async () => {
    const o = await pendiente();
    await engine.acceptOrder({ tenantId: A.tenantId, orderId: o.orderId, memberId: RESPONSABLE_A, reservation: { kind: "platform" } });
    assert.deepEqual(await enviarMensajeDecision(deps(), decision(o, "rechazar", "rejected", "motivo de prueba")), { estado: "no_aplica", motivo: "estado_no_coincide" });
    assert.deepEqual(enviados, []);
  });

  it("Q) el documento NUNCA aparece en un texto generado: ni al aceptar, ni al rechazar, ni en el registro, ni en lo que recibe el gancho", async () => {
    const o = await pendiente({ checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "no_especificado", number: DOC } });
    const recibidos: DecisionPorAceptar[] = [];
    const ctx = ctxA({ alDecidir: async (d) => { recibidos.push(d); return ALDECIDIR(deps())(d); } });
    const r = await decidir(ctx, o.orderId, "rechazar", "Producto no disponible");
    const todo = JSON.stringify({ enviados, filas: almacen.filas, recibidos, respuesta: r.body });
    for (const x of ["1.020.345.678", "1020345678", "020.345", "020345", "345.678", "345678"]) assert.ok(!todo.includes(x), `aparece ${x}`);
    const o2 = await pendiente({ checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "no_especificado", number: DOC }, contact: { phoneNumberId: PN_A, waId: "573001110009" } });
    almacen.entrante(PN_A, "573001110009", new Date(reloj - MIN).toISOString());
    await decidir(ctx, o2.orderId, "aceptar");
    assert.ok(!JSON.stringify({ enviados, filas: almacen.filas }).includes("345678"));
  });

  it("Q) un motivo que parece un documento, teléfono o cuenta (7+ dígitos) NO se envía al cliente: el panel le avisa a la persona", async () => {
    for (const motivo of ["Cédula 1.020.345.678 no coincide", "Llamar al 300 123 4567", "cuenta 1234567890", "doc 1020345678"]) {
      const o = await pendiente({ producto: await producto(A, `P ${motivo.slice(0, 5)}`, 5) });
      const r = await decidir(ctxA(), o.orderId, "rechazar", motivo);
      assert.equal(r.status, 200, "la decisión sí se aplica");
      assert.deepEqual(mensajeCliente(r), { estado: "no_aplica", motivo: "motivo_sensible", repetida: false }, motivo);
    }
    assert.deepEqual(enviados, []);
    assert.equal(almacen.filas.length, 0);
  });

  it("Q) el nombre, la dirección y el teléfono del cliente tampoco salen: el texto solo lleva lo que escribió el negocio, el número de pedido y el motivo", async () => {
    const o = await pendiente();
    await decidir(ctxA(), o.orderId, "aceptar");
    const t = enviados[0].texto;
    for (const dato of ["Laura", "Gómez", "Calle 10", "573001234567", "Chapinero", "Bogotá"]) assert.ok(!t.includes(dato), dato);
  });
});

// ===========================================================================
describe("3B.8 · ventana de 24 h, fallos de WhatsApp y reintentos (la decisión nunca se deshace)", () => {
  it("ventana de 24 h cerrada: NO se llama a WhatsApp; queda registrado como 'ventana_vencida' y el panel lo dice", async () => {
    almacen.entrante(PN_A, ANA.waId, new Date(reloj - 30 * HORA).toISOString());
    const o = await pendiente();
    const r = await decidir(ctxA(), o.orderId, "aceptar");
    assert.equal(r.status, 200);
    assert.equal(mensajeCliente(r)?.estado, "ventana_vencida");
    assert.deepEqual(enviados, []);
    assert.equal(almacen.filas[0].estado, "ventana_vencida");
    assert.equal(estadoDe(o).status, "confirmed");
  });

  it("falla de WhatsApp (4xx): 'fallida' en el registro; el pedido sigue aceptado y la respuesta del panel es 200", async () => {
    falloEnvio = new ErrorEnvioWhatsapp("131026", "mensaje no entregable", false);
    const o = await pendiente();
    const r = await decidir(ctxA(), o.orderId, "aceptar");
    assert.equal(r.status, 200);
    assert.equal(mensajeCliente(r)?.estado, "fallida");
    assert.equal(estadoDe(o).status, "confirmed");
    assert.equal(almacen.filas[0].estado, "fallida");
  });

  it("resultado incierto (timeout): 'desconocido' (no se sabe si llegó) y NO se reenvía automáticamente", async () => {
    falloEnvio = new ErrorEnvioWhatsapp("timeout", "sin respuesta", true);
    const o = await pendiente();
    const r = await decidir(ctxA(), o.orderId, "aceptar");
    assert.equal(mensajeCliente(r)?.estado, "desconocido");
    falloEnvio = null;
    await enviarMensajeDecision(deps(), decision(o, "aceptar", "confirmed", null));
    assert.deepEqual(enviados, [], "una repetición no manda lo que quizá ya llegó");
  });

  it("un gancho que lanza una excepción no cambia la decisión: 200 y el panel informa 'no_disponible'", async () => {
    const o = await pendiente();
    const r = await decidir(ctxA({ alDecidir: async () => { throw new Error("falla inesperada"); } }), o.orderId, "aceptar");
    assert.equal(r.status, 200);
    assert.equal(mensajeCliente(r)?.estado, "no_disponible");
    assert.equal(estadoDe(o).status, "confirmed");
  });

  it("el reintento genérico (Pedidos > notificaciones) NO reenvía estos mensajes: usaría la plantilla de siempre y no el texto del negocio", async () => {
    almacen.entrante(PN_A, ANA.waId, new Date(reloj - 30 * HORA).toISOString());
    const acep = await pendiente();
    await decidir(ctxA(), acep.orderId, "aceptar");
    const rech = await pendiente({ producto: await producto(A, "Otro", 5) });
    await decidir(ctxA(), rech.orderId, "rechazar", "motivo de prueba");
    almacen.entrante(PN_A, ANA.waId, new Date(reloj - MIN).toISOString());
    for (const [pedido, tipo] of [[acep, "aceptado"], [rech, "rechazado"]] as const) {
      const r = await reintentarNotificacion(notificador(), { tenantId: A.tenantId, tipo, pedido: estadoDe(pedido) });
      assert.equal(r.estado, "no_reintentable", tipo);
      assert.match("motivo" in r ? String(r.motivo) : "", /texto configurado del negocio/);
    }
    assert.deepEqual(enviados, []);
  });

  it("el módulo genérico no tiene plantilla para 'aceptado': nunca inventa un texto de aceptación", async () => {
    const { mensajeNotificacion } = await import("@/lib/catalogo/pedidos/notificaciones");
    assert.throws(() => mensajeNotificacion("aceptado", { nombre: "Laura", pedido: "DL-ORD-AAAAAA", entrega: "domicilio", negocio: "Tienda" }), /lo define el negocio/);
  });
});

// ===========================================================================
describe("3B.8 · respuesta al 'sí' del cliente tras el aviso: el texto lo define el negocio y no toca el pedido (B, C, D)", () => {
  // Texto de PRUEBA con el ejemplo del dueño ("Patricia"): vive solo en la configuración del negocio A.
  const TRAS_AVISO_A = "Perfecto 👍 Tu confirmación fue recibida. Patricia será la encargada de continuar con la gestión de tu pedido y coordinar el despacho.";
  const TRAS_AVISO_B = "[B] Recibimos tu confirmación. Una persona de nuestro equipo continuará contigo.";
  let escribio: boolean | "error";
  let respuestas: Array<{ phoneNumberId: string; texto: string }>;

  beforeEach(() => {
    escribio = false;
    respuestas = [];
    configs.set(`${A.tenantId}|${PN_A}`, configA({ textoTrasAviso: TRAS_AVISO_A }));
    configs.set(`${B.tenantId}|${PN_B}`, configB());
    configs.set(`${B.tenantId}|${PN_B}`, { ...configB(), textoTrasAviso: TRAS_AVISO_B });
  });

  const depsSi = (pn: string): RespuestaAvisoDeps => ({
    config: lector,
    engine,
    humanWroteSince: async () => {
      if (escribio === "error") throw new Error("no se pudo comprobar");
      return escribio;
    },
    sendText: async (texto) => {
      respuestas.push({ phoneNumberId: pn, texto });
      return { sent: true };
    },
    log: () => {},
  });
  const si = (tenant: CatalogActor, pn: string, waId: string, text = "sí") => atenderRespuestaTrasAviso({ tenantId: tenant.tenantId, phoneNumberId: pn, waId, text }, depsSi(pn));

  it("B) el 'sí' recibe UNA respuesta con EXACTAMENTE el texto que configuró el negocio; el pedido sigue pendiente (no se acepta, ni se reserva, ni se despacha)", async () => {
    const o = await pendiente();
    const antes = instantanea(o);
    const r = await si(A, PN_A, ANA.waId);
    assert.deepEqual(r, { handled: true, accion: "respondida" });
    assert.deepEqual(respuestas, [{ phoneNumberId: PN_A, texto: TRAS_AVISO_A }]);
    const f = estadoDe(o);
    assert.equal(f.status, "pending_acceptance");
    assert.equal(f.confirmedAt, null);
    assert.ok(f.acceptance?.customerReplyAt, "el 'sí' queda registrado (informativo)");
    assert.equal(pedidos.reservations.length, 0);
    assert.equal(JSON.parse(instantanea(o)).status, JSON.parse(antes).status);
    // La respuesta es texto del negocio: el motor no agrega nada (ni fecha, ni 'ya salió', ni 'confirmado').
    assert.equal(respuestas[0].texto, TRAS_AVISO_A);
  });

  it("B) otro 'sí' de otra forma de decirlo ('confirmo', 'estoy 100% seguro') recibe lo mismo; una pregunta o duda NO es un 'sí' y no recibe esa respuesta", async () => {
    const o = await pendiente();
    for (const dudoso of ["¿cuándo llega?", "creo que sí", "no estoy seguro", "sí pero cambia la dirección"]) {
      assert.deepEqual(await si(A, PN_A, ANA.waId, dudoso), { handled: false, motivo: "no_es_confirmacion" }, dudoso);
    }
    assert.deepEqual(respuestas, []);
    assert.equal((await si(A, PN_A, ANA.waId, "estoy 100% seguro")).handled, true);
    assert.equal(respuestas.length, 1);
    assert.equal(estadoDe(o).status, "pending_acceptance");
  });

  it("C) si una persona (Patricia) YA escribió: el 'sí' se registra pero NO se responde (la intervención humana tiene prioridad)", async () => {
    const o = await pendiente();
    escribio = true;
    const r = await si(A, PN_A, ANA.waId);
    assert.deepEqual(r, { handled: true, accion: "registrada_sin_respuesta" });
    assert.deepEqual(respuestas, []);
    assert.ok(estadoDe(o).acceptance?.customerReplyAt, "se registró");
    assert.equal(estadoDe(o).status, "pending_acceptance");
  });

  it("C) sin certeza de si una persona escribió (la comprobación falla): tampoco se responde", async () => {
    await pendiente();
    escribio = "error";
    assert.deepEqual(await si(A, PN_A, ANA.waId), { handled: true, accion: "registrada_sin_respuesta" });
    assert.deepEqual(respuestas, []);
  });

  it("C) el negocio puede elegir responder igual aunque una persona ya haya escrito (D11): entonces SÍ sale el texto, una vez", async () => {
    configs.set(`${A.tenantId}|${PN_A}`, configA({ textoTrasAviso: TRAS_AVISO_A, siYaRespondioPersona: "responder" }));
    await pendiente();
    escribio = true;
    assert.deepEqual(await si(A, PN_A, ANA.waId), { handled: true, accion: "respondida" });
    assert.deepEqual(respuestas.map((x) => x.texto), [TRAS_AVISO_A]);
  });

  it("D) dos 'sí' seguidos: UNA sola respuesta (el segundo solo se reconoce como ya registrado)", async () => {
    await pendiente();
    const r1 = await si(A, PN_A, ANA.waId);
    const r2 = await si(A, PN_A, ANA.waId, "claro");
    assert.deepEqual(r1, { handled: true, accion: "respondida" });
    assert.deepEqual(r2, { handled: true, accion: "ya_registrada" });
    assert.equal(respuestas.length, 1);
  });

  it("D) cinco 'sí' a la vez (reintentos del webhook): UNA sola respuesta; el registro es atómico en la BD", async () => {
    const o = await pendiente();
    const rs = await Promise.all(Array.from({ length: 5 }, () => si(A, PN_A, ANA.waId)));
    assert.equal(respuestas.length, 1);
    assert.equal(rs.filter((r) => r.handled && r.accion === "respondida").length, 1);
    assert.equal(estadoDe(o).status, "pending_acceptance");
  });

  it("sin configuración de aceptación (o sin el texto): el mensaje sigue su camino, no se inventa ninguna respuesta", async () => {
    await pendiente();
    configs.set(`${A.tenantId}|${PN_A}`, null);
    assert.deepEqual(await si(A, PN_A, ANA.waId), { handled: false, motivo: "sin_configuracion" });
    assert.deepEqual(respuestas, []);
  });

  it("I) cada negocio responde con SU texto: el 'sí' del cliente de B nunca recibe el de A (ni 'Patricia')", async () => {
    await pendiente();
    const pb = await producto(B, "Anillo", 5);
    const { order } = await engine.createOrder({ tenantId: B.tenantId, channel: "retail", source: "agent", contact: BETO, items: [{ reference: pb.reference, quantity: 1 }], idempotencyKey: "agent:b1" });
    const ob = await engine.submitForAcceptance({ tenantId: B.tenantId, contact: BETO, orderId: order.orderId, confirmationId: order.confirmation!.id, checkout: DOMICILIO, policy: SIN_RESERVA });
    await engine.recordAcceptanceNotice({ tenantId: B.tenantId, contact: BETO, orderId: ob.orderId });
    await si(A, PN_A, ANA.waId);
    await si(B, PN_B, BETO.waId);
    assert.equal(respuestas.find((x) => x.phoneNumberId === PN_A)?.texto, TRAS_AVISO_A);
    assert.equal(respuestas.find((x) => x.phoneNumberId === PN_B)?.texto, TRAS_AVISO_B);
    assert.ok(!respuestas.find((x) => x.phoneNumberId === PN_B)?.texto.includes("Patricia"));
    // Un 'sí' del cliente de A por el número de B no encuentra ningún pedido pendiente de B: no responde nada.
    assert.deepEqual(await si(B, PN_B, ANA.waId), { handled: false, motivo: "sin_pedido_pendiente" });
  });
});
