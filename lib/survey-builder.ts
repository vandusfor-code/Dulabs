/**
 * Survey Builder — modelo de la definición de una encuesta.
 *
 * `SurveyQuestion` es la fuente única de verdad del tipo de pregunta: lo usa
 * tanto el Builder de /dashboard/surveys/new como el motor real del bot
 * (lib/survey-engine.ts la importa directamente) y se persiste tal cual en
 * la columna `questions` (jsonb) de `dulabs_survey_bot_config`.
 */

export type QuestionType =
  | "message"
  | "single_choice"
  | "multiple_choice"
  | "yes_no"
  | "rating_1_5"
  | "rating_1_10"
  | "nps_0_10"
  | "open_text";

export interface SurveyQuestion {
  id: string;
  type: QuestionType;
  text: string;
  required: boolean;
  helpText?: string;
  /** single_choice / multiple_choice */
  options?: string[];
  /** rating_* / nps_* */
  minLabel?: string;
  maxLabel?: string;
}

/** Tipos que se responden con una escala numérica. */
export const SCALE_TYPES: QuestionType[] = ["rating_1_5", "rating_1_10", "nps_0_10"];
/** Tipos que se responden eligiendo entre opciones. */
export const CHOICE_TYPES: QuestionType[] = ["single_choice", "multiple_choice"];

export function isScaleType(t: QuestionType): boolean {
  return SCALE_TYPES.includes(t);
}
export function isChoiceType(t: QuestionType): boolean {
  return CHOICE_TYPES.includes(t);
}

/** Rango numérico [min, max] de un tipo de escala (para pintar botones). */
export function scaleRange(t: QuestionType): [number, number] | null {
  switch (t) {
    case "rating_1_5":
      return [1, 5];
    case "rating_1_10":
      return [1, 10];
    case "nps_0_10":
      return [0, 10];
    default:
      return null;
  }
}

export interface TypeMeta {
  /** Etiqueta compacta para el badge de la lista, ej. "Rating 1–10". */
  badge: { es: string; en: string };
  /** Etiqueta larga para el <select> de tipo, ej. "Rating (1–10)". */
  select: { es: string; en: string };
  /** Etiqueta corta para el selector de preview, ej. "Rating". */
  short: { es: string; en: string };
  /** Clases del badge (color por familia de tipo). */
  badgeClass: string;
}

export const TYPE_META: Record<QuestionType, TypeMeta> = {
  message: {
    badge: { es: "Mensaje", en: "Message" },
    select: { es: "Mensaje (sin respuesta)", en: "Message (no answer)" },
    short: { es: "Mensaje", en: "Message" },
    badgeClass: "bg-sky-400/15 text-sky-400",
  },
  single_choice: {
    badge: { es: "Opción única", en: "Single choice" },
    select: { es: "Opción única", en: "Single choice" },
    short: { es: "Opción única", en: "Single choice" },
    badgeClass: "bg-violet-500/15 text-violet-300",
  },
  multiple_choice: {
    badge: { es: "Opción múltiple", en: "Multiple choice" },
    select: { es: "Opción múltiple", en: "Multiple choice" },
    short: { es: "Múltiple", en: "Multiple" },
    badgeClass: "bg-indigo-500/15 text-indigo-300",
  },
  yes_no: {
    badge: { es: "Sí / No", en: "Yes / No" },
    select: { es: "Sí / No", en: "Yes / No" },
    short: { es: "Sí / No", en: "Yes / No" },
    badgeClass: "bg-cyan-500/15 text-cyan-300",
  },
  rating_1_5: {
    badge: { es: "Rating 1–5", en: "Rating 1–5" },
    select: { es: "Rating (1–5)", en: "Rating (1–5)" },
    short: { es: "Rating", en: "Rating" },
    badgeClass: "bg-lime/12 text-lime-text",
  },
  rating_1_10: {
    badge: { es: "Rating 1–10", en: "Rating 1–10" },
    select: { es: "Rating (1–10)", en: "Rating (1–10)" },
    short: { es: "Rating", en: "Rating" },
    badgeClass: "bg-lime/12 text-lime-text",
  },
  nps_0_10: {
    badge: { es: "NPS 0–10", en: "NPS 0–10" },
    select: { es: "NPS (0–10)", en: "NPS (0–10)" },
    short: { es: "NPS", en: "NPS" },
    badgeClass: "bg-amber-400/15 text-amber-400",
  },
  open_text: {
    badge: { es: "Texto libre", en: "Open text" },
    select: { es: "Texto libre", en: "Open text" },
    short: { es: "Texto", en: "Text" },
    badgeClass: "bg-ink text-mist",
  },
};

/** Orden en que se listan los tipos dentro del <select> del editor. */
export const QUESTION_TYPE_ORDER: QuestionType[] = [
  "single_choice",
  "multiple_choice",
  "yes_no",
  "rating_1_5",
  "rating_1_10",
  "nps_0_10",
  "open_text",
  "message",
];

/** Estimación de duración: ~13s por pregunta, en minutos (mínimo 1). */
export function estimatedMinutes(count: number): number {
  return Math.max(1, Math.round((count * 13) / 60));
}

let idCounter = 0;
export function newQuestionId(): string {
  idCounter += 1;
  return `q-${Date.now().toString(36)}-${idCounter}`;
}

/** Pregunta nueva por defecto al pulsar "Add question". */
export function createBlankQuestion(): SurveyQuestion {
  return {
    id: newQuestionId(),
    type: "single_choice",
    text: "",
    required: true,
    helpText: "",
    options: ["", ""],
  };
}

