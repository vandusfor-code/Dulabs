/**
 * FASE 3B.8 — MENSAJE AL CLIENTE TRAS UNA DECISIÓN HUMANA (aceptar, rechazar, cancelar) sobre un pedido pendiente de aceptación.
 *
 *   decisión de una persona autorizada (3B.7: el estado YA cambió, por las operaciones de siempre)
 *     -> ¿hay texto del NEGOCIO para esa decisión? (checkout_opciones.cierre.textos.aceptado | rechazado | cancelado)
 *     -> se completa con {pedido} y, si la plantilla lo pide, el motivo que registró esa persona (nunca uno inventado)
 *     -> módulo "notificaciones_pedidos" del negocio (si no está activo, no se envía nada)
 *     -> candado IDEMPOTENTE en la BD: una fila por (pedido, tipo de mensaje), clave única: un doble clic, un reintento, un
 *        webhook repetido o dos procesos NUNCA mandan dos veces el mismo mensaje (no depende de la memoria del proceso)
 *     -> ventana de 24 h de WhatsApp, número del negocio, token propio -> texto EXACTO -> resultado registrado.
 *
 * Qué NO hace, por diseño:
 *   - no cambia el estado del pedido (no lo acepta, confirma, reserva, completa ni despacha): solo informa lo ya decidido;
 *   - no inventa texto: sin texto configurado no envía nada; no promete fechas, despacho, stock ni alternativas;
 *   - no usa texto de otro negocio: la configuración se lee por (negocio de la sesión, número del pedido) y el número debe ser
 *     del mismo negocio;
 *   - no usa el modelo ni algo que el modelo pueda influir; no incluye datos del cliente, ni el documento;
 *   - nunca lanza: cualquier problema queda en el resultado (la decisión ya está tomada y no se deshace).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order } from "@/lib/catalogo/pedidos/contrato";
import type { OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { notificarTransicion, type NotificadorDeps, type ResultadoNotificacion, type TipoNotificacion } from "@/lib/catalogo/pedidos/notificaciones";
import { productionNotificador } from "@/lib/catalogo/pedidos/notificaciones-produccion";
import type { DecisionPorAceptar, MensajeAlCliente } from "@/lib/catalogo/pedidos/por-aceptar";
import type { ConfigAceptacion } from "@/lib/agente/aceptacion-humana";
import { CLAVE_TEXTO_DECISION, renderizarTextoDecision, type DecisionConTexto } from "@/lib/agente/textos-cliente";

/** Tipo de mensaje (y fila del candado de idempotencia) de cada decisión. */
export const TIPO_MENSAJE_DECISION: Readonly<Record<DecisionConTexto, TipoNotificacion>> = Object.freeze({ aceptar: "aceptado", rechazar: "rechazado", cancelar: "cancelado" });

/** Estados en que el pedido describe esa decisión (el mensaje solo sale si el pedido realmente quedó así). */
const ESTADOS_DE_LA_DECISION: Readonly<Record<DecisionConTexto, readonly Order["status"][]>> = Object.freeze({
  aceptar: ["confirmed", "completed"],
  rechazar: ["rejected"],
  cancelar: ["cancelled"],
});

export type MotivoSinMensaje = "sin_pedido" | "estado_no_coincide" | "sin_configuracion" | "sin_texto" | "plantilla_invalida" | "pedido_invalido" | "sin_motivo" | "motivo_sensible";

export type ResultadoMensajeDecision = ResultadoNotificacion | { estado: "no_aplica"; motivo: MotivoSinMensaje };

export interface MensajesDecisionDeps {
  engine: Pick<OrderEngine, "panelOrder">;
  /** Configuración de aceptación del negocio para ese número; null = no usa la aceptación humana o no es válida. */
  config: (tenantId: string, phoneNumberId: string) => Promise<ConfigAceptacion | null>;
  /** Candado idempotente (tabla dulabs_catalogo_pedido_notificaciones), canal, ventana de 24 h y envío. */
  notificador: NotificadorDeps;
  /** Registro SIN datos personales. */
  log?: (entry: Record<string, unknown>) => void;
}

const logPorDefecto = (entry: Record<string, unknown>) => console.info(JSON.stringify({ log: "decision_message", ...entry }));

/**
 * Informa al cliente de una decisión YA aplicada. Idempotente por (pedido, decisión). Nunca lanza.
 * `d.tenantId` es el negocio de la SESIÓN que decidió (nunca uno que llegue en la petición ni del modelo).
 */
export async function enviarMensajeDecision(deps: MensajesDecisionDeps, d: DecisionPorAceptar): Promise<ResultadoMensajeDecision> {
  const log = deps.log ?? logPorDefecto;
  const sinMensaje = (motivo: MotivoSinMensaje): ResultadoMensajeDecision => {
    log({ business_id: d.tenantId, order_id: d.pedido, decision: d.accion, resultado: "no_aplica", motivo });
    return { estado: "no_aplica", motivo };
  };
  try {
    // El pedido se lee SIEMPRE en el negocio de la sesión: uno de otro negocio no existe aquí.
    const found = await deps.engine.panelOrder(d.tenantId, d.pedido);
    const order = found?.order;
    if (!order || order.businessId !== d.tenantId || !order.contact) return sinMensaje("sin_pedido");
    // Solo se informa lo que ya pasó: el pedido debe estar realmente en el estado de esa decisión.
    if (!ESTADOS_DE_LA_DECISION[d.accion].includes(order.status)) return sinMensaje("estado_no_coincide");
    // Texto del NEGOCIO dueño de ese número (nunca de otro, nunca uno por defecto).
    const config = await deps.config(d.tenantId, order.contact.phoneNumberId);
    if (!config) return sinMensaje("sin_configuracion");
    const plantilla = config.textosDecision?.[CLAVE_TEXTO_DECISION[d.accion]] ?? null;
    if (!plantilla) return sinMensaje("sin_texto");
    const texto = renderizarTextoDecision(CLAVE_TEXTO_DECISION[d.accion], plantilla, { pedido: order.orderId, motivo: d.motivo });
    if (!texto.ok) return sinMensaje(texto.motivo);
    const r = await notificarTransicion(deps.notificador, { tenantId: d.tenantId, tipo: TIPO_MENSAJE_DECISION[d.accion], antes: null, despues: order, miembroId: d.miembroId, texto: texto.texto });
    log({ business_id: d.tenantId, order_id: order.orderId, decision: d.accion, resultado: r.estado, motivo: "motivo" in r ? (r.motivo ?? undefined) : undefined, repetida: "repetida" in r ? r.repetida : undefined });
    return r;
  } catch (err) {
    log({ business_id: d.tenantId, order_id: d.pedido, decision: d.accion, resultado: "error", detalle: err instanceof Error ? err.message.slice(0, 80) : "?" });
    return { estado: "no_disponible" };
  }
}

/** Lo que ve la persona que decidió (el panel): qué pasó con el mensaje al cliente. */
export function aMensajeAlCliente(r: ResultadoMensajeDecision): MensajeAlCliente {
  if (r.estado === "no_aplica") return { estado: "no_aplica", motivo: r.motivo, repetida: false };
  if (r.estado === "desactivada" || r.estado === "no_disponible") return { estado: r.estado, motivo: null, repetida: false };
  return { estado: r.estado, motivo: r.motivo, repetida: r.repetida };
}

/**
 * Cableado de PRODUCCIÓN: BD de Supabase (candado idempotente), módulo "notificaciones_pedidos", token propio del número y Meta
 * Cloud API. Es el gancho alDecidir de las rutas de "Por aceptar". Sin motor de pedidos no hay gancho (nada que informar).
 */
export function productionMensajesDecision(input: { supabase: SupabaseClient; engine: Pick<OrderEngine, "panelOrder"> | null; config: MensajesDecisionDeps["config"] }): ((d: DecisionPorAceptar) => Promise<MensajeAlCliente>) | null {
  if (!input.engine) return null;
  const deps: MensajesDecisionDeps = { engine: input.engine, config: input.config, notificador: productionNotificador(input.supabase) };
  return async (d) => aMensajeAlCliente(await enviarMensajeDecision(deps, d));
}
