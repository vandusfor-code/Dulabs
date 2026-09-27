// DuLabs Business — Business Agent 2.0, FASE 4 — renderer determinista (frontera de respuesta).
//
//   RESPONSE PLAN (state machine) + ActionResult (Action Engine) → TEXTO
//
// Plantillas fijas + textos que ya redacta el BACKEND en los handlers (reservaTexto, cotizacionTexto, respuestaDirecta):
// no hay LLM aquí, así que no puede afirmar nada que el sistema no hizo. Reglas duras:
//   - "tu cita quedó agendada" SOLO con un ActionResult SUCCEEDED de una acción de reserva en ESTE turno.
//   - Un timeout ambiguo nunca se presenta como éxito ni como fracaso: se dice que no se pudo confirmar.
//   - NO_RESPONSE (una persona tiene la conversación) = no se envía nada.
// La redacción más natural (plantillas por negocio o un LLM con grounding) es una capa posterior sobre este contrato.

import type { ConversationState } from "@/lib/agent-compiler/conversation/model";
import type { ResponsePlan } from "@/lib/agent-compiler/conversation/response-plan";
import type { ActionResult } from "@/lib/agent-compiler/actions/result";
import type { AgentTone } from "@/lib/agent-compiler/spec/types";
import type { PriceFact } from "@/lib/agent-compiler/conversation/entities";
import { DEFAULT_TONE, phrasebook, type Phrases } from "@/lib/agent-compiler/conversation/phrasebook";

export interface RenderInput {
  plan: ResponsePlan;
  state: ConversationState;
  /** Resultados de acciones ejecutadas en ESTE turno (en orden). */
  actions: readonly ActionResult[];
  businessName: string;
  /** Pregunta configurada por el negocio para cada dato (customerData.question), por nombre de slot. */
  questions: Readonly<Record<string, string>>;
  /** FASE 5 (artefacto): mensaje al transferir. */
  handoffMessage?: string;
  /** FASE 5 (artefacto): mensaje configurado cuando el conocimiento no tiene respuesta. */
  noAnswerMessage?: string;
  /** FASE 5 (artefacto, policies.unsupportedRequest): false = nunca ofrecer una persona. */
  offerHandoff?: boolean;
  /** FASE 6 — vista previa: lo que se "haría" se dice como simulación, nunca como hecho. */
  simulation?: boolean;
  /**
   * FASE 7 — el mensaje de ESTE turno no se pudo interpretar (IA caída, sin respuesta válida tras los reintentos): no
   * se ejecutó nada y el estado se conservó. Se dice con honestidad y se ofrece una persona si el negocio la tiene.
   */
  understandingFailed?: boolean;
  /** FASE 7 — el negocio tiene traspaso a una persona (requisitos publicados). */
  handoffAvailable?: boolean;
  /** FASE 8 — tono publicado (solo estilo). Ausente = "cercano". */
  tone?: AgentTone;
  /** FASE 8 — locale y moneda del negocio para formatear HECHOS (precios). */
  locale?: string;
  currency?: string;
  /** FASE 8 — hechos del backend de este turno (precios reales del catálogo). */
  facts?: { prices?: readonly PriceFact[] };
  /** FASE 8 — opciones configuradas de los datos tipo lista (p. ej. recurso), para mostrarlas al preguntar. */
  selectOptions?: Readonly<Record<string, readonly string[]>>;
  /** FASE 8 — resultado de VERIFICAR una escritura de desenlace desconocido en este turno (se le dice al cliente). */
  verification?: { outcome: "found" | "not_found" | "unknown"; start?: string } | null;
}

/** FASE 7 — respaldo sin IA: nunca afirma nada ni ejecuta nada; pide reformular. */
export const UNDERSTANDING_FALLBACK_TEXT = phrasebook(DEFAULT_TONE).understandingFallback;
/** La frase sugerida la reconoce el backend SIN IA (HUMAN_REQUEST_PHRASES), así que funciona aunque el modelo esté caído. */
export const UNDERSTANDING_FALLBACK_HANDOFF_TEXT = phrasebook(DEFAULT_TONE).understandingFallbackHandoff;

/** Texto de una acción con efecto que en la simulación NO se ejecutó (nunca se presenta como hecha). */
const SIMULATED_TEXT: Readonly<Record<string, string>> = {
  crear_cita_nylas_generico: "Aquí tu agente agendaría la cita en tu calendario.",
  agendar_cita_especialista: "Aquí tu agente agendaría la cita con tu equipo.",
  cancelar_cita_cliente: "Aquí tu agente cancelaría la cita.",
  reprogramar_cita_cliente: "Aquí tu agente cambiaría la cita al nuevo horario.",
  transferir_soporte: "Aquí tu agente pasaría la conversación a una persona de tu equipo y se pausaría.",
  ba_guardar_lead: "Aquí tu agente guardaría los datos del cliente en sus contactos.",
  ba_programar_recordatorio: "Aquí tu agente programaría el recordatorio de la cita.",
};

export function simulatedActionText(action: string): string {
  return `🧪 Simulación: ${SIMULATED_TEXT[action] ?? "aquí tu agente haría esta acción."} (No se creó ni se envió nada real.)`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return `${DIAS[d.getUTCDay()]} ${Number(m[3])} de ${MESES[Number(m[2]) - 1]}`;
}

export function formatTime(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const suffix = h < 12 ? "a. m." : "p. m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/** "sábado 14 de marzo a las 3:00 p. m." de un instante, en la zona del negocio (HECHO formateado, no estilo). */
export function formatInstant(isoInstant: string, timeZone: string): string {
  const d = new Date(isoInstant);
  if (Number.isNaN(d.getTime())) return isoInstant;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${formatDate(`${get("year")}-${get("month")}-${get("day")}`)} a las ${formatTime(`${get("hour")}:${get("minute")}`)}`;
}

/** Precio en la moneda del negocio (HECHO): "$25.000". */
export function formatMoney(amount: number, currency = "COP", locale = "es-CO"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(amount).replace(/ /g, " ");
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
}

const INVALID_REASONS: Readonly<Record<string, string>> = {
  SLOT_TAKEN: "Ese horario ya está ocupado.",
  OUTSIDE_BUSINESS_HOURS: "Ese horario está fuera de nuestro horario de atención.",
  TOO_SOON: "Ese horario ya no está disponible con la anticipación que necesitamos.",
  BUSINESS_CLOSED: "Ese día no atendemos.",
  DATE_IN_PAST: "Esa fecha ya pasó.",
  NO_AVAILABILITY: "Para ese día ya no tenemos cupos.",
  NO_AVAILABILITY_IN_RANGE: "No tenemos cupos en esa franja.",
  // FASE 5 — reglas del Universal Business Model que aplica el Action Engine.
  DATE_TOO_FAR: "Todavía no tenemos agenda abierta para esa fecha.",
  SERVICE_NOT_OFFERED: "Ese servicio no lo tenemos disponible para reservar.",
  // FASE 8.
  APPOINTMENT_NOT_FOUND: "Esa cita ya no aparece en tu agenda.",
};

function lastOf(actions: readonly ActionResult[], pred: (a: ActionResult) => boolean): ActionResult | undefined {
  for (let i = actions.length - 1; i >= 0; i--) if (pred(actions[i]!)) return actions[i];
  return undefined;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function bookingSummary(state: ConversationState): string {
  const s = state.slots;
  const txt = (n: string) => {
    const v = s[n]?.value;
    if (!v) return null;
    if (v.kind === "text") return v.text;
    if (v.kind === "date") return formatDate(v.date);
    if (v.kind === "time") return formatTime(v.time);
    if (v.kind === "number") return String(v.number);
    if (v.kind === "select") return v.option;
    return null;
  };
  const parts = [
    txt("service"),
    txt("date") ? `el ${txt("date")}` : null,
    txt("time") ? `a las ${txt("time")}` : null,
    txt("recurso") ? `con ${txt("recurso")}` : null,
    txt("customer_name") ? `a nombre de ${txt("customer_name")}` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

const LOOKUP_ACTIONS = ["calcular_cotizacion", "buscar_conocimiento", "listar_catalogo_servicios", "ba_consultar_producto"];

/** Texto de un producto consultado: HECHOS del inventario (nombre, precio, stock) con el estilo del tono. */
function productText(a: ActionResult, p: Phrases, input: RenderInput, priceFocus: boolean): string | null {
  const d = a.data;
  const money = (v: unknown) => (typeof v === "number" ? formatMoney(v, str(d.moneda) ?? input.currency, input.locale) : null);
  switch (d.resultado) {
    case "encontrado": {
      const name = str(d.productoNombre) ?? "";
      if (priceFocus) return p.productPrice(name, money(d.precio));
      const stock = typeof d.stock === "number" && d.controlaStock === true ? `Hay ${d.stock} disponible${d.stock === 1 ? "" : "s"}` : null;
      return p.productFound(name, money(d.precio), stock);
    }
    case "agotado":
      return p.productOutOfStock(str(d.productoNombre) ?? "");
    case "ambiguo": {
      const opts = Array.isArray(d.opciones) ? d.opciones.filter((x): x is string => typeof x === "string") : [];
      return p.productAmbiguous(opts.join(", "));
    }
    case "no_encontrado":
      return p.productNotFound(str(d.consulta) ?? "");
    default:
      return null;
  }
}

/** Texto informativo de una consulta hecha en este turno (cotización, conocimiento, catálogo, producto), redactado por el backend. */
function lookupText(a: ActionResult | undefined, p: Phrases, input: RenderInput, noAnswer = "No tengo esa información a la mano."): string | null {
  if (!a || a.status !== "SUCCEEDED") return null;
  switch (a.action) {
    case "calcular_cotizacion":
      return str(a.data.cotizacionTexto);
    case "buscar_conocimiento":
      return a.data.conocimientoEncontrado === true ? (str(a.data.respuestaExacta) ?? str(a.data.respuestaDirecta)) : noAnswer;
    case "listar_catalogo_servicios":
      return str(a.data.catalogoTexto);
    case "ba_consultar_producto":
      return productText(a, p, input, input.state.goal?.intent === "PRICE_INQUIRY" || input.state.currentIntent?.intent === "PRICE_INQUIRY");
    default:
      return null;
  }
}

const numbered = (items: readonly string[]) => items.map((x, i) => `${i + 1}. ${x}`).join("\n");

function availabilityText(a: ActionResult | undefined, p: Phrases): string | null {
  if (!a || a.action !== "buscar_disponibilidad_nylas_generico" || a.status !== "SUCCEEDED") return null;
  const slots = Array.isArray(a.data.horariosDisponibles) ? (a.data.horariosDisponibles as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (slots.length === 0) return null;
  const fecha = typeof a.data.fecha === "string" ? formatDate(a.data.fecha) : "ese día";
  // Numerados: "la segunda" se resuelve contra ESTA lista (state.offers), la misma que ve el cliente.
  return p.availability(fecha, numbered(slots.slice(0, MAX_OFFERED_SLOTS).map(formatTime)));
}

/** Máximo de horarios que se muestran (y que quedan como opciones elegibles por número). */
export const MAX_OFFERED_SLOTS = 8;

const BOOKING_ACTIONS = new Set(["crear_cita_nylas_generico", "agendar_cita_especialista"]);

/** Lectura de una franja candidata ("16:00-" / "-12:00" / "14:00-16:00") en palabras. */
function formatRangeCandidate(c: string): string {
  const [from, to] = c.split("-");
  if (from && to) return `entre las ${formatTime(from)} y las ${formatTime(to)}`;
  if (from) return `después de las ${formatTime(from)}`;
  if (to) return `antes de las ${formatTime(to)}`;
  return c;
}

function candidateText(slot: string | undefined, c: string): string {
  if (slot === "time") return formatTime(c);
  if (slot === "time_range") return formatRangeCandidate(c);
  return c;
}

/** Precios reales del catálogo (hechos) para "¿cuánto cuesta?". Sin precio fijo se dice así; nunca "$0". */
function priceFactsText(input: RenderInput, p: Phrases): string | null {
  const prices = input.facts?.prices ?? [];
  if (prices.length === 0) return null;
  const lines = prices.map((f) => `• ${f.name}: ${f.amount === null ? "precio a confirmar con el equipo" : formatMoney(f.amount, input.currency, input.locale)}`).join("\n");
  return p.prices(lines);
}

export function renderResponse(input: RenderInput): string | null {
  const text = renderCore(input);
  const v = input.verification;
  if (!v || v.outcome === "unknown") return text;
  const p = phrasebook(input.tone);
  const note = v.outcome === "found" ? p.verifiedFound(v.start ? formatInstant(v.start, input.state.timezone) : null) : p.verifiedNotFound;
  return [note, text].filter(Boolean).join("\n\n");
}

function renderCore(input: RenderInput): string | null {
  const { plan, state, actions } = input;
  const p = phrasebook(input.tone);
  const last = actions.at(-1);
  const simulated = lastOf(actions, (a) => a.simulated === true);
  if (simulated) return simulatedActionText(simulated.action);
  const handoffDone = lastOf(actions, (a) => a.action === "transferir_soporte" && a.status === "SUCCEEDED");
  const failure = lastOf(actions, (a) => a.status !== "SUCCEEDED" && a.status !== "IN_PROGRESS");
  const quoted = actions.some((a) => a.action === "calcular_cotizacion" && a.status === "SUCCEEDED");
  const lookup = lookupText(lastOf(actions, (a) => LOOKUP_ACTIONS.includes(a.action) && plan.intent !== "COMPLETION"), p, input, input.noAnswerMessage);
  const extra = [quoted ? null : priceFactsText(input, p), lookup].filter(Boolean).join("\n\n") || null;
  const withExtra = (text: string | null) => [extra, text].filter(Boolean).join("\n\n") || null;
  const offer = (yes: boolean | undefined) => (yes && input.offerHandoff !== false ? p.offerHandoff : "");
  const question = (slot: string | undefined, fallback: string) => (slot && (input.questions[slot] ?? p.questions[slot])) ?? fallback;

  if (handoffDone) return input.handoffMessage ?? p.handoffDefault;

  // FASE 7 — la IA no pudo interpretar este mensaje: no se inventa una respuesta ni se retoma una pregunta como si se
  // hubiera entendido. Tras varios fallos seguidos, la state machine pasa a ERROR y responde el respaldo con persona.
  if (input.understandingFailed && plan.intent !== "NO_RESPONSE" && plan.intent !== "ERROR_FALLBACK") {
    return `${p.understandingFallback}${input.handoffAvailable && input.offerHandoff !== false ? ` ${p.understandingFallbackHandoff}` : ""}`;
  }

  switch (plan.intent) {
    case "NO_RESPONSE":
    case "ACTION_IN_PROGRESS":
    case "AWAIT_ACTION_RESULT":
      return null;
    case "ASK_FOR_SLOT": {
      if (plan.slot === "time") {
        const avail = availabilityText(lastOf(actions, (a) => a.action === "buscar_disponibilidad_nylas_generico"), p);
        if (avail) return withExtra(avail);
      }
      const q = question(plan.slot, p.moreDetail);
      // FASE 8 — dato tipo lista (p. ej. el recurso): se muestran las opciones reales, numeradas.
      const opts = plan.slot ? input.selectOptions?.[plan.slot] : undefined;
      if (opts && opts.length > 0) return withExtra(`${q}\n${numbered(opts)}${offer(plan.offerHandoff)}`);
      return withExtra(`${q}${offer(plan.offerHandoff)}`);
    }
    case "CLARIFY_SLOT": {
      // FASE 8 — el backend necesita que el cliente elija (p. ej. cuál de sus citas): se muestran SUS opciones reales.
      const offers = state.offers;
      if (plan.detail === "selection_required" && offers && offers.slot === plan.slot) {
        return withExtra(`${question(plan.slot, p.moreDetail)}\n${p.chooseFrom(numbered(offers.options.map((o) => o.label)))}`);
      }
      // FASE 7 — servicio que el negocio no tiene: se dice y se muestran SOLO los servicios reales.
      if (plan.slot === "service" && plan.detail === "service_not_offered") {
        const opts = plan.candidates ?? [];
        return withExtra(`${p.serviceNotOffered(opts.length ? opts.join(", ") : null)}${offer(plan.offerHandoff)}`);
      }
      if (plan.slot === "service" && plan.detail === "service_suggestion" && plan.candidates?.length === 1) {
        return withExtra(p.didYouMean(plan.candidates[0]!));
      }
      if (plan.reason === "invalid") {
        const reason = failure?.error?.reason && INVALID_REASONS[failure.error.reason];
        if (failure?.error?.reason === "REMINDER_TIME_INVALID") return withExtra(p.reminderInvalid);
        return withExtra(`${reason ?? p.invalidDefault} ${question(plan.slot, p.tellMeAgain)}${offer(plan.offerHandoff)}`);
      }
      if (plan.candidates && plan.candidates.length > 1) {
        const opts = plan.candidates.map((c) => candidateText(plan.slot, c));
        if (plan.slot === "service") return withExtra(p.whichService(opts.join(", ")));
        return withExtra(p.whichOf(opts.slice(0, -1).join(", "), opts.at(-1)!));
      }
      return withExtra(`${p.notClear} ${question(plan.slot, p.moreDetail)}`);
    }
    case "ASK_FOR_CHANGE":
      return p.askChange;
    case "CONFIRM_ACTION": {
      if (plan.action === "cancelar_cita_cliente") {
        const chosen = state.offers?.slot === "appointment" ? state.offers.options.find((o) => o.value === (state.slots.appointment?.value?.kind === "text" ? state.slots.appointment.value.text : ""))?.label : undefined;
        return p.confirmCancel(chosen ?? null);
      }
      if (plan.action === "reprogramar_cita_cliente") return p.confirmReschedule(bookingSummary(state));
      return withExtra(p.confirmBooking(bookingSummary(state)));
    }
    case "COMPLETION": {
      if (!last || last.status !== "SUCCEEDED") return null;
      if (BOOKING_ACTIONS.has(last.action)) {
        return str(last.data.reservaTexto) ?? (typeof last.data.inicio === "string" ? p.bookingDone : null);
      }
      if (last.action === "cancelar_cita_cliente") return p.cancelDone(str(last.data.citaCanceladaTexto));
      if (last.action === "reprogramar_cita_cliente") return p.rescheduleDone(str(last.data.citaMovidaTexto) ?? bookingSummary(state));
      if (last.action === "ba_guardar_lead") {
        const name = state.slots.customer_name?.value?.kind === "text" ? state.slots.customer_name.value.text : null;
        return p.leadSaved(name);
      }
      if (last.action === "ba_programar_recordatorio") {
        const at = str(last.data.recordatorioEn);
        return at ? p.reminderScheduled(formatInstant(at, state.timezone), last.data.actualizado === true) : null;
      }
      if (last.action === "ba_consultar_producto") return withExtra(lookupText(last, p, input, input.noAnswerMessage));
      return lookupText(last, p, input, input.noAnswerMessage);
    }
    case "CANCELLATION_ACK":
      return p.cancelAck;
    case "HANDOFF_MESSAGE":
      return null;
    case "HANDOFF_UNAVAILABLE":
      return p.handoffUnavailable;
    case "UNSUPPORTED":
      return `${p.unsupported}${offer(plan.offerHandoff)}`;
    case "CLARIFY_INTENT":
      return withExtra(p.howCanIHelp);
    case "ERROR_FALLBACK": {
      if (failure?.error?.reason === "NO_APPOINTMENT_TO_REMIND") return p.reminderNoAppointment;
      if (failure?.error?.ambiguous) return `${p.errorAmbiguous}${offer(plan.offerHandoff)}`;
      return `${p.errorGeneric}${offer(plan.offerHandoff)}`;
    }
    case "CONVERSATIONAL": {
      switch (plan.conversationalIntent) {
        case "GREETING":
          return withExtra(p.greeting(input.businessName));
        case "FAREWELL":
          return p.farewell;
        case "COMPLAINT":
          return p.complaint;
        case "CONFIRMATION":
        case "REJECTION":
        case "UNKNOWN":
          // Un "sí"/"no" sin nada pendiente no confirma ni rechaza nada.
          return withExtra(p.howCanIHelp);
        default:
          return withExtra(p.anythingElse);
      }
    }
  }
}
