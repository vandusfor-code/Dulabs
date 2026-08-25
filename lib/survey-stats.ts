/**
 * Agregación real del bot de encuestas (lib/survey-engine.ts +
 * lib/survey-bot-store.ts) a las formas que consume la UI de
 * /dashboard/surveys (lib/surveys.ts, lib/survey-detail.ts,
 * lib/survey-questions.ts). Funciones puras: reciben filas ya consultadas
 * de dulabs_survey_bot_config / dulabs_survey_sessions y devuelven los
 * mismos tipos que antes alimentaba la maqueta — sin red, fácil de probar.
 */

import type { SurveyQuestion, QuestionType } from "@/lib/survey-builder";
import type { SurveySessionStatus } from "@/lib/survey-engine";
import type { SurveyStatus, SurveySummary, SurveyKpis, FunnelStep, SurveyPerformancePoint } from "@/lib/surveys";
import type { SurveyDetail, SurveyResultBucket, SurveyParticipantStatus } from "@/lib/survey-detail";
import { STATUS_ORDER } from "@/lib/survey-detail";
import type { SurveyQuestionDef, SurveyQuestionType, QuestionAnalytics, OptionAggregate, SurveyQuestionsData } from "@/lib/survey-questions";

export interface SurveyConfigRow {
  phone_number_id: string;
  nombre_negocio: string;
  survey_name: string;
  brand_name: string;
  questions: SurveyQuestion[];
  close_date: string | null;
  active: boolean;
  updated_at: string;
}

export interface SurveySessionRow {
  phone_number_id: string;
  telefono_participante: string;
  nombre_participante: string | null;
  status: SurveySessionStatus;
  answers: Record<string, string | string[] | number>;
  reminders_sent: number;
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
}

// Cada sesión creada = una invitación enviada (createSessionRow se llama en
// el momento del envío, ver app/api/dashboard/surveys/invitar/route.ts).
export function sentCount(sessions: SurveySessionRow[]): number {
  return sessions.length;
}
export function startedCount(sessions: SurveySessionRow[]): number {
  return sessions.filter((s) => s.status !== "invited").length;
}
export function completedCount(sessions: SurveySessionRow[]): number {
  return sessions.filter((s) => s.status === "completed").length;
}

const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

// KPIs de cabecera = totales históricos (todas las sesiones). Los deltas
// comparan la ventana de los últimos 30 días contra los 30 días previos —
// no contra el total histórico, para que "+X% vs últimos 30 días" tenga el
// significado que promete la etiqueta.
export function kpisFromSessions(sessions: SurveySessionRow[], now: Date = new Date()): SurveyKpis {
  const sent = sentCount(sessions);
  const started = startedCount(sessions);
  const completed = completedCount(sessions);
  const rate = pct(completed, started);

  const hace30d = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const hace60d = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const ultimos30d = sessions.filter((s) => s.created_at >= hace30d);
  const previos30d = sessions.filter((s) => s.created_at >= hace60d && s.created_at < hace30d);

  const sentAntes = sentCount(previos30d);
  const startedAntes = startedCount(previos30d);
  const completedAntes = completedCount(previos30d);
  const rateAntes = pct(completedAntes, startedAntes);
  const rateAhora = pct(completedCount(ultimos30d), startedCount(ultimos30d));
  const deltaPct = (ahora: number, antes: number) => (antes > 0 ? Math.round(((ahora - antes) / antes) * 100) : ahora > 0 ? 100 : 0);
  return {
    sent,
    started,
    completed,
    completionRate: rate,
    deltas: {
      sent: deltaPct(sentCount(ultimos30d), sentAntes),
      started: deltaPct(startedCount(ultimos30d), startedAntes),
      completed: deltaPct(completedCount(ultimos30d), completedAntes),
      completionRate: Math.round(rateAhora - rateAntes),
    },
  };
}

// "Q5"/"Q10" = participantes que respondieron al menos 5/10 preguntas
// reales (excluye tipo "message"). En encuestas con menos de 10 preguntas,
// Q10 coincide con "completadas" — es un número real, no una etiqueta falsa.
export function funnelFromSessions(sessions: SurveySessionRow[]): FunnelStep[] {
  const sent = sentCount(sessions);
  const started = startedCount(sessions);
  const answeredAtLeast = (n: number) => sessions.filter((s) => Object.keys(s.answers).length >= n).length;
  const q5 = answeredAtLeast(5);
  const q10 = answeredAtLeast(10);
  const completed = completedCount(sessions);
  const step = (value: number) => ({ value, percentage: pct(value, sent) });
  return [
    { key: "invited", ...step(sent) },
    { key: "started", ...step(started) },
    { key: "q5", ...step(q5) },
    { key: "q10", ...step(q10) },
    { key: "completed", ...step(completed) },
  ];
}

// Agrupa por semana ISO (lunes) las últimas 6 semanas de iniciadas/completadas.
export function performanceFromSessions(sessions: SurveySessionRow[], now: Date = new Date()): SurveyPerformancePoint[] {
  const weekStart = (d: Date): string => {
    const copy = new Date(d);
    const day = (copy.getDay() + 6) % 7; // lunes = 0
    copy.setDate(copy.getDate() - day);
    copy.setHours(0, 0, 0, 0);
    return copy.toISOString().slice(0, 10);
  };
  const weekLabel = (iso: string): string => {
    const d = new Date(iso + "T00:00:00");
    const semana = Math.ceil(d.getDate() / 7);
    const mes = d.toLocaleDateString("es-CO", { month: "short" }).replace(".", "");
    return `S${semana} ${mes.charAt(0).toUpperCase()}${mes.slice(1)}`;
  };

  const weeks: string[] = [];
  const base = weekStart(now);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(base + "T00:00:00");
    d.setDate(d.getDate() - i * 7);
    weeks.push(d.toISOString().slice(0, 10));
  }

  return weeks.map((wk, i) => {
    const next = i + 1 < weeks.length ? weeks[i + 1] : new Date(new Date(wk + "T00:00:00").getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    const enSemana = (fecha: string) => fecha >= wk && fecha < next;
    const started = sessions.filter((s) => s.status !== "invited" && enSemana(s.created_at.slice(0, 10))).length;
    const completed = sessions.filter((s) => s.status === "completed" && enSemana(s.updated_at.slice(0, 10))).length;
    return { label: weekLabel(wk), started, completed };
  });
}

const SESSION_STATUS_A_BUCKET: Record<SurveySessionStatus, SurveyParticipantStatus> = {
  invited: "no_response",
  started: "in_progress",
  in_progress: "in_progress",
  paused: "resume_later",
  resume_scheduled: "resume_later",
  completed: "completed",
  declined: "declined",
  expired: "abandoned",
};

// "undelivered" queda siempre en 0: hoy no se rastrea fallo de entrega a
// nivel de encuesta (solo a nivel de dulabs_mensajes_log de campañas) — se
// deja honesto en vez de inventar el número.
export function resultBucketsFromSessions(sessions: SurveySessionRow[]): SurveyResultBucket[] {
  const counts: Record<SurveyParticipantStatus, number> = {
    completed: 0, no_response: 0, abandoned: 0, resume_later: 0, declined: 0, undelivered: 0, in_progress: 0,
  };
  for (const s of sessions) counts[SESSION_STATUS_A_BUCKET[s.status]]++;
  return STATUS_ORDER.map((status) => ({ status, count: counts[status] }));
}

export function statusFromConfig(config: Pick<SurveyConfigRow, "active" | "close_date">, hoy: string = new Date().toISOString().slice(0, 10)): SurveyStatus {
  if (!config.active) return "draft";
  if (config.close_date && config.close_date < hoy) return "completed";
  return "active";
}

export function summaryFromConfig(config: SurveyConfigRow, sessions: SurveySessionRow[]): SurveySummary {
  const sent = sentCount(sessions);
  const started = startedCount(sessions);
  const completed = completedCount(sessions);
  const actualizada = new Date(config.updated_at);
  const minutos = Math.max(0, Math.round((Date.now() - actualizada.getTime()) / 60_000));
  const relativo =
    minutos < 1
      ? { es: "hace un momento", en: "just now" }
      : minutos < 60
        ? { es: `hace ${minutos} min`, en: `${minutos} min ago` }
        : minutos < 1440
          ? { es: `hace ${Math.round(minutos / 60)} h`, en: `${Math.round(minutos / 60)} h ago` }
          : { es: actualizada.toLocaleDateString("es-CO"), en: actualizada.toLocaleDateString("en-US") };
  return {
    id: config.phone_number_id,
    name: config.survey_name || config.brand_name || config.nombre_negocio,
    status: statusFromConfig(config),
    questionCount: config.questions.filter((q) => q.type !== "message").length,
    sent,
    started,
    completed,
    completionRate: pct(completed, started),
    updatedAt: relativo,
    // Fecha real, aparte del texto relativo que se muestra: el filtro por
    // antigüedad de la tabla necesita algo comparable, y "hace 2 h" no lo es.
    updatedAtISO: config.updated_at,
  };
}

export function detailFromConfig(config: SurveyConfigRow, sessions: SurveySessionRow[]): SurveyDetail {
  const summary = summaryFromConfig(config, sessions);
  return {
    id: config.phone_number_id,
    name: summary.name,
    status: summary.status === "draft" ? "draft" : summary.status === "completed" ? "completed" : "active",
    channel: "whatsapp",
    questionCount: summary.questionCount,
    endDate: config.close_date ?? undefined,
    sent: summary.sent,
    started: summary.started,
    results: resultBucketsFromSessions(sessions),
    updatedAt: config.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Análisis por pregunta (pestaña "Preguntas" del detalle)
// ---------------------------------------------------------------------------

const TIPO_A_ANALYTICS: Partial<Record<QuestionType, SurveyQuestionType>> = {
  single_choice: "single_choice",
  multiple_choice: "multiple_choice",
  yes_no: "yes_no",
  rating_1_5: "rating",
  rating_1_10: "scale",
  nps_0_10: "nps",
  open_text: "free_text",
};

function toDef(q: SurveyQuestion, order: number): SurveyQuestionDef | null {
  const type = TIPO_A_ANALYTICS[q.type];
  if (!type) return null; // "message" no es respondible, se excluye
  const range = q.type === "rating_1_5" ? [1, 5] : q.type === "rating_1_10" ? [1, 10] : q.type === "nps_0_10" ? [0, 10] : null;
  return {
    id: q.id,
    order,
    text: q.text,
    type,
    required: q.required,
    options: q.options?.map((label) => ({ label })),
    config: range ? { scaleMin: range[0], scaleMax: range[1] } : undefined,
  };
}

function analyticsFor(q: SurveyQuestionDef, respuestas: Array<string | string[] | number>): QuestionAnalytics {
  const answered = respuestas.length;
  const base = { questionId: q.id, answered, skipped: 0, uniqueRespondents: answered };

  if (q.type === "free_text") {
    return {
      ...base,
      textResponses: respuestas.map((r, i) => ({ id: `${q.id}-${i}`, text: String(r), createdAt: new Date().toISOString() })),
    };
  }

  if (q.type === "single_choice" || q.type === "yes_no") {
    const counts = new Map<string, number>();
    for (const r of respuestas) counts.set(String(r), (counts.get(String(r)) ?? 0) + 1);
    const options: OptionAggregate[] = [...counts.entries()].map(([label, count]) => ({ label, count }));
    return { ...base, options };
  }

  if (q.type === "multiple_choice") {
    const counts = new Map<string, number>();
    for (const r of respuestas) {
      const vals = Array.isArray(r) ? r : [String(r)];
      for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const options: OptionAggregate[] = [...counts.entries()].map(([label, count]) => ({ label, count }));
    return { ...base, options, totalSelections: options.reduce((a, o) => a + o.count, 0) };
  }

  if (q.type === "scale" || q.type === "rating") {
    const min = q.config?.scaleMin ?? 1;
    const max = q.config?.scaleMax ?? 10;
    const values = respuestas.map((r) => Number(r)).filter((n) => Number.isFinite(n));
    const counts = Array.from({ length: max - min + 1 }, (_, i) => values.filter((v) => v === min + i).length);
    const options: OptionAggregate[] = counts.map((count, i) => ({ label: String(min + i), value: min + i, count }));
    const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted.length > 0 ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;
    return { ...base, options, numeric: { average: Math.round(avg * 10) / 10, median, min, max } };
  }

  if (q.type === "nps") {
    const values = respuestas.map((r) => Number(r)).filter((n) => Number.isFinite(n));
    const counts = Array.from({ length: 11 }, (_, i) => values.filter((v) => v === i).length);
    const options: OptionAggregate[] = counts.map((count, i) => ({ label: String(i), value: i, count }));
    const detractors = counts.slice(0, 7).reduce((a, b) => a + b, 0);
    const passives = counts.slice(7, 9).reduce((a, b) => a + b, 0);
    const promoters = counts.slice(9, 11).reduce((a, b) => a + b, 0);
    const score = values.length > 0 ? Math.round(((promoters - detractors) / values.length) * 100) : 0;
    return { ...base, options, nps: { score, promoters, passives, detractors } };
  }

  return base;
}

export function questionsDataFromConfig(config: SurveyConfigRow, sessions: SurveySessionRow[]): SurveyQuestionsData {
  const questions: SurveyQuestionDef[] = [];
  const analytics: Record<string, QuestionAnalytics> = {};
  let order = 0;
  for (const q of config.questions) {
    if (q.type === "message") continue;
    order += 1;
    const def = toDef(q, order);
    if (!def) continue;
    questions.push(def);
    const respuestas = sessions.map((s) => s.answers[q.id]).filter((v): v is string | string[] | number => v !== undefined);
    analytics[q.id] = analyticsFor(def, respuestas);
  }
  return { surveyId: config.phone_number_id, completed: completedCount(sessions), questions, analytics };
}
