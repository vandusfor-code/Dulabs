/**
 * Surveys — data contract + demo dataset.
 *
 * La UI se alimenta de estos tipos, no de valores hardcoded dentro de los
 * componentes. Cuando exista el backend conversacional (ver
 * SURVEYS_DATA_MODEL.md), basta con devolver estas mismas formas desde
 * `/api/dashboard/surveys` y reemplazar `surveyDashboardDemo`.
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
  insights: AIInsights;
}

/** Dataset de demostración — reemplazable por datos reales sin tocar la UI. */
export const surveyDashboardDemo: SurveyDashboard = {
  kpis: {
    sent: 5000,
    started: 3420,
    completed: 2891,
    completionRate: 84.5,
    deltas: { sent: 12, started: 8, completed: 15, completionRate: 6 },
  },
  performance: [
    { label: "W2 Jun", started: 950, completed: 650 },
    { label: "W3 Jun", started: 1600, completed: 1220 },
    { label: "W4 Jun", started: 1180, completed: 900 },
    { label: "W1 Jul", started: 1280, completed: 1010 },
    { label: "W2 Jul", started: 1760, completed: 1400 },
    { label: "W3 Jul", started: 900, completed: 650 },
  ],
  funnel: [
    { key: "invited", value: 5000, percentage: 100 },
    { key: "started", value: 3420, percentage: 68.4 },
    { key: "q5", value: 3287, percentage: 65.7 },
    { key: "q10", value: 3051, percentage: 61.0 },
    { key: "completed", value: 2891, percentage: 57.8 },
  ],
  surveys: [
    {
      id: "srv-satisfaccion",
      name: "Encuesta satisfacción servicios",
      status: "active",
      questionCount: 15,
      sent: 1000,
      started: 782,
      completed: 691,
      completionRate: 69.1,
      updatedAt: { es: "hace 2 min", en: "2 min ago" },
    },
    {
      id: "srv-presencial",
      name: "Experiencia atención presencial",
      status: "completed",
      questionCount: 10,
      sent: 2500,
      started: 1940,
      completed: 1721,
      completionRate: 88.7,
      updatedAt: { es: "hace 1 hora", en: "1 hour ago" },
    },
    {
      id: "srv-nps",
      name: "NPS – Recomendación",
      status: "active",
      questionCount: 8,
      sent: 800,
      started: 512,
      completed: 423,
      completionRate: 82.6,
      updatedAt: { es: "hace 3 horas", en: "3 hours ago" },
    },
    {
      id: "srv-telefonico",
      name: "Calidad del servicio telefónico",
      status: "draft",
      questionCount: 12,
      sent: 0,
      started: 0,
      completed: 0,
      completionRate: 0,
      updatedAt: { es: "20 jul 2026", en: "Jul 20, 2026" },
    },
  ],
  insights: {
    completedResponses: 2891,
    sentiment: {
      positive: { percentage: 78, count: 2256 },
      neutral: { percentage: 14, count: 405 },
      negative: { percentage: 8, count: 230 },
    },
    topics: [
      { label: "Atención del personal", percentage: 42 },
      { label: "Tiempo de espera", percentage: 28 },
      { label: "Información clara", percentage: 18 },
      { label: "Instalaciones", percentage: 12 },
    ],
  },
};
