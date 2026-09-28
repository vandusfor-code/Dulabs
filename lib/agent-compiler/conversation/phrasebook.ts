// DuLabs Business — Business Agent 2.0, FASE 8 — frases por TONO y LOCALE (solo ESTILO).
//
//   HECHOS (backend: precios, fechas, horarios, disponibilidad, resultados)  ─┐
//                                                                            ├─> renderer → texto
//   ESTILO (este archivo: saludo, forma de preguntar, tuteo/usted)          ─┘
//
// Regla: ninguna frase de aquí contiene ni decide un hecho. Las funciones reciben los hechos YA formateados por el
// renderer y solo los envuelven. Un test verifica que los mismos hechos aparecen idénticos con los cuatro tonos.
// "cercano" reproduce EXACTAMENTE las plantillas de FASE 4–7 (ningún agente existente cambia de texto).
//
// Locale: solo existe el español ("es"): el validador rechaza publicar otro idioma (LANGUAGE_NOT_SUPPORTED) en vez de
// responder en un idioma que no está escrito. Un locale nuevo = otro objeto con las mismas claves (el núcleo no cambia).

import type { AgentTone } from "@/lib/agent-compiler/spec/types";

export const DEFAULT_TONE: AgentTone = "cercano";

/** Cierra una oración sin duplicar el punto de un hecho que ya termina en punto ("4:30 p. m."). */
export const end = (text: string) => (text.endsWith(".") ? text : `${text}.`);
export const SUPPORTED_LOCALES = ["es"] as const;

export interface Phrases {
  /** FASE 10 — con el nombre del asistente que configuró el negocio (si lo hay). */
  greeting(businessName: string, assistantName?: string): string;
  farewell: string;
  complaint: string;
  howCanIHelp: string;
  anythingElse: string;
  askChange: string;
  cancelAck: string;
  handoffDefault: string;
  handoffUnavailable: string;
  /** FASE 9 — ruptura de bucle: el agente iba a repetir la misma respuesta por 3.ª vez. */
  loopBreak(handoffAvailable: boolean): string;
  unsupported: string;
  offerHandoff: string;
  errorGeneric: string;
  errorAmbiguous: string;
  notClear: string;
  invalidDefault: string;
  moreDetail: string;
  tellMeAgain: string;
  understandingFallback: string;
  understandingFallbackHandoff: string;
  questions: Readonly<Record<string, string>>;
  confirmBooking(summary: string): string;
  confirmCancel(detail: string | null): string;
  confirmReschedule(summary: string): string;
  bookingDone: string;
  cancelDone(detail: string | null): string;
  rescheduleDone(detail: string): string;
  availability(dateText: string, numberedSlots: string): string;
  whichService(options: string): string;
  serviceNotOffered(options: string | null): string;
  didYouMean(option: string): string;
  whichOf(first: string, last: string): string;
  chooseFrom(numbered: string): string;
  /** Hechos de precio YA formateados ("Corte: $25.000"). */
  prices(lines: string): string;
  productFound(name: string, price: string | null, stock: string | null): string;
  productPrice(name: string, price: string | null): string;
  productAmbiguous(options: string): string;
  productNotFound(query: string): string;
  productOutOfStock(name: string): string;
  leadSaved(name: string | null): string;
  reminderScheduled(when: string, updated: boolean): string;
  reminderNoAppointment: string;
  reminderInvalid: string;
  verifiedFound(when: string | null): string;
  verifiedNotFound: string;
  /** FASE 9 — verificación de una cancelación / reprogramación de desenlace desconocido. */
  verifiedCancelled: string;
  verifiedCancelNotDone: string;
  verifiedMoved(when: string | null): string;
  verifiedMoveNotDone: string;
  /** Texto del recordatorio que se ENVÍA (hechos: servicio y hora ya formateados). */
  reminderMessage(service: string | null, when: string): string;
}

const cercano: Phrases = {
  greeting: (n, a) => (a ? `¡Hola! Soy ${a}, el asistente de ${n}. ¿En qué te puedo ayudar?` : `¡Hola! Soy el asistente de ${n}. ¿En qué te puedo ayudar?`),
  farewell: "¡Gracias por escribirnos! Que tengas un buen día.",
  complaint: "Lamento el inconveniente. ¿Me cuentas qué pasó?",
  howCanIHelp: "¿En qué te puedo ayudar?",
  anythingElse: "¿En qué más te puedo ayudar?",
  askChange: "Entendido. ¿Qué te gustaría cambiar?",
  cancelAck: "Listo, no hago la reserva. Si necesitas algo más, aquí estoy.",
  handoffDefault: "Te comunico con una persona del equipo. En breve te escriben por aquí.",
  handoffUnavailable: "En este momento no puedo comunicarte con una persona por este medio. ¿Te ayudo con algo más?",
  loopBreak: (h) => (h ? "Parece que no estoy logrando ayudarte con esto. ¿Quieres que te comunique con una persona del equipo?" : "Parece que no estoy logrando ayudarte con esto. ¿Me lo cuentas con otras palabras?"),
  unsupported: "Por ahora no puedo gestionar eso por aquí.",
  offerHandoff: " Si prefieres, te comunico con una persona del equipo.",
  errorGeneric: "No pude completar eso en este momento.",
  errorAmbiguous: "No pude confirmar la operación en este momento. Una persona del equipo lo va a revisar.",
  notClear: "No me quedó claro.",
  invalidDefault: "Ese dato no es válido.",
  moreDetail: "¿Me das un poco más de detalle?",
  tellMeAgain: "¿Me lo indicas de nuevo?",
  understandingFallback: "En este momento no pude entender tu mensaje. ¿Me lo puedes escribir de otra forma?",
  understandingFallbackHandoff: "Si prefieres, escribe «quiero hablar con una persona» y te comunico con alguien del equipo.",
  questions: {
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
    recurso: "¿Con quién te gustaría?",
    appointment: "Tienes varias citas próximas:",
  },
  confirmBooking: (s) => `Te confirmo: ${end(s)} ¿Lo reservo?`,
  confirmCancel: (d) => (d ? `¿Confirmas que quieres cancelar tu cita de ${d}?` : "¿Confirmas que quieres cancelar tu cita?"),
  confirmReschedule: (s) => `¿Confirmas que movemos tu cita al ${s}?`,
  bookingDone: "Listo, tu cita quedó agendada.",
  cancelDone: (d) => `Listo, cancelé tu cita${d ? `: ${end(d)}` : "."}`,
  rescheduleDone: (d) => `Listo, tu cita quedó para: ${end(d)}`,
  availability: (date, slots) => `Estos son los horarios disponibles para el ${date}:\n${slots}\n¿Cuál prefieres?`,
  whichService: (o) => `Tenemos varias opciones: ${o}. ¿Cuál te gustaría?`,
  serviceNotOffered: (o) => `Ese servicio no lo tenemos.${o ? ` Estos son nuestros servicios: ${o}.` : ""} ¿Cuál te gustaría?`,
  didYouMean: (o) => `¿Te refieres a ${o}?`,
  whichOf: (a, b) => `¿Te refieres a ${a} o a ${b}?`,
  chooseFrom: (n) => `${n}\n¿Cuál eliges?`,
  prices: (l) => `Estos son nuestros precios:\n${l}`,
  productFound: (n, p, s) => `Sí, tenemos ${n}${p ? ` a ${p}` : ""}.${s ? ` ${end(s)}` : ""}`,
  productPrice: (n, p) => (p ? `${n} cuesta ${p}.` : `${n} no tiene un precio fijo; el equipo te lo confirma.`),
  productAmbiguous: (o) => `Tenemos varias opciones: ${o}. ¿Cuál te interesa?`,
  productNotFound: (q) => `No encontré «${q}» en nuestro inventario. ¿Te ayudo a buscar otro producto?`,
  productOutOfStock: (n) => `${n} está agotado en este momento.`,
  leadSaved: (n) => `Gracias${n ? `, ${n}` : ""}. Guardé tus datos para que el equipo te contacte.`,
  reminderScheduled: (w, u) => (u ? `Listo, cambié tu recordatorio para el ${end(w)}` : `Listo, te escribo el ${w} para recordarte tu cita.`),
  reminderNoAppointment: "No encuentro una cita agendada en esta conversación para recordarte. ¿Quieres agendar una?",
  reminderInvalid: "Ese momento no sirve para el recordatorio (debe ser antes de tu cita y no en el pasado). ¿Cuándo te lo envío?",
  reminderMessage: (s, w) => `¡Hola! Te recordamos tu cita${s ? ` de ${s}` : ""} el ${end(w)} ¡Te esperamos!`,
  verifiedFound: (w) => `Revisé la agenda: tu cita${w ? ` del ${w}` : ""} sí quedó agendada.`,
  verifiedNotFound: "Revisé la agenda y la cita no alcanzó a quedar agendada.",
  verifiedCancelled: "Revisé la agenda: tu cita sí quedó cancelada.",
  verifiedCancelNotDone: "Revisé la agenda y tu cita sigue activa: la cancelación no alcanzó a hacerse.",
  verifiedMoved: (w) => (w ? `Revisé la agenda: tu cita sí quedó movida al ${end(w)}` : "Revisé la agenda: tu cita sí quedó movida."),
  verifiedMoveNotDone: "Revisé la agenda y tu cita sigue en su horario original: el cambio no alcanzó a hacerse.",
};

const profesional: Phrases = {
  ...cercano,
  greeting: (n, a) => (a ? `Hola, soy ${a}, el asistente virtual de ${n}. ¿En qué puedo ayudarte?` : `Hola, soy el asistente virtual de ${n}. ¿En qué puedo ayudarte?`),
  farewell: "Gracias por comunicarte con nosotros. Que tengas un buen día.",
  complaint: "Lamento lo ocurrido. ¿Podrías contarme qué pasó?",
  howCanIHelp: "¿En qué puedo ayudarte?",
  anythingElse: "¿Hay algo más en lo que pueda ayudarte?",
  askChange: "Entendido. ¿Qué dato te gustaría cambiar?",
  cancelAck: "De acuerdo, no realizo la reserva. Quedo atento si necesitas algo más.",
  confirmBooking: (s) => `Resumen de tu reserva: ${end(s)} ¿Confirmo la reserva?`,
  bookingDone: "Tu cita quedó agendada.",
  leadSaved: (n) => `Gracias${n ? `, ${n}` : ""}. Registré tus datos para que el equipo se comunique contigo.`,
  reminderScheduled: (w, u) => (u ? `Actualicé tu recordatorio para el ${end(w)}` : `Programé un recordatorio para el ${end(w)}`),
};

const casual: Phrases = {
  ...cercano,
  greeting: (n, a) => (a ? `¡Hola! 👋 Aquí ${a}, del equipo de ${n}. ¿Qué necesitas?` : `¡Hola! 👋 Aquí el asistente de ${n}. ¿Qué necesitas?`),
  farewell: "¡Gracias por escribir! Que te vaya súper.",
  howCanIHelp: "¿Qué necesitas?",
  anythingElse: "¿Algo más en lo que te ayude?",
  askChange: "¡Dale! ¿Qué quieres cambiar?",
  confirmBooking: (s) => `Va: ${end(s)} ¿Te la aparto?`,
  bookingDone: "¡Listo! Tu cita quedó agendada.",
  leadSaved: (n) => `¡Gracias${n ? `, ${n}` : ""}! Ya guardé tus datos para que el equipo te escriba.`,
  reminderScheduled: (w, u) => (u ? `¡Hecho! Cambié tu recordatorio para el ${end(w)}` : `¡Hecho! Te escribo el ${w} para recordarte.`),
};

const formal: Phrases = {
  ...cercano,
  greeting: (n, a) => (a ? `Buen día. Le atiende ${a}, asistente de ${n}. ¿En qué puedo servirle?` : `Buen día. Le atiende el asistente de ${n}. ¿En qué puedo servirle?`),
  farewell: "Gracias por comunicarse con nosotros. Que tenga un buen día.",
  complaint: "Lamentamos el inconveniente. ¿Podría indicarnos qué sucedió?",
  howCanIHelp: "¿En qué puedo servirle?",
  anythingElse: "¿Hay algo más en lo que pueda servirle?",
  askChange: "Entendido. ¿Qué desea modificar?",
  cancelAck: "De acuerdo, no se realiza la reserva. Quedamos a su disposición.",
  handoffUnavailable: "En este momento no es posible comunicarle con una persona por este medio. ¿Puedo ayudarle con algo más?",
  loopBreak: (h) => (h ? "Al parecer no estoy logrando ayudarle con esto. ¿Desea que lo comunique con una persona del equipo?" : "Al parecer no estoy logrando ayudarle con esto. ¿Podría explicarlo con otras palabras?"),
  unsupported: "Por el momento no es posible gestionar esa solicitud por este medio.",
  offerHandoff: " Si lo prefiere, puedo comunicarle con una persona del equipo.",
  errorGeneric: "No fue posible completar la solicitud en este momento.",
  errorAmbiguous: "No fue posible confirmar la operación en este momento. Una persona del equipo la revisará.",
  notClear: "Disculpe, no me quedó claro.",
  moreDetail: "¿Podría darme un poco más de detalle?",
  tellMeAgain: "¿Podría indicármelo nuevamente?",
  understandingFallback: "En este momento no pude interpretar su mensaje. ¿Podría escribirlo de otra forma?",
  understandingFallbackHandoff: "Si lo prefiere, escriba «quiero hablar con una persona» y le comunico con alguien del equipo.",
  questions: {
    ...cercano.questions,
    service: "¿Qué servicio desea?",
    product: "¿Qué producto le interesa?",
    date: "¿Para qué día desea la cita?",
    time: "¿A qué hora le conviene?",
    time_range: "¿En qué horario le conviene?",
    customer_name: "¿A nombre de quién registro la reserva?",
    quantity: "¿Cuántas unidades necesita?",
    email: "¿Cuál es su correo electrónico?",
    phone: "¿Cuál es su número de teléfono?",
    notes: "¿Hay algo que debamos tener en cuenta?",
    recurso: "¿Con quién desea ser atendido?",
    appointment: "Tiene varias citas próximas:",
  },
  confirmBooking: (s) => `Le confirmo: ${end(s)} ¿Desea que realice la reserva?`,
  confirmCancel: (d) => (d ? `¿Confirma que desea cancelar su cita de ${d}?` : "¿Confirma que desea cancelar su cita?"),
  confirmReschedule: (s) => `¿Confirma que trasladamos su cita al ${s}?`,
  bookingDone: "Su cita quedó agendada.",
  cancelDone: (d) => `Su cita fue cancelada${d ? `: ${end(d)}` : "."}`,
  rescheduleDone: (d) => `Su cita quedó para: ${end(d)}`,
  availability: (date, slots) => `Estos son los horarios disponibles para el ${date}:\n${slots}\n¿Cuál prefiere?`,
  whichService: (o) => `Contamos con varias opciones: ${o}. ¿Cuál desea?`,
  serviceNotOffered: (o) => `No contamos con ese servicio.${o ? ` Nuestros servicios son: ${o}.` : ""} ¿Cuál desea?`,
  didYouMean: (o) => `¿Se refiere a ${o}?`,
  whichOf: (a, b) => `¿Se refiere a ${a} o a ${b}?`,
  chooseFrom: (n) => `${n}\n¿Cuál elige?`,
  prices: (l) => `Estos son nuestros precios:\n${l}`,
  productFound: (n, p, s) => `Sí, contamos con ${n}${p ? ` a ${p}` : ""}.${s ? ` ${end(s)}` : ""}`,
  productPrice: (n, p) => (p ? `${n} tiene un valor de ${p}.` : `${n} no tiene un precio fijo; el equipo se lo confirmará.`),
  productAmbiguous: (o) => `Contamos con varias opciones: ${o}. ¿Cuál le interesa?`,
  productNotFound: (q) => `No encontré «${q}» en nuestro inventario. ¿Desea consultar otro producto?`,
  productOutOfStock: (n) => `${n} se encuentra agotado en este momento.`,
  leadSaved: (n) => `Gracias${n ? `, ${n}` : ""}. Sus datos quedaron registrados para que el equipo se comunique con usted.`,
  reminderScheduled: (w, u) => (u ? `Su recordatorio quedó actualizado para el ${end(w)}` : `Le enviaremos un recordatorio el ${end(w)}`),
  reminderNoAppointment: "No encuentro una cita agendada en esta conversación para recordarle. ¿Desea agendar una?",
  reminderInvalid: "Ese momento no es válido para el recordatorio (debe ser antes de su cita y no en el pasado). ¿Cuándo desea recibirlo?",
  reminderMessage: (s, w) => `Buen día. Le recordamos su cita${s ? ` de ${s}` : ""} el ${end(w)} Le esperamos.`,
  verifiedFound: (w) => `Verifiqué la agenda: su cita${w ? ` del ${w}` : ""} sí quedó registrada.`,
  verifiedNotFound: "Verifiqué la agenda y la cita no alcanzó a quedar registrada.",
  verifiedCancelled: "Verifiqué la agenda: su cita sí quedó cancelada.",
  verifiedCancelNotDone: "Verifiqué la agenda y su cita continúa vigente: la cancelación no alcanzó a realizarse.",
  verifiedMoved: (w) => (w ? `Verifiqué la agenda: su cita sí quedó reprogramada para el ${end(w)}` : "Verifiqué la agenda: su cita sí quedó reprogramada."),
  verifiedMoveNotDone: "Verifiqué la agenda y su cita continúa en el horario original: el cambio no alcanzó a realizarse.",
};

export const PHRASEBOOKS: Readonly<Record<AgentTone, Phrases>> = { cercano, profesional, casual, formal };

/** Frases del tono pedido (desconocido/ausente = "cercano"). */
export function phrasebook(tone: AgentTone | string | undefined | null): Phrases {
  return (tone && Object.prototype.hasOwnProperty.call(PHRASEBOOKS, tone) ? PHRASEBOOKS[tone as AgentTone] : PHRASEBOOKS[DEFAULT_TONE]);
}
