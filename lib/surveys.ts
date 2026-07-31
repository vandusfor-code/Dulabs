/**
 * Surveys — contrato de datos del panel /dashboard/surveys.
 *
 * Los valores reales los arma GET /api/dashboard/surveys (ver
 * lib/survey-stats.ts) a partir de dulabs_survey_bot_config +
 * dulabs_survey_sessions — una "encuesta" en esta UI es la encuesta activa
 * de un número de WhatsApp.
 */

export type SurveyStatus = "draft" | "active" | "paused" | "completed" | "archived";

/** Texto ya listo para mostrar en ambos idiomas (evita depender del reloj en la demo). */
export interface LocalizedText {
  es: string;
  en: string;
}

export interface SurveySummary {
  id: string;
  name: string;
  status: SurveyStatus;
  questionCount: number;
  sent: number;
  started: number;
  completed: number;
  completionRate: number;
  updatedAt: LocalizedText;
}

export interface SurveyKpis {
  sent: number;
  started: number;
  completed: number;
  completionRate: number;
  deltas: {
    sent: number;
    started: number;
    completed: number;
    completionRate: number;
  };
}

export interface SurveyPerformancePoint {
  label: string;
  started: number;
  completed: number;
}

export type FunnelStepKey = "invited" | "started" | "q5" | "q10" | "completed";

export interface FunnelStep {
  key: FunnelStepKey;
  value: number;
  percentage: number;
}

export interface AIInsights {
  completedResponses: number;
  sentiment: {
    positive: { percentage: number; count: number };
    neutral: { percentage: number; count: number };
    negative: { percentage: number; count: number };
  };
  topics: Array<{ label: string; percentage: number }>;
}

export interface SurveyDashboard {
  kpis: SurveyKpis;
  performance: SurveyPerformancePoint[];
  funnel: FunnelStep[];
  surveys: SurveySummary[];
  /** null = todavía no hay suficientes respuestas de texto libre para un análisis real. */
  insights: AIInsights | null;
}
