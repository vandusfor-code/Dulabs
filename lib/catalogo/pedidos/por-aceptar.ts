/**
 * FASE 3B.5 — PANEL "POR ACEPTAR": los pedidos que el cliente dejó listos (checkout + aviso) y que UNA PERSONA
 * del negocio debe aceptar o rechazar. Aceptar es lo único que los vuelve venta.
 *
 *   GET  lista     pedidos pendientes de aceptación del negocio de la sesión (con todo lo que la persona necesita).
 *   GET  detalle   uno solo + historial.
 *   POST decidir   { accion: "aceptar" | "rechazar" | "cancelar", motivo? }  — SOLO una persona autenticada del
 *                  negocio con permiso (la responsable y su respaldo; con "responsable_y_admins", también un
 *                  admin). Cada acción la valida el backend (aquí) Y la BD (compare-and-set + disparadores).
 *
 * Reglas que esta capa garantiza (no el cliente web ni el modelo):
 *   - negocio de la sesión: un pedido de otro negocio es un "no encontrado" (nunca se ve, ni se acepta, ni se
 *     rechaza, ni se lee su documento);
 *   - aceptar usa acceptOrder (NUNCA confirmOrder): ahí nace confirmed_at, la etapa, el pago pendiente y la
 *     reserva de stock según la política del negocio; sin stock suficiente NO se confirma nada y el pedido
 *     sigue pendiente, visible;
 *   - rechazar/cancelar solo desde "pendiente de aceptación": sin venta, sin reserva;
 *   - repetir la acción (doble clic, recarga) no la repite: devuelve el pedido tal cual (`repetido: true`);
 *   - el documento solo sale enmascarado.
 * Al cliente no se le envía ningún mensaje desde aquí (no hay un texto aprobado por el negocio todavía).
 *
 * FASE 3B.7 — operación del panel (sin cambiar ninguna regla de arriba):
 *   - lista paginada por cursor (el mismo keyset del historial; sin tope silencioso), con la conversación del pedido
 *     (quién la tiene, si la IA está pausada, estado en el Inbox), la responsable configurada y los datos que faltan;
 *   - detalle de un pedido que YA se procesó (otra persona lo aceptó/rechazó, venció, etc.): no es un error, es el
 *     estado actualizado (`procesado`), sin datos personales del cliente;
 *   - gancho `alDecidir` para la Fase 3B.8 (mensaje al cliente tras la decisión): este archivo no envía nada ni conoce textos; el
 *     cableado de producción (por-aceptar-produccion.ts) lo conecta a lib/catalogo/pedidos/mensajes-decision.ts, que solo envía el
 *     texto que el NEGOCIO configuró y de forma idempotente.
 */
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import type { DeliveryType, Order, PaymentMethod } from "@/lib/catalogo/pedidos/contrato";
import { OrderError, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { PEDIDO_PUBLICO, codificarCursor, decodificarCursor, enriquecerPedidos, pedidoPanel, type PanelExtras, type PedidoPanel } from "@/lib/catalogo/pedidos/panel";
import type { ReservationSummary } from "@/lib/catalogo/pedidos/repositorio";
import { puedeDecidir, type ConfigAceptacion, type QuienAcepta } from "@/lib/agente/aceptacion-humana";
import { usaMotivo } from "@/lib/agente/textos-cliente";

export const ACCIONES_DECISION = ["aceptar", "rechazar", "cancelar"] as const;
export type AccionDecision = (typeof ACCIONES_DECISION)[number];

/** Páginas del listado: 25 por defecto, hasta 50 (el motor acota a 100). */
export const POR_ACEPTAR_POR_PAGINA = 25;
export const POR_ACEPTAR_MAX_POR_PAGINA = 50;

/** Datos del checkout que faltan y que la persona debería confirmar con el cliente (códigos estables). */
export type CampoFaltante = "nombre" | "telefono" | "ciudad" | "departamento" | "direccion" | "barrio" | "oficina";

/** La conversación del pedido, tal como la ve el Inbox: nunca se crea otra bandeja, solo se enlaza la que existe. */
export interface ConversacionPorAceptar {
  /** Número del negocio que atendió (para abrir el chat en el Inbox). */
  numero: string;
  /** Teléfono de la conversación: SOLO para quien puede atender (admin / agente). */
  telefono: string | null;
  /** Persona del equipo que tiene asignada la conversación; null = nadie. */
  asignada: string | null;
  /** La IA está pausada en ESA conversación (una persona la atiende). */
  ia_pausada: boolean;
  ia_pausada_hasta: string | null;
  /** Estado de la conversación en el Inbox; null = sin estado. */
  estado: "open" | "pending" | "closed" | null;
}

/** Quién debe aceptar según la configuración del negocio (nombres, nunca ids). */
export interface ResponsablePorAceptar {
  principal: string | null;
  respaldo: string | null;
  quien_acepta: QuienAcepta;
}

export interface PedidoPorAceptar {
  pedido: string;
  estado: "por_aceptar";
  creado: string;
  actualizado: string;
  lineas: PedidoPanel["lineas"];
  unidades: number;
  total: number;
  sin_precio: number;
  /** Nota de envío del negocio (p. ej. "envío gratis"), tal cual la configuró. */
  envio: string | null;
  pago: PaymentMethod;
  entrega: DeliveryType;
  cliente: {
    nombre: string;
    /** Teléfono de contacto que dio el cliente: SOLO para quien puede atender (admin / agente). */
    telefono: string | null;
    telefono_parcial: string | null;
    ciudad: string | null;
    departamento: string | null;
    direccion: string | null;
    barrio: string | null;
    referencia_entrega: string | null;
    oficina: string | null;
  };
  /** Solo enmascarado (últimos 4). Nunca el número. */
  documento: { tipo: string; enmascarado: string } | null;
  aviso_enviado: string | null;
  /** Cuándo el cliente respondió "sí" después del aviso (informativo: NO acepta el pedido). */
  respuesta_cliente: string | null;
  asignada: string | null;
  /** Quién debe aceptar (configuración del negocio); null = sin configuración utilizable. */
  responsable: ResponsablePorAceptar | null;
  /** Mensajes al cliente que el negocio configuró para cada decisión; null = sin configuración utilizable. */
  avisa_al_cliente: AvisosAlCliente | null;
  conversacion: ConversacionPorAceptar | null;
  /** Datos del checkout que no llegaron (la persona los confirma con el cliente antes de aceptar). */
  faltantes: CampoFaltante[];
  /** Plazo de la reserva de stock mientras espera (null = sin reserva) y vencimiento del pedido (null = no vence solo). */
  reserva_minutos: number | null;
  vence: string | null;
  puede_decidir: boolean;
  acciones: AccionDecision[];
  /** Estado que la persona VIO (compare-and-set de la decisión). */
  version: { estado: "pending_acceptance" };
}

export interface HistorialPorAceptar {
  tipo: string;
  desde: string | null;
  hacia: string | null;
  actor: string | null;
  miembro: string | null;
  motivo: string | null;
  fecha: string;
}

/** Un pedido que ya salió de "Por aceptar" (lo aceptó/rechazó/canceló alguien o venció): solo su estado, sin datos del cliente. */
export interface ProcesadoPorAceptar {
  pedido: string;
  /** Estado actual del pedido (confirmed, completed, rejected, cancelled, expired…). */
  estado: Order["status"];
  fecha: string | null;
  /** Quién lo procesó (nombre de la persona del equipo); null = el sistema (venció) o no se sabe. */
  por: string | null;
  motivo: string | null;
}

/**
 * Una decisión humana YA aplicada (no repetida). Gancho de la Fase 3B.8 (mensaje al cliente según la decisión).
 * En producción no hay ningún gancho cableado: aceptar o rechazar NO le escribe nada al cliente.
 */
export interface DecisionPorAceptar {
  tenantId: string;
  pedido: string;
  accion: AccionDecision;
  estado: Order["status"];
  miembroId: number;
  contacto: { phoneNumberId: string; waId: string };
  /** Motivo que registró la persona autorizada (rechazar y cancelar lo exigen); null al aceptar sin nota. Nunca uno inventado. */
  motivo: string | null;
}

/** Qué pasó con el mensaje al cliente tras la decisión (informativo para la persona: la decisión ya está tomada y no se deshace). */
export interface MensajeAlCliente {
  /** enviada | ventana_vencida | omitida | fallida | desconocido | desactivada | no_disponible | no_aplica | enviando | pendiente */
  estado: string;
  motivo: string | null;
  /** true = ya se había enviado antes (esta vez no se repitió). */
  repetida: boolean;
}

/** Qué mensajes al cliente tiene configurados el negocio (para avisarle a la persona ANTES de decidir; no revela los textos). */
export interface AvisosAlCliente {
  aceptar: boolean;
  rechazar: boolean;
  cancelar: boolean;
  /** La plantilla de rechazo / cancelación incluye el motivo: lo que escriba la persona lo lee el cliente. */
  motivo_al_cliente: { rechazar: boolean; cancelar: boolean };
}

/** Todo lo que necesitan los manejadores (la ruta lo arma con la sesión ya autorizada). */
export interface PorAceptarCtx {
  engine: OrderEngine | null;
  /** Negocio de la SESIÓN (nunca uno que llegue en la petición). */
  tenantId: string;
  persona: { miembroId: number; esAdmin: boolean };
  extras: PanelExtras;
  /** Configuración de aceptación del negocio para ese número; null = no configurada o inválida (fail-closed). */
  config: (phoneNumberId: string) => Promise<ConfigAceptacion | null>;
  /** Fase 3B.8: se llama UNA vez tras una decisión aplicada. Un fallo aquí nunca deshace ni cambia la decisión. */
  alDecidir?: (decision: DecisionPorAceptar) => Promise<MensajeAlCliente | void>;
}

const HTTP: Partial<Record<OrderError["code"], number>> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID_TRANSITION: 409,
  CONFLICT: 409,
  OUT_OF_STOCK: 409,
  PRODUCT_UNAVAILABLE: 409,
  PRICE_CHANGED: 409,
  ORDER_HAS_ISSUES: 409,
  UNAVAILABLE: 503,
  INVALID_INPUT: 400,
};

function errorPorAceptar(err: unknown): Response {
  if (err instanceof OrderError) return apiError(err.code, err.message, HTTP[err.code] ?? 422, err.details);
  console.error("[catalogo/pedidos/por-aceptar]", err instanceof Error ? err.message : "?");
  return apiError("INTERNAL_ERROR", "No se pudo completar la operación.", 500);
}

const noEncontrado = () => apiError("NOT_FOUND", "No encontramos ese pedido.", 404);

const usaMotivoEn = (plantilla: string | null | undefined) => !!plantilla && usaMotivo(plantilla);

/** Qué mensajes al cliente están configurados (la persona lo sabe antes de decidir; no se muestran los textos). */
export function avisosAlCliente(config: ConfigAceptacion): AvisosAlCliente {
  const t = config.textosDecision;
  return {
    aceptar: !!t?.aceptado,
    rechazar: !!t?.rechazado,
    cancelar: !!t?.cancelado,
    motivo_al_cliente: { rechazar: usaMotivoEn(t?.rechazado), cancelar: usaMotivoEn(t?.cancelado) },
  };
}

type Atencion = { pausadaHasta: string | null; conversacion: "open" | "pending" | "closed" | null };

const falta = (v: string | null | undefined) => !v || !v.trim();

/** Datos del checkout que faltan según la modalidad de entrega (solo informativo: no bloquea ninguna acción). */
export function camposFaltantes(a: NonNullable<Order["acceptance"]>): CampoFaltante[] {
  const out: CampoFaltante[] = [];
  if (falta(a.customerName)) out.push("nombre");
  if (falta(a.contactPhone)) out.push("telefono");
  if (a.delivery === "domicilio") {
    if (falta(a.city)) out.push("ciudad");
    if (falta(a.department)) out.push("departamento");
    if (falta(a.address)) out.push("direccion");
    if (falta(a.neighborhood)) out.push("barrio");
  } else if (a.delivery === "oficina_transportadora") {
    if (falta(a.city)) out.push("ciudad");
    if (falta(a.department)) out.push("departamento");
    if (falta(a.carrierOffice)) out.push("oficina");
  }
  return out;
}

function vistaPorAceptar(
  order: Order,
  doc: { type: string; masked: string } | null,
  config: ConfigAceptacion | null,
  d: PorAceptarCtx,
  base: PedidoPanel & { asesora?: { asignada: string | null } | null },
  extra: { atencion: Atencion | null; nombres: Map<number, string> },
): PedidoPorAceptar | null {
  const a = order.acceptance;
  if (!a) return null;
  const decide = !!config && puedeDecidir(config, d.persona);
  const contacto = order.contact;
  const asignada = base.asesora?.asignada ?? null;
  const pausada = extra.atencion?.pausadaHasta ?? null;
  return {
    pedido: order.orderId,
    estado: "por_aceptar",
    creado: order.createdAt,
    actualizado: order.updatedAt,
    lineas: base.lineas,
    unidades: order.totalUnits,
    total: order.total,
    sin_precio: order.unpricedUnits,
    envio: config?.notaEnvio ?? null,
    pago: a.paymentMethod,
    entrega: a.delivery,
    cliente: {
      nombre: a.customerName,
      telefono: d.extras.verTelefono ? a.contactPhone : null,
      telefono_parcial: a.contactPhone ? a.contactPhone.slice(-4) : null,
      ciudad: a.city,
      departamento: a.department,
      direccion: a.address,
      barrio: a.neighborhood,
      referencia_entrega: a.deliveryReference,
      oficina: a.carrierOffice,
    },
    documento: doc ? { tipo: doc.type, enmascarado: doc.masked } : null,
    aviso_enviado: a.noticeSentAt,
    respuesta_cliente: a.customerReplyAt,
    asignada,
    responsable: config ? { principal: extra.nombres.get(config.responsable.miembro_id) ?? null, respaldo: config.responsable.respaldo_miembro_id !== null ? (extra.nombres.get(config.responsable.respaldo_miembro_id) ?? null) : null, quien_acepta: config.aceptan } : null,
    avisa_al_cliente: config ? avisosAlCliente(config) : null,
    conversacion: contacto ? { numero: contacto.phoneNumberId, telefono: d.extras.verTelefono ? contacto.waId : null, asignada, ia_pausada: pausada !== null, ia_pausada_hasta: pausada, estado: extra.atencion?.conversacion ?? null } : null,
    faltantes: camposFaltantes(a),
    reserva_minutos: a.reservationMinutes,
    vence: a.expiresAt,
    puede_decidir: decide,
    acciones: decide ? [...ACCIONES_DECISION] : [],
    version: { estado: "pending_acceptance" },
  };
}

async function armar(d: PorAceptarCtx, items: Array<{ order: Order; reservations: ReservationSummary[] }>): Promise<PedidoPorAceptar[]> {
  const engine = d.engine as OrderEngine;
  const configs = new Map<string, ConfigAceptacion | null>();
  const configDe = async (o: Order) => {
    const k = o.contact?.phoneNumberId ?? "";
    if (!configs.has(k)) configs.set(k, k ? await d.config(k).catch(() => null) : null);
    return configs.get(k) ?? null;
  };
  // Nombres de la responsable y su respaldo (de ESTE negocio): una lectura por número, no por pedido.
  const nombres = new Map<string, Map<number, string>>();
  const nombresDe = async (o: Order, config: ConfigAceptacion | null) => {
    const k = o.contact?.phoneNumberId ?? "";
    if (!nombres.has(k)) {
      const ids = config ? [config.responsable.miembro_id, ...(config.responsable.respaldo_miembro_id !== null ? [config.responsable.respaldo_miembro_id] : [])] : [];
      nombres.set(k, ids.length && d.extras.fuentes.miembros ? await d.extras.fuentes.miembros(d.tenantId, ids).catch(() => new Map<number, string>()) : new Map<number, string>());
    }
    return nombres.get(k) as Map<number, string>;
  };
  const base = await enriquecerPedidos(
    d.tenantId,
    items.map((i) => ({ vista: pedidoPanel(i.order, i.reservations), order: i.order, reservations: i.reservations })),
    d.extras,
  );
  // Atención de las conversaciones (IA pausada, estado del Inbox): una sola lectura; si falla, queda sin dato.
  const contactos = [...new Map(items.flatMap((i) => (i.order.contact ? [[`${i.order.contact.phoneNumberId}|${i.order.contact.waId}`, i.order.contact] as const] : []))).values()];
  const atenciones = d.extras.fuentes.atencion && contactos.length ? await d.extras.fuentes.atencion(d.tenantId, contactos).catch(() => new Map<string, Atencion>()) : new Map<string, Atencion>();
  const out: PedidoPorAceptar[] = [];
  for (let i = 0; i < items.length; i++) {
    const { order } = items[i];
    const doc = await engine.acceptanceDocument(d.tenantId, order).catch(() => null);
    const config = await configDe(order);
    const nombres = await nombresDe(order, config);
    const k = order.contact ? `${order.contact.phoneNumberId}|${order.contact.waId}` : null;
    const v = vistaPorAceptar(order, doc, config, d, base[i], { atencion: (k && atenciones.get(k)) || null, nombres });
    if (v) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** GET lista: ?limite=1..50 (25 por defecto), ?cursor=<opaco>. Respuesta: { pedidos, siguiente } (siguiente = cursor de la próxima página o null). */
export async function listarPorAceptar(d: PorAceptarCtx, params: URLSearchParams = new URLSearchParams()): Promise<Response> {
  if (!d.engine) return apiError("UNAVAILABLE", "Los pedidos no están activados.", 503);
  const limiteTexto = params.get("limite");
  const limite = limiteTexto === null ? POR_ACEPTAR_POR_PAGINA : Number(limiteTexto);
  if (!Number.isInteger(limite) || limite < 1 || limite > POR_ACEPTAR_MAX_POR_PAGINA) return apiError("VALIDATION_ERROR", `limite debe ser un entero entre 1 y ${POR_ACEPTAR_MAX_POR_PAGINA}.`, 400);
  const cursorTexto = params.get("cursor");
  const cursor = cursorTexto ? decodificarCursor(cursorTexto) : null;
  if (cursorTexto && !cursor) return apiError("VALIDATION_ERROR", "cursor inválido.", 400);
  try {
    const r = await d.engine.listPendingAcceptancePage(d.tenantId, { cursor, limit: limite });
    const pedidos = await armar(d, r.items);
    return apiOk({ pedidos, siguiente: r.next ? codificarCursor(r.next) : null });
  } catch (err) {
    return errorPorAceptar(err);
  }
}

/**
 * GET detalle. Respuesta: { pedido, procesado, historial }.
 *   - pendiente de aceptación  → `pedido` completo, `procesado: null`;
 *   - ya procesado (pasó por la aceptación del negocio y otra persona —o el tiempo— lo cerró o aceptó)
 *     → `pedido: null`, `procesado` con el estado actual (sin datos del cliente);
 *   - cualquier otro pedido (de otro negocio, o que nunca pasó por la aceptación) → 404.
 */
export async function detallePorAceptar(d: PorAceptarCtx, pedido: string): Promise<Response> {
  if (!d.engine) return apiError("UNAVAILABLE", "Los pedidos no están activados.", 503);
  if (!PEDIDO_PUBLICO.test(pedido)) return noEncontrado();
  try {
    const found = await d.engine.panelOrder(d.tenantId, pedido);
    if (!found) return noEncontrado();
    const historia = await d.engine.orderHistory(d.tenantId, found.order);
    // Solo lo que está (o estuvo) pendiente de aceptación del negocio; cualquier otro pedido no es de esta vista.
    const pendiente = found.order.status === "pending_acceptance" && !!found.order.acceptance;
    if (!pendiente && !historia.some((h) => h.to === "pending_acceptance")) return noEncontrado();
    const ids = [...new Set(historia.flatMap((h) => (h.memberId !== null ? [h.memberId] : [])))];
    const nombres = ids.length && d.extras.fuentes.miembros ? await d.extras.fuentes.miembros(d.tenantId, ids).catch(() => new Map<number, string>()) : new Map<number, string>();
    const historial: HistorialPorAceptar[] = historia.map((h) => ({
      tipo: h.type,
      desde: h.from,
      hacia: h.to,
      actor: h.actor,
      miembro: h.memberId !== null ? (nombres.get(h.memberId) ?? `#${h.memberId}`) : null,
      motivo: h.reason,
      fecha: h.at,
    }));
    if (!pendiente) {
      // El último cambio que dejó al pedido en su estado actual (quién y cuándo).
      const ultimo = [...historial].reverse().find((h) => h.hacia === found.order.status) ?? null;
      const procesado: ProcesadoPorAceptar = { pedido: found.order.orderId, estado: found.order.status, fecha: ultimo?.fecha ?? null, por: ultimo?.miembro ?? null, motivo: ultimo?.motivo ?? null };
      return apiOk({ pedido: null, procesado, historial });
    }
    const [vista] = await armar(d, [found]);
    if (!vista) return noEncontrado();
    return apiOk({ pedido: vista, procesado: null, historial });
  } catch (err) {
    return errorPorAceptar(err);
  }
}

// ---------------------------------------------------------------------------
// Decisión humana: aceptar / rechazar / cancelar
// ---------------------------------------------------------------------------

/** ¿Este pedido pasó por la aceptación del negocio? (para que repetir una acción sobre uno CERRADO sea inocuo, pero solo sobre estos). */
async function vinoDeAceptacion(engine: OrderEngine, tenantId: string, order: Order): Promise<boolean> {
  const historia = await engine.orderHistory(tenantId, order).catch(() => []);
  return historia.some((h) => h.to === "pending_acceptance");
}

/**
 * Dos personas deciden A LA VEZ y esta perdió la carrera (la BD solo deja pasar a una: compare-and-set): si el pedido
 * ya quedó en el estado que se pedía, es lo mismo que repetir la acción (`repetido: true`, nada se duplica); si quedó
 * en otro (alguien rechazó mientras esta aceptaba), el error 409 se conserva y la pantalla muestra el estado actual.
 */
async function carreraPerdida(engine: OrderEngine, tenantId: string, pedido: string, destino: Order["status"], err: unknown): Promise<Response | null> {
  if (!(err instanceof OrderError) || (err.code !== "INVALID_TRANSITION" && err.code !== "CONFLICT")) return null;
  const ahora = await engine.panelOrder(tenantId, pedido).catch(() => null);
  if (!ahora || ahora.order.status !== destino || !(await vinoDeAceptacion(engine, tenantId, ahora.order))) return null;
  return apiOk({ pedido: ahora.order.orderId, estado: ahora.order.status, repetido: true, mensaje_cliente: null });
}

/**
 * Avisa a la Fase 3B.8 (si hay gancho) de una decisión aplicada y devuelve qué pasó con el mensaje al cliente (null = no hay
 * gancho). Nunca lanza: la decisión ya está tomada y no se deshace por un problema del mensaje.
 */
async function avisarDecision(d: PorAceptarCtx, order: Order, accion: AccionDecision, estado: Order["status"], motivo: string | null): Promise<MensajeAlCliente | null> {
  if (!d.alDecidir || !order.contact) return null;
  try {
    const r = await d.alDecidir({ tenantId: d.tenantId, pedido: order.orderId, accion, estado, miembroId: d.persona.miembroId, contacto: { phoneNumberId: order.contact.phoneNumberId, waId: order.contact.waId }, motivo });
    return r ?? null;
  } catch (err) {
    console.error("[catalogo/pedidos/por-aceptar] alDecidir:", err instanceof Error ? err.message : "?");
    return { estado: "no_disponible", motivo: null, repetida: false };
  }
}

export async function decidirPorAceptar(d: PorAceptarCtx, pedido: string, body: unknown): Promise<Response> {
  if (!d.engine) return apiError("UNAVAILABLE", "Los pedidos no están activados.", 503);
  if (!PEDIDO_PUBLICO.test(pedido)) return noEncontrado();
  const b = (body ?? {}) as { accion?: unknown; motivo?: unknown };
  if (typeof b.accion !== "string" || !(ACCIONES_DECISION as readonly string[]).includes(b.accion)) return apiError("VALIDATION_ERROR", "accion no válida.", 400);
  const accion = b.accion as AccionDecision;
  const motivo = typeof b.motivo === "string" ? b.motivo.trim() : "";
  if (accion !== "aceptar" && (motivo.length < 3 || motivo.length > 300)) return apiError("VALIDATION_ERROR", "Escribe el motivo (entre 3 y 300 caracteres).", 400);
  if (motivo.length > 300) return apiError("VALIDATION_ERROR", "El motivo admite máximo 300 caracteres.", 400);
  const engine = d.engine;
  try {
    // El pedido se busca SIEMPRE en el negocio de la sesión: uno de otro negocio es "no encontrado".
    const found = await engine.panelOrder(d.tenantId, pedido);
    if (!found || !found.order.contact) return noEncontrado();
    const order = found.order;
    // Configuración del negocio para ese número: sin ella (o inválida) no se decide nada (fail-closed).
    const config = await d.config(order.contact!.phoneNumberId).catch(() => null);
    if (!config) return apiError("UNAVAILABLE", "La aceptación de pedidos no está configurada para este negocio.", 503);
    if (!puedeDecidir(config, d.persona)) return apiError("FORBIDDEN", "No tienes permiso para aceptar o rechazar este pedido.", 403);

    if (accion === "aceptar") {
      if (order.status !== "pending_acceptance" && !(order.status === "confirmed" && (await vinoDeAceptacion(engine, d.tenantId, order)))) {
        return apiError("INVALID_TRANSITION", `El pedido ${order.orderId} no está pendiente de aceptación (estado: ${order.status}).`, 409);
      }
      // acceptOrder (nunca confirmOrder). Sin stock suficiente lanza y el pedido SIGUE pendiente.
      let r: Awaited<ReturnType<OrderEngine["acceptOrder"]>>;
      try {
        r = await engine.acceptOrder({ tenantId: d.tenantId, orderId: pedido, memberId: d.persona.miembroId, reservation: config.reservaTrasAceptar, reason: motivo || null });
      } catch (err) {
        const repetida = await carreraPerdida(engine, d.tenantId, pedido, "confirmed", err);
        if (repetida) return repetida;
        throw err;
      }
      const aviso = r.result !== "duplicate" ? await avisarDecision(d, order, "aceptar", r.order.status, motivo || null) : null;
      return apiOk({ pedido: r.order.orderId, estado: r.order.status, repetido: r.result === "duplicate", mensaje_cliente: aviso });
    }

    // Rechazar / cancelar: solo desde pendiente de aceptación (o repetir lo ya hecho sobre uno de estos).
    const destino = accion === "rechazar" ? "rejected" : "cancelled";
    if (order.status !== "pending_acceptance" && !(order.status === destino && (await vinoDeAceptacion(engine, d.tenantId, order)))) {
      return apiError("CONFLICT", "El pedido cambió mientras lo revisabas. Actualiza y vuelve a intentarlo.", 409);
    }
    let r: Awaited<ReturnType<OrderEngine["closeOrder"]>>;
    try {
      r = await engine.closeOrder({
        tenantId: d.tenantId,
        orderId: pedido,
        action: accion === "rechazar" ? "reject" : "cancel",
        memberId: d.persona.miembroId,
        reason: motivo,
        expectedStatus: "pending_acceptance",
      });
    } catch (err) {
      const repetida = await carreraPerdida(engine, d.tenantId, pedido, destino, err);
      if (repetida) return repetida;
      throw err;
    }
    const aviso = r.result !== "duplicate" ? await avisarDecision(d, order, accion, r.order.status, motivo) : null;
    return apiOk({ pedido: r.order.orderId, estado: r.order.status, repetido: r.result === "duplicate", mensaje_cliente: aviso });
  } catch (err) {
    return errorPorAceptar(err);
  }
}
