// DuLabs Business — Business Agent 2.0, FASE 6 — errores en lenguaje humano.
//
// Nada técnico llega a la pantalla: cada error del modelo, del compilador o de la verificación con datos reales se
// traduce a "qué pasa y dónde se arregla" (paso + campo) y lleva un código de soporte estable (BA-VAL-012). El detalle
// técnico queda en los logs del servidor.

export const ONBOARDING_STEPS = ["negocio", "oferta", "citas", "horario", "atencion", "reglas", "prueba", "activar"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingIssue {
  step: OnboardingStep;
  /** Campo del borrador (ruta con puntos) para resaltar en la pantalla, si aplica. */
  field?: string;
  message: string;
  /** Código de soporte estable (se muestra en pequeño). */
  code: string;
  severity: "error" | "warning";
}

/** Códigos de soporte: prefijo por etapa + número estable. */
export const SUPPORT_CODES = {
  // Borrador
  DRAFT_INVALID: "BA-DRF-001",
  DRAFT_CONFLICT: "BA-DRF-002",
  DRAFT_STORE: "BA-DRF-003",
  // Validación del negocio
  NAME_MISSING: "BA-VAL-001",
  TIMEZONE_INVALID: "BA-VAL-002",
  TIMEZONE_NOT_SUPPORTED: "BA-VAL-003",
  CATALOG_EMPTY: "BA-VAL-004",
  QUOTES_NEED_CATALOG: "BA-VAL-005",
  AGENDA_MISSING: "BA-VAL-006",
  HOURS_INVALID: "BA-VAL-007",
  HOURS_OVERLAP: "BA-VAL-008",
  HOURS_REQUIRED: "BA-VAL-009",
  CHANGES_NEED_CALENDAR: "BA-VAL-010",
  HANDOFF_NEEDED: "BA-VAL-011",
  FIELD_INVALID: "BA-VAL-012",
  FIELD_PROTECTED: "BA-VAL-013",
  FIELD_DUPLICATE: "BA-VAL-014",
  TOPIC_INVALID: "BA-VAL-015",
  MODEL_OTHER: "BA-VAL-016",
  RUNTIME_RULES: "BA-VAL-017",
  // FASE 8
  RESOURCES_NEED_CALENDAR: "BA-VAL-018",
  RESOURCE_INVALID: "BA-VAL-019",
  LEAD_NEEDS_NAME: "BA-VAL-020",
  REMINDERS_NEED_BOOKING: "BA-VAL-021",
  ENGINE_REQUIRED: "BA-VAL-022",
  // Datos reales (readiness)
  READINESS: "BA-RDY-001",
  // Publicación
  PUBLISH_INVALID: "BA-PUB-001",
  PUBLISH_NOT_READY: "BA-PUB-002",
  PUBLISH_COMPILE: "BA-PUB-003",
  PUBLISH_CONFLICT: "BA-PUB-004",
  PUBLISH_PROJECTION: "BA-PUB-005",
  PUBLISH_STORE: "BA-PUB-006",
  PUBLISH_REJECTED_BY_DB: "BA-PUB-007",
  // Activación
  ACTIVATE_NOT_PUBLISHED: "BA-ACT-001",
  ACTIVATE_OUTDATED: "BA-ACT-002",
  ACTIVATE_BLOCKED: "BA-ACT-003",
  ACTIVATE_NUMBER: "BA-ACT-004",
  ACTIVATE_STORE: "BA-ACT-005",
  // Simulación
  SIM_INCOMPLETE: "BA-SIM-001",
  SIM_UNAVAILABLE: "BA-SIM-002",
  SIM_STATE: "BA-SIM-003",
} as const;

/** Paso del configurador donde se arregla cada paso de la verificación con datos reales (readiness). */
export const READINESS_STEP: Readonly<Record<string, OnboardingStep>> = {
  capacidades: "oferta",
  servicios: "oferta",
  agendamiento: "citas",
  horarios: "horario",
  datos: "atencion",
  conocimiento: "atencion",
  reglas: "reglas",
  handoff: "atencion",
};

export function issue(step: OnboardingStep, code: string, message: string, field?: string, severity: OnboardingIssue["severity"] = "error"): OnboardingIssue {
  return { step, code, message, severity, ...(field ? { field } : {}) };
}

/** El primer paso con errores (a dónde llevar a la persona). */
export function firstStepWithErrors(issues: readonly OnboardingIssue[]): OnboardingStep | null {
  for (const s of ONBOARDING_STEPS) if (issues.some((i) => i.step === s && i.severity === "error")) return s;
  return null;
}
