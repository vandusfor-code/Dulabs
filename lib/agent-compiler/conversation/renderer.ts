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

const DEFAULT_QUESTIONS: Readonly<Record<string, string>> = {
  service: "¿Qué servicio te gustaría?",
  product: "¿Qué producto te interesa?",
  date: "¿Para qué día?",
  time: "¿A qué hora te gustaría?",
  time_range: "¿En qué horario te queda mejor?",
  customer_name: "¿A nombre de quién?",
  quantity: "¿Cuántas unidades necesitas?",
  party_size: "¿Para cuántas personas?",
  email: "¿Cuál es tu correo electrónico?",
  phone: "¿Cuál es tu número de teléfono?",
  location: "¿En qué lugar?",
  notes: "¿Hay algo que debamos tener en cuenta?",
};

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
  const parts = [txt("service"), txt("date") ? `el ${txt("date")}` : null, txt("time") ? `a las ${txt("time")}` : null, txt("customer_name") ? `a nombre de ${txt("customer_name")}` : null].filter(Boolean);
  return parts.join(", ");
}

/** Texto informativo de una consulta hecha en este turno (cotización, conocimiento, catálogo), redactado por el backend. */
function lookupText(a: ActionResult | undefined, noAnswer = "No tengo esa información a la mano."): string | null {
  if (!a || a.status !== "SUCCEEDED") return null;
  switch (a.action) {
    case "calcular_cotizacion":
      return str(a.data.cotizacionTexto);
    case "buscar_conocimiento":
      return a.data.conocimientoEncontrado === true ? (str(a.data.respuestaExacta) ?? str(a.data.respuestaDirecta)) : noAnswer;
    case "listar_catalogo_servicios":
      return str(a.data.catalogoTexto);
    default:
      return null;
  }
}

function availabilityText(a: ActionResult | undefined): string | null {
  if (!a || a.action !== "buscar_disponibilidad_nylas_generico" || a.status !== "SUCCEEDED") return null;
  const slots = Array.isArray(a.data.horariosDisponibles) ? (a.data.horariosDisponibles as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (slots.length === 0) return null;
  const fecha = typeof a.data.fecha === "string" ? formatDate(a.data.fecha) : "ese día";
  return `Estos son los horarios disponibles para el ${fecha}: ${slots.slice(0, 8).map(formatTime).join(", ")}. ¿Cuál prefieres?`;
}

const BOOKING_ACTIONS = new Set(["crear_cita_nylas_generico", "agendar_cita_especialista"]);

export function renderResponse(input: RenderInput): string | null {
  const { plan, state, actions } = input;
  const last = actions.at(-1);
  const handoffDone = lastOf(actions, (a) => a.action === "transferir_soporte" && a.status === "SUCCEEDED");
  const failure = lastOf(actions, (a) => a.status !== "SUCCEEDED" && a.status !== "IN_PROGRESS");
  const extra = lookupText(lastOf(actions, (a) => ["calcular_cotizacion", "buscar_conocimiento", "listar_catalogo_servicios"].includes(a.action)), input.noAnswerMessage);
  const withExtra = (text: string | null) => [extra, text].filter(Boolean).join("\n\n") || null;
  const offer = (yes: boolean | undefined) => (yes && input.offerHandoff !== false ? " Si prefieres, te comunico con una persona del equipo." : "");

  if (handoffDone) return input.handoffMessage ?? "Te comunico con una persona del equipo. En breve te escriben por aquí.";

  switch (plan.intent) {
    case "NO_RESPONSE":
    case "ACTION_IN_PROGRESS":
    case "AWAIT_ACTION_RESULT":
      return null;
    case "ASK_FOR_SLOT": {
      if (plan.slot === "time") {
        const avail = availabilityText(lastOf(actions, (a) => a.action === "buscar_disponibilidad_nylas_generico"));
        if (avail) return withExtra(avail);
      }
      const q = (plan.slot && (input.questions[plan.slot] ?? DEFAULT_QUESTIONS[plan.slot])) ?? "¿Me das un poco más de detalle?";
      return withExtra(`${q}${offer(plan.offerHandoff)}`);
    }
    case "CLARIFY_SLOT": {
      if (plan.reason === "invalid") {
        const reason = failure?.error?.reason && INVALID_REASONS[failure.error.reason];
        const q = (plan.slot && (input.questions[plan.slot] ?? DEFAULT_QUESTIONS[plan.slot])) ?? "¿Me lo indicas de nuevo?";
        return withExtra(`${reason ?? "Ese dato no es válido."} ${q}${offer(plan.offerHandoff)}`);
      }
      if (plan.candidates && plan.candidates.length > 1) {
        const opts = plan.slot === "time" ? plan.candidates.map(formatTime) : plan.candidates;
        return withExtra(`¿Te refieres a ${opts.slice(0, -1).join(", ")} o a ${opts.at(-1)}?`);
      }
      const q = (plan.slot && (input.questions[plan.slot] ?? DEFAULT_QUESTIONS[plan.slot])) ?? "¿Me das un poco más de detalle?";
      return withExtra(`No me quedó claro. ${q}`);
    }
    case "ASK_FOR_CHANGE":
      return "Entendido. ¿Qué te gustaría cambiar?";
    case "CONFIRM_ACTION": {
      if (plan.action === "cancelar_cita_cliente") return "¿Confirmas que quieres cancelar tu cita?";
      if (plan.action === "reprogramar_cita_cliente") return `¿Confirmas que movemos tu cita al ${bookingSummary(state)}?`;
      return withExtra(`Te confirmo: ${bookingSummary(state)}. ¿Lo reservo?`);
    }
    case "COMPLETION": {
      if (!last || last.status !== "SUCCEEDED") return null;
      if (BOOKING_ACTIONS.has(last.action)) {
        return str(last.data.reservaTexto) ?? (typeof last.data.inicio === "string" ? `Listo, tu cita quedó agendada.` : null);
      }
      if (last.action === "cancelar_cita_cliente") return `Listo, cancelé tu cita${str(last.data.citaCanceladaTexto) ? `: ${str(last.data.citaCanceladaTexto)}` : ""}.`;
      if (last.action === "reprogramar_cita_cliente") return `Listo, tu cita quedó para: ${str(last.data.citaMovidaTexto) ?? bookingSummary(state)}.`;
      return lookupText(last, input.noAnswerMessage);
    }
    case "CANCELLATION_ACK":
      return "Listo, no hago la reserva. Si necesitas algo más, aquí estoy.";
    case "HANDOFF_MESSAGE":
      return null;
    case "HANDOFF_UNAVAILABLE":
      return "En este momento no puedo comunicarte con una persona por este medio. ¿Te ayudo con algo más?";
    case "UNSUPPORTED":
      return `Por ahora no puedo gestionar eso por aquí.${offer(plan.offerHandoff)}`;
    case "CLARIFY_INTENT":
      return withExtra("¿En qué te puedo ayudar?");
    case "ERROR_FALLBACK": {
      if (failure?.error?.ambiguous) return `No pude confirmar la operación en este momento. Una persona del equipo lo va a revisar.${offer(plan.offerHandoff)}`;
      return `No pude completar eso en este momento.${offer(plan.offerHandoff)}`;
    }
    case "CONVERSATIONAL": {
      switch (plan.conversationalIntent) {
        case "GREETING":
          return withExtra(`¡Hola! Soy el asistente de ${input.businessName}. ¿En qué te puedo ayudar?`);
        case "FAREWELL":
          return "¡Gracias por escribirnos! Que tengas un buen día.";
        case "COMPLAINT":
          return "Lamento el inconveniente. ¿Me cuentas qué pasó?";
        case "CONFIRMATION":
        case "REJECTION":
        case "UNKNOWN":
          // Un "sí"/"no" sin nada pendiente no confirma ni rechaza nada.
          return withExtra("¿En qué te puedo ayudar?");
        default:
          return withExtra("¿En qué más te puedo ayudar?");
      }
    }
  }
}
