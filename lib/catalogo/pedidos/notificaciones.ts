/**
 * Bloque 31 — NOTIFICACIONES AUTOMÁTICAS DE ESTADO DE PEDIDOS POR WHATSAPP.
 *
 *   Dashboard -> acción -> backend valida (sesión, rol, módulo, compare-and-set, transición)
 *     -> motor + BD aplican el cambio -> ESTE módulo: ¿corresponde notificar? -> registro idempotente
 *     -> ventana de 24 h -> mensaje FIJO (sin IA) -> WhatsApp -> resultado registrado.
 *
 * Reglas:
 *   - Nunca antes del cambio: solo se llama DESPUÉS de que el motor aceptó la transición.
 *   - Sin Gemini: el texto es una plantilla determinista con datos reales del pedido (nombre,
 *     número, modalidad de entrega). Nunca inventa guías, fechas, transportadoras ni pagos.
 *   - Idempotente: una fila por (pedido, tipo) con clave única en la BD. Doble clic, recarga,
 *     reintento o dos pestañas: la segunda llamada encuentra la fila y NO vuelve a enviar.
 *   - Ventana de 24 h: solo se envía texto libre si el cliente escribió en las últimas 24 h
 *     (con margen). Si no: "ventana_vencida", sin llamar a Meta (se deja listo para una plantilla).
 *   - Si WhatsApp falla, el pedido NO se revierte: la notificación queda "fallida" con el error, y
 *     se puede reintentar (compare-and-set: un reintento nunca duplica).
 *   - Aislado por negocio: módulo "notificaciones_pedidos" del tenant, y el número de WhatsApp del
 *     pedido debe ser de ESE negocio. No toca la IA, las pausas ni la asignación del chat.
 */
import type { Order } from "@/lib/catalogo/pedidos/contrato";

export const TIPOS_NOTIFICACION = ["pago_recibido", "en_preparacion", "enviado", "entregado", "completado", "cancelado", "rechazado"] as const;
export type TipoNotificacion = (typeof TIPOS_NOTIFICACION)[number];

export type EstadoNotificacion = "pendiente" | "enviando" | "enviada" | "fallida" | "ventana_vencida" | "desconocido" | "omitida";

/** Motivos de "omitida" / "ventana_vencida" (cerrados, sin datos personales). */
export type MotivoNotificacion = "sin_contacto" | "telefono_invalido" | "sin_canal" | "sin_token" | "ventana_vencida" | "meta_ventana_cerrada";

export interface RegistroNotificacion {
  id: number;
  tipo: TipoNotificacion;
  estadoDesde: string | null;
  estadoHacia: string;
  estado: EstadoNotificacion;
  motivo: string | null;
  errorCodigo: string | null;
  errorMensaje: string | null;
  messageId: string | null;
  intentos: number;
  miembroId: number | null;
  enviadaAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lo que ve el panel después de una acción. */
export type ResultadoNotificacion =
  | { estado: "desactivada" }
  | { estado: "no_disponible" }
  | { estado: EstadoNotificacion; tipo: TipoNotificacion; motivo: string | null; repetida: boolean };

/** Acción del panel -> tipo de notificación (una por transición real). */
export const TIPO_POR_ACCION: Readonly<Record<string, TipoNotificacion>> = {
  pago_recibido: "pago_recibido",
  en_preparacion: "en_preparacion",
  enviado: "enviado",
  entregado: "entregado",
  completar: "completado",
  cancelar: "cancelado",
  rechazar: "rechazado",
};

// ---------------------------------------------------------------------------
// Ventana de 24 h (una sola función central)
// ---------------------------------------------------------------------------

/** 24 h de Meta menos un margen: un envío que sale en el último minuto no debe llegar tarde. */
export const VENTANA_MS = 24 * 60 * 60_000;
export const MARGEN_VENTANA_MS = 10 * 60_000;

/**
 * ¿Se puede enviar un mensaje LIBRE a este contacto? Solo si el CLIENTE escribió (mensaje entrante)
 * dentro de las últimas 24 h (menos el margen). Sin mensajes del cliente: no.
 */
export function ventanaConversacion(ultimoEntrante: string | null, ahora: number): { abierta: boolean; motivo: "sin_mensajes_del_cliente" | "vencida" | null; venceEn: number | null } {
  if (!ultimoEntrante) return { abierta: false, motivo: "sin_mensajes_del_cliente", venceEn: null };
  const t = Date.parse(ultimoEntrante);
  if (!Number.isFinite(t)) return { abierta: false, motivo: "sin_mensajes_del_cliente", venceEn: null };
  const venceEn = t + VENTANA_MS - MARGEN_VENTANA_MS;
  return ahora < venceEn ? { abierta: true, motivo: null, venceEn } : { abierta: false, motivo: "vencida", venceEn };
}

// ---------------------------------------------------------------------------
// Mensajes (fijos, sin IA)
// ---------------------------------------------------------------------------

export interface DatosMensaje {
  nombre: string | null;
  pedido: string;
  entrega: "tienda" | "domicilio" | null;
  negocio: string | null;
}

function saludo(nombre: string | null, carinoso: boolean): string {
  const n = nombre?.trim().split(/\s+/)[0] ?? "";
  const limpio = n.length >= 2 && n.length <= 30 ? n : "";
  if (carinoso) return limpio ? `Hola, ${limpio} 💖` : "Hola 💖";
  return limpio ? `Hola, ${limpio}.` : "Hola.";
}

/** Texto de la notificación. Solo usa datos reales del pedido; nada inventado. */
export function mensajeNotificacion(tipo: TipoNotificacion, d: DatosMensaje): string {
  const ref = `*${d.pedido}*`;
  const negocio = d.negocio?.trim() || "nuestra tienda";
  const tienda = d.entrega === "tienda";
  switch (tipo) {
    case "pago_recibido":
      return `${saludo(d.nombre, true)}\n\n¡Gracias! Te confirmamos que recibimos el pago de tu pedido ${ref}. ✨\n\nContinuamos con la preparación y te iremos contando por este medio cómo avanza.`;
    case "en_preparacion":
      return `${saludo(d.nombre, true)}\n\nTu pedido ${ref} ya está en preparación. 📦\n\n${tienda ? "Te avisaremos por este medio cualquier novedad." : "Te avisaremos cuando sea enviado."}`;
    case "enviado":
      return `${saludo(d.nombre, true)}\n\n¡Tenemos una actualización! Tu pedido ${ref} ya fue enviado. 📦\n\nTe avisaremos cuando tengamos la siguiente actualización.`;
    case "entregado":
      return tienda
        ? `${saludo(d.nombre, true)}\n\nTu pedido ${ref} fue entregado en la tienda. 🛍️\n\nEsperamos que disfrutes mucho tu compra. ¡Gracias por confiar en ${negocio}! 💖`
        : `${saludo(d.nombre, true)}\n\nTu pedido ${ref} figura como entregado. 📦\n\nEsperamos que disfrutes mucho tu compra. ¡Gracias por confiar en ${negocio}! 💖`;
    case "completado":
      return `${saludo(d.nombre, true)}\n\nTu pedido ${ref} ha sido completado.\n\n¡Gracias por comprar en ${negocio}! ✨`;
    case "cancelado":
      return `${saludo(d.nombre, false)}\n\nTe informamos que tu pedido ${ref} fue cancelado.\n\nSi tienes alguna inquietud, responde este mensaje y una asesora te ayudará.`;
    case "rechazado":
      return `${saludo(d.nombre, false)}\n\nTe informamos que tu pedido ${ref} no pudo continuar y fue rechazado.\n\nSi necesitas ayuda, responde este mensaje y una asesora te atenderá.`;
  }
}

// ---------------------------------------------------------------------------
// Dependencias (inyectables: memoria en pruebas, Supabase + Meta en producción)
// ---------------------------------------------------------------------------

export interface CanalWhatsapp {
  phoneNumberId: string;
  token: string | null;
  nombreNegocio: string | null;
}

export interface NotificacionesStore {
  /** Módulo "notificaciones_pedidos" del negocio (encendido solo para quien corresponda). */
  habilitado(tenantId: string): Promise<boolean>;
  /**
   * Crea la fila (pedido, tipo) en estado "enviando" si no existe. Si ya existe, la devuelve SIN
   * crear otra (candado de idempotencia: clave única en la BD). null = la tabla no existe todavía.
   */
  reservar(input: {
    tenantId: string;
    pedidoId: string;
    pedidoPublico: string;
    tipo: TipoNotificacion;
    estadoDesde: string | null;
    estadoHacia: string;
    phoneNumberId: string | null;
    telefono: string | null;
    miembroId: number | null;
  }): Promise<{ creada: boolean; registro: RegistroNotificacion } | null>;
  /** Compare-and-set: pasa de `desde` a `hacia` solo si la fila sigue en `desde`. Devuelve la fila o null si otro ganó. */
  cambiar(tenantId: string, id: number, desde: readonly EstadoNotificacion[], cambios: Partial<Pick<RegistroNotificacion, "estado" | "motivo" | "errorCodigo" | "errorMensaje" | "messageId" | "enviadaAt">> & { sumarIntento?: boolean }): Promise<RegistroNotificacion | null>;
  listar(tenantId: string, pedidoId: string): Promise<RegistroNotificacion[]>;
  /** Canal del pedido: el número debe pertenecer a ESTE negocio (si no, null). */
  canal(tenantId: string, phoneNumberId: string): Promise<CanalWhatsapp | null>;
  /** Último mensaje ENTRANTE del cliente en ese número (ISO) o null. */
  ultimoEntrante(phoneNumberId: string, telefono: string): Promise<string | null>;
}

export class ErrorEnvioWhatsapp extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    /** true = no se sabe si Meta lo entregó (timeout, red): reintentar podría duplicar. */
    readonly incierto: boolean,
    /** Meta dice que la ventana de 24 h está cerrada (131047). */
    readonly ventanaCerrada = false,
  ) {
    super(mensaje);
    this.name = "ErrorEnvioWhatsapp";
  }
}

export interface EnviadorWhatsapp {
  /** Envía el texto; devuelve el message_id de Meta o lanza ErrorEnvioWhatsapp. */
  enviar(canal: CanalWhatsapp, telefono: string, texto: string): Promise<{ messageId: string | null }>;
  /** Registra el mensaje en el Inbox (historial) como mensaje del negocio. Mejor esfuerzo. */
  registrar(canal: CanalWhatsapp, telefono: string, texto: string, messageId: string | null): Promise<void>;
}

export interface NotificadorDeps {
  store: NotificacionesStore;
  enviador: EnviadorWhatsapp;
  now?: () => number;
  log?: (entry: Record<string, unknown>) => void;
}

const TELEFONO = /^[0-9]{8,15}$/;

function estadoVisibleDe(o: Order): string {
  if (o.status === "completed") return "completado";
  if (o.status === "cancelled") return "cancelado";
  if (o.status === "rejected") return "rechazado";
  if (o.status === "expired") return "vencido";
  return o.checkout?.stage ?? o.status;
}

function resumen(r: RegistroNotificacion, repetida: boolean): ResultadoNotificacion {
  return { estado: r.estado, tipo: r.tipo, motivo: r.motivo, repetida };
}

/**
 * Notifica UNA transición ya aplicada. `antes` = el pedido que la persona vio; `despues` = el pedido
 * tras el cambio. Nunca lanza: cualquier problema queda registrado en la fila y en el resultado.
 */
export async function notificarTransicion(
  deps: NotificadorDeps,
  input: { tenantId: string; tipo: TipoNotificacion; antes: Order | null; despues: Order; miembroId: number | null },
): Promise<ResultadoNotificacion> {
  const log = deps.log ?? (() => {});
  const { store } = deps;
  const o = input.despues;
  try {
    if (!(await store.habilitado(input.tenantId))) return { estado: "desactivada" };
    const contacto = o.contact;
    const telefono = contacto && TELEFONO.test(contacto.waId) ? contacto.waId : null;
    const reserva = await store.reservar({
      tenantId: input.tenantId,
      pedidoId: o.id,
      pedidoPublico: o.orderId,
      tipo: input.tipo,
      estadoDesde: input.antes ? (input.tipo === "pago_recibido" ? `pago_${input.antes.checkout?.paymentStatus ?? "pendiente"}` : estadoVisibleDe(input.antes)) : null,
      estadoHacia: input.tipo === "pago_recibido" ? "pago_recibido" : estadoVisibleDe(o),
      phoneNumberId: contacto?.phoneNumberId ?? null,
      telefono,
      miembroId: input.miembroId,
    });
    if (!reserva) return { estado: "no_disponible" };
    // Ya existía: doble clic, recarga, reintento o dos pestañas. NUNCA se vuelve a enviar aquí.
    if (!reserva.creada) return resumen(reserva.registro, true);
    return await intentarEnvio(deps, input.tenantId, o, reserva.registro, false);
  } catch (err) {
    log({ log: "pedido_notificacion", result: "error", pedido: o.orderId, tipo: input.tipo, detalle: err instanceof Error ? err.message.slice(0, 120) : "?" });
    return { estado: "no_disponible" };
  }
}

/** Envía (o decide no enviar) sobre una fila que ESTA ejecución tiene en "enviando". */
async function intentarEnvio(deps: NotificadorDeps, tenantId: string, o: Order, r: RegistroNotificacion, repetida: boolean): Promise<ResultadoNotificacion> {
  const { store, enviador } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const cerrar = async (cambios: Parameters<NotificacionesStore["cambiar"]>[3]) => {
    const fila = await store.cambiar(tenantId, r.id, ["enviando"], cambios);
    const final = fila ?? { ...r, ...cambios };
    log({ log: "pedido_notificacion", pedido: o.orderId, tipo: r.tipo, result: final.estado, motivo: final.motivo ?? null, error: final.errorCodigo ?? null });
    return resumen(final as RegistroNotificacion, repetida);
  };
  const contacto = o.contact;
  if (!contacto) return cerrar({ estado: "omitida", motivo: "sin_contacto" });
  if (!TELEFONO.test(contacto.waId)) return cerrar({ estado: "omitida", motivo: "telefono_invalido" });
  const canal = await store.canal(tenantId, contacto.phoneNumberId);
  // El número del pedido debe ser de ESTE negocio: nunca se escribe con el número de otro.
  if (!canal) return cerrar({ estado: "omitida", motivo: "sin_canal" });
  if (!canal.token) return cerrar({ estado: "omitida", motivo: "sin_token" });
  const ventana = ventanaConversacion(await store.ultimoEntrante(contacto.phoneNumberId, contacto.waId), now());
  if (!ventana.abierta) return cerrar({ estado: "ventana_vencida", motivo: "ventana_vencida" });
  const texto = mensajeNotificacion(r.tipo, { nombre: o.checkout?.customerName ?? null, pedido: o.orderId, entrega: o.checkout?.delivery ?? null, negocio: canal.nombreNegocio });
  try {
    const { messageId } = await enviador.enviar(canal, contacto.waId, texto);
    await enviador.registrar(canal, contacto.waId, texto, messageId).catch(() => undefined);
    return cerrar({ estado: "enviada", motivo: null, errorCodigo: null, errorMensaje: null, messageId, enviadaAt: new Date(now()).toISOString(), sumarIntento: true });
  } catch (err) {
    const e = err instanceof ErrorEnvioWhatsapp ? err : new ErrorEnvioWhatsapp("desconocido", err instanceof Error ? err.message : "error", true);
    if (e.ventanaCerrada) return cerrar({ estado: "ventana_vencida", motivo: "meta_ventana_cerrada", errorCodigo: e.codigo, errorMensaje: e.message.slice(0, 300), sumarIntento: true });
    return cerrar({ estado: e.incierto ? "desconocido" : "fallida", motivo: null, errorCodigo: e.codigo, errorMensaje: e.message.slice(0, 300), sumarIntento: true });
  }
}

/** Estados desde los que el equipo puede reintentar (nunca "enviada"). "desconocido": solo pasado un rato. */
export const REINTENTABLES: readonly EstadoNotificacion[] = ["fallida", "ventana_vencida", "omitida", "desconocido"];
export const ESPERA_REINTENTO_INCIERTO_MS = 10 * 60_000;

/** ¿La notificación sigue describiendo el estado ACTUAL del pedido? (no se reenvía algo ya superado) */
export function sigueVigente(tipo: TipoNotificacion, o: Order): boolean {
  if (tipo === "pago_recibido") return o.checkout?.paymentStatus === "recibido" && (o.status === "confirmed" || o.status === "completed");
  if (tipo === "completado") return o.status === "completed";
  if (tipo === "cancelado") return o.status === "cancelled";
  if (tipo === "rechazado") return o.status === "rejected";
  return o.status === "confirmed" && o.checkout?.stage === tipo;
}

/**
 * Reintento pedido por el equipo desde el panel. Toma la fila con compare-and-set (de un estado
 * reintentable a "enviando"): dos clics o dos personas a la vez => solo UNO envía.
 */
export async function reintentarNotificacion(
  deps: NotificadorDeps,
  input: { tenantId: string; tipo: TipoNotificacion; pedido: Order },
): Promise<ResultadoNotificacion | { estado: "no_reintentable"; motivo: string }> {
  const now = deps.now ?? Date.now;
  if (!(await deps.store.habilitado(input.tenantId))) return { estado: "desactivada" };
  const filas = await deps.store.listar(input.tenantId, input.pedido.id);
  const r = filas.find((f) => f.tipo === input.tipo);
  if (!r) return { estado: "no_reintentable", motivo: "No hay una notificación de ese tipo para este pedido." };
  if (r.estado === "enviada") return { estado: "no_reintentable", motivo: "Esa notificación ya fue enviada." };
  if (!sigueVigente(input.tipo, input.pedido)) return { estado: "no_reintentable", motivo: "El pedido ya cambió de estado: esa notificación ya no aplica." };
  if (!(REINTENTABLES as readonly string[]).includes(r.estado)) return { estado: "no_reintentable", motivo: "La notificación se está enviando en este momento." };
  if (r.estado === "desconocido" && now() - Date.parse(r.updatedAt) < ESPERA_REINTENTO_INCIERTO_MS) {
    return { estado: "no_reintentable", motivo: "No se sabe si el mensaje llegó. Revisa el chat y vuelve a intentar en unos minutos." };
  }
  const tomada = await deps.store.cambiar(input.tenantId, r.id, [r.estado], { estado: "enviando" });
  if (!tomada) return { estado: "no_reintentable", motivo: "Otra persona está reintentando esta notificación." };
  return intentarEnvio(deps, input.tenantId, input.pedido, tomada, false);
}

// ---------------------------------------------------------------------------
// Memoria (pruebas)
// ---------------------------------------------------------------------------

export function createMemoryNotificacionesStore(opts: { habilitados?: string[]; canales?: Record<string, CanalWhatsapp & { tenantId: string }>; now?: () => number } = {}) {
  const filas: Array<RegistroNotificacion & { tenantId: string; pedidoId: string }> = [];
  const entrantes = new Map<string, string>();
  const habilitados = new Set(opts.habilitados ?? []);
  const canales = new Map(Object.entries(opts.canales ?? {}));
  const now = opts.now ?? Date.now;
  let seq = 0;
  let disponible = true;
  const iso = () => new Date(now()).toISOString();
  const store: NotificacionesStore = {
    async habilitado(tenantId) {
      return habilitados.has(tenantId);
    },
    async reservar(i) {
      if (!disponible) return null;
      const existente = filas.find((f) => f.pedidoId === i.pedidoId && f.tipo === i.tipo);
      if (existente) return { creada: false, registro: { ...existente } };
      const r = {
        id: ++seq,
        tenantId: i.tenantId,
        pedidoId: i.pedidoId,
        tipo: i.tipo,
        estadoDesde: i.estadoDesde,
        estadoHacia: i.estadoHacia,
        estado: "enviando" as EstadoNotificacion,
        motivo: null,
        errorCodigo: null,
        errorMensaje: null,
        messageId: null,
        intentos: 0,
        miembroId: i.miembroId,
        enviadaAt: null,
        createdAt: iso(),
        updatedAt: iso(),
      };
      filas.push(r);
      return { creada: true, registro: { ...r } };
    },
    async cambiar(tenantId, id, desde, cambios) {
      const f = filas.find((x) => x.id === id && x.tenantId === tenantId);
      if (!f || !desde.includes(f.estado)) return null;
      const { sumarIntento, ...resto } = cambios;
      Object.assign(f, resto, { updatedAt: iso() });
      if (sumarIntento) f.intentos++;
      return { ...f };
    },
    async listar(tenantId, pedidoId) {
      return filas.filter((f) => f.tenantId === tenantId && f.pedidoId === pedidoId).map((f) => ({ ...f }));
    },
    async canal(tenantId, phoneNumberId) {
      const c = canales.get(phoneNumberId);
      return c && c.tenantId === tenantId ? { phoneNumberId: c.phoneNumberId, token: c.token, nombreNegocio: c.nombreNegocio } : null;
    },
    async ultimoEntrante(phoneNumberId, telefono) {
      return entrantes.get(`${phoneNumberId}|${telefono}`) ?? null;
    },
  };
  return {
    store,
    filas,
    habilitar: (tenantId: string, on = true) => (on ? habilitados.add(tenantId) : habilitados.delete(tenantId)),
    entrante: (phoneNumberId: string, telefono: string, at: string) => entrantes.set(`${phoneNumberId}|${telefono}`, at),
    sinTabla: () => (disponible = false),
  };
}
