/**
 * FASE 3B.5 — ACEPTACIÓN HUMANA: asignación a la persona responsable, aviso, panel "Por aceptar", aceptar /
 * rechazar, el "sí" del cliente después del aviso y el aislamiento entre negocios. TODO en memoria, con las
 * MISMAS reglas que la BD (repositorio de pedidos en memoria) y el runtime real del agente.
 *
 *   1. Enrutador: asigna a la persona de la configuración (activa y del MISMO negocio; si no, fail-closed),
 *      registra UN evento de asignación, avisa por el canal del panel y deja la IA en silencio. Idempotente.
 *   2. Panel: el pedido aparece como pendiente con todo lo que la persona necesita (documento enmascarado).
 *   3. Aceptar (acceptOrder, nunca confirmOrder) / rechazar / cancelar: solo una persona autorizada del negocio;
 *      doble clic inocuo; sin stock no hay venta parcial; la reserva sale de la política del negocio.
 *   4. El "sí" del cliente: se registra (una vez) y puede recibir UNA respuesta fija; nunca confirma ni reserva;
 *      si una persona ya escribió, no se le responde.
 *   5. Multi-negocio y Delacour (checkout de siempre) sin cambios.
 *
 * Negocios, personas, clientes, productos, textos y políticas FICTICIOS (valores de prueba). Nada toca
 * Supabase, Gemini ni Meta.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString("base64");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin, type ClienteConfig } from "@/lib/supabase";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { OrderError, createOrderEngine, type CheckoutData, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import type { AcceptancePolicy, Order } from "@/lib/catalogo/pedidos/contrato";
import { decidirPorAceptar, detallePorAceptar, listarPorAceptar, type PedidoPorAceptar, type PorAceptarCtx } from "@/lib/catalogo/pedidos/por-aceptar";
import type { PanelFuentes } from "@/lib/catalogo/pedidos/panel";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import { createMemoryAgentConfigStore, parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import { createMemoryConversationStateStore, type ConversationStateStore } from "@/lib/agente/estado";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import type { AgentToolsDeps } from "@/lib/agente/herramientas";
import { runAgentTurn } from "@/lib/agente/runtime";
import { createMemoryCustomerChannelStore } from "@/lib/agente/clasificacion";
import type { HistoryRow } from "@/lib/agente/contexto";
import { ACEPTACION_BUTTONS } from "@/lib/agente/checkout";
import { CHECKOUT_OPCIONES_LEGADO, FUNCIONES_FASE_3B, type FuncionFase3B } from "@/lib/agente/perfil-negocio";
import { createMemoryMiembrosStore, type MiembroEquipo } from "@/lib/agente/responsable";
import {
  canalPanel,
  createAcceptanceRouter,
  createMemoryAsignacionesStore,
  createSupabaseAsignacionesStore,
  leerConfigAceptacion,
  notificarResponsablePedido,
  puedeDecidir,
  type AvisoResponsable,
  type CanalNotificador,
  type ConfigAceptacion,
  type EnrutadorAceptacionDeps,
} from "@/lib/agente/aceptacion-humana";
import { atenderRespuestaTrasAviso, createSupabaseHumanEvidence, esConfirmacionTrasAviso, type RespuestaAvisoDeps } from "@/lib/agente/respuesta-aviso";
import { atenderConAgenteSiAplica, atenderRespuestaTrasAvisoProduccion, type AgentBoundaryDeps, type AgentBoundaryInput } from "@/lib/agente/webhook";
import { cifrarSecreto } from "@/lib/crypto";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const PN_A = "100000000000001";
const PN_B = "100000000000002";
const ANA = { phoneNumberId: PN_A, waId: "573001110001" };
const BETO = { phoneNumberId: PN_B, waId: "573001110002" };
const DOC = "1.020.345.678";
const MIN = 60_000;

// Personas de PRUEBA (ids ficticios; la responsable real la define el negocio al aprovisionar).
const RESPONSABLE_A = 41;
const ADMIN_A = 42;
const INACTIVA_A = 43;
const AGENTE_A = 44;
const RESPONSABLE_B = 51;
const ADMIN_B = 52;
const MIEMBROS: MiembroEquipo[] = [
  { id: RESPONSABLE_A, tenantId: A.tenantId, estado: "activo", rol: "agente", email: "responsable.a@example.test" },
  { id: ADMIN_A, tenantId: A.tenantId, estado: "activo", rol: "admin", email: "admin.a@example.test" },
  { id: INACTIVA_A, tenantId: A.tenantId, estado: "suspendido", rol: "agente", email: null },
  { id: AGENTE_A, tenantId: A.tenantId, estado: "activo", rol: "agente", email: null },
  { id: RESPONSABLE_B, tenantId: B.tenantId, estado: "activo", rol: "agente", email: null },
  { id: ADMIN_B, tenantId: B.tenantId, estado: "activo", rol: "admin", email: null },
];

// Políticas de PRUEBA (las reales las decide el negocio: D4, D5, D6).
const SIN_RESERVA: AcceptancePolicy = { reservation: { kind: "none" }, expiration: { kind: "none" }, document: { kind: "not_collected" } };
const CON_DOCUMENTO: AcceptancePolicy = { ...SIN_RESERVA, document: { kind: "required_for_office", allowedTypes: ["no_especificado"], retention: { kind: "no_automatic_deletion" } } };
const DOMICILIO: CheckoutData = { customerName: "Laura Gómez", paymentMethod: "contra_entrega", delivery: "domicilio", address: "Calle 10 # 20-30", city: "Bogotá", deliveryReference: null, contactPhone: "573001234567", department: "Cundinamarca", neighborhood: "Chapinero" };
const OFICINA: CheckoutData = { customerName: "Laura Gómez", paymentMethod: "contra_entrega", delivery: "oficina_transportadora", address: null, city: "Medellín", deliveryReference: null, contactPhone: "573001234567", department: "Antioquia", neighborhood: null, carrierOffice: "Oficina Centro" };

const TEXTO_TRAS_AVISO = "Respuesta de prueba tras el aviso 😊";
const configA = (over: Partial<ConfigAceptacion> = {}): ConfigAceptacion => ({
  responsable: { miembro_id: RESPONSABLE_A, respaldo_miembro_id: null, canales: ["panel"] },
  aceptan: "solo_responsable",
  reservaTrasAceptar: { kind: "platform" },
  textoTrasAviso: TEXTO_TRAS_AVISO,
  siYaRespondioPersona: "no_responder",
  notaEnvio: "Envío GRATIS",
  ...over,
});
const configB = (): ConfigAceptacion => configA({ responsable: { miembro_id: RESPONSABLE_B, respaldo_miembro_id: null, canales: ["panel"] }, notaEnvio: null });

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let pedidos: ReturnType<typeof createMemoryOrdersRepository>;
let sink: ReturnType<typeof memoryOrderEventSink>;
let engine: OrderEngine;
let asign: ReturnType<typeof createMemoryAsignacionesStore>;
let pausas: Array<{ waId: string; until: string | undefined }>;
let avisosPanel: AvisoResponsable[];
let rutas: number;
let llamadas: { confirmOrder: number; acceptOrder: number };
let logsRuteo: Array<Record<string, unknown>>;
/** Línea de tiempo de lo que ocurre (para probar el ORDEN: aviso -> registro -> asignación -> aviso a la persona -> pausa). */
let linea: string[];
/** Lo que ya estaba registrado EN EL MOMENTO de asignar y de pausar. */
let alAsignar: { avisoRegistrado: boolean } | null;
let configs: Map<string, ConfigAceptacion | null>;
let reloj: number;
let seq: number;

const lector = async (tenantId: string, phoneNumberId: string) => configs.get(`${tenantId}|${phoneNumberId}`) ?? null;

function construir(over: { miembros?: MiembroEquipo[] } = {}) {
  const miembros = createMemoryMiembrosStore(over.miembros ?? MIEMBROS);
  const router = createAcceptanceRouter({
    config: lector,
    miembros,
    asignaciones: {
      asignar: async (i) => {
        alAsignar = { avisoRegistrado: !!pedidos.orders.find((o) => o.orderId === i.pedido)?.acceptance?.noticeSentAt };
        linea.push("asignada");
        return asign.asignar(i);
      },
    },
    notificador: {
      canales: {
        panel: {
          enviar: async (a) => {
            avisosPanel.push(a);
            linea.push("aviso_a_persona");
            return canalPanel.enviar(a);
          },
        },
      },
    },
    handoff: {
      async pauseConversation({ contact, until }) {
        pausas.push({ waId: contact.waId, until });
        linea.push("pausa");
        return { ok: true };
      },
    },
    log: (e) => logsRuteo.push(e),
  });
  const route = router.route.bind(router);
  const motor = createOrderEngine({
    orders: pedidos,
    catalog: mem.repo,
    key: Buffer.alloc(32, 5),
    sink,
    log: () => {},
    now: () => new Date(reloj),
    documentCipher: { encrypt: cifrarSecreto },
    handoff: { pauseConversation: async () => ({ ok: true }) },
    acceptanceRouter: {
      check: (i) => router.check(i),
      route: async (i) => {
        rutas++;
        return route(i);
      },
    },
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
  sink = memoryOrderEventSink();
  asign = createMemoryAsignacionesStore({ [PN_A]: A.tenantId, [PN_B]: B.tenantId });
  pausas = [];
  avisosPanel = [];
  rutas = 0;
  llamadas = { confirmOrder: 0, acceptOrder: 0 };
  logsRuteo = [];
  linea = [];
  alAsignar = null;
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
async function pendiente(opts: { qty?: number; stock?: number; checkout?: CheckoutData; policy?: AcceptancePolicy; contact?: typeof ANA; document?: { type: string; number: string } | null; sinAviso?: boolean } = {}) {
  const p = await producto(A, "Licuadora", opts.stock ?? 5);
  const o = await enviar(await propuesta(opts.contact ?? ANA, [{ reference: p.reference, quantity: opts.qty ?? 1 }]), { checkout: opts.checkout, policy: opts.policy, contact: opts.contact, document: opts.document });
  const conAviso = opts.sinAviso ? o : await engine.recordAcceptanceNotice({ tenantId: A.tenantId, contact: opts.contact ?? ANA, orderId: o.orderId });
  return { producto: p, orden: conAviso };
}
const esError = (code: string) => (e: unknown) => e instanceof OrderError && e.code === code;

// --- Panel -------------------------------------------------------------------
const fuentes = (): PanelFuentes => ({
  nombres: async () => new Map(),
  canales: async () => new Map(),
  confirmados: async () => new Map(),
  asignadas: async () => new Map([...asign.filas].filter(([, m]) => m !== null).map(([k, m]) => [k, m === RESPONSABLE_A ? "Responsable A" : `Miembro ${m}`])),
  fotos: async () => new Map(),
  miembros: async (_t, ids) => new Map(ids.map((i) => [i, `Miembro ${i}`])),
});
const ctxA = (persona: { miembroId: number; esAdmin: boolean } = { miembroId: RESPONSABLE_A, esAdmin: false }, over: Partial<PorAceptarCtx> = {}): PorAceptarCtx => ({
  engine,
  tenantId: A.tenantId,
  persona,
  extras: { fuentes: fuentes(), verTelefono: true },
  config: (pn) => lector(A.tenantId, pn),
  ...over,
});
const ctxB = (persona: { miembroId: number; esAdmin: boolean } = { miembroId: RESPONSABLE_B, esAdmin: false }): PorAceptarCtx => ({
  engine,
  tenantId: B.tenantId,
  persona,
  extras: { fuentes: fuentes(), verTelefono: true },
  config: (pn) => lector(B.tenantId, pn),
});
type Resp = { success: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
const leer = async (r: Response): Promise<{ status: number; body: Resp }> => ({ status: r.status, body: (await r.json()) as Resp });
const lista = async (ctx: PorAceptarCtx) => ((await leer(await listarPorAceptar(ctx))).body.data?.pedidos ?? []) as PedidoPorAceptar[];
const decidir = async (ctx: PorAceptarCtx, pedido: string, accion: string, motivo?: string) => leer(await decidirPorAceptar(ctx, pedido, { accion, ...(motivo ? { motivo } : {}) }));

// ===========================================================================
// 1. Responsable: asignación, evento, aviso, pausa (backend determinista)
// ===========================================================================

describe("3B.5 · responsable: al pasar a pending_acceptance se asigna, se avisa y la IA calla", () => {
  it("1) asigna a la persona de la configuración; 5) UN evento de asignación; la IA queda en silencio; el pedido ya está guardado", async () => {
    const { orden } = await pendiente();
    assert.equal(orden.status, "pending_acceptance");
    assert.equal(rutas, 1);
    assert.equal(asign.filas.get(`${PN_A}|${ANA.waId}`), RESPONSABLE_A);
    assert.equal(asign.eventos.length, 1);
    assert.deepEqual(asign.eventos[0], {
      phoneNumberId: PN_A,
      waId: ANA.waId,
      tipo: "asignado",
      miembroId: RESPONSABLE_A,
      detalle: { motivo: "pedido_pendiente_de_aceptacion", pedido: orden.orderId, automatico: true, miembro_id_destino: RESPONSABLE_A },
    });
    assert.deepEqual(pausas, [{ waId: ANA.waId, until: "released" }], "pausa de la IA (hasta que una persona la libere)");
    // Evento del pedido: pasó a pending_acceptance por el agente (el aviso se registra aparte).
    const hist = pedidos.history.filter((h) => h.orderId === orden.id).map((h) => [h.entry.type, h.entry.to, h.entry.actor]);
    assert.ok(hist.some(([t, to, actor]) => t === "order.status_changed" && to === "pending_acceptance" && actor === "agent"));
    assert.ok(hist.some(([t]) => t === "order.acceptance_notice_sent"));
  });

  it("2) la responsable pertenece al MISMO negocio (y está activa): el enrutador solo lee miembros de ese negocio", async () => {
    const { orden } = await pendiente();
    const m = MIEMBROS.find((x) => x.id === asign.filas.get(`${PN_A}|${orden.contact!.waId}`));
    assert.equal(m?.tenantId, A.tenantId);
    assert.equal(m?.estado, "activo");
  });

  it("3) responsable INACTIVA => fail-closed: el pedido NO se envía a aceptación, no se asigna, no se pausa, no se escribe nada", async () => {
    configs.set(`${A.tenantId}|${PN_A}`, configA({ responsable: { miembro_id: INACTIVA_A, respaldo_miembro_id: null, canales: ["panel"] } }));
    const p = await producto(A, "Licuadora", 5);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    await assert.rejects(enviar(prop), esError("UNAVAILABLE"));
    assert.equal(pedidos.orders.find((o) => o.id === prop.id)?.status, "pending_confirmation", "sigue esperando confirmación");
    assert.equal(asign.filas.size, 0);
    assert.equal(asign.eventos.length, 0);
    assert.equal(pausas.length, 0);
    assert.equal(rutas, 0);
    assert.ok(logsRuteo.some((l) => l.resultado === "bloqueado" && l.motivo === "responsable_inactivo"));
  });

  it("4) una persona de OTRO negocio como responsable => fail-closed (nunca se asigna 'Patricia de B' a un pedido de A)", async () => {
    configs.set(`${A.tenantId}|${PN_A}`, configA({ responsable: { miembro_id: RESPONSABLE_B, respaldo_miembro_id: null, canales: ["panel"] } }));
    const p = await producto(A, "Licuadora", 5);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    await assert.rejects(enviar(prop), esError("UNAVAILABLE"));
    assert.equal(asign.filas.size, 0);
    assert.equal(pausas.length, 0);
    assert.ok(logsRuteo.some((l) => l.motivo === "responsable_de_otro_negocio"));
    // Y sin configuración (o inexistente): igual de cerrado.
    configs.set(`${A.tenantId}|${PN_A}`, configA({ responsable: { miembro_id: 999, respaldo_miembro_id: null, canales: ["panel"] } }));
    await assert.rejects(enviar(prop), esError("UNAVAILABLE"));
    configs.delete(`${A.tenantId}|${PN_A}`);
    await assert.rejects(enviar(prop), esError("UNAVAILABLE"));
    assert.equal(asign.filas.size, 0);
  });

  it("la asignación no puede cruzar negocios: un número de B no se asigna con la persona de A", async () => {
    await assert.rejects(asign.asignar({ tenantId: A.tenantId, phoneNumberId: PN_B, waId: BETO.waId, miembroId: RESPONSABLE_A, pedido: "DL-ORD-AAAAAA" }), /no es de este negocio/);
    assert.equal(asign.filas.size, 0);
  });

  it("no le quita la conversación a otra persona que ya la atiende (un humano manda), y no repite el evento", async () => {
    asign.filas.set(`${PN_A}|${ANA.waId}`, AGENTE_A);
    await pendiente();
    assert.equal(asign.filas.get(`${PN_A}|${ANA.waId}`), AGENTE_A, "sigue de la otra persona");
    assert.equal(asign.eventos.length, 0);
    assert.deepEqual(pausas, [{ waId: ANA.waId, until: "released" }], "la IA calla igual");
  });

  it("10) idempotencia: reintentar el envío (webhook duplicado), el registro del aviso o la asignación no crea dos asignaciones, dos eventos ni dos avisos del mismo acto", async () => {
    const p = await producto(A, "Licuadora", 5);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    const primero = await enviar(prop);
    const segundo = await enviar(prop); // reintento del envío: devuelve el mismo pedido
    assert.equal(segundo.status, "pending_acceptance");
    assert.equal(segundo.orderId, primero.orderId);
    assert.equal(rutas, 0, "asignar NO ocurre al guardar el pedido: espera a que el aviso salga y quede registrado");
    const a = await engine.recordAcceptanceNotice({ tenantId: A.tenantId, contact: ANA, orderId: primero.orderId });
    const b = await engine.recordAcceptanceNotice({ tenantId: A.tenantId, contact: ANA, orderId: primero.orderId }); // reintento: el aviso ya estaba registrado
    assert.equal(a.acceptance?.noticeSentAt, b.acceptance?.noticeSentAt, "el aviso se registra UNA vez");
    assert.equal(rutas, 2, "el enrutador se vuelve a invocar (repara)…");
    assert.equal(asign.filas.size, 1);
    assert.equal(asign.eventos.length, 1, "…pero UN solo evento de asignación");
    assert.equal(avisosPanel.length, 2, "el canal recibe la MISMA clave determinista (un canal con almacenamiento no repite)");
    assert.equal(avisosPanel[0].clave, avisosPanel[1].clave);
    assert.equal(pedidos.orders.filter((o) => o.status === "pending_acceptance").length, 1);
    assert.equal(pedidos.history.filter((h) => h.orderId === primero.id && h.entry.type === "order.status_changed" && h.entry.to === "pending_acceptance").length, 1, "UN solo evento de pedido");
    assert.equal(pedidos.history.filter((h) => h.orderId === primero.id && h.entry.type === "order.acceptance_notice_sent").length, 1, "UN solo evento de aviso");
  });

  it("la responsable se desactivó ENTRE guardar el pedido y registrar el aviso: el pedido no se pierde, NO se asigna a una persona inactiva y la IA calla igual", async () => {
    const p = await producto(A, "Licuadora", 5);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    const o = await enviar(prop);
    configs.set(`${A.tenantId}|${PN_A}`, configA({ responsable: { miembro_id: INACTIVA_A, respaldo_miembro_id: null, canales: ["panel"] } }));
    const conAviso = await engine.recordAcceptanceNotice({ tenantId: A.tenantId, contact: ANA, orderId: o.orderId });
    assert.equal(conAviso.status, "pending_acceptance");
    assert.equal(asign.filas.size, 0, "no se asigna a una persona inactiva");
    assert.deepEqual(pausas, [{ waId: ANA.waId, until: "released" }], "la IA calla igual: el silencio no depende de poder asignar");
    assert.equal(pedidos.orders.filter((x) => x.status === "pending_acceptance").length, 1, "un solo pedido");
    assert.equal((await lista(ctxA({ miembroId: INACTIVA_A, esAdmin: false }))).length, 1, "sigue visible en 'Por aceptar'");
    assert.ok(logsRuteo.some((l) => l.resultado === "con_fallos" && JSON.stringify(l.fallos).includes("responsable_inactivo")));
  });

  it("un fallo del enrutador DESPUÉS de guardar no deshace el pedido: queda visible en 'Por aceptar' y el reintento lo repara", async () => {
    let fallar = true;
    const motorFragil = createOrderEngine({
      orders: pedidos,
      catalog: mem.repo,
      key: Buffer.alloc(32, 5),
      sink,
      log: () => {},
      now: () => new Date(reloj),
      acceptanceRouter: {
        check: async () => ({ ok: true }),
        route: async () => {
          if (fallar) throw new Error("se cayó la asignación");
          rutas++;
        },
      },
    });
    const p = await producto(A, "Licuadora", 5);
    const { order } = await motorFragil.createOrder({ tenantId: A.tenantId, channel: "retail", source: "agent", contact: ANA, items: [{ reference: p.reference, quantity: 1 }], idempotencyKey: "agent:fragil" });
    const args = { tenantId: A.tenantId, contact: ANA, orderId: order.orderId, confirmationId: order.confirmation!.id, checkout: DOMICILIO, policy: SIN_RESERVA };
    const o = await motorFragil.submitForAcceptance(args);
    assert.equal(o.status, "pending_acceptance", "el pedido ya estaba guardado");
    const registrado = await motorFragil.recordAcceptanceNotice({ tenantId: A.tenantId, contact: ANA, orderId: o.orderId });
    assert.ok(registrado.acceptance?.noticeSentAt, "el aviso quedó registrado aunque la asignación se cayó");
    assert.equal((await motorFragil.listPendingAcceptance(A.tenantId)).length, 1);
    fallar = false;
    await motorFragil.recordAcceptanceNotice({ tenantId: A.tenantId, contact: ANA, orderId: o.orderId });
    assert.equal(rutas, 1, "el reintento sí asignó");
  });
});

// ===========================================================================
// 2. Notificación a la persona responsable (abstracción por canal)
// ===========================================================================

describe("3B.5 · notificarResponsablePedido: abstracción por canal, sin inventar credenciales", () => {
  const responsable = MIEMBROS[0];
  const orden = { id: "00000000-0000-4000-8000-000000000001", orderId: "DL-ORD-ABCDEF" };

  it("6) el panel queda entregado; correo y WhatsApp sin adaptador => 'no_configurado' (nunca se inventa un destino); no repite", async () => {
    const r = await notificarResponsablePedido({ canales: { panel: canalPanel } }, { tenantId: A.tenantId, order: orden, responsable, canales: ["panel", "correo", "whatsapp", "panel"] });
    assert.deepEqual(r, [
      { canal: "panel", estado: "entregada" },
      { canal: "correo", estado: "no_configurado" },
      { canal: "whatsapp", estado: "no_configurado" },
    ]);
  });

  it("6) un canal con almacenamiento recibe una clave DETERMINISTA por pedido + canal (reintentar no avisa dos veces) y un canal que falla no impide los demás", async () => {
    const vistas = new Set<string>();
    let enviados = 0;
    const correo: CanalNotificador = {
      enviar: async (a) => {
        if (vistas.has(a.clave)) return { estado: "entregada" }; // idempotente por clave
        vistas.add(a.clave);
        enviados++;
        return { estado: "entregada" };
      },
    };
    const roto: CanalNotificador = {
      enviar: async () => {
        throw new Error("sin red");
      },
    };
    const deps = { canales: { correo, whatsapp: roto, panel: canalPanel } };
    const a = await notificarResponsablePedido(deps, { tenantId: A.tenantId, order: orden, responsable, canales: ["correo", "whatsapp", "panel"] });
    const b = await notificarResponsablePedido(deps, { tenantId: A.tenantId, order: orden, responsable, canales: ["correo", "whatsapp", "panel"] });
    assert.deepEqual(a, b);
    assert.deepEqual(a.map((x) => x.estado), ["entregada", "error", "entregada"]);
    assert.equal(enviados, 1, "el correo se envió una sola vez por la clave");
    assert.equal(vistas.size, 1);
  });

  it("6) por el enrutador: el aviso del panel sale una vez por acto con clave determinista; con correo/whatsapp pedidos pero sin adaptador, el pedido igual queda asignado", async () => {
    configs.set(`${A.tenantId}|${PN_A}`, configA({ responsable: { miembro_id: RESPONSABLE_A, respaldo_miembro_id: null, canales: ["panel", "correo", "whatsapp"] } }));
    const { orden: o } = await pendiente();
    assert.equal(avisosPanel.length, 1);
    assert.equal(avisosPanel[0].pedido, o.orderId);
    assert.equal(avisosPanel[0].responsable.id, RESPONSABLE_A);
    assert.match(avisosPanel[0].clave, /^evt_[0-9a-z]{26}$/);
    const ruteo = logsRuteo.find((l) => l.resultado === "ok");
    assert.deepEqual(ruteo?.avisos, [
      { canal: "panel", estado: "entregada" },
      { canal: "correo", estado: "no_configurado" },
      { canal: "whatsapp", estado: "no_configurado" },
    ]);
    assert.equal(asign.filas.get(`${PN_A}|${ANA.waId}`), RESPONSABLE_A);
    // El registro del enrutador no lleva datos personales (ni teléfono, ni documento, ni nombre del cliente).
    const s = JSON.stringify(logsRuteo);
    assert.ok(!s.includes(ANA.waId) && !s.includes("Laura") && !s.includes(DOC));
  });
});

// ===========================================================================
// 3. Panel "Por aceptar"
// ===========================================================================

describe("3B.5 · panel 'Por aceptar'", () => {
  it("7) el pedido aparece como PENDIENTE con todo lo que la persona necesita (domicilio)", async () => {
    const { orden } = await pendiente({ qty: 2 });
    const [v] = await lista(ctxA());
    assert.equal(v.pedido, orden.orderId);
    assert.equal(v.estado, "por_aceptar");
    assert.deepEqual(v.lineas.map((l) => [l.nombre, l.cantidad, l.precio_unitario]), [["Licuadora", 2, 50_000]]);
    assert.equal(v.total, 100_000);
    assert.equal(v.envio, "Envío GRATIS");
    assert.equal(v.pago, "contra_entrega");
    assert.deepEqual(v.cliente, { nombre: "Laura Gómez", telefono: "573001234567", telefono_parcial: "4567", ciudad: "Bogotá", departamento: "Cundinamarca", direccion: "Calle 10 # 20-30", barrio: "Chapinero", referencia_entrega: null, oficina: null });
    assert.equal(v.documento, null);
    assert.ok(v.aviso_enviado, "aviso enviado");
    assert.equal(v.respuesta_cliente, null);
    assert.equal(v.asignada, "Responsable A");
    assert.ok(v.creado);
    assert.equal(v.puede_decidir, true);
    assert.deepEqual(v.acciones, ["aceptar", "rechazar", "cancelar"]);
  });

  it("7) con oficina: oficina de la transportadora y documento SOLO enmascarado (nunca el número)", async () => {
    await pendiente({ checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "no_especificado", number: DOC } });
    const respuesta = await leer(await listarPorAceptar(ctxA()));
    const [v] = respuesta.body.data!.pedidos as PedidoPorAceptar[];
    assert.equal(v.cliente.oficina, "Oficina Centro");
    assert.deepEqual(v.documento, { tipo: "no_especificado", enmascarado: "•••• 5678" });
    assert.ok(!JSON.stringify(respuesta.body).includes("1020345678") && !JSON.stringify(respuesta.body).includes(DOC) && !JSON.stringify(respuesta.body).includes("345.678"));
    const detalle = await leer(await detallePorAceptar(ctxA(), v.pedido));
    assert.equal(detalle.status, 200);
    assert.ok(!JSON.stringify(detalle.body).includes("1020345678") && !JSON.stringify(detalle.body).includes("345.678"));
    assert.ok((detalle.body.data!.historial as Array<{ tipo: string }>).some((h) => h.tipo === "order.status_changed"));
  });

  it("solo lista los de ESTE negocio y solo los pendientes; la persona sin permiso lo ve pero sin acciones", async () => {
    await pendiente();
    const pb = await producto(B, "Anillo", 3);
    const ob = await engine.createOrder({ tenantId: B.tenantId, channel: "retail", source: "agent", contact: BETO, items: [{ reference: pb.reference, quantity: 1 }], idempotencyKey: "agent:b1" });
    await engine.submitForAcceptance({ tenantId: B.tenantId, contact: BETO, orderId: ob.order.orderId, confirmationId: ob.order.confirmation!.id, checkout: DOMICILIO, policy: SIN_RESERVA });
    assert.equal((await lista(ctxA())).length, 1);
    assert.equal((await lista(ctxB())).length, 1);
    assert.equal((await lista(ctxA())).some((v) => v.pedido === ob.order.orderId), false, "A no ve el pedido de B");
    const sinPermiso = await lista(ctxA({ miembroId: AGENTE_A, esAdmin: false }));
    assert.equal(sinPermiso[0].puede_decidir, false);
    assert.deepEqual(sinPermiso[0].acciones, []);
  });
});

// ===========================================================================
// 4. Aceptar / rechazar / cancelar
// ===========================================================================

describe("3B.5 · aceptar el pedido (acceptOrder, nunca confirmOrder)", () => {
  it("8)11)12)13) la responsable acepta: pending_acceptance -> confirmed con acceptOrder; confirmOrder NO se ejecuta; nace la venta", async () => {
    const { orden, producto: p } = await pendiente({ qty: 2 });
    assert.equal(orden.confirmedAt, null, "antes de aceptar no hay venta");
    const r = await decidir(ctxA(), orden.orderId, "aceptar");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual({ estado: r.body.data?.estado, repetido: r.body.data?.repetido }, { estado: "confirmed", repetido: false });
    assert.equal(llamadas.acceptOrder, 1, "acceptOrder ejecutado");
    assert.equal(llamadas.confirmOrder, 0, "confirmOrder NO ejecutado");
    const o = pedidos.orders.find((x) => x.id === orden.id)!;
    assert.equal(o.status, "confirmed");
    assert.ok(o.confirmedAt, "confirmed_at");
    assert.equal(o.checkout?.stage, "confirmado", "etapa");
    assert.equal(o.checkout?.paymentStatus, "pendiente", "estado de pago");
    assert.equal(await engine.hasPurchase({ tenantId: A.tenantId, contact: ANA }), true, "ahora sí cuenta como venta");
    assert.equal(mem.inventory.stockOf(p.id), 3, "reserva de stock (política de la plataforma)");
    const hist = pedidos.history.filter((h) => h.orderId === o.id);
    const aceptado = hist.find((h) => h.entry.to === "confirmed");
    assert.equal(aceptado?.entry.actor, "human");
    assert.equal(aceptado?.entry.memberId, RESPONSABLE_A, "queda quién lo aceptó");
    assert.ok(sink.events.some((e) => e.transition?.to === "confirmed"), "evento de venta confirmada solo AHORA");
    assert.equal((await lista(ctxA())).length, 0, "ya no está por aceptar");
  });

  it("14) la reserva de stock sale ÚNICAMENTE de la política: sin reserva mientras espera; al aceptar, plataforma o plazo propio", async () => {
    const { orden, producto: p } = await pendiente({ qty: 2 });
    assert.equal(pedidos.reservations.length, 0, "mientras espera no hay reserva (política de prueba: sin reserva)");
    assert.equal(mem.inventory.stockOf(p.id), 5);
    configs.set(`${A.tenantId}|${PN_A}`, configA({ reservaTrasAceptar: { kind: "ttl", minutes: 45 } }));
    await decidir(ctxA(), orden.orderId, "aceptar");
    const reserva = pedidos.reservations.filter((r) => r.orderId === orden.id && r.status === "activa");
    assert.equal(reserva.length, 1, "UNA reserva");
    assert.equal(Date.parse(reserva[0].expiresAt) - reloj, 45 * MIN, "con el plazo propio del negocio");
    assert.equal(mem.inventory.stockOf(p.id), 3);
  });

  it("15) falta de stock al aceptar => NO se confirma en silencio ni hay venta parcial: sigue pendiente y visible para la persona", async () => {
    const { orden, producto: p } = await pendiente({ qty: 3, stock: 5, policy: SIN_RESERVA });
    mem.inventory.setStock(p.id, 1); // mientras esperaba, el inventario bajó
    const r = await decidir(ctxA(), orden.orderId, "aceptar");
    assert.equal(r.status, 409);
    assert.equal(r.body.success, false);
    assert.ok(["OUT_OF_STOCK", "ORDER_HAS_ISSUES", "PRODUCT_UNAVAILABLE"].includes(r.body.error?.code ?? ""), JSON.stringify(r.body));
    const o = pedidos.orders.find((x) => x.id === orden.id)!;
    assert.equal(o.status, "pending_acceptance");
    assert.equal(o.confirmedAt, null);
    assert.equal(o.checkout, null, "sin etapa ni pago");
    assert.equal(pedidos.reservations.filter((x) => x.orderId === orden.id).length, 0, "sin reserva parcial");
    assert.equal(mem.inventory.stockOf(p.id), 1, "el stock no se tocó");
    assert.equal((await lista(ctxA())).length, 1, "sigue visible para la persona");
    assert.equal(await engine.hasPurchase({ tenantId: A.tenantId, contact: ANA }), false);
  });

  it("17) doble aceptación (doble clic): la segunda no confirma ni reserva otra vez; devuelve 'repetido'", async () => {
    const { orden, producto: p } = await pendiente({ qty: 2 });
    const a = await decidir(ctxA(), orden.orderId, "aceptar");
    const b = await decidir(ctxA(), orden.orderId, "aceptar");
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(b.body.data?.repetido, true);
    assert.equal(pedidos.reservations.filter((r) => r.orderId === orden.id && r.status === "activa").length, 1, "UNA sola reserva");
    assert.equal(mem.inventory.stockOf(p.id), 3);
    assert.equal(pedidos.history.filter((h) => h.orderId === orden.id && h.entry.to === "confirmed").length, 1, "UN solo evento de confirmación");
    assert.equal(sink.events.filter((e) => e.transition?.to === "confirmed").length, 1);
    // Simultáneas: tampoco se duplica.
    const { orden: o2 } = await pendiente({ contact: { phoneNumberId: PN_A, waId: "573001110003" }, stock: 5 });
    const [x, y] = await Promise.all([decidir(ctxA(), o2.orderId, "aceptar"), decidir(ctxA(), o2.orderId, "aceptar")]);
    assert.ok([x.status, y.status].every((s) => s === 200 || s === 409));
    assert.equal(pedidos.history.filter((h) => h.orderId === o2.id && h.entry.to === "confirmed").length, 1);
  });

  it("9) una persona SIN permiso no acepta (ni rechaza); con 'responsable_y_admins', un admin sí; el respaldo también", async () => {
    const { orden } = await pendiente();
    const agente = await decidir(ctxA({ miembroId: AGENTE_A, esAdmin: false }), orden.orderId, "aceptar");
    assert.equal(agente.status, 403);
    assert.equal(agente.body.error?.code, "FORBIDDEN");
    const admin1 = await decidir(ctxA({ miembroId: ADMIN_A, esAdmin: true }), orden.orderId, "aceptar");
    assert.equal(admin1.status, 403, "con 'solo_responsable' ni el admin");
    const rechazo = await decidir(ctxA({ miembroId: AGENTE_A, esAdmin: false }), orden.orderId, "rechazar", "motivo de prueba");
    assert.equal(rechazo.status, 403);
    assert.equal(pedidos.orders.find((o) => o.id === orden.id)?.status, "pending_acceptance");
    assert.equal(llamadas.acceptOrder, 0);
    configs.set(`${A.tenantId}|${PN_A}`, configA({ aceptan: "responsable_y_admins", responsable: { miembro_id: RESPONSABLE_A, respaldo_miembro_id: AGENTE_A, canales: ["panel"] } }));
    assert.equal(puedeDecidir(configA({ aceptan: "responsable_y_admins" }), { miembroId: ADMIN_A, esAdmin: true }), true);
    assert.equal(puedeDecidir(configA(), { miembroId: ADMIN_A, esAdmin: true }), false);
    const porAdmin = await decidir(ctxA({ miembroId: ADMIN_A, esAdmin: true }), orden.orderId, "aceptar");
    assert.equal(porAdmin.status, 200);
    assert.equal(pedidos.orders.find((o) => o.id === orden.id)?.status, "confirmed");
    const { orden: o2 } = await pendiente({ contact: { phoneNumberId: PN_A, waId: "573001110004" } });
    assert.equal((await decidir(ctxA({ miembroId: AGENTE_A, esAdmin: false }), o2.orderId, "aceptar")).status, 200, "el respaldo configurado también");
  });

  it("sin configuración válida del negocio no se decide nada (fail-closed)", async () => {
    const { orden } = await pendiente();
    configs.delete(`${A.tenantId}|${PN_A}`);
    const r = await decidir(ctxA(), orden.orderId, "aceptar");
    assert.equal(r.status, 503);
    assert.equal(pedidos.orders.find((o) => o.id === orden.id)?.status, "pending_acceptance");
  });

  it("validaciones: acción inválida, número de pedido inválido, y rechazar/cancelar exigen motivo", async () => {
    const { orden } = await pendiente();
    assert.equal((await decidir(ctxA(), orden.orderId, "confirmar")).status, 400);
    assert.equal((await decidir(ctxA(), "no-es-un-pedido", "aceptar")).status, 404);
    assert.equal((await decidir(ctxA(), orden.orderId, "rechazar")).status, 400);
    assert.equal((await decidir(ctxA(), orden.orderId, "cancelar", "ab")).status, 400);
    assert.equal(pedidos.orders.find((o) => o.id === orden.id)?.status, "pending_acceptance");
  });
});

describe("3B.5 · rechazar / cancelar (sin venta ni reserva)", () => {
  it("16) rechazar: solo desde pending_acceptance, registra QUIÉN y por qué, sin venta, sin reserva, sin confirmOrder", async () => {
    const { orden, producto: p } = await pendiente({ qty: 2 });
    const r = await decidir(ctxA(), orden.orderId, "rechazar", "Producto no disponible en esa ciudad");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data?.estado, "rejected");
    const o = pedidos.orders.find((x) => x.id === orden.id)!;
    assert.equal(o.status, "rejected");
    assert.equal(o.confirmedAt, null);
    assert.equal(o.checkout, null);
    assert.equal(pedidos.reservations.filter((x) => x.orderId === orden.id && x.status === "activa").length, 0);
    assert.equal(mem.inventory.stockOf(p.id), 5);
    assert.equal(llamadas.confirmOrder, 0);
    assert.equal(llamadas.acceptOrder, 0);
    assert.equal(await engine.hasPurchase({ tenantId: A.tenantId, contact: ANA }), false);
    const h = pedidos.history.find((x) => x.orderId === o.id && x.entry.to === "rejected");
    assert.equal(h?.entry.memberId, RESPONSABLE_A, "queda quién lo hizo");
    assert.equal(h?.entry.actor, "human");
    assert.equal(h?.entry.reason, "Producto no disponible en esa ciudad");
    assert.ok(!sink.events.some((e) => e.transition?.to === "confirmed"), "ningún evento de venta");
    assert.equal((await lista(ctxA())).length, 0);
  });

  it("cancelar: igual (cancelled), sin venta; y rechazar un pedido ya aceptado NO se puede (conflicto)", async () => {
    const { orden } = await pendiente();
    const c = await decidir(ctxA(), orden.orderId, "cancelar", "El cliente ya no lo quiere");
    assert.equal(c.body.data?.estado, "cancelled");
    assert.equal(pedidos.orders.find((x) => x.id === orden.id)?.confirmedAt, null);
    const { orden: o2 } = await pendiente({ contact: { phoneNumberId: PN_A, waId: "573001110005" } });
    await decidir(ctxA(), o2.orderId, "aceptar");
    const tarde = await decidir(ctxA(), o2.orderId, "rechazar", "ya lo había aceptado");
    assert.equal(tarde.status, 409, "un pedido ya aceptado no se rechaza desde 'Por aceptar'");
    assert.equal(pedidos.orders.find((x) => x.id === o2.id)?.status, "confirmed");
  });

  it("18) doble rechazo: el segundo no cambia nada ni duplica el evento", async () => {
    const { orden } = await pendiente();
    const a = await decidir(ctxA(), orden.orderId, "rechazar", "motivo de prueba");
    const b = await decidir(ctxA(), orden.orderId, "rechazar", "motivo de prueba");
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(b.body.data?.repetido, true);
    assert.equal(pedidos.history.filter((h) => h.orderId === orden.id && h.entry.to === "rejected").length, 1);
    // Después de rechazado no se puede aceptar.
    const tarde = await decidir(ctxA(), orden.orderId, "aceptar");
    assert.equal(tarde.status, 409);
    assert.equal(llamadas.acceptOrder, 0, "sobre un pedido que ya no está pendiente ni siquiera se llama a acceptOrder");
    assert.equal(pedidos.orders.find((x) => x.id === orden.id)?.status, "rejected");
  });

  it("el cliente no puede cambiar el pedido a confirmed: ni el 'sí' ni ninguna ruta del agente (solo acceptOrder humano)", async () => {
    const { orden } = await pendiente();
    await assert.rejects(
      engine.confirmOrder({ tenantId: A.tenantId, contact: ANA, orderId: orden.orderId, confirmationId: orden.confirmation?.id ?? "cualquiera", actor: "agent", checkout: { customerName: "Laura Gómez", paymentMethod: "contra_entrega", delivery: "domicilio", address: "Calle 1", city: "Bogotá", deliveryReference: null } }),
      (e: unknown) => e instanceof OrderError,
    );
    assert.equal(pedidos.orders.find((x) => x.id === orden.id)?.status, "pending_acceptance");
  });
});

// ===========================================================================
// 5. El "sí" del cliente después del aviso
// ===========================================================================

describe("3B.5 · el cliente responde 'sí' después del aviso: información, nunca una confirmación", () => {
  it("esConfirmacionTrasAviso: confirmaciones claras sí; preguntas, negaciones, cambios, textos largos y emojis solos no", () => {
    for (const t of ["Sí", "si", "Sí.", "Confirmo", "Estoy seguro", "estoy 100% seguro", "Sí, estoy 100% seguro de recibirlo", "Claro que sí", "ok", "Listo, confirmo", "sí confirmo 😊"]) assert.equal(esConfirmacionTrasAviso(t), true, t);
    for (const t of ["no", "No estoy seguro", "sí pero cuándo llega", "¿sí llega mañana?", "sí, cambia la dirección", "quiero cancelar", "👍", "", "sí quiero saber el costo del envío", "tal vez", "sí tengo una duda"]) assert.equal(esConfirmacionTrasAviso(t), false, t);
    assert.equal(esConfirmacionTrasAviso("sí ".repeat(40)), false);
  });

  /** Dependencias de la puerta con lo del negocio A y los espías. */
  function puerta(over: Partial<RespuestaAvisoDeps> & { personaEscribio?: boolean } = {}) {
    const enviados: string[] = [];
    const deps: RespuestaAvisoDeps = {
      config: lector,
      engine,
      humanWroteSince: async () => over.personaEscribio ?? false,
      sendText: async (t) => {
        enviados.push(t);
        return { sent: true };
      },
      log: () => {},
      ...over,
    };
    return { deps, enviados };
  }
  const si = (deps: RespuestaAvisoDeps, text = "Sí", contact = ANA, tenantId = A.tenantId) => atenderRespuestaTrasAviso({ tenantId, phoneNumberId: contact.phoneNumberId, waId: contact.waId, text }, deps);

  it("19)20)21)22) 'sí' => se registra respuesta_cliente_at y sale UNA respuesta fija; el pedido NO cambia: sin estado nuevo, sin reserva, sin venta, sin acceptOrder/confirmOrder", async () => {
    const { orden, producto: p } = await pendiente({ qty: 2 });
    const { deps, enviados } = puerta();
    const r = await si(deps);
    assert.deepEqual(r, { handled: true, accion: "respondida" });
    assert.deepEqual(enviados, [TEXTO_TRAS_AVISO]);
    const o = pedidos.orders.find((x) => x.id === orden.id)!;
    assert.ok(o.acceptance?.customerReplyAt, "respuesta_cliente_at");
    assert.equal(o.status, "pending_acceptance", "20) el estado NO cambia");
    assert.equal(pedidos.reservations.length, 0, "21) sin reserva");
    assert.equal(mem.inventory.stockOf(p.id), 5);
    assert.equal(o.confirmedAt, null, "22) sin venta");
    assert.equal(o.checkout, null);
    assert.equal(await engine.hasPurchase({ tenantId: A.tenantId, contact: ANA }), false);
    assert.equal(llamadas.acceptOrder, 0);
    assert.equal(llamadas.confirmOrder, 0);
    assert.ok(!sink.events.some((e) => e.transition?.to === "confirmed"));
    const hist = pedidos.history.filter((h) => h.orderId === o.id).map((h) => h.entry.type);
    assert.equal(hist.filter((t) => t === "order.customer_replied").length, 1);
    assert.equal((await lista(ctxA()))[0].respuesta_cliente, o.acceptance?.customerReplyAt, "la persona lo ve (informativo)");
  });

  it("24)10) la respuesta automática sale UNA sola vez: segundo 'sí', mensaje duplicado y dos 'sí' simultáneos", async () => {
    await pendiente();
    const { deps, enviados } = puerta();
    const [a, b] = await Promise.all([si(deps, "Sí"), si(deps, "Confirmo")]);
    const acciones = [a, b].map((x) => (x.handled ? x.accion : "no"));
    assert.deepEqual(acciones.sort(), ["respondida", "ya_registrada"]);
    assert.equal(enviados.length, 1);
    const c = await si(deps, "Sí");
    assert.deepEqual(c, { handled: true, accion: "ya_registrada" });
    assert.equal(enviados.length, 1, "nunca una segunda respuesta");
  });

  it("23)10) si una persona del equipo YA escribió, el 'sí' se registra pero el bot NO responde (la intervención humana manda)", async () => {
    const { orden } = await pendiente();
    const { deps, enviados } = puerta({ personaEscribio: true });
    const r = await si(deps);
    assert.deepEqual(r, { handled: true, accion: "registrada_sin_respuesta" });
    assert.equal(enviados.length, 0);
    assert.ok(pedidos.orders.find((x) => x.id === orden.id)?.acceptance?.customerReplyAt);
    // Y si no se puede comprobar si una persona escribió, tampoco se responde (fail-closed).
    const { orden: o2 } = await pendiente({ contact: { phoneNumberId: PN_A, waId: "573001110006" } });
    const roto = puerta({ humanWroteSince: async () => { throw new Error("sin datos"); } });
    assert.deepEqual(await si(roto.deps, "Sí", { phoneNumberId: PN_A, waId: "573001110006" }), { handled: true, accion: "registrada_sin_respuesta" });
    assert.equal(roto.enviados.length, 0);
    assert.ok(pedidos.orders.find((x) => x.id === o2.id)?.acceptance?.customerReplyAt);
  });

  it("D11: si el negocio eligió responder igual aunque una persona haya escrito, responde (una vez); la pausa nunca se acorta", async () => {
    await pendiente();
    configs.set(`${A.tenantId}|${PN_A}`, configA({ siYaRespondioPersona: "responder" }));
    const { deps, enviados } = puerta({ personaEscribio: true });
    assert.deepEqual(await si(deps), { handled: true, accion: "respondida" });
    assert.equal(enviados.length, 1);
    assert.equal(pausas.every((x) => x.until === "released"), true);
  });

  it("solo con pedido pendiente CON aviso de esa conversación: sin aviso, sin pedido, otro texto, sin configuración, o en otra conversación => no se toma el mensaje", async () => {
    const { deps, enviados } = puerta();
    assert.deepEqual(await si(deps), { handled: false, motivo: "sin_pedido_pendiente" });
    await pendiente({ sinAviso: true });
    assert.deepEqual(await si(deps), { handled: false, motivo: "sin_aviso" });
    await engine.recordAcceptanceNotice({ tenantId: A.tenantId, contact: ANA, orderId: pedidos.orders[0].orderId });
    assert.deepEqual(await si(deps, "¿cuándo llega?"), { handled: false, motivo: "no_es_confirmacion" });
    assert.deepEqual(await si(deps, "Sí", { phoneNumberId: PN_A, waId: "573009999999" }), { handled: false, motivo: "sin_pedido_pendiente" }, "otra conversación del mismo negocio");
    assert.deepEqual(await si(deps, "Sí", BETO), { handled: false, motivo: "sin_configuracion" }, "otro número: no es de este negocio");
    configs.delete(`${A.tenantId}|${PN_A}`);
    assert.deepEqual(await si(deps), { handled: false, motivo: "sin_configuracion" });
    assert.equal(enviados.length, 0);
    assert.equal(pedidos.orders[0].acceptance?.customerReplyAt, null);
  });

  it("negocio B: su 'sí' nunca toca el pedido de A (mismo texto, otro negocio) ni se responde con el texto de A", async () => {
    await pendiente();
    const { deps, enviados } = puerta();
    assert.deepEqual(await si(deps, "Sí", { phoneNumberId: PN_B, waId: ANA.waId }, B.tenantId), { handled: false, motivo: "sin_pedido_pendiente" });
    assert.deepEqual(await si(deps, "Sí", ANA, B.tenantId), { handled: false, motivo: "sin_configuracion" }, "B con el número de A: ni configuración");
    assert.equal(enviados.length, 0);
    assert.equal(pedidos.orders[0].acceptance?.customerReplyAt, null);
  });
});

// ===========================================================================
// 6. Aislamiento entre negocios
// ===========================================================================

describe("3B.5 · aislamiento: el negocio A nunca toca lo de B", () => {
  it("26) la persona de B no ve, no acepta, no rechaza, no cancela ni lee el documento de un pedido de A: 'no encontrado' sin revelar nada", async () => {
    const { orden } = await pendiente({ checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "no_especificado", number: DOC } });
    const ctx = ctxB();
    assert.equal((await lista(ctx)).length, 0);
    const det = await leer(await detallePorAceptar(ctx, orden.orderId));
    assert.equal(det.status, 404);
    for (const accion of ["aceptar", "rechazar", "cancelar"]) {
      const r = await decidir(ctx, orden.orderId, accion, "intento de otro negocio");
      assert.equal(r.status, 404, accion);
      assert.equal(r.body.error?.code, "NOT_FOUND");
    }
    assert.ok(!JSON.stringify(det.body).includes("Laura") && !JSON.stringify(det.body).includes("5678"), "la respuesta de B no revela nada del pedido de A");
    const o = pedidos.orders.find((x) => x.id === orden.id)!;
    assert.equal(o.status, "pending_acceptance");
    assert.equal(llamadas.acceptOrder, 0);
    assert.equal(await engine.acceptanceDocument(B.tenantId, o), null, "el documento de A no se lee desde B");
    assert.deepEqual(await engine.acceptanceDocument(A.tenantId, o), { type: "no_especificado", masked: "•••• 5678" });
  });

  it("26) ni siquiera la persona de A (misma id numérica que una de B no existe) actúa en B: el negocio sale SIEMPRE de la sesión, nunca de la petición", async () => {
    const pb = await producto(B, "Anillo", 3);
    const ob = await engine.createOrder({ tenantId: B.tenantId, channel: "retail", source: "agent", contact: BETO, items: [{ reference: pb.reference, quantity: 1 }], idempotencyKey: "agent:b2" });
    const enviadoB = await engine.submitForAcceptance({ tenantId: B.tenantId, contact: BETO, orderId: ob.order.orderId, confirmationId: ob.order.confirmation!.id, checkout: DOMICILIO, policy: SIN_RESERVA });
    await engine.recordAcceptanceNotice({ tenantId: B.tenantId, contact: BETO, orderId: enviadoB.orderId });
    assert.equal(asign.filas.get(`${PN_B}|${BETO.waId}`), RESPONSABLE_B, "B se asigna con SU persona");
    const r = await decidir(ctxA(), enviadoB.orderId, "aceptar");
    assert.equal(r.status, 404);
    assert.equal(pedidos.orders.find((x) => x.id === enviadoB.id)?.status, "pending_acceptance");
    // Y la persona de B sí puede con lo suyo.
    assert.equal((await decidir(ctxB(), enviadoB.orderId, "aceptar")).status, 200);
    assert.equal(pedidos.orders.filter((x) => x.businessId === A.tenantId).length, 0);
  });
});

// ===========================================================================
// 7. Delacour: el flujo de siempre no cambia
// ===========================================================================

describe("3B.5 · Delacour sigue exactamente igual (pending_confirmation -> confirmed con confirmOrder)", () => {
  it("27) un pedido del checkout de siempre: confirmOrder, venta confirmada, el enrutador NO se invoca y no existe nada por aceptar", async () => {
    configs.clear(); // Delacour: sin aceptación humana
    const p = await producto(B, "Anillo", 3);
    const prop = await engine.createOrder({ tenantId: B.tenantId, channel: "retail", source: "agent", contact: BETO, items: [{ reference: p.reference, quantity: 1 }], idempotencyKey: "agent:del" });
    assert.equal(prop.order.status, "pending_confirmation");
    const r = await engine.confirmOrder({
      tenantId: B.tenantId,
      contact: BETO,
      orderId: prop.order.orderId,
      confirmationId: prop.order.confirmation!.id,
      actor: "agent",
      checkout: { customerName: "Laura Gómez", paymentMethod: "transferencia", delivery: "domicilio", address: "Calle 10 # 20-30", city: "Montería", deliveryReference: null },
    });
    assert.equal(r.status, "confirmed");
    assert.equal(r.checkout?.stage, "confirmado");
    assert.equal(llamadas.confirmOrder, 1);
    assert.equal(llamadas.acceptOrder, 0);
    assert.equal(rutas, 0, "el enrutador de aceptación NUNCA se invoca para el flujo de siempre");
    assert.equal(asign.filas.size, 0, "ninguna asignación automática");
    assert.equal(pausas.length, 0);
    assert.equal((await engine.listPendingAcceptance(B.tenantId)).length, 0);
    assert.equal(await engine.pendingAcceptanceFor({ tenantId: B.tenantId, contact: BETO }), null);
    const { deps, enviados } = (() => {
      const e: string[] = [];
      return { enviados: e, deps: { config: lector, engine, humanWroteSince: async () => false, sendText: async (t: string) => (e.push(t), { sent: true }), log: () => {} } satisfies RespuestaAvisoDeps };
    })();
    assert.equal((await atenderRespuestaTrasAviso({ tenantId: B.tenantId, phoneNumberId: PN_B, waId: BETO.waId, text: "Sí" }, deps)).handled, false, "el 'sí' de un cliente de Delacour sigue su camino de siempre");
    assert.equal(enviados.length, 0);
    // Y 'aceptar' no sirve para un pedido que nunca estuvo por aceptar.
    configs.set(`${B.tenantId}|${PN_B}`, configB());
    const x = await decidir(ctxB(), prop.order.orderId, "aceptar");
    assert.equal(x.status, 409);
    assert.equal(pedidos.orders.find((o) => o.id === prop.order.id)?.status, "confirmed");
  });

  it("27) el perfil de Delacour (opciones de siempre) no tiene cierre con aceptación: leerConfigAceptacion => null", () => {
    const r = leerConfigAceptacion({ checkoutOptions: CHECKOUT_OPCIONES_LEGADO, business: {} as AgentRuntimeConfig["business"] });
    assert.equal(r, null);
    assert.equal(leerConfigAceptacion({ checkoutOptions: null, business: {} as AgentRuntimeConfig["business"] }), null);
  });
});

// ===========================================================================
// 8. De punta a punta: checkout conversacional -> asignación -> "sí" -> panel -> aceptar
// ===========================================================================

const OPCIONES_E2E = {
  entregas: ["domicilio", "oficina_transportadora"],
  pagos: [{ metodo: "contra_entrega" }],
  campos: { nombre_completo: true, telefono: { modo: "requerido", acepta_mismo_whatsapp: true }, departamento: true, barrio: true },
  oficina: {
    transportadora: "Transportadora de Prueba",
    oferta: "solo_si_cliente_pide",
    pide_direccion: false,
    pide_barrio: false,
    seleccion: { tipo: "texto_libre" },
    documento: { modo: "requerido", tipos: "sin_especificar", retencion: { tipo: "sin_borrado_automatico" }, si_se_niega: "handoff" },
  },
  cierre: {
    modo: "aceptacion_humana",
    validacion_resumen: "boton_datos_correctos",
    mostrar_numero_pedido: false,
    textos: { aviso: "AVISO DE PRUEBA: ¿Me confirmas que estás seguro de recibirlo?", tras_aviso_confirma: TEXTO_TRAS_AVISO },
    responsable: { miembro_id: RESPONSABLE_A, respaldo_miembro_id: null, canales: ["panel"] },
    aceptan: "solo_responsable",
    reserva: { tipo: "sin_reserva" },
    vencimiento: { tipo: "sin_vencimiento" },
    reserva_tras_aceptar: { tipo: "plataforma" },
    respuesta_tras_aviso: { si_ya_respondio_persona: "no_responder" },
    pregunta_sin_respuesta: "seguir_checkout",
  },
};
const TODAS = Object.fromEntries(FUNCIONES_FASE_3B.map((f) => [f, true])) as Record<FuncionFase3B, boolean>;

describe("3B.5 · de punta a punta por el runtime real", () => {
  let stateStore: ConversationStateStore;
  let history: HistoryRow[];
  let sent: string[];
  let providers: Array<ReturnType<typeof createSimulatedProvider>>;
  let configE2E: AgentRuntimeConfig;
  let wseq: number;
  let alEnviarAviso: { estado: string | null; avisoRegistrado: boolean; asignado: boolean; pausado: boolean } | null;

  const fila = (): AgentConfigRow => ({
    id_tenant: A.tenantId,
    phone_number_id: PN_A,
    tipo: "catalog_sales",
    habilitado: true,
    proveedor: "gemini",
    modelo: "gemini-3.6-flash",
    credencial_ref: "env:GEMINI_KEY_PRUEBA",
    nivel_razonamiento: "low",
    herramientas: [...AGENT_TOOL_NAMES],
    canal: "retail",
    negocio: { nombre_agente: "Asistente", nombre_negocio: "Tienda Ficticia", pedido: { nota_envio_domicilio: "Envío GRATIS" } },
    clasificacion_cliente: false,
    checkout_conversacional: true,
    vocabulario: null,
    checkout_opciones: OPCIONES_E2E,
    meta_token_plataforma: false,
  });

  beforeEach(() => {
    stateStore = createMemoryConversationStateStore();
    history = [];
    sent = [];
    providers = [];
    wseq = 0;
    alEnviarAviso = null;
    const r = parseAgentConfig(fila(), { tenantId: A.tenantId, phoneNumberId: PN_A }, { funciones3b: TODAS });
    assert.equal(r.kind, "ok", JSON.stringify(r));
    configE2E = (r as { config: AgentRuntimeConfig }).config;
    // La configuración del negocio sale de la MISMA fila que usa el agente.
    const aceptacion = leerConfigAceptacion(configE2E);
    assert.ok(aceptacion);
    configs.set(`${A.tenantId}|${PN_A}`, aceptacion);
  });

  const toolDeps = (): AgentToolsDeps => ({
    engine,
    catalog: mem.repo,
    ownsPhoneNumber: async (t, pn) => (t === A.tenantId && pn === PN_A) || (t === B.tenantId && pn === PN_B),
    customerName: async () => null,
    rememberCustomerName: async () => {},
    siteUrl: () => "https://dulabs.test",
    documentCipher: { encrypt: cifrarSecreto },
  });

  async function turno(script: SimulatedStep[], text: string, buttonId?: string) {
    const provider = createSimulatedProvider(script);
    providers.push(provider);
    const wamid = `wamid.in.${++wseq}`;
    history.push({ direccion: "entrante", contenido: text, origen: "entrante", wamid });
    return runAgentTurn(
      {
        config: configE2E,
        provider,
        model: "gemini-3.6-flash",
        tools: toolDeps(),
        state: stateStore,
        history: { recent: async () => history.map((h) => ({ ...h })) },
        classification: createMemoryCustomerChannelStore({ [PN_A]: A.tenantId }),
        sender: {
          async sendText(t) {
            sent.push(t);
            if (t.startsWith("AVISO DE PRUEBA")) {
              // Lo que ya existía cuando SALIÓ el aviso: el pedido guardado, y todavía sin asignar ni pausar.
              const o = pedidos.orders.find((x) => x.contact?.waId === ANA.waId);
              alEnviarAviso = { estado: o?.status ?? null, avisoRegistrado: !!o?.acceptance?.noticeSentAt, asignado: asign.filas.size > 0, pausado: pausas.length > 0 };
              linea.push("aviso_enviado");
            }
            return { sent: true, wamid: `wamid.out.${++wseq}` };
          },
          async sendImage() {
            return { sent: true, wamid: `wamid.img.${++wseq}` };
          },
          async sendButtons(body) {
            sent.push(body);
            return { sent: true, wamid: `wamid.btn.${++wseq}` };
          },
          async sendList(body) {
            sent.push(body);
            return { sent: true, wamid: `wamid.list.${++wseq}` };
          },
          // Como en producción: la conversación pausada por el traspaso cuenta como "una persona la tiene".
          // La pausa llega DURANTE el último turno del checkout: el aviso igual tiene que salir.
          humanTookOver: async () => pausas.some((x) => x.waId === ANA.waId),
        },
        log: () => {},
        now: () => reloj,
        retry: { sleep: async () => {}, random: () => 0 },
      },
      { tenantId: A.tenantId, phoneNumberId: PN_A, waId: ANA.waId, wamid, text, buttonId: buttonId ?? null },
    );
  }
  const call = (name: string, args: Record<string, unknown> = {}): SimulatedStep => ({ toolCalls: [{ name, args }] });

  it("1)25) checkout completo -> pending_acceptance asignado a la responsable correcta; el documento nunca va al modelo; el 'sí' no confirma; la responsable acepta", async () => {
    const p = await producto(A, "Ventilador", 5, 150_000);
    await turno([call("update_cart", { items: [{ reference: p.reference, quantity: 1 }] }), { text: "Listo, lo agregué." }], `quiero 1 ${p.reference}`);
    await turno([call("create_order_request"), { text: "TEXTO DEL MODELO QUE NO DEBE SALIR" }], "me lo llevo");
    await turno([], "Laura Gómez");
    await turno([], ACEPTACION_BUTTONS.phone[0].title, ACEPTACION_BUTTONS.phone[0].id);
    await turno([], "Medellín");
    await turno([], "Antioquia");
    await turno([], "mejor lo reclamo en la oficina de Transportadora de Prueba");
    await turno([], "Oficina Centro, calle 13");
    await turno([], DOC);
    await turno([], ACEPTACION_BUTTONS.summary[0].title, ACEPTACION_BUTTONS.summary[0].id);
    // Pendiente de aceptación, asignado a la responsable configurada, IA en silencio, aviso registrado.
    const o = pedidos.orders.find((x) => x.contact?.waId === ANA.waId)!;
    assert.equal(o.status, "pending_acceptance");
    assert.ok(o.acceptance?.noticeSentAt);
    assert.equal(asign.filas.get(`${PN_A}|${ANA.waId}`), RESPONSABLE_A);
    assert.equal(asign.eventos.length, 1);
    assert.ok(pausas.some((x) => x.until === "released"));
    assert.equal(llamadas.confirmOrder, 0);
    assert.equal(llamadas.acceptOrder, 0);
    assert.ok(sent.includes("AVISO DE PRUEBA: ¿Me confirmas que estás seguro de recibirlo?"));
    // EL ORDEN (no se invierte): pedido guardado -> aviso enviado -> aviso registrado -> asignada/avisada -> IA pausada.
    assert.deepEqual(alEnviarAviso, { estado: "pending_acceptance", avisoRegistrado: false, asignado: false, pausado: false }, "al salir el aviso el pedido ya estaba guardado y NADA se había asignado ni pausado");
    assert.deepEqual(linea.slice(0, 4), ["aviso_enviado", "asignada", "aviso_a_persona", "pausa"]);
    assert.deepEqual(alAsignar, { avisoRegistrado: true }, "se asigna DESPUÉS de registrar el aviso");
    assert.equal(asign.filas.get(`${PN_A}|${ANA.waId}`), RESPONSABLE_A, "y se asigna sin esperar el 'sí' del cliente");
    // 25) El documento nunca llegó al modelo ni al panel completo.
    // El modelo NO tiene confirm_order (el cierre lo conduce el backend): la IA no puede confirmar por esa herramienta.
    const pedidosAlModelo = providers.flatMap((x) => x.requests);
    assert.ok(pedidosAlModelo.length > 0 && pedidosAlModelo.every((r) => r.tools.length > 0 && r.tools.every((t) => t.name !== "confirm_order")), "ninguna llamada al modelo declara confirm_order");
    const prompts = JSON.stringify(providers.flatMap((x) => x.requests));
    for (const s of ["1.020.345.678", "1020345678", "345.678"]) assert.ok(!prompts.includes(s), `prompt con ${s}`);
    // El cliente responde "sí": se registra y recibe UNA respuesta fija; nada más cambia.
    const enviados: string[] = [];
    const deps: RespuestaAvisoDeps = { config: lector, engine, humanWroteSince: async () => false, sendText: async (t) => (enviados.push(t), { sent: true }), log: () => {} };
    const r = await atenderRespuestaTrasAviso({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: ANA.waId, text: "Sí, estoy seguro" }, deps);
    assert.deepEqual(r, { handled: true, accion: "respondida" });
    assert.deepEqual(enviados, [TEXTO_TRAS_AVISO]);
    assert.equal(pedidos.orders.find((x) => x.id === o.id)?.status, "pending_acceptance");
    // La responsable lo ve (documento enmascarado) y lo acepta: nace la venta.
    const [v] = await lista(ctxA());
    assert.equal(v.pedido, o.orderId);
    assert.deepEqual(v.documento, { tipo: "no_especificado", enmascarado: "•••• 5678" });
    assert.equal(v.cliente.oficina, "Oficina Centro, calle 13");
    assert.equal(v.cliente.departamento, "Antioquia");
    assert.ok(v.respuesta_cliente);
    assert.ok(!JSON.stringify(v).includes("1020345678"));
    const acepto = await decidir(ctxA(), o.orderId, "aceptar");
    assert.equal(acepto.status, 200, JSON.stringify(acepto.body));
    assert.equal(pedidos.orders.find((x) => x.id === o.id)?.status, "confirmed");
    assert.equal(llamadas.confirmOrder, 0);
    assert.equal(llamadas.acceptOrder, 1);
  });

  it("responsable inactiva en el momento del cierre: el cliente NO queda en el limbo; el pedido no se envía y nada se asigna ni se pausa", async () => {
    configs.set(`${A.tenantId}|${PN_A}`, configA({ responsable: { miembro_id: INACTIVA_A, respaldo_miembro_id: null, canales: ["panel"] } }));
    const p = await producto(A, "Ventilador", 5, 150_000);
    await turno([call("update_cart", { items: [{ reference: p.reference, quantity: 1 }] }), { text: "Listo, lo agregué." }], `quiero 1 ${p.reference}`);
    await turno([call("create_order_request"), { text: "TEXTO DEL MODELO QUE NO DEBE SALIR" }], "me lo llevo");
    await turno([], "Laura Gómez");
    await turno([], ACEPTACION_BUTTONS.phone[0].title, ACEPTACION_BUTTONS.phone[0].id);
    await turno([], "Bogotá");
    await turno([], "Cundinamarca");
    await turno([], "Calle 10 # 20-30");
    await turno([], "Chapinero");
    await turno([], ACEPTACION_BUTTONS.summary[0].title, ACEPTACION_BUTTONS.summary[0].id);
    const o = pedidos.orders.find((x) => x.contact?.waId === ANA.waId)!;
    assert.equal(o.status, "pending_confirmation", "no se envió a aceptación");
    assert.equal(asign.filas.size, 0);
    assert.equal(pausas.length, 0);
    assert.ok(!sent.some((s) => s.includes("AVISO DE PRUEBA")), "ningún aviso sin una persona que reciba el pedido");
    assert.equal(llamadas.confirmOrder, 0);
  });
});

// ===========================================================================
// 9. La puerta del webhook (producción): barata, a prueba de fallos y en su sitio
// ===========================================================================

describe("3B.5 · puerta del webhook: no cambia nada para quien no usa la aceptación humana", () => {
  const cliente = { id_tenant: A.tenantId, phone_number_id: PN_A } as unknown as ClienteConfig;
  const entrada = (text: string) => ({ waId: ANA.waId, destino: ANA.waId, wamid: "wamid.in.1", text });
  const prohibido = (mensaje: string) => new Proxy({}, { get: () => { throw new Error(mensaje); } }) as unknown as SupabaseClient;

  it("27) un mensaje que NO es un sí no consulta NADA (Delacour y los demás negocios: cero costo y cero cambios)", async () => {
    for (const t of ["hola", "¿cuánto cuesta el envío?", "quiero 2 anillos", "", "no", "sí, pero cambia la dirección"]) {
      assert.deepEqual(await atenderRespuestaTrasAvisoProduccion(prohibido("no debe consultar la base"), cliente, entrada(t)), { handled: false, motivo: "no_es_confirmacion" }, t);
    }
  });

  it("un sí con la base caída: handled=false (el mensaje sigue su camino de siempre) y NUNCA lanza", async () => {
    const r = await atenderRespuestaTrasAvisoProduccion(prohibido("base caída"), cliente, entrada("Sí"));
    assert.equal(r.handled, false);
  });

  it("el webhook llama a la puerta DESPUÉS de ia_pausada / ia_restringida_a (un número pausado sigue en silencio) y ANTES de la pausa por chat", () => {
    const src = readFileSync(join(process.cwd(), "app/webhook-dulabs/route.ts"), "utf8").split("\r\n").join("\n");
    const iPausada = src.indexOf("if (cliente.ia_pausada) {");
    const iRestringida = src.indexOf("if (cliente.ia_restringida_a) {");
    const iPuerta = src.indexOf("atenderRespuestaTrasAvisoProduccion(supabaseAdmin(), cliente");
    const iPausaChat = src.indexOf("IA en silencio para");
    assert.ok(iPausada > 0 && iPausada < iRestringida && iRestringida < iPuerta && iPuerta < iPausaChat, "orden de las barreras del webhook");
    assert.ok(src.includes("if (respuestaAviso.handled) return;"));
  });
});

// ===========================================================================
// 10. CIERRE TÉCNICO 3B.5 — fail-closed, orden, evidencia humana, concurrencia
// ===========================================================================

describe("3B.5 cierre · el enrutador: un paso que falla NUNCA salta los demás (la IA siempre calla)", () => {
  const routerCon = (over: Partial<EnrutadorAceptacionDeps>) =>
    createAcceptanceRouter({
      config: lector,
      miembros: createMemoryMiembrosStore(MIEMBROS),
      asignaciones: asign,
      notificador: {
        canales: {
          panel: {
            enviar: async (a) => {
              avisosPanel.push(a);
              return canalPanel.enviar(a);
            },
          },
        },
      },
      handoff: {
        pauseConversation: async ({ contact }) => {
          pausas.push({ waId: contact.waId, until: "released" });
          return { ok: true };
        },
      },
      log: (e) => logsRuteo.push(e),
      ...over,
    });

  it("b) la ASIGNACIÓN falla: la persona igual es avisada, la IA igual calla, el pedido sigue visible y queda constancia", async () => {
    const original = asign.asignar;
    asign.asignar = async () => {
      throw new Error("BD caída");
    };
    try {
      const { orden } = await pendiente();
      assert.equal(orden.status, "pending_acceptance");
      assert.equal(avisosPanel.length, 1, "la persona igual fue avisada");
      assert.deepEqual(pausas, [{ waId: ANA.waId, until: "released" }], "la IA igual calla");
      assert.equal((await lista(ctxA())).length, 1, "el pedido sigue visible");
      assert.ok(logsRuteo.some((l) => l.resultado === "con_fallos" && JSON.stringify(l.fallos) === JSON.stringify(["asignacion"])));
    } finally {
      asign.asignar = original;
    }
  });

  it("c) el AVISO a la persona falla: la asignación y la pausa quedan hechas", async () => {
    const { orden } = await pendiente({ sinAviso: true });
    const router = routerCon({
      notificador: {
        canales: {
          panel: {
            enviar: async () => {
              throw new Error("canal caído");
            },
          },
        },
      },
    });
    // notificarResponsablePedido absorbe el fallo del canal: no es un error del enrutador.
    await router.route({ tenantId: A.tenantId, order: orden });
    assert.equal(asign.filas.get(`${PN_A}|${ANA.waId}`), RESPONSABLE_A);
    assert.equal(pausas.length, 1);
  });

  it("la PAUSA falla: la asignación y el aviso quedan hechos y se deja constancia (el reintento lo repara)", async () => {
    const { orden } = await pendiente({ sinAviso: true });
    const router = routerCon({ handoff: { pauseConversation: async () => ({ ok: false }) } });
    await assert.rejects(router.route({ tenantId: A.tenantId, order: orden }), /pausa/);
    assert.equal(asign.filas.get(`${PN_A}|${ANA.waId}`), RESPONSABLE_A);
    assert.equal(avisosPanel.length, 1);
    assert.ok(logsRuteo.some((l) => l.resultado === "con_fallos" && JSON.stringify(l.fallos) === JSON.stringify(["pausa"])));
  });

  it("a) la VALIDACIÓN de la responsable se cae (configuración ilegible): no se asigna a nadie, pero la IA SIEMPRE calla", async () => {
    const { orden } = await pendiente({ sinAviso: true });
    const router = routerCon({
      config: async () => {
        throw new Error("BD caída");
      },
    });
    await assert.rejects(router.route({ tenantId: A.tenantId, order: orden }), /responsable_ilegible/);
    assert.equal(asign.filas.size, 0);
    assert.deepEqual(pausas, [{ waId: ANA.waId, until: "released" }]);
  });

  it("el enrutador se niega a trabajar con un pedido de OTRO negocio (no asigna, no avisa, no pausa)", async () => {
    const { orden } = await pendiente({ sinAviso: true });
    const router = routerCon({});
    await assert.rejects(router.route({ tenantId: B.tenantId, order: orden }), /otro negocio/);
    assert.equal(asign.filas.size, 0);
    assert.equal(pausas.length, 0);
    assert.equal(avisosPanel.length, 0);
  });
});

describe("3B.5 cierre · la puerta del 'sí' es FAIL-CLOSED respecto a la venta", () => {
  const entrada = (text = "Sí", contact = ANA) => ({ tenantId: A.tenantId, phoneNumberId: contact.phoneNumberId, waId: contact.waId, text });
  const depsCon = (over: Partial<RespuestaAvisoDeps> = {}) => {
    const enviados: string[] = [];
    const deps: RespuestaAvisoDeps = {
      config: lector,
      engine,
      humanWroteSince: async () => false,
      sendText: async (t) => (enviados.push(t), { sent: true }),
      log: () => {},
      ...over,
    };
    return { deps, enviados };
  };

  it("e) registrar el 'sí' falla (BD caída o el pedido cambió justo ahora): SILENCIO (handled), sin respuesta, sin otro camino", async () => {
    const { orden } = await pendiente();
    for (const falla of [new Error("BD caída"), new OrderError("INVALID_TRANSITION", "ya no está pendiente")]) {
      const { deps, enviados } = depsCon({
        engine: {
          pendingAcceptanceFor: (i) => engine.pendingAcceptanceFor(i),
          recordCustomerReplyOnce: async () => {
            throw falla;
          },
        },
      });
      assert.deepEqual(await atenderRespuestaTrasAviso(entrada(), deps), { handled: true, accion: "silencio_por_error" });
      assert.equal(enviados.length, 0);
    }
    assert.equal(pedidos.orders.find((o) => o.id === orden.id)?.status, "pending_acceptance");
    assert.equal(llamadas.confirmOrder, 0);
    assert.equal(llamadas.acceptOrder, 0);
  });

  it("d) comprobar si una persona escribió falla: el 'sí' se registra pero NO se responde", async () => {
    await pendiente();
    const { deps, enviados } = depsCon({
      humanWroteSince: async () => {
        throw new Error("sin datos");
      },
    });
    assert.deepEqual(await atenderRespuestaTrasAviso(entrada(), deps), { handled: true, accion: "registrada_sin_respuesta" });
    assert.equal(enviados.length, 0);
  });

  it("f) enviar la respuesta falla: queda registrada, sin reintento automático (nunca dos respuestas) y el mensaje NO sigue a otro flujo", async () => {
    await pendiente();
    const { deps } = depsCon({
      sendText: async () => {
        throw new Error("Meta caído");
      },
    });
    assert.deepEqual(await atenderRespuestaTrasAviso(entrada(), deps), { handled: true, accion: "registrada_sin_respuesta" });
    const { deps: d2, enviados } = depsCon();
    assert.deepEqual(await atenderRespuestaTrasAviso(entrada(), d2), { handled: true, accion: "ya_registrada" });
    assert.equal(enviados.length, 0);
  });

  it("ANTES de saber que hay pedido pendiente (configuración o búsqueda ilegibles) el mensaje sigue su camino: la barrera del agente decide con su propia lectura", async () => {
    const { deps } = depsCon({
      config: async () => {
        throw new Error("BD caída");
      },
    });
    assert.deepEqual(await atenderRespuestaTrasAviso(entrada(), deps), { handled: false, motivo: "error" });
    const { deps: d2 } = depsCon({
      engine: {
        pendingAcceptanceFor: async () => {
          throw new Error("BD caída");
        },
        recordCustomerReplyOnce: (i) => engine.recordCustomerReplyOnce(i),
      },
    });
    assert.deepEqual(await atenderRespuestaTrasAviso(entrada(), d2), { handled: false, motivo: "error" });
  });

  it("el 'sí' válido JAMÁS confirma: ni confirmed, ni confirmOrder, ni acceptOrder, ni reserva, ni stock, ni venta (cualquier variante)", async () => {
    const { orden, producto: p } = await pendiente({ qty: 2 });
    const { deps } = depsCon();
    for (const t of ["Sí", "Confirmo", "Estoy seguro", "estoy 100% seguro de recibirlo", "ok", "Sí", "dale"]) await atenderRespuestaTrasAviso(entrada(t), deps);
    const o = pedidos.orders.find((x) => x.id === orden.id)!;
    assert.equal(o.status, "pending_acceptance");
    assert.equal(o.confirmedAt, null);
    assert.equal(o.checkout, null);
    assert.equal(pedidos.reservations.length, 0);
    assert.equal(mem.inventory.stockOf(p.id), 5);
    assert.equal(llamadas.confirmOrder, 0);
    assert.equal(llamadas.acceptOrder, 0);
    assert.equal(await engine.hasPurchase({ tenantId: A.tenantId, contact: ANA }), false);
    assert.ok(![...sink.events, ...pedidos.events].some((e) => e.order.status === "confirmed" || e.transition?.to === "confirmed"));
  });

  it("la regla estricta: incertidumbre, dudas, preguntas, cambios y emojis NO activan la puerta", () => {
    for (const t of ["creo que sí", "tal vez", "déjame mirar", "dejame pensarlo", "cuánto demora?", "¿cuánto demora el envío?", "cuanto demora", "sí, pero…", "sí pero primero quiero ver", "no", "no estoy seguro", "👍", "👍🙏", "sí, cambia el barrio", "Sí, mi dirección es otra", "quiero cambiar la dirección", "luego te confirmo", "supongo que sí", "creo que si lo recibo"]) assert.equal(esConfirmacionTrasAviso(t), false, t);
    for (const t of ["Sí", "sí.", "SÍ", "Sí estoy seguro", "Confirmo, estoy 100% seguro de recibirlo", "Claro que sí", "Listo", "dale ok"]) assert.equal(esConfirmacionTrasAviso(t), true, t);
  });
});

describe("3B.5 cierre · 'una persona del equipo ya escribió': evidencia real (historial + bitácora), no una hora", () => {
  let db: SupabaseMemoria;
  const DESDE = new Date(Date.parse("2026-10-02T15:00:00Z")).toISOString(); // creación del pedido
  const DESPUES = "2026-10-02T15:05:00.000Z";
  const ANTES = "2026-10-01T10:00:00.000Z";
  const fila = (over: Record<string, unknown>) => ({ phone_number_id: PN_A, telefono_cliente: ANA.waId, direccion: "saliente", contenido: "texto", origen: "agente", wamid: null, created_at: DESPUES, ...over });
  const evento = (over: Record<string, unknown>) => ({ phone_number_id: PN_A, telefono_cliente: ANA.waId, tipo: "mensaje_enviado", miembro_id: RESPONSABLE_A, detalle: {}, created_at: DESPUES, ...over });
  const evidencia = () => createSupabaseHumanEvidence(supabaseAdmin());
  const hay = () => evidencia()(PN_A, ANA.waId, DESDE);

  beforeEach(() => {
    db = installSupabaseMemoria(process.env.SUPABASE_URL as string);
    db.table("dulabs_mensajes_log", { identity: "id" });
    db.table("dulabs_conversacion_eventos", { identity: "id" });
  });
  afterEach(() => db.uninstall());

  it("1)2) la responsable escribió desde el Inbox (después del aviso y antes del 'sí') => hay evidencia", async () => {
    assert.equal(await hay(), false, "sin mensajes: lectura limpia => nadie escribió");
    db.rows("dulabs_mensajes_log").push(fila({ origen: "agente", contenido: "Hola, soy Patricia" }));
    assert.equal(await hay(), true);
  });

  it("2) la persona respondió desde el celular del negocio (eco de coexistencia, origen 'manual') => hay evidencia", async () => {
    db.rows("dulabs_mensajes_log").push(fila({ origen: "manual", contenido: "Hola, te escribo yo" }));
    assert.equal(await hay(), true);
  });

  it("3) OTRO miembro del mismo negocio escribió (bitácora de la conversación, aunque el mensaje no se hubiera registrado) => hay evidencia", async () => {
    db.rows("dulabs_conversacion_eventos").push(evento({ miembro_id: AGENTE_A }));
    assert.equal(await hay(), true);
  });

  it("4) los mensajes del propio BOT y los automáticos NO cuentan (ia, campaña, automático, entrantes) ni los de otro cliente u otro número", async () => {
    for (const origen of ["ia", "campaña", "automatico", "whatsapp_ia"]) db.rows("dulabs_mensajes_log").push(fila({ origen }));
    db.rows("dulabs_mensajes_log").push(fila({ direccion: "entrante", origen: "entrante" }));
    db.rows("dulabs_mensajes_log").push(fila({ origen: "agente", telefono_cliente: "573009990000" }));
    db.rows("dulabs_mensajes_log").push(fila({ origen: "agente", phone_number_id: PN_B }));
    db.rows("dulabs_conversacion_eventos").push(evento({ tipo: "asignado" }), evento({ tipo: "liberado" }), evento({ telefono_cliente: "573009990000" }));
    assert.equal(await hay(), false);
  });

  it("5) mensajes duplicados (mismo mensaje dos veces) no rompen ni cambian el resultado", async () => {
    db.rows("dulabs_mensajes_log").push(fila({ origen: "agente", wamid: "wamid.dup" }), fila({ origen: "agente", wamid: "wamid.dup" }));
    assert.equal(await hay(), true);
  });

  it("lo que una persona escribió ANTES de que existiera el pedido (otra época de la conversación) no cuenta", async () => {
    db.rows("dulabs_mensajes_log").push(fila({ origen: "agente", created_at: ANTES }));
    db.rows("dulabs_conversacion_eventos").push(evento({ created_at: ANTES }));
    assert.equal(await hay(), false);
  });

  it("6) SIN evidencia suficiente => se asume que sí escribió (NO se responde): error en cualquiera de las dos fuentes, o fecha inválida", async () => {
    db.missing("dulabs_mensajes_log");
    assert.equal(await hay(), true, "no se pudo leer el historial");
    db.uninstall();
    db = installSupabaseMemoria(process.env.SUPABASE_URL as string);
    db.table("dulabs_mensajes_log", { identity: "id" });
    db.missing("dulabs_conversacion_eventos");
    assert.equal(await hay(), true, "no se pudo leer la bitácora");
    assert.equal(await evidencia()(PN_A, ANA.waId, "no-es-una-fecha"), true, "fecha inválida");
  });

  it("con la evidencia REAL de producción, de punta a punta: sin persona => responde; con persona => registra y no responde", async () => {
    const { orden } = await pendiente({ qty: 1 });
    const enviados: string[] = [];
    const deps: RespuestaAvisoDeps = { config: lector, engine, humanWroteSince: evidencia(), sendText: async (t) => (enviados.push(t), { sent: true }), log: () => {} };
    db.rows("dulabs_mensajes_log").push(fila({ origen: "agente", created_at: new Date(Date.parse(orden.createdAt) + 60_000).toISOString() }));
    assert.deepEqual(await atenderRespuestaTrasAviso({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: ANA.waId, text: "Sí" }, deps), { handled: true, accion: "registrada_sin_respuesta" });
    assert.equal(enviados.length, 0);
    assert.ok(pedidos.orders.find((o) => o.id === orden.id)?.acceptance?.customerReplyAt);
    // Otro cliente, sin ninguna persona: responde.
    const otro = { phoneNumberId: PN_A, waId: "573001110099" };
    await pendiente({ contact: otro });
    assert.deepEqual(await atenderRespuestaTrasAviso({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: otro.waId, text: "Sí" }, deps), { handled: true, accion: "respondida" });
    assert.deepEqual(enviados, [TEXTO_TRAS_AVISO]);
  });
});

describe("3B.5 cierre · barrera del agente: con un pedido pendiente (con aviso) el agente NO atiende, pase lo que pase", () => {
  const filaGuard = (opciones: unknown, checkout: boolean | undefined): AgentConfigRow => ({
    id_tenant: A.tenantId,
    phone_number_id: PN_A,
    tipo: "catalog_sales",
    habilitado: true,
    proveedor: "gemini",
    modelo: "gemini-3.6-flash",
    credencial_ref: "env:GEMINI_KEY_PRUEBA",
    nivel_razonamiento: "low",
    herramientas: [...AGENT_TOOL_NAMES],
    canal: "retail",
    negocio: { nombre_negocio: "Tienda Ficticia" },
    clasificacion_cliente: false,
    ...(checkout === undefined ? {} : { checkout_conversacional: checkout }),
    vocabulario: null,
    checkout_opciones: opciones,
    meta_token_plataforma: false,
  });
  const entrada: AgentBoundaryInput = { cliente: { id_tenant: A.tenantId, phone_number_id: PN_A }, waId: ANA.waId, destino: ANA.waId, wamid: "wamid.in.1", text: "hola" };
  function frontera(row: AgentConfigRow, over: Partial<AgentBoundaryDeps> & { conTodas?: boolean } = {}) {
    const n = { build: 0 };
    const { conTodas = true, ...resto } = over;
    const deps: AgentBoundaryDeps = {
      configStore: createMemoryAgentConfigStore([row]),
      ...(conTodas ? { funciones3b: TODAS } : {}),
      env: { GEMINI_KEY_PRUEBA: "clave-de-prueba" },
      hasMetaCredential: () => true,
      logError: () => {},
      build: () => {
        n.build++;
        return null;
      },
      ...resto,
    };
    return { deps, n };
  }

  it("pendiente CON aviso => silencio (handled): el agente NO corre aunque no haya pausa; no se construye nada ni se llama al modelo", async () => {
    const { deps, n } = frontera(filaGuard(OPCIONES_E2E, true), { pendingAcceptance: async () => ({ pending: true, noticeSent: true }) });
    assert.deepEqual(await atenderConAgenteSiAplica(entrada, deps), { handled: true, outcome: "pending_acceptance" });
    assert.equal(n.build, 0);
  });

  it("pendiente SIN aviso aún registrado (el cierre del checkout se está completando) => el turno sigue; sin pedido pendiente => sigue", async () => {
    for (const estado of [{ pending: true, noticeSent: false }, { pending: false, noticeSent: false }]) {
      const { deps, n } = frontera(filaGuard(OPCIONES_E2E, true), { pendingAcceptance: async () => estado });
      const r = await atenderConAgenteSiAplica(entrada, deps);
      assert.equal(n.build, 1, JSON.stringify(estado));
      assert.deepEqual(r, { handled: true, outcome: "unavailable", reason: "runtime_deps_unavailable" });
    }
  });

  it("la lectura del pedido pendiente falla => fail-closed: silencio, no se atiende", async () => {
    const { deps, n } = frontera(filaGuard(OPCIONES_E2E, true), {
      pendingAcceptance: async () => {
        throw new Error("BD caída");
      },
    });
    assert.deepEqual(await atenderConAgenteSiAplica(entrada, deps), { handled: true, outcome: "unavailable", reason: "pending_acceptance_unreadable" });
    assert.equal(n.build, 0);
  });

  it("un número con aceptación humana SIN la barrera instalada => fail-closed (no se atiende)", async () => {
    const { deps, n } = frontera(filaGuard(OPCIONES_E2E, true));
    assert.deepEqual(await atenderConAgenteSiAplica(entrada, deps), { handled: true, outcome: "unavailable", reason: "acceptance_guard_unavailable" });
    assert.equal(n.build, 0);
  });

  it("PRODUCCIÓN: con la compuerta cerrada la configuración con aceptación es inválida => el agente no responde y NO cae a otro bot", async () => {
    const { deps, n } = frontera(filaGuard(OPCIONES_E2E, true), { conTodas: false, pendingAcceptance: async () => ({ pending: false, noticeSent: false }) });
    assert.deepEqual(await atenderConAgenteSiAplica(entrada, deps), { handled: true, outcome: "invalid_config", reason: "checkout_feature_unavailable" });
    assert.equal(n.build, 0);
  });

  it("Delacour (opciones de siempre): la barrera NUNCA se consulta y el turno sigue exactamente como antes", async () => {
    let consultas = 0;
    const { deps, n } = frontera(filaGuard(CHECKOUT_OPCIONES_LEGADO, false), {
      conTodas: false,
      pendingAcceptance: async () => {
        consultas++;
        return { pending: true, noticeSent: true };
      },
    });
    const r = await atenderConAgenteSiAplica(entrada, deps);
    assert.equal(consultas, 0);
    assert.equal(n.build, 1);
    assert.deepEqual(r, { handled: true, outcome: "unavailable", reason: "runtime_deps_unavailable" });
  });
});

describe("3B.5 cierre · la configuración con aceptación humana EXIGE el checkout conversacional (si no, el modelo conservaría confirm_order)", () => {
  const filaCfg = (checkout: boolean | undefined, opciones: unknown = OPCIONES_E2E): AgentConfigRow => ({
    id_tenant: A.tenantId,
    phone_number_id: PN_A,
    tipo: "catalog_sales",
    habilitado: true,
    proveedor: "gemini",
    modelo: "gemini-3.6-flash",
    credencial_ref: "env:GEMINI_KEY_PRUEBA",
    nivel_razonamiento: "low",
    herramientas: [...AGENT_TOOL_NAMES],
    canal: "retail",
    negocio: { nombre_negocio: "Tienda Ficticia" },
    clasificacion_cliente: false,
    ...(checkout === undefined ? {} : { checkout_conversacional: checkout }),
    vocabulario: null,
    checkout_opciones: opciones,
    meta_token_plataforma: false,
  });
  const esperado = { tenantId: A.tenantId, phoneNumberId: PN_A };

  it("sin checkout_conversacional (false o ausente) la configuración es INVÁLIDA; con él, válida y el modelo NO tiene confirm_order", () => {
    for (const c of [false, undefined]) assert.deepEqual(parseAgentConfig(filaCfg(c), esperado, { funciones3b: TODAS }), { kind: "invalid", reason: "checkout_required_for_acceptance" }, String(c));
    const ok = parseAgentConfig(filaCfg(true), esperado, { funciones3b: TODAS });
    assert.equal(ok.kind, "ok");
    assert.equal(ok.kind === "ok" && ok.config.checkoutEnabled, true);
  });

  it("en producción (compuerta cerrada) sigue 'checkout_feature_unavailable' (el cierre ni siquiera puede configurarse)", () => {
    for (const c of [false, true]) assert.deepEqual(parseAgentConfig(filaCfg(c), esperado), { kind: "invalid", reason: "checkout_feature_unavailable" });
  });

  it("Delacour (opciones de siempre, con o sin checkout conversacional) no cambia: sigue siendo válida", () => {
    for (const c of [false, true, undefined]) assert.equal(parseAgentConfig(filaCfg(c, CHECKOUT_OPCIONES_LEGADO), esperado).kind, "ok", String(c));
    assert.equal(parseAgentConfig(filaCfg(false, null), esperado).kind, "ok", "sin opciones (perfil de siempre)");
  });
});

describe("3B.5 cierre · aislamiento: Delacour (sin aceptación humana) frente a un pedido de ASLC", () => {
  const D: CatalogActor = { tenantId: "dddddddd-0000-4000-8000-00000000000d", userId: "admin-d" };
  const ctxD = (persona = { miembroId: 61, esAdmin: true }): PorAceptarCtx => ({
    engine,
    tenantId: D.tenantId,
    persona,
    extras: { fuentes: fuentes(), verTelefono: true },
    config: async () => null, // Delacour no usa la aceptación humana
  });

  it("un administrador de Delacour no ve, no acepta, no rechaza, no cancela ni lee el documento de un pedido de ASLC", async () => {
    const { orden } = await pendiente({ checkout: OFICINA, policy: CON_DOCUMENTO, document: { type: "no_especificado", number: DOC } });
    assert.equal((await lista(ctxD())).length, 0);
    assert.equal((await leer(await detallePorAceptar(ctxD(), orden.orderId))).status, 404);
    for (const accion of ["aceptar", "rechazar", "cancelar"]) assert.equal((await decidir(ctxD(), orden.orderId, accion, "intento de otro negocio")).status, 404, accion);
    assert.equal(pedidos.orders.find((o) => o.id === orden.id)?.status, "pending_acceptance");
    assert.equal(llamadas.acceptOrder, 0);
    assert.equal(await engine.acceptanceDocument(D.tenantId, pedidos.orders.find((o) => o.id === orden.id)!), null);
  });

  it("ni el tenant_id de la petición ni el número de pedido de la URL cambian el negocio: el negocio sale SIEMPRE de la sesión", async () => {
    const { orden } = await pendiente();
    const r = await leer(await decidirPorAceptar(ctxD(), orden.orderId.toLowerCase(), { accion: "aceptar", tenant_id: A.tenantId, tenantId: A.tenantId }));
    assert.equal(r.status, 404, "minúsculas o mayúsculas, el pedido de ASLC no existe para Delacour");
    const r2 = await leer(await decidirPorAceptar(ctxA({ miembroId: RESPONSABLE_A, esAdmin: false }), orden.orderId, { accion: "aceptar", tenant_id: B.tenantId }));
    assert.equal(r2.status, 200, "un tenant_id ajeno en el cuerpo se ignora: manda el de la sesión");
    assert.equal(pedidos.orders.find((o) => o.id === orden.id)?.businessId, A.tenantId);
  });

  it("el pedido de ASLC no puede asignarse a un miembro de otro negocio (ni por configuración ni por el almacén de asignaciones)", async () => {
    configs.set(`${A.tenantId}|${PN_A}`, configA({ responsable: { miembro_id: ADMIN_B, respaldo_miembro_id: null, canales: ["panel"] } }));
    const p = await producto(A, "Licuadora", 5);
    const prop = await propuesta(ANA, [{ reference: p.reference, quantity: 1 }]);
    await assert.rejects(enviar(prop), esError("UNAVAILABLE"));
    assert.equal(asign.filas.size, 0);
  });

  it("el webhook ejecuta la puerta del 'sí' DESPUÉS de marcar el mensaje como procesado (un mismo wamid nunca entra dos veces)", () => {
    const src = readFileSync(join(process.cwd(), "app/webhook-dulabs/route.ts"), "utf8").split("\r\n").join("\n");
    const iMarcado = src.indexOf('.is("procesado_at", null)');
    const iPuerta = src.indexOf("atenderRespuestaTrasAvisoProduccion(supabaseAdmin(), cliente");
    assert.ok(iMarcado > 0 && iMarcado < iPuerta);
  });
});

describe("3B.5 cierre · concurrencia: lo que garantiza la BD, no un 'primero consulto y luego escribo'", () => {
  let db: SupabaseMemoria;
  beforeEach(() => {
    db = installSupabaseMemoria(process.env.SUPABASE_URL as string);
    db.table("dulabs_clientes_config").push({ phone_number_id: PN_A, id_tenant: A.tenantId }, { phone_number_id: PN_B, id_tenant: B.tenantId });
    db.table("dulabs_conversacion_asignaciones", { identity: "id", unique: [["phone_number_id", "telefono_cliente"]] });
    db.table("dulabs_conversacion_eventos", { identity: "id" });
  });
  afterEach(() => db.uninstall());
  const asignar = (store: ReturnType<typeof createSupabaseAsignacionesStore>, miembroId: number, tenantId = A.tenantId, phoneNumberId = PN_A) => store.asignar({ tenantId, phoneNumberId, waId: ANA.waId, miembroId, pedido: "DL-ORD-AAAAAA" });

  it("asignación repetida y simultánea (código real de producción sobre la restricción UNIQUE): UNA fila, UN evento, un solo ganador", async () => {
    const store = createSupabaseAsignacionesStore(supabaseAdmin());
    const r = await Promise.all(Array.from({ length: 6 }, () => asignar(store, RESPONSABLE_A)));
    assert.equal(r.filter((x) => x.estado === "asignada").length, 1);
    assert.equal(r.filter((x) => x.estado === "ya_asignada").length, 5);
    assert.equal(db.rows("dulabs_conversacion_asignaciones").length, 1);
    assert.equal(db.rows("dulabs_conversacion_eventos").length, 1);
    assert.equal(db.rows("dulabs_conversacion_eventos")[0].tipo, "asignado");
    // Un reintento posterior no repite nada.
    assert.equal((await asignar(store, RESPONSABLE_A)).estado, "ya_asignada");
    assert.equal(db.rows("dulabs_conversacion_eventos").length, 1);
  });

  it("dos personas distintas compiten por la misma conversación: gana UNA y la otra no se la quita; UN evento", async () => {
    const store = createSupabaseAsignacionesStore(supabaseAdmin());
    const [a, b] = await Promise.all([asignar(store, RESPONSABLE_A), asignar(store, AGENTE_A)]);
    assert.deepEqual([a.estado, b.estado].sort(), ["asignada", "de_otra_persona"]);
    const fila = db.rows("dulabs_conversacion_asignaciones");
    assert.equal(fila.length, 1);
    assert.equal(db.rows("dulabs_conversacion_eventos").length, 1);
    assert.equal(Number(fila[0].miembro_id), a.estado === "asignada" ? RESPONSABLE_A : AGENTE_A);
  });

  it("el almacén de producción se niega a asignar un número de OTRO negocio (no escribe nada)", async () => {
    const store = createSupabaseAsignacionesStore(supabaseAdmin());
    await assert.rejects(asignar(store, RESPONSABLE_A, A.tenantId, PN_B), /no es de este negocio/);
    await assert.rejects(asignar(store, RESPONSABLE_B, B.tenantId, PN_A), /no es de este negocio/);
    assert.equal(db.rows("dulabs_conversacion_asignaciones").length, 0);
    assert.equal(db.rows("dulabs_conversacion_eventos").length, 0);
  });

  it("aceptar y rechazar A LA VEZ: exactamente UNA decisión gana; nunca venta y rechazo juntos, ni dos reservas", async () => {
    const { orden, producto: p } = await pendiente({ qty: 2 });
    const [x, y] = await Promise.all([decidir(ctxA(), orden.orderId, "aceptar"), decidir(ctxA(), orden.orderId, "rechazar", "motivo de prueba")]);
    const final = pedidos.orders.find((o) => o.id === orden.id)!;
    assert.ok(final.status === "confirmed" || final.status === "rejected", final.status);
    assert.equal(pedidos.history.filter((h) => h.orderId === orden.id && (h.entry.to === "confirmed" || h.entry.to === "rejected")).length, 1, "UNA sola transición decisiva");
    const reservas = pedidos.reservations.filter((r) => r.orderId === orden.id && r.status === "activa").length;
    assert.equal(reservas, final.status === "confirmed" ? 1 : 0);
    assert.equal(mem.inventory.stockOf(p.id), final.status === "confirmed" ? 3 : 5);
    assert.ok([x.status, y.status].some((s) => s === 200), "alguna decisión se aplicó");
    assert.equal(final.status === "confirmed", llamadas.acceptOrder >= 1 && final.confirmedAt !== null);
  });

  it("rechazar dos veces a la vez: UN evento", async () => {
    const { orden } = await pendiente();
    await Promise.all([decidir(ctxA(), orden.orderId, "rechazar", "motivo de prueba"), decidir(ctxA(), orden.orderId, "rechazar", "motivo de prueba"), decidir(ctxA(), orden.orderId, "cancelar", "motivo de prueba")]);
    const final = pedidos.orders.find((o) => o.id === orden.id)!;
    assert.ok(final.status === "rejected" || final.status === "cancelled");
    assert.equal(pedidos.history.filter((h) => h.orderId === orden.id && (h.entry.to === "rejected" || h.entry.to === "cancelled")).length, 1);
    assert.equal(final.confirmedAt, null);
  });
});
