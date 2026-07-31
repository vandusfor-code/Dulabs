import type { SurveyQuestion } from "@/lib/survey-builder";
import type { SurveyBotConfig } from "@/lib/survey-engine";

// Forma remota (snake_case, tal cual la API/DB) de la config de un bot de
// encuestas — evita duplicar el mapeo en cada campo del formulario; solo se
// convierte a SurveyBotConfig (camelCase) justo antes de llamar al motor.
// Única fuente de esta config: la pestaña Ajustes del Builder de
// /dashboard/surveys/new (ver lib/survey-engine.ts para el modelo real).
export interface RemoteBotConfig {
  phone_number_id: string;
  /** Nombre propio de la encuesta — llena {{nombre_encuesta}} en la plantilla de invitación de Meta y es el nombre que se muestra en /dashboard/surveys. Distinto de brand_name (la empresa). */
  survey_name: string;
  brand_name: string;
  agent_name: string;
  intro_template: string;
  closing_template: string;
  decline_template: string;
  schedule_confirm_template: string;
  milestone_half: string;
  milestone_two_left: string;
  milestone_last: string;
  reminder_delay_hours: number;
  reminder_max: number;
  reminder_template: string;
  allow_change_answers: boolean;
  questions: SurveyQuestion[];
  close_date: string | null;
  invite_template_name: string;
  reminder_template_name: string;
  active: boolean;
  existe?: boolean;
}

export function toEngineConfig(r: RemoteBotConfig): SurveyBotConfig {
  return {
    brandName: r.brand_name,
    agentName: r.agent_name,
    introTemplate: r.intro_template,
    closingTemplate: r.closing_template,
    declineTemplate: r.decline_template,
    scheduleConfirmTemplate: r.schedule_confirm_template,
    milestones: { half: r.milestone_half, twoLeft: r.milestone_two_left, last: r.milestone_last },
    reminder: { delayHours: r.reminder_delay_hours, maxReminders: r.reminder_max, template: r.reminder_template },
    allowChangeAnswers: r.allow_change_answers,
  };
}
