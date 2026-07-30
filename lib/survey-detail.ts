/**
 * Survey Detail — modelo de resultados de una encuesta (pantalla "Resumen").
 *
 * Alineado con DATA_AND_LOGIC.md del handoff. Es la referencia para el backend
 * real; por ahora la UI se alimenta de una fixture y de derivaciones sobre los
 * resúmenes demo del dashboard. Sin persistencia, sin motor, sin Meta.
 *
 * Regla de cuentas: los buckets de `results` son mutuamente excluyentes y su
 * suma es exactamente `sent`.
 */

import { surveyDashboardDemo } from "@/lib/surveys";

export type SurveyParticipantStatus =
  | "completed"
  | "no_response"
  | "abandoned"
  | "resume_later"
  | "declined"
  | "undelivered"
  | "in_progress";

export interface SurveyResultBucket {
  status: SurveyParticipantStatus;
  count: number;
}

export interface SurveyDetail {
  id: string;
  name: string;
  status: "active" | "paused" | "completed" | "draft";
  channel: "whatsapp";
  service?: string;
  questionCount: number;
  startDate?: string;
  endDate?: string;
  sent: number;
  started: number;
  results: SurveyResultBucket[];
  updatedAt: string;
}

/** Etiqueta bilingüe + color de acento semántico por estado operativo. */
export const STATUS_META: Record<SurveyParticipantStatus, { es: string; en: string; color: string }> = {
  completed: { es: "Respondió encuesta (completada)", en: "Completed the survey", color: "var(--color-lime)" },
  no_response: { es: "No respondió", en: "No response", color: "#a3e635" },
  abandoned: { es: "Inició pero no terminó", en: "Started but didn't finish", color: "#f59e0b" },
  resume_later: { es: "Solicitó continuar más tarde", en: "Asked to continue later", color: "#5b9bf3" },
  declined: { es: "No desea responder", en: "Declined to answer", color: "#a78bfa" },
  undelivered: { es: "Mensaje no entregado", en: "Message not delivered", color: "#f2555a" },
  in_progress: { es: "Encuesta en progreso", en: "Survey in progress", color: "#8b9298" },
};

/** Orden de estados tal como aparecen en el mockup. */
export const STATUS_ORDER: SurveyParticipantStatus[] = [
  "completed",
  "no_response",
  "abandoned",
  "resume_later",
  "declined",
  "undelivered",
  "in_progress",
];

// ---------- Métricas derivadas (DATA_AND_LOGIC.md) ----------

export const pct = (n: number, d: number): number => (d > 0 ? (n / d) * 100 : 0);

export function completedCount(d: SurveyDetail): number {
  return d.results.find((r) => r.status === "completed")?.count ?? 0;
}
export function nonEffectiveCount(d: SurveyDetail): number {
  return Math.max(0, d.sent - completedCount(d));
}
export function completionRate(d: SurveyDetail): number {
  return pct(completedCount(d), d.started);
}

// ---------- Formateo (es-CO, como el mockup, sin depender del reloj) ----------

const MONTHS = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

/** "Jun 01 – Jun 30, 2026" (en) / "jun 01 – jun 30, 2026" (es). */
export function formatDateRange(start: string, end: string, lang: "es" | "en"): string {
  const parse = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return { y, m: m - 1, d };
  };
  const a = parse(start);
  const b = parse(end);
  const mo = MONTHS[lang];
  const dd = (n: number) => String(n).padStart(2, "0");
  return `${mo[a.m]} ${dd(a.d)} – ${mo[b.m]} ${dd(b.d)}, ${b.y}`;
}

/** "28 Jul 2026, 14:35" — usa la hora de pared del ISO (ignora la zona del visor). */
export function formatUpdatedAt(iso: string, lang: "es" | "en"): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const [, y, mon, day, hh, mm] = m;
  return `${Number(day)} ${MONTHS[lang][Number(mon) - 1]} ${y}, ${hh}:${mm}`;
}

// ---------- Fixtures + resolución por id ----------

/** Fixture real entregada en el handoff (encuesta de satisfacción). */
const FIXTURE_SATISFACCION: SurveyDetail = {
  id: "srv-satisfaccion",
  name: "Encuesta satisfacción servicios",
  status: "active",
  channel: "whatsapp",
  service: "Crédito Social",
  questionCount: 15,
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  sent: 1000,
  started: 782,
  updatedAt: "2026-07-28T14:35:00-05:00",
  results: [
    { status: "completed", count: 691 },
    { status: "no_response", count: 87 },
    { status: "abandoned", count: 54 },
    { status: "resume_later", count: 42 },
    { status: "declined", count: 38 },
    { status: "undelivered", count: 35 },
    { status: "in_progress", count: 53 },
  ],
};

const FIXTURES: Record<string, SurveyDetail> = {
  [FIXTURE_SATISFACCION.id]: FIXTURE_SATISFACCION,
};

/** Proporciones de la fixture para repartir "no efectivas" en encuestas derivadas. */
const NON_COMPLETED_RATIOS: { status: SurveyParticipantStatus; weight: number }[] = FIXTURE_SATISFACCION.results
  .filter((r) => r.status !== "completed")
  .map((r) => ({ status: r.status, weight: r.count }));

/**
 * Deriva un SurveyDetail a partir del resumen demo del dashboard (números
 * reales ya existentes), repartiendo las "no efectivas" según las proporciones
 * de la fixture. No inventa métricas nuevas: solo distribuye las existentes.
 */
function deriveFromSummary(id: string): SurveyDetail | null {
  const s = surveyDashboardDemo.surveys.find((x) => x.id === id);
  if (!s) return null;

  const nonEffective = Math.max(0, s.sent - s.completed);
  const totalWeight = NON_COMPLETED_RATIOS.reduce((acc, r) => acc + r.weight, 0) || 1;

  const raw = NON_COMPLETED_RATIOS.map((r) => ({
    status: r.status,
    count: Math.floor((nonEffective * r.weight) / totalWeight),
  }));
  // Ajuste de redondeo para que la suma sea exactamente nonEffective.
  let assigned = raw.reduce((acc, r) => acc + r.count, 0);
  let i = 0;
  while (assigned < nonEffective && raw.length > 0) {
    raw[i % raw.length].count += 1;
    assigned += 1;
    i += 1;
  }

  return {
    id: s.id,
    name: s.name,
    status: s.status === "paused" || s.status === "archived" ? "paused" : s.status,
    channel: "whatsapp",
    questionCount: s.questionCount,
    sent: s.sent,
    started: s.started,
    updatedAt: FIXTURE_SATISFACCION.updatedAt,
    results: [{ status: "completed" as const, count: s.completed }, ...raw],
  };
}

/** Resuelve el detalle de una encuesta por id (fixture real o derivada). */
export function getSurveyDetail(id: string): SurveyDetail | null {
  return FIXTURES[id] ?? deriveFromSummary(id);
}
