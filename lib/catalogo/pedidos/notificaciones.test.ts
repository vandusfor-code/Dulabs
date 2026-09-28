/**
 * Bloque 31 — notificaciones automáticas de estado de pedidos por WhatsApp (A–T).
 * Motor, catálogo, pedidos y notificaciones en memoria (misma semántica que la BD; la BD tiene su
 * prueba SQL y la matriz E2E corre contra PostgreSQL real). Meta simulada. Sin IA. Datos ficticios.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine, type CheckoutData, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { accionGestion, detalleGestion, reintentarNotificacionGestion, type NotificacionVista } from "@/lib/catalogo/pedidos/gestion";
import type { Order } from "@/lib/catalogo/pedidos/contrato";
import {
  ESPERA_REINTENTO_INCIERTO_MS,
  ErrorEnvioWhatsapp,
  MARGEN_VENTANA_MS,
  VENTANA_MS,
  createMemoryNotificacionesStore,
  mensajeNotificacion,
  notificarTransicion,
  reintentarNotificacion,
  ventanaConversacion,
  type EnviadorWhatsapp,
  type NotificadorDeps,
  type ResultadoNotificacion,
} from "@/lib/catalogo/pedidos/notificaciones";
import { errorDeMeta } from "@/lib/catalogo/pedidos/notificaciones-produccion";
import { MetaGraphApiError } from "@/lib/whatsapp";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const PN_A = "100000000000001";
const PN_B = "200000000000002";
const ANA = { phoneNumberId: PN_A, waId: "573001110001" };
const LUIS = { phoneNumberId: PN_A, waId: "573001110002" };
const ASESORA = 41;

const CHECKOUT = {
  tienda: { customerName: "Ana Pérez", paymentMethod: "transferencia", delivery: "tienda", address: null, city: null, deliveryReference: null },
  domicilio: { customerName: "Luis Gómez", paymentMethod: "pago_en_tienda", delivery: "domicilio", address: "Calle 1 # 2-3", city: "Montería", deliveryReference: "Portón azul" },
} satisfies Record<string, CheckoutData>;

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let orders: ReturnType<typeof createMemoryOrdersRepository>;
let engine: OrderEngine;
let clock: number;
let seq: number;
let notif: ReturnType<typeof createMemoryNotificacionesStore>;
let envios: Array<{ phoneNumberId: string; telefono: string; texto: string }>;
let registrados: string[];
let fallo: ErrorEnvioWhatsapp | null;
let deps: NotificadorDeps;

const enviador = (): EnviadorWhatsapp => ({
  async enviar(canal, telefono, texto) {
    if (fallo) {
      const e = fallo;
      fallo = null;
      throw e;
    }
    envios.push({ phoneNumberId: canal.phoneNumberId, telefono, texto });
    return { messageId: `wamid.notif.${envios.length}` };
  },
  async registrar(_c, _t, texto) {
    registrados.push(texto);
  },
});

beforeEach(() => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  clock = Date.parse("2026-09-28T15:00:00Z");
  orders = createMemoryOrdersRepository({ inventory: mem.inventory, now: () => clock });
  engine = createOrderEngine({ orders, catalog: mem.repo, key: Buffer.alloc(32, 5), log: () => {}, now: () => new Date(clock), handoff: { pauseConversation: async () => ({ ok: true }) } });
  for (const actor of [A, B]) mem.enableModule(actor.tenantId);
  seq = 0;
  envios = [];
  registrados = [];
  fallo = null;
  notif = createMemoryNotificacionesStore({
    habilitados: [A.tenantId],
    now: () => clock,
    canales: {
      [PN_A]: { tenantId: A.tenantId, phoneNumberId: PN_A, token: "tok-a", nombreNegocio: "Delacour Joyería" },
      [PN_B]: { tenantId: B.tenantId, phoneNumberId: PN_B, token: "tok-b", nombreNegocio: "Otro negocio" },
    },
  });
  // El cliente escribió hace 1 hora: ventana de 24 h abierta.
  for (const c of [ANA, LUIS]) notif.entrante(c.phoneNumberId, c.waId, new Date(clock - 3_600_000).toISOString());
  deps = { store: notif.store, enviador: enviador(), now: () => clock };
});

async function confirmado(opts: { contact?: typeof ANA; entrega?: "tienda" | "domicilio"; tenant?: CatalogActor } = {}) {
  const actor = opts.tenant ?? A;
  const p = await admin.createProduct(actor, { name: `Anillo ${++seq}`, retailPrice: 50_000, wholesalePrice: 30_000, stock: 5 });
  const contact = opts.contact ?? ANA;
  const { order } = await engine.createOrder({ tenantId: actor.tenantId, channel: "retail", source: "agent", contact, items: [{ reference: p.reference, quantity: 1 }], idempotencyKey: `agent:b31-${seq}` });
  return engine.confirmOrder({ tenantId: actor.tenantId, contact, orderId: order.orderId, confirmationId: order.confirmation!.id, actor: "agent", checkout: CHECKOUT[opts.entrega ?? "tienda"] });
}

type Resp = { status: number; body: { success: boolean; data: { repetido?: boolean; notificacion?: ResultadoNotificacion | null }; error?: { code: string; message: string } } };
async function visto(pedido: string, tenant = A.tenantId) {
  const o = (await orders.getByOrderId(tenant, pedido))!;
  return { estado: o.status, etapa: o.checkout?.stage ?? null, pago: o.checkout?.paymentStatus ?? null };
}
async function actuar(pedido: string, accion: string, opts: { motivo?: string; tenant?: string; d?: NotificadorDeps | null } = {}): Promise<Resp> {
  const tenant = opts.tenant ?? A.tenantId;
  const res = await accionGestion(engine, tenant, pedido, { accion, esperado: await visto(pedido, tenant), ...(opts.motivo ? { motivo: opts.motivo } : {}) }, ASESORA, opts.d === null ? undefined : (opts.d ?? deps));
  return { status: res.status, body: await res.json() };
}
const pedidoDe = async (id: string) => (await orders.getByOrderId(A.tenantId, id))!;

describe("B31 · notificaciones de estado por WhatsApp", () => {
  it("A/C/R · cambio válido => el estado queda aplicado y el cliente recibe UN WhatsApp con el mensaje fijo (sin IA)", async () => {
    const o = await confirmado({ entrega: "domicilio", contact: LUIS });
    const r = await actuar(o.orderId, "en_preparacion");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.notificacion, { estado: "enviada", tipo: "en_preparacion", motivo: null, repetida: false });
    assert.equal((await pedidoDe(o.orderId)).checkout?.stage, "en_preparacion");
    assert.equal(envios.length, 1);
    assert.equal(envios[0].telefono, LUIS.waId);
    assert.equal(envios[0].texto, mensajeNotificacion("en_preparacion", { nombre: "Luis Gómez", pedido: o.orderId, entrega: "domicilio", negocio: "Delacour Joyería" }));
    assert.match(envios[0].texto, /^Hola, Luis 💖/);
    assert.deepEqual(registrados, [envios[0].texto], "queda en el Inbox como mensaje del negocio");
    const fila = notif.filas[0];
    assert.equal(fila.messageId, "wamid.notif.1");
    assert.equal(fila.estadoDesde, "confirmado");
    assert.equal(fila.estadoHacia, "en_preparacion");
    assert.equal(fila.miembroId, ASESORA);
  });

  it("B · cambio inválido (enviado en un pedido para recoger; completar sin pago) => 409 y NINGUNA notificación", async () => {
    const o = await confirmado({ entrega: "tienda" });
    await actuar(o.orderId, "en_preparacion");
    const antes = envios.length;
    const r = await actuar(o.orderId, "enviado");
    assert.equal(r.status, 409);
    const r2 = await actuar(o.orderId, "completar");
    assert.equal(r2.status, 409);
    assert.equal(envios.length, antes);
    assert.equal(notif.filas.length, 1, "solo la de 'en preparación'");
  });

  it("D/S · WhatsApp falla (error de Meta) => el pedido NO se revierte; la notificación queda 'fallida' con código y mensaje", async () => {
    const o = await confirmado({ entrega: "domicilio", contact: LUIS });
    fallo = new ErrorEnvioWhatsapp("131026", "Message undeliverable", false);
    const r = await actuar(o.orderId, "en_preparacion");
    assert.equal(r.status, 200);
    assert.equal(r.body.data.notificacion && "estado" in r.body.data.notificacion && r.body.data.notificacion.estado, "fallida");
    assert.equal((await pedidoDe(o.orderId)).checkout?.stage, "en_preparacion", "el cambio de estado se conserva");
    assert.equal(notif.filas[0].errorCodigo, "131026");
    assert.equal(notif.filas[0].errorMensaje, "Message undeliverable");
    assert.equal(envios.length, 0);
  });

  it("S · Meta responde 131047 (ventana cerrada) => 'ventana_vencida' con el motivo de Meta", async () => {
    const o = await confirmado();
    fallo = new ErrorEnvioWhatsapp("131047", "Re-engagement message", false, true);
    const r = await actuar(o.orderId, "pago_recibido");
    assert.equal((r.body.data.notificacion as { estado: string }).estado, "ventana_vencida");
    assert.equal(notif.filas[0].motivo, "meta_ventana_cerrada");
  });

  it("E/F · ventana de 24 h: abierta => se envía; vencida o sin mensajes del cliente => NO se llama a Meta y queda 'ventana_vencida'", async () => {
    const o1 = await confirmado({ contact: ANA });
    notif.entrante(ANA.phoneNumberId, ANA.waId, new Date(clock - 25 * 3_600_000).toISOString());
    const r = await actuar(o1.orderId, "pago_recibido");
    assert.deepEqual(r.body.data.notificacion, { estado: "ventana_vencida", tipo: "pago_recibido", motivo: "ventana_vencida", repetida: false });
    assert.equal(envios.length, 0);
    assert.equal((await pedidoDe(o1.orderId)).checkout?.paymentStatus, "recibido", "el pago sí quedó registrado");
    // Función central: sin mensajes, justo antes y justo después del límite (con margen).
    assert.equal(ventanaConversacion(null, clock).abierta, false);
    assert.equal(ventanaConversacion(new Date(clock - (VENTANA_MS - MARGEN_VENTANA_MS) + 1_000).toISOString(), clock).abierta, true);
    assert.equal(ventanaConversacion(new Date(clock - (VENTANA_MS - MARGEN_VENTANA_MS)).toISOString(), clock).abierta, false);
    assert.equal(ventanaConversacion("no-es-fecha", clock).abierta, false);
  });

  it("G/I · doble clic simultáneo y repetir la acción => UN solo WhatsApp (clave única pedido + tipo)", async () => {
    const o = await confirmado({ entrega: "domicilio", contact: LUIS });
    const esperado = await visto(o.orderId);
    const [r1, r2] = await Promise.all(
      [1, 2].map(async () => {
        const res = await accionGestion(engine, A.tenantId, o.orderId, { accion: "en_preparacion", esperado }, ASESORA, deps);
        return res.json() as Promise<Resp["body"]>;
      }),
    );
    assert.ok(r1.success || r2.success);
    const repetida = await actuar(o.orderId, "en_preparacion");
    assert.equal(repetida.body.data.repetido, true);
    assert.equal((repetida.body.data.notificacion as { repetida: boolean }).repetida, true);
    assert.equal(envios.length, 1, "un solo mensaje pase lo que pase");
    assert.equal(notif.filas.length, 1);
  });

  it("H · reintento del mismo evento (timeout, recarga del servidor) => notificarTransicion dos veces = un envío", async () => {
    const o = await confirmado();
    await engine.markPaymentReceived({ tenantId: A.tenantId, orderId: o.orderId, memberId: ASESORA });
    const despues = await pedidoDe(o.orderId);
    const a = await notificarTransicion(deps, { tenantId: A.tenantId, tipo: "pago_recibido", antes: o, despues, miembroId: ASESORA });
    const b = await notificarTransicion(deps, { tenantId: A.tenantId, tipo: "pago_recibido", antes: o, despues, miembroId: ASESORA });
    assert.equal(a.estado, "enviada");
    assert.deepEqual(b, { estado: "enviada", tipo: "pago_recibido", motivo: null, repetida: true });
    assert.equal(envios.length, 1);
  });

  it("J · domicilio: preparación -> enviado -> entregado, cada uno con su mensaje (sin guías, fechas ni transportadora inventadas)", async () => {
    const o = await confirmado({ entrega: "domicilio", contact: LUIS });
    await actuar(o.orderId, "en_preparacion");
    await actuar(o.orderId, "enviado");
    await actuar(o.orderId, "entregado");
    assert.equal(envios.length, 3);
    assert.match(envios[0].texto, /Te avisaremos cuando sea enviado/);
    assert.match(envios[1].texto, /ya fue enviado/);
    assert.match(envios[2].texto, /figura como entregado/);
    for (const e of envios) assert.doesNotMatch(e.texto, /gu[ií]a|transportadora|\d{1,2}\/\d{1,2}|llegar[aá] el|días? hábiles/i);
  });

  it("K · recoger en tienda: nunca dice 'enviado'; entregado = 'entregado en la tienda'", async () => {
    const o = await confirmado({ entrega: "tienda" });
    await actuar(o.orderId, "en_preparacion");
    await actuar(o.orderId, "entregado");
    assert.equal(envios.length, 2);
    for (const e of envios) assert.doesNotMatch(e.texto, /enviad/);
    assert.match(envios[1].texto, /entregado en la tienda/);
  });

  it("L/M · teléfono inválido o pedido sin contacto => 'omitida' con el motivo; el estado sí cambia", async () => {
    const o = await confirmado();
    await engine.markPaymentReceived({ tenantId: A.tenantId, orderId: o.orderId, memberId: ASESORA });
    const despues = await pedidoDe(o.orderId);
    const sinTel: Order = { ...despues, id: "otro-1", contact: { phoneNumberId: PN_A, waId: "12" } };
    const sinContacto: Order = { ...despues, id: "otro-2", contact: null };
    assert.equal((await notificarTransicion(deps, { tenantId: A.tenantId, tipo: "pago_recibido", antes: null, despues: sinTel, miembroId: 1 })).estado, "omitida");
    assert.equal((await notificarTransicion(deps, { tenantId: A.tenantId, tipo: "pago_recibido", antes: null, despues: sinContacto, miembroId: 1 })).estado, "omitida");
    assert.deepEqual(notif.filas.map((f) => f.motivo), ["telefono_invalido", "sin_contacto"]);
    assert.equal(envios.length, 0);
  });

  it("N · aislamiento: otro negocio sin el módulo => sin notificación; un pedido de A con el número de B => nunca se usa el número de B", async () => {
    const ob = await confirmado({ tenant: B, contact: { phoneNumberId: PN_B, waId: "573009990001" } });
    notif.entrante(PN_B, "573009990001", new Date(clock - 60_000).toISOString());
    const r = await actuar(ob.orderId, "en_preparacion", { tenant: B.tenantId });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.notificacion, { estado: "desactivada" });
    assert.equal(envios.length, 0);
    assert.equal(notif.filas.length, 0);
    // Pedido de A cuyo contacto dice ser del número de B: el canal no es de A => omitida, sin envío.
    const o = await confirmado();
    await engine.markPaymentReceived({ tenantId: A.tenantId, orderId: o.orderId, memberId: ASESORA });
    const cruzado: Order = { ...(await pedidoDe(o.orderId)), contact: { phoneNumberId: PN_B, waId: "573009990001" } };
    const x = await notificarTransicion(deps, { tenantId: A.tenantId, tipo: "pago_recibido", antes: null, despues: cruzado, miembroId: 1 });
    assert.deepEqual(x, { estado: "omitida", tipo: "pago_recibido", motivo: "sin_canal", repetida: false });
    assert.equal(envios.length, 0);
  });

  it("O/P · IA pausada o asesora atendiendo: la notificación sale igual y el notificador no tiene acceso a pausas, IA ni asignación", () => {
    const src = readFileSync(join(process.cwd(), "lib/catalogo/pedidos/notificaciones.ts"), "utf8");
    const prod = readFileSync(join(process.cwd(), "lib/catalogo/pedidos/notificaciones-produccion.ts"), "utf8");
    for (const s of [src, prod]) {
      const imports = s.split("\n").filter((l) => /^import |^\s+from "/.test(l)).join("\n");
      assert.doesNotMatch(imports, /@\/lib\/agente|ia-proveedores|gemini|pausas-chat|conversacion-estado|asignaci|chat-lock/i, "sin IA, sin pausas, sin asignación");
    }
    assert.doesNotMatch(prod, /\.from\("dulabs_(pausas_chat|chat_lock|agente_conversaciones|conversacion_estado|conversacion_asignaciones)"\)/);
  });

  it("Q · negocio sin el módulo: el estado cambia y no se crea ni envía nada", async () => {
    notif.habilitar(A.tenantId, false);
    const o = await confirmado();
    const r = await actuar(o.orderId, "pago_recibido");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.notificacion, { estado: "desactivada" });
    assert.equal(notif.filas.length, 0);
    assert.equal(envios.length, 0);
  });

  it("sin la migración (tabla inexistente): la acción funciona igual y el panel dice 'no disponible'", async () => {
    notif.sinTabla();
    const o = await confirmado();
    const r = await actuar(o.orderId, "pago_recibido");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.notificacion, { estado: "no_disponible" });
    assert.equal((await pedidoDe(o.orderId)).checkout?.paymentStatus, "recibido");
  });

  it("D · la BD de notificaciones falla (caída, timeout): el pedido cambia igual y la acción responde 200", async () => {
    const o = await confirmado();
    const roto: NotificadorDeps = { ...deps, store: { ...notif.store, reservar: async () => { throw new Error("conexión perdida"); } } };
    const r = await actuar(o.orderId, "en_preparacion", { d: roto });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.notificacion, { estado: "no_disponible" });
    assert.equal((await pedidoDe(o.orderId)).checkout?.stage, "en_preparacion");
    assert.equal(envios.length, 0);
  });

  it("T · recuperación: 'fallida' -> Reintentar => enviada (una vez); reintentar de nuevo => rechazado; dos a la vez => un envío", async () => {
    const o = await confirmado();
    fallo = new ErrorEnvioWhatsapp("http_500", "Meta caída", false);
    await actuar(o.orderId, "pago_recibido");
    assert.equal(notif.filas[0].estado, "fallida");
    const [x, y] = await Promise.all([1, 2].map(() => reintentarNotificacion(deps, { tenantId: A.tenantId, tipo: "pago_recibido", pedido: notif.filas.length ? ({ ...o, checkout: { ...o.checkout!, paymentStatus: "recibido" } } as Order) : o })));
    assert.equal([x, y].filter((r) => r.estado === "enviada").length, 1);
    assert.equal(envios.length, 1);
    assert.equal(notif.filas[0].intentos, 2);
    const otra = await reintentarNotificacion(deps, { tenantId: A.tenantId, tipo: "pago_recibido", pedido: await pedidoDe(o.orderId) });
    assert.deepEqual(otra, { estado: "no_reintentable", motivo: "Esa notificación ya fue enviada." });
    assert.equal(envios.length, 1);
  });

  it("T · reintento seguro: 'desconocido' (timeout) no se reintenta antes de 10 min; una notificación ya superada no se reenvía", async () => {
    const o = await confirmado({ entrega: "domicilio", contact: LUIS });
    fallo = new ErrorEnvioWhatsapp("timeout", "sin respuesta", true);
    await actuar(o.orderId, "en_preparacion");
    assert.equal(notif.filas[0].estado, "desconocido");
    const pronto = await reintentarNotificacion(deps, { tenantId: A.tenantId, tipo: "en_preparacion", pedido: await pedidoDe(o.orderId) });
    assert.equal(pronto.estado, "no_reintentable");
    clock += ESPERA_REINTENTO_INCIERTO_MS + 1;
    notif.entrante(LUIS.phoneNumberId, LUIS.waId, new Date(clock - 60_000).toISOString());
    // El pedido ya avanzó a "enviado": la de "en preparación" ya no aplica.
    await actuar(o.orderId, "enviado");
    const vieja = await reintentarNotificacion(deps, { tenantId: A.tenantId, tipo: "en_preparacion", pedido: await pedidoDe(o.orderId) });
    assert.deepEqual(vieja, { estado: "no_reintentable", motivo: "El pedido ya cambió de estado: esa notificación ya no aplica." });
  });

  it("panel: el detalle lista las notificaciones y la ruta de reintento valida el tipo y el pedido", async () => {
    const o = await confirmado();
    fallo = new ErrorEnvioWhatsapp("131026", "Message undeliverable", false);
    await actuar(o.orderId, "pago_recibido");
    const extras = { fuentes: { nombres: async () => new Map(), canales: async () => new Map(), confirmados: async () => new Map(), asignadas: async () => new Map(), fotos: async () => new Map(), miembros: async () => new Map(), atencion: async () => new Map() }, verTelefono: true };
    const det = (await (await detalleGestion(engine, A.tenantId, o.orderId, extras, deps)).json()) as { data: { notificaciones: NotificacionVista[] } };
    assert.equal(det.data.notificaciones.length, 1);
    assert.equal(det.data.notificaciones[0].estado, "fallida");
    assert.equal(det.data.notificaciones[0].error_codigo, "131026");
    assert.equal((await reintentarNotificacionGestion(engine, A.tenantId, o.orderId, { tipo: "inventado" }, deps)).status, 400);
    assert.equal((await reintentarNotificacionGestion(engine, B.tenantId, o.orderId, { tipo: "pago_recibido" }, deps)).status, 404, "otro negocio no ve el pedido");
    const ok = await reintentarNotificacionGestion(engine, A.tenantId, o.orderId, { tipo: "pago_recibido" }, deps);
    assert.equal(ok.status, 200);
    assert.equal(envios.length, 1);
  });

  it("mensajes: cancelado y rechazado ofrecen una asesora; sin nombre, saludo neutro; completado agradece con el nombre del negocio", () => {
    const d = { nombre: null, pedido: "DL-ORD-ABC234", entrega: "domicilio" as const, negocio: "Delacour Joyería" };
    assert.match(mensajeNotificacion("cancelado", d), /^Hola\.\n\nTe informamos que tu pedido \*DL-ORD-ABC234\* fue cancelado[\s\S]*asesora/);
    assert.match(mensajeNotificacion("rechazado", d), /no pudo continuar y fue rechazado[\s\S]*asesora/);
    assert.match(mensajeNotificacion("completado", { ...d, nombre: "Ana María" }), /^Hola, Ana 💖[\s\S]*¡Gracias por comprar en Delacour Joyería! ✨$/);
  });

  it("errores de Meta: 131047 = ventana cerrada; 4xx = fallida (no incierta); timeout/red = incierta", () => {
    const v = errorDeMeta(new MetaGraphApiError({ httpStatus: 400, metaErrorCode: 131047, metaErrorMessage: "Re-engagement" }));
    assert.equal(v.ventanaCerrada, true);
    const f = errorDeMeta(new MetaGraphApiError({ httpStatus: 400, metaErrorCode: 131026, metaErrorMessage: "undeliverable" }));
    assert.deepEqual([f.codigo, f.incierto, f.ventanaCerrada], ["131026", false, false]);
    const t = Object.assign(new Error("timeout"), { name: "TimeoutError" });
    assert.deepEqual([errorDeMeta(t).codigo, errorDeMeta(t).incierto], ["timeout", true]);
  });
});
