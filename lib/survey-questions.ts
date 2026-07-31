/**
 * Survey Questions — análisis por pregunta (pestaña "Preguntas" del detalle).
 *
 * La UI se deriva del `type` de cada pregunta (dispatcher), no de valores
 * hardcoded. Los datos reales los arma lib/survey-stats.ts
 * (questionsDataFromConfig) a partir de las respuestas guardadas en
 * dulabs_survey_sessions.
 */

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
