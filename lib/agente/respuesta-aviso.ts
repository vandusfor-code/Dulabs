/**
 * FASE 3B.5 — EL CLIENTE RESPONDE "SÍ" DESPUÉS DEL AVISO OBLIGATORIO.
 *
 * Eso NO confirma la venta. Solo es información para la persona responsable:
 *   - se registra UNA vez (respuesta_cliente_at) en el pedido pendiente de aceptación;
 *   - si nadie del equipo le había escrito al cliente, el sistema envía UNA respuesta fija del negocio
 *     ("la persona encargada continuará con tu pedido…");
 *   - no cambia el estado del pedido, no aparta stock, no confirma nada y no ejecuta acceptOrder.
 *
 * Es una puerta del webhook que corre ANTES de la pausa de la conversación (el traspaso a la persona la dejó
 * en pausa) y solo toma el mensaje si TODO esto se cumple; si no, el mensaje sigue su camino de siempre
 * (silencio por pausa, o el agente — que NO atiende una conversación con un pedido pendiente: ver
 * `pendingAcceptance` en lib/agente/webhook.ts):
 *   1) el texto es una confirmación clara y corta (nada de preguntas, negaciones ni cambios);
 *   2) el negocio usa la aceptación humana (configuración válida) y la IA del número no está pausada;
 *   3) hay un pedido pendiente de aceptación de ESA conversación, de ESE negocio, con el aviso ya enviado.
 *
 * FAIL-CLOSED respecto a la venta: una vez que se sabe que hay un pedido pendiente CON aviso, cualquier error
 * posterior (registrar el "sí", comprobar si una persona escribió, enviar) deja el mensaje en SILENCIO
 * (`handled: true`): nunca abre otro camino (otro agente, otro flujo, el modelo). Antes de saberlo (error al leer la
 * configuración o buscar el pedido) el mensaje sigue su camino y la barrera del agente decide con su propia lectura.
 *
 * La intervención humana tiene prioridad: si una persona ya le escribió al cliente (ver `createSupabaseHumanEvidence`),
 * se registra su "sí" pero NO se le responde (salvo que el negocio haya elegido lo contrario, D11). Si no se puede
 * comprobar con certeza, tampoco se responde.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order } from "@/lib/catalogo/pedidos/contrato";
import { OrderError, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import type { ConfigAceptacion } from "@/lib/agente/aceptacion-humana";

// ---------------------------------------------------------------------------
// ¿Es una confirmación? (determinista, estricta)
// ---------------------------------------------------------------------------

const plano = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Palabras que SOLAS afirman. */
const NUCLEO = new Set(["si", "sip", "sipi", "claro", "confirmo", "confirmado", "seguro", "segura", "correcto", "dale", "ok", "okay", "listo", "acepto", "perfecto", "vale", "adelante", "afirmativo", "exacto", "supuesto", "obvio", "recibo", "recibirlo", "recibirla"]);
/** Palabras que pueden acompañar una afirmación sin cambiarla. */
const RELLENO = new Set(["estoy", "100", "lo", "la", "voy", "a", "que", "de", "por", "acuerdo", "totalmente", "completamente", "absolutamente", "pedido", "mi", "el", "pues", "ya", "y", "gracias", "favor", "muy", "bien", "esta", "asi", "es", "eso", "todo", "yo", "recibir", "tengo", "disponibilidad", "dinero"]);
/** Cualquiera de estas palabras convierte el mensaje en otra cosa (pregunta, duda, cambio, negación, incertidumbre). */
const NO_ES = new Set(["no", "nunca", "tampoco", "todavia", "aun", "pero", "cambia", "cambiar", "cancela", "cancelar", "quiero", "quisiera", "duda", "pregunta", "cuando", "cuanto", "cuantos", "donde", "como", "cual", "porque", "puedo", "hay", "espera", "esperame", "mejor", "aunque", "sin", "solo", "tal", "vez", "quiza", "quizas", "creo", "depende", "ni", "dejame", "mirar", "pensar", "pienso", "veo", "ver", "supongo", "parece"]);

/**
 * ¿El mensaje confirma, sin condiciones, lo que preguntó el aviso ("¿estás 100% seguro de recibirlo?")?
 * "Sí", "confirmo", "estoy 100% seguro", "claro que sí" => true. "Creo que sí", "tal vez", "déjame mirar", "Sí, pero
 * ¿cuándo llega?", "no estoy seguro", un texto largo o un emoji solo => false.
 */
export function esConfirmacionTrasAviso(text: string): boolean {
  if (!text || text.length > 80 || /[?¿]/.test(text)) return false;
  const palabras = plano(text)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (palabras.length === 0 || palabras.length > 10) return false;
  if (palabras.some((p) => NO_ES.has(p))) return false;
  return palabras.some((p) => NUCLEO.has(p)) && palabras.every((p) => NUCLEO.has(p) || RELLENO.has(p));
}

// ---------------------------------------------------------------------------
// ¿Una persona del equipo ya le escribió al cliente? (evidencia, no una hora)
// ---------------------------------------------------------------------------

/**
 * Evidencia de que una PERSONA del equipo escribió en la conversación desde `sinceIso` (la creación del pedido).
 * Dos fuentes independientes, cualquiera basta:
 *   1) el historial de mensajes (dulabs_mensajes_log): salientes con origen "agente" (Inbox del dashboard) o "manual"
 *      (la persona respondió desde el celular del negocio: eco de coexistencia). El bot escribe con origen "ia"; las
 *      campañas y los envíos automáticos tienen otro origen: no cuentan;
 *   2) la bitácora de la conversación (dulabs_conversacion_eventos): "mensaje_enviado" (Inbox y plantillas), con la
 *      persona que lo envió — sirve aunque el registro del mensaje no se hubiera guardado.
 * Cualquier duda => true ("una persona ya escribió" => NO se responde automáticamente): un error de lectura de
 * cualquiera de las dos fuentes, o una fecha inválida. Solo un resultado limpio de AMBAS fuentes dice false.
 */
export function createSupabaseHumanEvidence(supabase: SupabaseClient): (phoneNumberId: string, waId: string, sinceIso: string) => Promise<boolean> {
  return async (phoneNumberId, waId, sinceIso) => {
    if (Number.isNaN(Date.parse(sinceIso))) return true;
    try {
      const [mensajes, eventos] = await Promise.all([
        supabase.from("dulabs_mensajes_log").select("id").eq("phone_number_id", phoneNumberId).eq("telefono_cliente", waId).eq("direccion", "saliente").in("origen", ["manual", "agente"]).gte("created_at", sinceIso).limit(1),
        supabase.from("dulabs_conversacion_eventos").select("id").eq("phone_number_id", phoneNumberId).eq("telefono_cliente", waId).eq("tipo", "mensaje_enviado").gte("created_at", sinceIso).limit(1),
      ]);
      if (mensajes.error || eventos.error) return true;
      return (mensajes.data ?? []).length > 0 || (eventos.data ?? []).length > 0;
    } catch {
      return true;
    }
  };
}

// ---------------------------------------------------------------------------
// La puerta
// ---------------------------------------------------------------------------

export type ResultadoRespuestaAviso =
  | { handled: false; motivo: "no_es_confirmacion" | "sin_configuracion" | "sin_pedido_pendiente" | "sin_aviso" | "error" }
  | { handled: true; accion: "respondida" | "registrada_sin_respuesta" | "ya_registrada" | "silencio_por_error" };

export interface RespuestaAvisoDeps {
  /** Configuración de aceptación del negocio para ese número; null = no usa la aceptación humana o no es válida. */
  config: (tenantId: string, phoneNumberId: string) => Promise<ConfigAceptacion | null>;
  engine: Pick<OrderEngine, "pendingAcceptanceFor" | "recordCustomerReplyOnce">;
  /** ¿Una persona del equipo (Inbox o celular) le escribió a este cliente desde `sinceIso`? (createSupabaseHumanEvidence) */
  humanWroteSince: (phoneNumberId: string, waId: string, sinceIso: string) => Promise<boolean>;
  sendText: (text: string) => Promise<{ sent: boolean }>;
  /** Registro SIN datos personales. */
  log?: (entry: Record<string, unknown>) => void;
}

const logPorDefecto = (entry: Record<string, unknown>) => console.info(JSON.stringify({ log: "acceptance_reply", ...entry }));

export async function atenderRespuestaTrasAviso(
  input: { tenantId: string; phoneNumberId: string; waId: string; text: string },
  deps: RespuestaAvisoDeps,
): Promise<ResultadoRespuestaAviso> {
  const log = deps.log ?? logPorDefecto;
  if (!esConfirmacionTrasAviso(input.text)) return { handled: false, motivo: "no_es_confirmacion" };
  const contact = { phoneNumberId: input.phoneNumberId, waId: input.waId };
  let config: ConfigAceptacion;
  let order: Order;
  // Fase A — ¿es una conversación con un pedido pendiente CON aviso de un negocio con aceptación humana? Un error aquí
  // todavía no dice nada: el mensaje sigue su camino y la barrera del agente decide con su propia lectura.
  try {
    const cfg = await deps.config(input.tenantId, input.phoneNumberId);
    if (!cfg) return { handled: false, motivo: "sin_configuracion" };
    config = cfg;
    // Solo un pedido de ESTA conversación y de ESTE negocio (el repositorio filtra por negocio).
    const pendiente = await deps.engine.pendingAcceptanceFor({ tenantId: input.tenantId, contact });
    if (!pendiente || pendiente.businessId !== input.tenantId || pendiente.status !== "pending_acceptance" || !pendiente.acceptance) return { handled: false, motivo: "sin_pedido_pendiente" };
    if (!pendiente.acceptance.noticeSentAt) return { handled: false, motivo: "sin_aviso" };
    order = pendiente;
  } catch (err) {
    log({ business_id: input.tenantId, resultado: "no_determinado", motivo: err instanceof OrderError ? err.code : "error" });
    return { handled: false, motivo: "error" };
  }
  // Fase B — hay un pedido pendiente con aviso: de aquí en adelante, ante cualquier error, SILENCIO (fail-closed).
  try {
    // Una respuesta anterior ya quedó registrada: no se repite nada.
    if (order.acceptance?.customerReplyAt) {
      log({ business_id: input.tenantId, order_id: order.orderId, resultado: "ya_registrada" });
      return { handled: true, accion: "ya_registrada" };
    }
    // La intervención humana tiene prioridad. ¿Una persona escribió desde que existe el pedido? Sin certeza => sí.
    const personaEscribio = await deps.humanWroteSince(input.phoneNumberId, input.waId, order.createdAt).catch(() => true);
    // 1) Se registra (atómico en la BD: FOR UPDATE + una sola vez). Quien NO lo registró (llegó segundo) no responde.
    const r = await deps.engine.recordCustomerReplyOnce({ tenantId: input.tenantId, contact, orderId: order.orderId });
    if (r.result === "duplicate") return { handled: true, accion: "ya_registrada" };
    // 2) Respuesta fija, solo si ninguna persona había escrito (o si el negocio decidió responder igual).
    if (personaEscribio && config.siYaRespondioPersona === "no_responder") {
      log({ business_id: input.tenantId, order_id: order.orderId, resultado: "registrada_sin_respuesta", motivo: "persona_ya_escribio" });
      return { handled: true, accion: "registrada_sin_respuesta" };
    }
    const enviado = await deps.sendText(config.textoTrasAviso).catch(() => ({ sent: false }));
    log({ business_id: input.tenantId, order_id: order.orderId, resultado: enviado.sent ? "respondida" : "registrada_sin_respuesta", motivo: enviado.sent ? undefined : "envio_fallido" });
    return enviado.sent ? { handled: true, accion: "respondida" } : { handled: true, accion: "registrada_sin_respuesta" };
  } catch (err) {
    // No se pudo registrar el "sí" (o el pedido cambió justo ahora): silencio. Nunca otro agente, nunca otro flujo.
    log({ business_id: input.tenantId, order_id: order.orderId, resultado: "silencio_por_error", motivo: err instanceof OrderError ? err.code : "error" });
    return { handled: true, accion: "silencio_por_error" };
  }
}
