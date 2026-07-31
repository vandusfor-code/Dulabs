/**
 * Survey Detail — modelo de resultados de una encuesta (pantalla "Resumen").
 *
 * Los datos reales los arma lib/survey-stats.ts (detailFromConfig) a partir
 * de dulabs_survey_bot_config + dulabs_survey_sessions.
 *
 * Regla de cuentas: los buckets de `results` son mutuamente excluyentes y su
 * suma es exactamente `sent`.
 */

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

