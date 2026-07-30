/**
 * Survey Builder — modelo de la definición de una encuesta (borrador).
 *
 * Alineado con ARCHITECTURE.md del handoff. Es la referencia para el backend
 * real (tablas `surveys` / `survey_questions`), pero por ahora solo alimenta la
 * UI del constructor con estado local. No hay persistencia ni motor todavía.
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

export type SurveyDraftStatus = "draft" | "active" | "paused" | "completed" | "archived";

export interface SurveyDraft {
  id: string;
  name: string;
  status: SurveyDraftStatus;
  /** Mensaje de bienvenida que abre la conversación en WhatsApp. */
  greeting: string;
  questions: SurveyQuestion[];
  conditionalPaths: number;
  completionGoal: string;
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

/** Borrador de demostración (encuesta de satisfacción Cofrem — 18 preguntas). */
export function createDemoDraft(): SurveyDraft {
  const q = (partial: Omit<SurveyQuestion, "id">): SurveyQuestion => ({ id: newQuestionId(), ...partial });
  return {
    id: "srv-cofrem-credito-social",
    name: "Crédito Social Cofrem",
    status: "draft",
    greeting:
      "Hola Duvan 👋\nQueremos conocer tu experiencia con nuestro servicio Crédito Social.\nSon 18 preguntas rápidas y tus respuestas nos ayudan a mejorar.",
    conditionalPaths: 2,
    completionGoal: "Increase response rate",
    questions: [
      q({
        type: "single_choice",
        text: "Municipio donde recibió el servicio",
        required: true,
        options: ["Armenia", "Calarcá", "Montenegro", "La Tebaida", "Circasia", "Otro"],
      }),
      q({
        type: "single_choice",
        text: "¿A través de qué medio se enteró del servicio Crédito Social Cofrem?",
        required: true,
        options: ["Redes sociales", "Recomendación", "Página web", "En la oficina", "Otro"],
      }),
      q({
        type: "rating_1_10",
        text: "¿Cómo califica la comodidad y adecuación de nuestras salas de espera y áreas de atención?",
        required: true,
        minLabel: "Muy deficiente",
        maxLabel: "Excelente",
        helpText: "Califique siendo 1 muy deficiente y 10 excelente",
      }),
      q({
        type: "rating_1_10",
        text: "¿Sintió que los módulos de atención ofrecían la privacidad necesaria para tratar sus trámites?",
        required: true,
        minLabel: "Nada de acuerdo",
        maxLabel: "Totalmente de acuerdo",
      }),
      q({
        type: "rating_1_10",
        text: "¿Cómo califica la claridad de la información proporcionada por nuestros asesores?",
        required: true,
        minLabel: "Muy deficiente",
        maxLabel: "Excelente",
      }),
      q({
        type: "rating_1_10",
        text: "¿Cómo califica la actitud y disposición de nuestros asesores para ayudarle?",
        required: true,
        minLabel: "Muy deficiente",
        maxLabel: "Excelente",
      }),
      q({
        type: "rating_1_10",
        text: "¿Cómo califica el tiempo de espera para ser atendido?",
        required: true,
        minLabel: "Muy largo",
        maxLabel: "Muy corto",
      }),
      q({
        type: "rating_1_10",
        text: "¿Cómo califica la agilidad en la solución de su solicitud?",
        required: true,
        minLabel: "Muy lenta",
        maxLabel: "Muy ágil",
      }),
      q({
        type: "yes_no",
        text: "¿Le ofrecieron información clara sobre las condiciones del Crédito Social?",
        required: true,
      }),
      q({
        type: "rating_1_10",
        text: "¿Cómo califica la limpieza y presentación de nuestras instalaciones?",
        required: true,
        minLabel: "Muy deficiente",
        maxLabel: "Excelente",
      }),
      q({
        type: "rating_1_5",
        text: "¿Qué tan satisfecho quedó con la atención recibida en general?",
        required: true,
        minLabel: "Nada satisfecho",
        maxLabel: "Muy satisfecho",
      }),
      q({
        type: "single_choice",
        text: "¿Qué canal prefiere para futuras comunicaciones?",
        required: false,
        options: ["WhatsApp", "Llamada", "Correo electrónico", "SMS"],
      }),
      q({
        type: "yes_no",
        text: "¿Resolvió su trámite en una sola visita?",
        required: true,
      }),
      q({
        type: "rating_1_10",
        text: "¿Cómo califica la facilidad para agendar su cita?",
        required: false,
        minLabel: "Muy difícil",
        maxLabel: "Muy fácil",
      }),
      q({
        type: "multiple_choice",
        text: "¿Qué aspectos podríamos mejorar?",
        required: false,
        helpText: "Puede elegir varias opciones",
        options: ["Tiempo de espera", "Atención del personal", "Instalaciones", "Información", "Horarios"],
      }),
      q({
        type: "open_text",
        text: "¿Qué fue lo que más valoró de su experiencia?",
        required: false,
      }),
      q({
        type: "nps_0_10",
        text: "¿Qué tan probable es que recomiende Cofrem a un familiar o amigo?",
        required: true,
        minLabel: "Nada probable",
        maxLabel: "Muy probable",
      }),
      q({
        type: "open_text",
        text: "¿Tiene algún comentario o sugerencia adicional?",
        required: false,
      }),
    ],
  };
}
