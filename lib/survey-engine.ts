/**
 * Survey Engine — máquina de estados determinística del bot de encuestas.
 *
 * Implementa la "Especificación funcional del agente de encuestas" de Du Labs.
 * Regla central (sección 17 del spec): la IA interpreta y redacta; el BACKEND
 * decide qué pregunta toca, valida, persiste y programa. Este módulo es esa
 * lógica de backend: puro, sin I/O, sin dependencias de red — por eso es
 * testeable y puede correr igual en el webhook, en un cron o en el simulador.
 *
 * La IA (opcional) puede envolver este motor para interpretar lenguaje natural
 * ambiguo, pero el progreso y los estados críticos viven aquí, no en el modelo.
 */

import { scaleRange, type SurveyQuestion } from "@/lib/survey-builder";

// ---------------------------------------------------------------------------
// Configuración personalizable por encuesta / marca
// ---------------------------------------------------------------------------

export interface SurveyBotConfig {
  /** Nombre de la empresa o servicio evaluado (personalizable — no solo Cofrem). */
  brandName: string;
  /** Nombre con el que se presenta el agente (opcional). */
  agentName: string;
  /** Introducción. Placeholders: {brand}, {count}. */
  introTemplate: string;
  /** Mensaje al completar. Placeholders: {brand}. */
  closingTemplate: string;
  /** Mensaje al declinar. Placeholders: {closeDate}. */
  declineTemplate: string;
  /** Confirmación de reanudación programada. Placeholders: {time}. */
  scheduleConfirmTemplate: string;
  /** Mensajes de motivación por hito. */
  milestones: { half: string; twoLeft: string; last: string };
  /** Insistencia responsable. */
  reminder: {
    delayHours: number;
    maxReminders: number;
    /** Placeholders: {brand}. */
    template: string;
  };
  /** Permitir que el participante cambie una respuesta previa. */
  allowChangeAnswers: boolean;
}

export const DEFAULT_SURVEY_BOT_CONFIG: SurveyBotConfig = {
  brandName: "nuestro servicio",
  agentName: "Du",
  introTemplate:
    "Hola 👋 Queremos conocer tu experiencia con {brand}. Tu opinión nos ayuda a seguir mejorando. Son {count} preguntas cortas y te acompaño durante todo el proceso. ¿Comenzamos?",
  closingTemplate:
    "¡Terminamos! Muchas gracias por compartir tu experiencia. Tus respuestas son muy importantes y nos ayudan a identificar oportunidades para seguir mejorando {brand}.",
  declineTemplate:
    "Entendido, gracias por tu tiempo. No te enviaremos más recordatorios de esta encuesta. Si cambias de opinión, podrás retomarla hasta {closeDate}.",
  scheduleConfirmTemplate:
    "Perfecto. Dejamos tu encuesta pausada y continuamos {time} desde donde quedamos.",
  milestones: {
    half: "¡Ya vamos por la mitad! Gracias por tomarte este tiempo. Continuemos.",
    twoLeft: "Ya nos faltan solo dos preguntas. Agradecemos mucho el tiempo que te estás tomando.",
    last: "¡Última pregunta! Ya terminamos.",
  },
  reminder: {
    delayHours: 4,
    maxReminders: 2,
    template:
      "Veo que quizá te ocupaste 😊 Tu avance quedó guardado. Si deseas, podemos continuar desde donde quedamos; tu opinión nos ayuda muchísimo a mejorar {brand}.",
  },
  allowChangeAnswers: true,
};

// ---------------------------------------------------------------------------
// Estado del participante (sección 12 y 13 del spec)
// ---------------------------------------------------------------------------

export type SurveySessionStatus =
  | "invited"
  | "started"
  | "in_progress"
  | "paused"
  | "resume_scheduled"
  | "completed"
  | "declined"
  | "expired";

export type MilestoneKey = "half" | "twoLeft" | "last";

export interface SurveySession {
  status: SurveySessionStatus;
  /** Índice de la pregunta pendiente (siguiente a responder). */
  currentIndex: number;
  /** questionId -> respuesta persistida. */
  answers: Record<string, string | string[] | number>;
  remindersSent: number;
  milestonesSent: MilestoneKey[];
  /** El bot preguntó a qué hora retomar y espera la respuesta. */
  awaitingSchedule: boolean;
  resumeAt: string | null;
  lastInteractionAt: string | null;
  /** Fecha de cierre de la encuesta (ISO date). */
  closeDate: string | null;
}

// Colombia es UTC-5 fijo (sin horario de verano).
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

// closeDate es "YYYY-MM-DD" (fecha de calendario, sin hora): la encuesta
// debe seguir activa hasta el FINAL de ese día en hora Bogotá, no desde su
// inicio. `new Date("2026-08-04").getTime()` da medianoche UTC de esa
// fecha — 5 horas ANTES de medianoche Bogotá del día anterior siquiera —
// así que comparar directo contra eso expiraba la encuesta desde el
// arranque del propio día de cierre (bug real: una encuesta con close_date
// = hoy quedaba expirada en el primer mensaje del participante, sin
// procesar ni una sola respuesta). Se compara contra la medianoche Bogotá
// del día SIGUIENTE en su lugar, para que closeDate siga vigente durante
// todo ese día calendario en Colombia.
function cierreVencido(closeDate: string, now: Date): boolean {
  const [y, m, d] = closeDate.split("-").map(Number);
  const medianocheBogotaDiaSiguienteEnUtc = Date.UTC(y, m - 1, d + 1) + BOGOTA_OFFSET_MS;
  return now.getTime() >= medianocheBogotaDiaSiguienteEnUtc;
}

export function createSession(closeDate: string | null = null): SurveySession {
  return {
    status: "invited",
    currentIndex: 0,
    answers: {},
    remindersSent: 0,
    milestonesSent: [],
    awaitingSchedule: false,
    resumeAt: null,
    lastInteractionAt: null,
    closeDate,
  };
}

// ---------------------------------------------------------------------------
// Acciones que el motor devuelve (el "qué hacer" que la IA/canal ejecuta)
// ---------------------------------------------------------------------------

export type EngineActionKind =
  | "ask" // presentar pregunta actual (con posible intro/hito)
  | "clarify" // respuesta ambigua/ inválida
  | "progress" // responder "¿cuánto falta?" y re-preguntar
  | "offer_pause" // "estoy ocupado" -> ofrecer pausar/continuar
  | "ask_schedule" // "más tarde" -> preguntar hora
  | "scheduled" // compromiso de reanudación confirmado
  | "completed" // encuesta finalizada
  | "closed" // el usuario no desea continuar
  | "already_closed"; // llega mensaje a una encuesta ya cerrada/completada

export interface EngineResult {
  session: SurveySession;
  action: EngineActionKind;
  /** Mensajes a enviar, en orden. Uno por burbuja de WhatsApp. */
  messages: string[];
  /** Botones sugeridos (quick replies) para este turno. */
  quickReplies?: string[];
}

// ---------------------------------------------------------------------------
// Utilidades de lenguaje (interpretación determinística)
// ---------------------------------------------------------------------------

const norm = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

const YES = new Set(["si", "s", "sí", "claro", "dale", "ok", "okay", "vale", "listo", "obvio", "correcto", "afirmativo", "yes", "y", "de acuerdo", "por supuesto", "asi es"]);
const NO = new Set(["no", "n", "nop", "nel", "negativo", "para nada", "jamas", "nunca"]);

const DECLINE_PHRASES = ["no deseo continuar", "no quiero continuar", "no quiero seguir", "no deseo participar", "no me interesa", "no gracias", "detener", "detente", "cancelar", "cancela", "salir", "ya no", "dejalo", "eliminame", "no molesten", "stop", "baja"];
const LATER_PHRASES = ["mas tarde", "luego", "despues", "ahora no", "en otro momento", "mañana", "manana", "despues sigo", "continuo despues", "otro dia", "otro rato"];
const BUSY_PHRASES = ["ocupado", "ocupada", "estoy ocupado", "no puedo ahora", "estoy trabajando", "en un momento", "espera", "dame un momento"];
const PROGRESS_PHRASES = ["cuanto falta", "cuantas faltan", "cuanto queda", "cuantas preguntas", "en que vamos", "cuanto llevo", "cuantas van", "cuanto me falta"];
const REPEAT_PHRASES = ["repite", "repetir", "no entendi", "otra vez", "cual era la pregunta", "que dijiste", "no entiendo", "repiteme", "de nuevo", "vuelve a"];
// Coincide EXACTO con los quick-reply "Continuar" / "Continuar encuesta" que
// devuelve el propio motor (offer_pause, buildReminder) y con el botón
// QUICK_REPLY de la plantilla de recordatorio de Meta — para que tocar el
// botón o escribirlo a mano hagan lo mismo: retomar sin tratarlo como
// respuesta a la pregunta actual (bug real que esto corrige).
const CONTINUE_PHRASES = ["continuar encuesta", "continuar", "continuemos", "sigamos", "continua", "retomar", "retomemos", "seguir", "dale continuemos"];
const START_YES = new Set([...YES, "comenzar", "empezar", "empecemos", "comencemos", "arranquemos", "vamos"]);

type Intent = "decline" | "later" | "busy" | "progress" | "repeat" | "continue" | "answer";

function classify(text: string): Intent {
  const n = norm(text);
  if (DECLINE_PHRASES.some((p) => n.includes(p))) return "decline";
  if (PROGRESS_PHRASES.some((p) => n.includes(p))) return "progress";
  if (REPEAT_PHRASES.some((p) => n.includes(p))) return "repeat";
  if (CONTINUE_PHRASES.some((p) => n.includes(p))) return "continue";
  if (LATER_PHRASES.some((p) => n.includes(p))) return "later";
  if (BUSY_PHRASES.some((p) => n.includes(p))) return "busy";
  return "answer";
}

/** Interpreta una hora/fecha aproximada. Devuelve {date, label} o null. */
export function parseResumeTime(text: string, now: Date): { date: Date; label: string } | null {
  const n = norm(text);
  const tomorrow = n.includes("manana");
  const base = new Date(now);
  if (tomorrow) base.setDate(base.getDate() + 1);

  // "en N horas" / "en N minutos"
  const rel = n.match(/en\s+(\d+)\s*(hora|minuto|min|hr)/);
  if (rel) {
    const amount = Number(rel[1]);
    const d = new Date(now);
    if (/min/.test(rel[2])) d.setMinutes(d.getMinutes() + amount);
    else d.setHours(d.getHours() + amount);
    return { date: d, label: formatTimeLabel(d, now) };
  }

  // "a las 8", "8 pm", "8:30", "8 y media"
  const hm = n.match(/(\d{1,2})(?:[:.\s]?(\d{2}))?\s*(a\.?\s?m|p\.?\s?m|am|pm)?/);
  if (hm) {
    let hour = Number(hm[1]);
    const minute = hm[2] ? Number(hm[2]) : n.includes("media") ? 30 : 0;
    const mer = (hm[3] ?? "").replace(/[.\s]/g, "");
    if (mer.startsWith("p") && hour < 12) hour += 12;
    if (mer.startsWith("a") && hour === 12) hour = 0;
    // Sin meridiano y hora <= 7 → asumir tarde (pm) si es hoy y ya pasó
    if (!mer && hour >= 1 && hour <= 7 && !tomorrow) hour += 12;
    if (hour > 23 || minute > 59) return null;
    const d = new Date(base);
    d.setHours(hour, minute, 0, 0);
    if (!tomorrow && d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return { date: d, label: formatTimeLabel(d, now) };
  }
  return null;
}

function formatTimeLabel(d: Date, now: Date): string {
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const hh = d.getHours();
  const mm = d.getMinutes();
  const mer = hh >= 12 ? "p. m." : "a. m.";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const time = `${h12}:${String(mm).padStart(2, "0")} ${mer}`;
  if (sameDay) return `a las ${time}`;
  if (isTomorrow) return `mañana a las ${time}`;
  return `el ${d.getDate()}/${d.getMonth() + 1} a las ${time}`;
}

// ---------------------------------------------------------------------------
// Validación de respuestas por tipo de pregunta (sección 6 del spec)
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  value?: string | string[] | number;
}

function matchOption(text: string, options: string[]): number {
  const n = norm(text);
  // por número ("2")
  const num = n.match(/^\s*(\d{1,2})\b/);
  if (num) {
    const idx = Number(num[1]) - 1;
    if (idx >= 0 && idx < options.length) return idx;
  }
  // por texto exacto/contenido
  const exact = options.findIndex((o) => norm(o) === n);
  if (exact >= 0) return exact;
  const contained = options.findIndex((o) => n.length >= 3 && (norm(o).includes(n) || n.includes(norm(o))));
  return contained;
}

export function validateAnswer(question: SurveyQuestion, text: string): ValidationResult {
  const n = norm(text);
  if (n === "") return { ok: false };

  switch (question.type) {
    case "message":
      return { ok: true, value: "" };

    case "yes_no": {
      const first = n.split(/\s+/)[0];
      if (YES.has(n) || YES.has(first)) return { ok: true, value: "Sí" };
      if (NO.has(n) || NO.has(first)) return { ok: true, value: "No" };
      return { ok: false };
    }

    case "rating_1_5":
    case "rating_1_10":
    case "nps_0_10": {
      const range = scaleRange(question.type)!;
      const m = n.match(/-?\d{1,2}/);
      if (!m) return { ok: false };
      const val = Number(m[0]);
      if (val < range[0] || val > range[1]) return { ok: false };
      return { ok: true, value: val };
    }

    case "single_choice": {
      const options = (question.options ?? []).filter(Boolean);
      const idx = matchOption(text, options);
      if (idx < 0) return { ok: false };
      return { ok: true, value: options[idx] };
    }

    case "multiple_choice": {
      const options = (question.options ?? []).filter(Boolean);
      const parts = text.split(/[,;]|\sy\s|\se\s/).map((p) => p.trim()).filter(Boolean);
      const chosen = new Set<string>();
      for (const part of parts) {
        const idx = matchOption(part, options);
        if (idx >= 0) chosen.add(options[idx]);
      }
      if (chosen.size === 0) return { ok: false };
      return { ok: true, value: [...chosen] };
    }

    case "open_text":
      return { ok: true, value: text.trim() };

    default:
      return { ok: true, value: text.trim() };
  }
}

// ---------------------------------------------------------------------------
// Presentación de preguntas
// ---------------------------------------------------------------------------

function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

// `textoBase` permite sustituir question.text por una redacción más cálida
// (ver lib/survey-agent-ia.ts) sin duplicar la lógica de instrucciones
// obligatorias (rango, opciones, ayuda) que sigue abajo, sin cambios y
// SIEMPRE agregada tal cual — la IA nunca las genera ni puede omitirlas.
export function questionPrompt(question: SurveyQuestion, textoBase?: string): string {
  let body = textoBase ?? question.text;
  const range = scaleRange(question.type);
  if (range) {
    const min = question.minLabel ? ` (${range[0]} = ${question.minLabel})` : "";
    const max = question.maxLabel ? ` (${range[1]} = ${question.maxLabel})` : "";
    body += `\n\nResponde con un número del ${range[0]} al ${range[1]}${min}${max}.`;
  } else if (question.type === "yes_no") {
    body += "\n\nResponde Sí o No.";
  } else if ((question.type === "single_choice" || question.type === "multiple_choice") && question.options?.length) {
    const opts = question.options.filter(Boolean).map((o, i) => `${i + 1}. ${o}`).join("\n");
    body += `\n\n${opts}`;
    if (question.type === "multiple_choice") body += "\n\nPuedes elegir varias opciones.";
  }
  if (question.helpText) body += `\n\n${question.helpText}`;
  return body;
}

function quickRepliesFor(question: SurveyQuestion): string[] | undefined {
  if (question.type === "yes_no") return ["Sí", "No"];
  if (question.type === "single_choice" && question.options?.length && question.options.length <= 4) {
    return question.options.filter(Boolean);
  }
  return undefined;
}

/** Preguntas "reales" (excluye tipo message que no requiere respuesta). */
function answerable(questions: SurveyQuestion[]): SurveyQuestion[] {
  return questions.filter((q) => q.type !== "message");
}

function progressOf(questions: SurveyQuestion[], session: SurveySession): { answered: number; total: number; pct: number } {
  const real = answerable(questions);
  const answered = real.filter((q) => q.id in session.answers).length;
  const total = real.length;
  return { answered, total, pct: total > 0 ? Math.round((answered / total) * 100) : 0 };
}

/**
 * Avanza `currentIndex` hasta la próxima pregunta que requiere respuesta,
 * acumulando en `messages` los mensajes tipo "message" que encuentre.
 */
function collectUntilNextQuestion(
  questions: SurveyQuestion[],
  session: SurveySession,
  messages: string[]
): SurveyQuestion | null {
  while (session.currentIndex < questions.length) {
    const q = questions[session.currentIndex];
    if (q.type === "message") {
      if (q.text.trim()) messages.push(q.text);
      session.currentIndex += 1;
      continue;
    }
    return q;
  }
  return null;
}

/** Prefijo de motivación por hito, si corresponde y no se ha enviado antes. */
function milestonePrefix(
  config: SurveyBotConfig,
  questions: SurveyQuestion[],
  session: SurveySession
): string | null {
  const { answered, total } = progressOf(questions, session);
  const remaining = total - answered;
  if (remaining <= 0) return null;

  if (remaining === 1 && !session.milestonesSent.includes("last")) {
    session.milestonesSent.push("last");
    return config.milestones.last;
  }
  if (remaining === 2 && !session.milestonesSent.includes("twoLeft")) {
    session.milestonesSent.push("twoLeft");
    return config.milestones.twoLeft;
  }
  if (answered > 0 && answered / total >= 0.5 && remaining > 2 && !session.milestonesSent.includes("half")) {
    session.milestonesSent.push("half");
    return config.milestones.half;
  }
  return null;
}

// ---------------------------------------------------------------------------
// API pública del motor
// ---------------------------------------------------------------------------

/** Envía la invitación inicial (intro) y queda a la espera de la aceptación. */
export function inviteSurvey(
  config: SurveyBotConfig,
  questions: SurveyQuestion[],
  session: SurveySession,
  now: Date = new Date()
): EngineResult {
  const s: SurveySession = { ...session, status: "invited", lastInteractionAt: now.toISOString() };
  const total = answerable(questions).length;
  return {
    session: s,
    action: "ask",
    messages: [fill(config.introTemplate, { brand: config.brandName, count: total })],
    quickReplies: ["Comenzar"],
  };
}

/** Presenta la primera pregunta (tras aceptar la invitación). */
export function startSurvey(
  config: SurveyBotConfig,
  questions: SurveyQuestion[],
  session: SurveySession,
  now: Date = new Date()
): EngineResult {
  const s: SurveySession = { ...session, status: "started", lastInteractionAt: now.toISOString() };
  const messages: string[] = [];
  const q = collectUntilNextQuestion(questions, s, messages);
  if (!q) {
    return finish(config, s, messages);
  }
  messages.push(questionPrompt(q));
  return { session: s, action: "ask", messages, quickReplies: quickRepliesFor(q) };
}

function finish(config: SurveyBotConfig, session: SurveySession, messages: string[]): EngineResult {
  const s: SurveySession = { ...session, status: "completed", resumeAt: null, awaitingSchedule: false };
  messages.push(fill(config.closingTemplate, { brand: config.brandName }));
  return { session: s, action: "completed", messages };
}

/** Procesa un mensaje entrante del participante y decide la siguiente acción. */
export function handleMessage(
  config: SurveyBotConfig,
  questions: SurveyQuestion[],
  session: SurveySession,
  userText: string,
  now: Date = new Date()
): EngineResult {
  const s: SurveySession = {
    ...session,
    answers: { ...session.answers },
    milestonesSent: [...session.milestonesSent],
    lastInteractionAt: now.toISOString(),
  };

  // Encuesta ya cerrada.
  if (s.status === "completed" || s.status === "declined" || s.status === "expired") {
    return { session: s, action: "already_closed", messages: [] };
  }

  // Vencimiento por fecha de cierre.
  if (s.closeDate && cierreVencido(s.closeDate, now)) {
    s.status = "expired";
    return { session: s, action: "already_closed", messages: [] };
  }

  // Aún no ha iniciado: interpretar intención de comenzar.
  if (s.status === "invited") {
    const n = norm(userText);
    if (DECLINE_PHRASES.some((p) => n.includes(p))) return decline(config, s);
    if (START_YES.has(n) || classify(userText) === "answer") {
      return startSurvey(config, questions, { ...s, status: "invited" }, now);
    }
  }

  // Esperando la hora de reanudación ("Más tarde" ya se eligió).
  if (s.awaitingSchedule) {
    const parsed = parseResumeTime(userText, now);
    if (!parsed) {
      return {
        session: s,
        action: "ask_schedule",
        messages: ["No logré entender la hora 🤔 ¿Me dices a qué hora te gustaría continuar? Por ejemplo: «a las 8» o «mañana a las 10»."],
      };
    }
    s.awaitingSchedule = false;
    s.status = "resume_scheduled";
    s.resumeAt = parsed.date.toISOString();
    return {
      session: s,
      action: "scheduled",
      messages: [fill(config.scheduleConfirmTemplate, { time: parsed.label })],
    };
  }

  const intent = classify(userText);

  if (intent === "decline") return decline(config, s);

  if (intent === "later") {
    // ¿Trae hora explícita? entonces programa directo.
    const parsed = parseResumeTime(userText, now);
    if (parsed) {
      s.status = "resume_scheduled";
      s.resumeAt = parsed.date.toISOString();
      return { session: s, action: "scheduled", messages: [fill(config.scheduleConfirmTemplate, { time: parsed.label })] };
    }
    s.status = "paused";
    s.awaitingSchedule = true;
    return {
      session: s,
      action: "ask_schedule",
      messages: ["¡Claro! Tu avance queda guardado. ¿A qué hora te gustaría continuar? (por ejemplo «a las 8» o «mañana a las 10»)"],
      quickReplies: ["En una hora", "Mañana a las 10"],
    };
  }

  if (intent === "busy") {
    s.status = "paused";
    return {
      session: s,
      action: "offer_pause",
      messages: ["Sin problema 😊 Tu avance quedó guardado. ¿Continuamos ahora o prefieres más tarde?"],
      quickReplies: ["Continuar", "Más tarde", "No deseo continuar"],
    };
  }

  // Localizar la pregunta actual.
  const scratch: string[] = [];
  const current = collectUntilNextQuestion(questions, s, scratch);
  if (!current) {
    return finish(config, s, []);
  }

  if (intent === "progress") {
    const { answered, total } = progressOf(questions, s);
    const messages = [
      `Vas muy bien: llevas ${answered} de ${total} preguntas (${Math.round((answered / total) * 100)}%). Seguimos aquí 👇`,
      questionPrompt(current),
    ];
    return { session: s, action: "progress", messages, quickReplies: quickRepliesFor(current) };
  }

  if (intent === "repeat") {
    return { session: s, action: "ask", messages: [questionPrompt(current)], quickReplies: quickRepliesFor(current) };
  }

  if (intent === "continue") {
    if (s.status === "paused" || s.status === "resume_scheduled") {
      s.status = "in_progress";
      s.resumeAt = null;
    }
    return { session: s, action: "ask", messages: [questionPrompt(current)], quickReplies: quickRepliesFor(current) };
  }

  // intent === "answer": validar contra la pregunta actual.
  const result = validateAnswer(current, userText);
  if (!result.ok) {
    return {
      session: s,
      action: "clarify",
      messages: [clarifyMessage(current), questionPrompt(current)],
      quickReplies: quickRepliesFor(current),
    };
  }

  // Guardar respuesta y avanzar.
  s.answers[current.id] = result.value ?? "";
  if (s.status === "started" || s.status === "invited" || s.status === "paused" || s.status === "resume_scheduled") {
    s.status = "in_progress";
  }
  s.currentIndex += 1;
  s.resumeAt = null;

  const messages: string[] = [];
  const next = collectUntilNextQuestion(questions, s, messages);
  if (!next) {
    return finish(config, s, messages);
  }
  const prefix = milestonePrefix(config, questions, s);
  if (prefix) messages.push(prefix);
  messages.push(questionPrompt(next));
  return { session: s, action: "ask", messages, quickReplies: quickRepliesFor(next) };
}

function decline(config: SurveyBotConfig, session: SurveySession): EngineResult {
  const s: SurveySession = { ...session, status: "declined", awaitingSchedule: false, resumeAt: null };
  const closeLabel = s.closeDate
    ? new Date(s.closeDate + (s.closeDate.length <= 10 ? "T00:00:00" : "")).toLocaleDateString("es-CO", { day: "numeric", month: "long" })
    : "la fecha de cierre";
  return { session: s, action: "closed", messages: [fill(config.declineTemplate, { closeDate: closeLabel })] };
}

function clarifyMessage(question: SurveyQuestion): string {
  const range = scaleRange(question.type);
  if (range) return `Necesito un número entre ${range[0]} y ${range[1]} para esta pregunta 🙂`;
  if (question.type === "yes_no") return "¿Me confirmas con un Sí o un No? 🙂";
  if (question.type === "single_choice" || question.type === "multiple_choice") return "No identifiqué esa opción. Elige una de la lista (puedes responder con el número) 👇";
  return "No estoy seguro de haber entendido. ¿Puedes responder de nuevo? 🙂";
}

// ---------------------------------------------------------------------------
// Insistencia responsable (sección 14) — usado por el scheduler / cron
// ---------------------------------------------------------------------------

/** ¿Corresponde enviar un recordatorio de recuperación ahora? */
export function shouldSendReminder(config: SurveyBotConfig, session: SurveySession, now: Date = new Date()): boolean {
  if (session.status !== "paused" && session.status !== "in_progress") return false;
  if (session.awaitingSchedule) return false; // esperando que diga la hora
  if (session.resumeAt) return false; // respetar el compromiso "más tarde"
  if (session.remindersSent >= config.reminder.maxReminders) return false;
  if (session.closeDate && cierreVencido(session.closeDate, now)) return false;
  if (!session.lastInteractionAt) return false;
  const elapsedH = (now.getTime() - new Date(session.lastInteractionAt).getTime()) / 3_600_000;
  return elapsedH >= config.reminder.delayHours;
}

/** Construye el recordatorio y actualiza el contador. */
export function buildReminder(config: SurveyBotConfig, session: SurveySession): EngineResult {
  const s: SurveySession = { ...session, remindersSent: session.remindersSent + 1 };
  return {
    session: s,
    action: "offer_pause",
    messages: [fill(config.reminder.template, { brand: config.brandName })],
    quickReplies: ["Continuar encuesta", "Más tarde", "No deseo continuar"],
  };
}

/** ¿Ya llegó la hora del compromiso de reanudación ("más tarde")? */
export function shouldResumeScheduled(session: SurveySession, now: Date = new Date()): boolean {
  if (session.status !== "resume_scheduled" || !session.resumeAt) return false;
  if (session.closeDate && cierreVencido(session.closeDate, now)) return false;
  return new Date(session.resumeAt).getTime() <= now.getTime();
}

/** Reactiva proactivamente una encuesta programada, re-presentando la pregunta pendiente. */
export function resumeScheduled(
  config: SurveyBotConfig,
  questions: SurveyQuestion[],
  session: SurveySession,
  now: Date = new Date()
): EngineResult {
  const s: SurveySession = { ...session, status: "in_progress", resumeAt: null, lastInteractionAt: now.toISOString() };
  const messages: string[] = ["¡Hola de nuevo! Como quedamos, continuemos con tu encuesta 🙂"];
  const q = collectUntilNextQuestion(questions, s, messages);
  if (!q) return finish(config, s, messages);
  messages.push(questionPrompt(q));
  return { session: s, action: "ask", messages, quickReplies: quickRepliesFor(q) };
}

// ---------------------------------------------------------------------------
// Instrucción base del agente de IA (sección 16) — personalizada por marca
// ---------------------------------------------------------------------------

export function buildSurveyAgentSystemPrompt(config: SurveyBotConfig): string {
  return `ROL
Eres ${config.agentName || "el agente"}, el agente conversacional de encuestas de Du Labs para "${config.brandName}". Tu objetivo principal es ayudar al participante a completar la encuesta asignada de manera natural, amable y respetuosa.

REGLAS
1. Haz solamente la pregunta que corresponda según el estado de la encuesta.
2. Nunca inventes preguntas, opciones ni respuestas.
3. No marques una pregunta como respondida hasta tener una respuesta válida.
4. Una vez validada, registra la respuesta mediante la lógica/herramienta del sistema y avanza.
5. Usa mensajes breves y naturales, apropiados para WhatsApp. Una sola pregunta por turno.
6. Motiva al participante en hitos reales de progreso, sin exagerar ni repetir.
7. Si el usuario se ocupa o quiere continuar después, conserva su progreso.
8. Si solicita una hora para retomar, interpreta y confirma la fecha/hora antes de guardarla.
9. Si dice que no desea continuar, cierra la encuesta para ese participante y no insistas.
10. Nunca reinicies una encuesta pausada: continúa desde la siguiente pregunta pendiente.
11. Si una respuesta es ambigua, pide aclaración breve y muestra las opciones cuando ayude.
12. Al finalizar, agradece el tiempo y explica brevemente que las respuestas ayudan a mejorar el servicio.
13. La fecha de cierre, el número de preguntas, el progreso y las opciones provienen de los datos reales de la encuesta que te entrega el backend.
14. No prometas acciones que el sistema no pueda ejecutar.
15. Cumple las restricciones de mensajería y privacidad configuradas para el canal.

La máquina de estados del backend decide qué pregunta toca y valida las respuestas; tú solo interpretas el mensaje del usuario y redactas la respuesta dentro de las reglas del estado actual.`;
}
