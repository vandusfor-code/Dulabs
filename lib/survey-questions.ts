/**
 * Survey Questions — análisis por pregunta (pestaña "Preguntas" del detalle).
 *
 * Alineado con DATA_MODEL.md / QUESTION_TYPE_RENDERING.md del handoff. La UI se
 * deriva del `type` de cada pregunta (dispatcher), no de valores hardcoded.
 * Datos demo por ahora; el backend real reemplazará `getSurveyQuestions`.
 */

import { surveyDashboardDemo } from "@/lib/surveys";

export type SurveyQuestionType =
  | "single_choice"
  | "multiple_choice"
  | "scale"
  | "nps"
  | "yes_no"
  | "rating"
  | "category"
  | "location"
  | "free_text"
  | "date"
  | "number";

export interface QuestionOption {
  id?: string;
  label: string;
  value?: string | number;
  /** Acento semántico opcional para el punto de la opción (si no, verde). */
  color?: string;
}

export interface SurveyQuestionDef {
  id: string;
  order: number;
  text: string;
  type: SurveyQuestionType;
  required: boolean;
  options?: QuestionOption[];
  config?: {
    scaleMin?: number;
    scaleMax?: number;
    /** Etiquetas consideradas "positivas" (para el insight de calidad). */
    positiveValues?: string[];
  };
  /** Sujeto del insight positivo, ej. "la comodidad de nuestras salas". */
  insightSubject?: { es: string; en: string };
}

export interface OptionAggregate {
  label: string;
  value?: string | number;
  count: number;
  color?: string;
}

export interface QuestionAnalytics {
  questionId: string;
  answered: number;
  skipped: number;
  uniqueRespondents: number;
  totalSelections?: number;
  averageSeconds?: number;
  options?: OptionAggregate[];
  numeric?: { average?: number; median?: number; min?: number; max?: number };
  nps?: { score: number; promoters: number; passives: number; detractors: number };
  textResponses?: Array<{ id: string; text: string; createdAt: string }>;
}

export interface SurveyQuestionsData {
  surveyId: string;
  /** Encuestas completadas (denominador de "% del total de completadas"). */
  completed: number;
  questions: SurveyQuestionDef[];
  analytics: Record<string, QuestionAnalytics>;
}

export const TYPE_LABEL: Record<SurveyQuestionType, { es: string; en: string }> = {
  single_choice: { es: "Opción única", en: "Single choice" },
  multiple_choice: { es: "Opción múltiple", en: "Multiple choice" },
  scale: { es: "Escala", en: "Scale" },
  nps: { es: "NPS", en: "NPS" },
  yes_no: { es: "Sí / No", en: "Yes / No" },
  rating: { es: "Calificación", en: "Rating" },
  category: { es: "Categoría", en: "Category" },
  location: { es: "Ubicación", en: "Location" },
  free_text: { es: "Texto libre", en: "Open text" },
  date: { es: "Fecha", en: "Date" },
  number: { es: "Número", en: "Number" },
};

export const pct = (n: number, d: number): number => (d > 0 ? (n / d) * 100 : 0);

// ---------- Builders de analytics ----------

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Expande [{value,count}] a la lista de valores individuales (para promedio/mediana). */
function expand(pairs: { value: number; count: number }[]): number[] {
  return pairs.flatMap((p) => Array<number>(p.count).fill(p.value));
}

function scaleAnalytics(id: string, counts: number[], min: number, averageSeconds: number): QuestionAnalytics {
  const options: OptionAggregate[] = counts.map((count, i) => ({ label: String(min + i), value: min + i, count }));
  const answered = counts.reduce((a, b) => a + b, 0);
  const values = expand(counts.map((count, i) => ({ value: min + i, count })));
  const avg = answered > 0 ? values.reduce((a, b) => a + b, 0) / answered : 0;
  return {
    questionId: id,
    answered,
    skipped: 0,
    uniqueRespondents: answered,
    averageSeconds,
    options,
    numeric: { average: Math.round(avg * 10) / 10, median: median(values), min: min, max: min + counts.length - 1 },
  };
}

function npsAnalytics(id: string, counts: number[], averageSeconds: number): QuestionAnalytics {
  // counts index 0..10
  const options: OptionAggregate[] = counts.map((count, i) => ({ label: String(i), value: i, count }));
  const answered = counts.reduce((a, b) => a + b, 0);
  const detractors = counts.slice(0, 7).reduce((a, b) => a + b, 0);
  const passives = counts.slice(7, 9).reduce((a, b) => a + b, 0);
  const promoters = counts.slice(9, 11).reduce((a, b) => a + b, 0);
  const score = answered > 0 ? Math.round(((promoters - detractors) / answered) * 100) : 0;
  return {
    questionId: id,
    answered,
    skipped: 0,
    uniqueRespondents: answered,
    averageSeconds,
    options,
    nps: { score, promoters, passives, detractors },
  };
}

function choiceAnalytics(id: string, options: OptionAggregate[], averageSeconds: number): QuestionAnalytics {
  const answered = options.reduce((a, o) => a + o.count, 0);
  return { questionId: id, answered, skipped: 0, uniqueRespondents: answered, averageSeconds, options };
}

// ---------- Dataset demo (encuesta de satisfacción, 16 respuestas) ----------

const QUALITY_COLORS = { great: "var(--color-lime)", good: "var(--color-lime)", mid: "#facc15", low: "#f59e0b", none: "#f2555a" };

function buildSatisfaccion(): SurveyQuestionsData {
  const q: SurveyQuestionDef[] = [
    {
      id: "q1", order: 1, type: "location", required: true,
      text: "Municipio donde recibió los servicios de Crédito Social.",
      options: ["Villavicencio", "Acacías", "Granada", "Guamal", "San Martín", "Puerto López", "Cumaral", "Restrepo", "Vista Hermosa", "Puerto Concordia", "San Carlos de Guaroa", "Cabuyaro", "Puerto Gaitán"].map((label, i) => ({ label, order: i + 1 })),
    },
    {
      id: "q2", order: 2, type: "single_choice", required: true,
      text: "¿A través de qué medio se enteró del servicio Crédito Social Cofrem?",
      options: ["Redes sociales", "Recomendación", "Página web", "En la oficina", "Otro"].map((label) => ({ label })),
    },
    {
      id: "q3", order: 3, type: "single_choice", required: true,
      text: "¿Cómo califica la comodidad y adecuación de nuestras salas de espera y áreas de atención?",
      options: [
        { label: "Excelente", color: QUALITY_COLORS.great },
        { label: "Bueno", color: QUALITY_COLORS.good },
        { label: "Regular", color: QUALITY_COLORS.mid },
        { label: "Malo", color: QUALITY_COLORS.low },
        { label: "No conoce la oficina", color: QUALITY_COLORS.none },
      ],
      config: { positiveValues: ["Excelente", "Bueno"] },
      insightSubject: { es: "la comodidad y adecuación de nuestras salas", en: "the comfort and adequacy of our waiting areas" },
    },
    { id: "q4", order: 4, type: "scale", required: true, config: { scaleMin: 1, scaleMax: 10 }, text: "En una escala del 1 (muy deficiente) al 10 (excelente), califique la privacidad de los módulos de atención." },
    { id: "q5", order: 5, type: "scale", required: true, config: { scaleMin: 1, scaleMax: 10 }, text: "En una escala del 1 (muy deficiente) al 10 (excelente), califique la claridad de la información de los asesores." },
    { id: "q6", order: 6, type: "scale", required: true, config: { scaleMin: 1, scaleMax: 10 }, text: "En una escala del 1 (muy deficiente) al 10 (excelente), califique la actitud y disposición de los asesores." },
    { id: "q7", order: 7, type: "scale", required: true, config: { scaleMin: 1, scaleMax: 10 }, text: "En una escala del 1 (muy deficiente) al 10 (excelente), califique el tiempo de espera para ser atendido." },
    { id: "q8", order: 8, type: "scale", required: true, config: { scaleMin: 1, scaleMax: 10 }, text: "En una escala del 1 (muy deficiente) al 10 (excelente), califique la agilidad en la solución de su solicitud." },
    { id: "q9", order: 9, type: "yes_no", required: true, text: "¿Le ofrecieron información clara sobre las condiciones del Crédito Social?" },
    { id: "q10", order: 10, type: "scale", required: true, config: { scaleMin: 1, scaleMax: 10 }, text: "En una escala del 1 (muy deficiente) al 10 (excelente), califique la limpieza de nuestras instalaciones." },
    {
      id: "q11", order: 11, type: "rating", required: true, config: { scaleMin: 1, scaleMax: 5 },
      text: "¿Qué tan satisfecho quedó con la atención recibida en general?",
    },
    {
      id: "q12", order: 12, type: "single_choice", required: false,
      text: "¿Qué canal prefiere para futuras comunicaciones?",
      options: ["WhatsApp", "Llamada", "Correo electrónico", "SMS"].map((label) => ({ label })),
    },
    { id: "q13", order: 13, type: "yes_no", required: true, text: "¿Resolvió su trámite en una sola visita?" },
    { id: "q14", order: 14, type: "nps", required: true, config: { scaleMin: 0, scaleMax: 10 }, text: "¿Qué tan probable es que recomiende Cofrem a un familiar o amigo?" },
    { id: "q15", order: 15, type: "free_text", required: false, text: "¿Tiene algún comentario o sugerencia adicional?" },
  ];

  const yn = (yes: number, no: number, id: string): QuestionAnalytics =>
    choiceAnalytics(id, [{ label: "Sí", count: yes }, { label: "No", count: no }], 8);

  const analytics: Record<string, QuestionAnalytics> = {
    q1: choiceAnalytics("q1", [
      { label: "Villavicencio", count: 6 }, { label: "Acacías", count: 3 }, { label: "Granada", count: 2 },
      { label: "Guamal", count: 1 }, { label: "San Martín", count: 1 }, { label: "Puerto López", count: 1 },
      { label: "Cumaral", count: 1 }, { label: "Restrepo", count: 1 }, { label: "Vista Hermosa", count: 0 },
      { label: "Puerto Concordia", count: 0 }, { label: "San Carlos de Guaroa", count: 0 }, { label: "Cabuyaro", count: 0 }, { label: "Puerto Gaitán", count: 0 },
    ], 9),
    q2: choiceAnalytics("q2", [
      { label: "Redes sociales", count: 5 }, { label: "Recomendación", count: 6 }, { label: "Página web", count: 2 },
      { label: "En la oficina", count: 2 }, { label: "Otro", count: 1 },
    ], 10),
    q3: choiceAnalytics("q3", [
      { label: "Excelente", count: 6, color: QUALITY_COLORS.great },
      { label: "Bueno", count: 8, color: QUALITY_COLORS.good },
      { label: "Regular", count: 0, color: QUALITY_COLORS.mid },
      { label: "Malo", count: 0, color: QUALITY_COLORS.low },
      { label: "No conoce la oficina", count: 2, color: QUALITY_COLORS.none },
    ], 12),
    q4: scaleAnalytics("q4", [0, 0, 0, 0, 1, 1, 2, 3, 4, 5], 1, 14),
    q5: scaleAnalytics("q5", [0, 0, 0, 1, 0, 1, 2, 4, 4, 4], 1, 13),
    q6: scaleAnalytics("q6", [0, 0, 0, 0, 0, 1, 1, 3, 5, 6], 1, 11),
    q7: scaleAnalytics("q7", [0, 1, 0, 1, 1, 2, 2, 3, 3, 3], 1, 15),
    q8: scaleAnalytics("q8", [0, 0, 1, 0, 1, 2, 2, 3, 4, 3], 1, 13),
    q9: yn(14, 2, "q9"),
    q10: scaleAnalytics("q10", [0, 0, 0, 0, 0, 0, 2, 3, 5, 6], 1, 10),
    q11: scaleAnalytics("q11", [0, 0, 2, 6, 8], 1, 9),
    q12: choiceAnalytics("q12", [
      { label: "WhatsApp", count: 9 }, { label: "Llamada", count: 4 }, { label: "Correo electrónico", count: 2 }, { label: "SMS", count: 1 },
    ], 8),
    q13: yn(12, 4, "q13"),
    q14: npsAnalytics("q14", [0, 0, 0, 0, 0, 1, 1, 2, 2, 4, 6], 12),
    q15: {
      questionId: "q15", answered: 9, skipped: 7, uniqueRespondents: 9, averageSeconds: 26,
      textResponses: [
        { id: "t1", text: "Excelente atención, los asesores fueron muy amables y claros.", createdAt: "2026-06-28T10:12:00-05:00" },
        { id: "t2", text: "El tiempo de espera fue un poco largo, pero valió la pena.", createdAt: "2026-06-27T16:40:00-05:00" },
        { id: "t3", text: "Muy buen servicio, resolví todo en una sola visita.", createdAt: "2026-06-26T09:05:00-05:00" },
        { id: "t4", text: "Sería ideal poder agendar la cita por WhatsApp.", createdAt: "2026-06-25T14:22:00-05:00" },
        { id: "t5", text: "Las instalaciones son cómodas y limpias.", createdAt: "2026-06-24T11:48:00-05:00" },
        { id: "t6", text: "Me gustaría recibir más información sobre otros productos.", createdAt: "2026-06-23T17:03:00-05:00" },
      ],
    },
  };

  return { surveyId: "srv-satisfaccion", completed: 16, questions: q, analytics };
}

const SATISFACCION = buildSatisfaccion();

/** Set genérico para encuestas secundarias (no es la del mockup). */
function buildGeneric(surveyId: string): SurveyQuestionsData {
  const summary = surveyDashboardDemo.surveys.find((s) => s.id === surveyId);
  const count = summary?.questionCount ?? 8;
  const answered = Math.max(0, Math.min(summary?.completed ?? 0, 12));
  const questions: SurveyQuestionDef[] = Array.from({ length: count }, (_, i) => ({
    id: `g${i + 1}`,
    order: i + 1,
    type: "single_choice" as const,
    required: true,
    text: `Pregunta ${i + 1}`,
    options: ["Muy satisfecho", "Satisfecho", "Neutral", "Insatisfecho"].map((label) => ({ label })),
  }));
  const analytics: Record<string, QuestionAnalytics> = {};
  for (const q of questions) {
    const a = answered;
    analytics[q.id] = choiceAnalytics(q.id, [
      { label: "Muy satisfecho", count: Math.round(a * 0.5) },
      { label: "Satisfecho", count: Math.round(a * 0.3) },
      { label: "Neutral", count: Math.round(a * 0.15) },
      { label: "Insatisfecho", count: a - Math.round(a * 0.5) - Math.round(a * 0.3) - Math.round(a * 0.15) },
    ], 10);
  }
  return { surveyId, completed: answered, questions, analytics };
}

export function getSurveyQuestions(surveyId: string): SurveyQuestionsData {
  if (surveyId === SATISFACCION.surveyId) return SATISFACCION;
  return buildGeneric(surveyId);
}

const round = (n: number) => Math.round(n);

/**
 * Insight determinístico a partir de los datos (sin IA). Devuelve null si no
 * aplica (sin respuestas o tipo sin insight útil).
 */
export function computeInsight(
  q: SurveyQuestionDef,
  a: QuestionAnalytics,
  t: (es: string, en: string) => string
): string | null {
  if (!a || a.answered === 0) return null;

  const positive = q.config?.positiveValues;
  if (positive && a.options && (q.type === "single_choice" || q.type === "rating" || q.type === "scale")) {
    const pos = a.options.filter((o) => positive.includes(o.label)).reduce((s, o) => s + o.count, 0);
    const p = round(pct(pos, a.answered));
    const subject = q.insightSubject ? t(q.insightSubject.es, q.insightSubject.en) : t("esta pregunta", "this question");
    return t(
      `El ${p}% de los participantes calificó positivamente ${subject}.`,
      `${p}% of participants rated ${subject} positively.`
    );
  }

  if (q.type === "nps" && a.nps) {
    return t(
      `NPS de ${a.nps.score}: ${a.nps.promoters} promotores y ${a.nps.detractors} detractores.`,
      `NPS of ${a.nps.score}: ${a.nps.promoters} promoters and ${a.nps.detractors} detractors.`
    );
  }

  if ((q.type === "scale" || q.type === "rating") && a.numeric?.average != null) {
    const max = q.config?.scaleMax ?? 10;
    return t(
      `El promedio fue ${a.numeric.average} sobre ${max}.`,
      `The average was ${a.numeric.average} out of ${max}.`
    );
  }

  if (q.type === "free_text") {
    return t(
      `Se recibieron ${a.answered} respuestas de texto libre.`,
      `${a.answered} open-text responses were received.`
    );
  }

  if (a.options && a.options.length > 0) {
    const top = [...a.options].sort((x, y) => y.count - x.count)[0];
    if (top.count === 0) return null;
    const p = round(pct(top.count, a.answered));
    return t(
      `La opción más seleccionada fue “${top.label}” con ${p}%.`,
      `The most selected option was “${top.label}” with ${p}%.`
    );
  }

  return null;
}
