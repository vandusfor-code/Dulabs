/**
 * Persistencia del bot de encuestas (Supabase). Capa fina entre el motor puro
 * (lib/survey-engine.ts) y la tabla real.
 *
 * IMPORTANTE — seguridad de despliegue: este módulo puede desplegarse ANTES
 * de que la migración `20260730090000_survey_bot.sql` se ejecute en la base
 * de datos real. Toda lectura swallow-ea el error si las tablas todavía no
 * existen (o si aún no hay configuración para ese número) y devuelve null —
 * el llamador (webhook / cron) debe tratar null como "el bot de encuestas no
 * aplica aquí" y seguir su flujo normal. Así, el código puede vivir en
 * producción sin romper nada mientras la migración no se haya aplicado, y el
 * bot se activa solo automáticamente en cuanto la tabla exista y el tenant
 * guarde su configuración.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SurveyQuestion } from "@/lib/survey-builder";
import { DEFAULT_SURVEY_BOT_CONFIG, createSession, type SurveyBotConfig, type SurveySession } from "@/lib/survey-engine";

/**
 * Encuesta de satisfacción genérica de 6 preguntas, usada como punto de
 * partida cuando un número todavía no ha personalizado su encuesta. Ejercita
 * los tipos principales (opción única, rating, sí/no, NPS, texto libre) y es
 * la MISMA que corre el simulador en vivo del panel de Agentes de IA.
 */
export const DEFAULT_SURVEY_QUESTIONS: SurveyQuestion[] = [
  { id: "s1", type: "single_choice", required: true, text: "¿Cómo prefieres que te contactemos?", options: ["WhatsApp", "Llamada", "Correo"] },
  { id: "s2", type: "rating_1_10", required: true, text: "¿Cómo calificas la atención recibida?", minLabel: "Muy mala", maxLabel: "Excelente" },
  { id: "s3", type: "yes_no", required: true, text: "¿Resolvimos tu solicitud en esta visita?" },
  { id: "s4", type: "rating_1_10", required: true, text: "¿Qué tan clara fue la información que te dimos?", minLabel: "Nada clara", maxLabel: "Muy clara" },
  { id: "s5", type: "nps_0_10", required: true, text: "¿Qué tan probable es que nos recomiendes?", minLabel: "Nada probable", maxLabel: "Muy probable" },
  { id: "s6", type: "open_text", required: false, text: "¿Algún comentario o sugerencia adicional?" },
];

export interface StoredSurveyBot {
  tenantId: string;
  phoneNumberId: string;
  /** Nombre propio de la encuesta (llena {{nombre_encuesta}} en la plantilla de invitación) — distinto de config.brandName (la empresa). */
  surveyName: string;
  config: SurveyBotConfig;
  questions: SurveyQuestion[];
  closeDate: string | null;
  inviteTemplateName: string;
  reminderTemplateName: string;
  active: boolean;
}

let warnedMissingTable = false;
function logMissingOnce(context: string, err: unknown) {
  if (warnedMissingTable) return;
  warnedMissingTable = true;
  console.warn(
    `[survey-bot-store] tablas del bot de encuestas no disponibles todavía (${context}). ` +
      `Esto es esperado hasta correr la migración 20260730090000_survey_bot.sql — el resto de la app sigue funcionando normal.`,
    err instanceof Error ? err.message : err
  );
}

/** Config + encuesta activa de un número, o null si no existe/no está activa/tabla ausente. */
export async function getSurveyBot(supabase: SupabaseClient, phoneNumberId: string): Promise<StoredSurveyBot | null> {
  try {
    const { data, error } = await supabase
      .from("dulabs_survey_bot_config")
      .select("*")
      .eq("phone_number_id", phoneNumberId)
      .maybeSingle();
    if (error) {
      logMissingOnce("getSurveyBot", error);
      return null;
    }
    if (!data || !data.active) return null;

    const config: SurveyBotConfig = {
      brandName: data.brand_name ?? DEFAULT_SURVEY_BOT_CONFIG.brandName,
      agentName: data.agent_name ?? DEFAULT_SURVEY_BOT_CONFIG.agentName,
      introTemplate: data.intro_template ?? DEFAULT_SURVEY_BOT_CONFIG.introTemplate,
      closingTemplate: data.closing_template ?? DEFAULT_SURVEY_BOT_CONFIG.closingTemplate,
      declineTemplate: data.decline_template ?? DEFAULT_SURVEY_BOT_CONFIG.declineTemplate,
      scheduleConfirmTemplate: data.schedule_confirm_template ?? DEFAULT_SURVEY_BOT_CONFIG.scheduleConfirmTemplate,
      milestones: {
        half: data.milestone_half ?? DEFAULT_SURVEY_BOT_CONFIG.milestones.half,
        twoLeft: data.milestone_two_left ?? DEFAULT_SURVEY_BOT_CONFIG.milestones.twoLeft,
        last: data.milestone_last ?? DEFAULT_SURVEY_BOT_CONFIG.milestones.last,
      },
      reminder: {
        delayHours: data.reminder_delay_hours ?? DEFAULT_SURVEY_BOT_CONFIG.reminder.delayHours,
        maxReminders: data.reminder_max ?? DEFAULT_SURVEY_BOT_CONFIG.reminder.maxReminders,
        template: data.reminder_template ?? DEFAULT_SURVEY_BOT_CONFIG.reminder.template,
      },
      allowChangeAnswers: data.allow_change_answers ?? true,
    };

    return {
      tenantId: data.id_tenant,
      phoneNumberId: data.phone_number_id,
      // Retrocompatible: encuestas configuradas antes de que existiera este
      // campo (survey_name = '' en la base) siguen mandando algo sensato en
      // {{nombre_encuesta}} en vez de un valor vacío.
      surveyName: data.survey_name || data.brand_name || DEFAULT_SURVEY_BOT_CONFIG.brandName,
      config,
      questions:
        Array.isArray(data.questions) && data.questions.length > 0
          ? (data.questions as SurveyQuestion[])
          : DEFAULT_SURVEY_QUESTIONS,
      closeDate: data.close_date ?? null,
      inviteTemplateName: data.invite_template_name ?? "du_encuesta_invitacion",
      reminderTemplateName: data.reminder_template_name ?? "du_encuesta_recordatorio",
      active: Boolean(data.active),
    };
  } catch (err) {
    logMissingOnce("getSurveyBot (throw)", err);
    return null;
  }
}

function rowToSession(row: Record<string, unknown>): SurveySession {
  return {
    status: row.status as SurveySession["status"],
    currentIndex: Number(row.current_index ?? 0),
    answers: (row.answers as SurveySession["answers"]) ?? {},
    remindersSent: Number(row.reminders_sent ?? 0),
    milestonesSent: Array.isArray(row.milestones_sent) ? (row.milestones_sent as SurveySession["milestonesSent"]) : [],
    awaitingSchedule: Boolean(row.awaiting_schedule),
    resumeAt: (row.resume_at as string) ?? null,
    lastInteractionAt: (row.last_interaction_at as string) ?? null,
    closeDate: (row.close_date as string) ?? null,
  };
}

function sessionToRow(session: SurveySession) {
  return {
    status: session.status,
    current_index: session.currentIndex,
    answers: session.answers,
    reminders_sent: session.remindersSent,
    milestones_sent: session.milestonesSent,
    awaiting_schedule: session.awaitingSchedule,
    resume_at: session.resumeAt,
    last_interaction_at: session.lastInteractionAt,
    close_date: session.closeDate,
    updated_at: new Date().toISOString(),
  };
}

/** Sesión existente para (número, participante), o null si no existe/tabla ausente. */
export async function getSession(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoParticipante: string
): Promise<SurveySession | null> {
  try {
    const { data, error } = await supabase
      .from("dulabs_survey_sessions")
      .select("*")
      .eq("phone_number_id", phoneNumberId)
      .eq("telefono_participante", telefonoParticipante)
      .maybeSingle();
    if (error) {
      logMissingOnce("getSession", error);
      return null;
    }
    return data ? rowToSession(data) : null;
  } catch (err) {
    logMissingOnce("getSession (throw)", err);
    return null;
  }
}

/** Crea la sesión inicial (estado invited) para un participante nuevo. */
export async function createSessionRow(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoParticipante: string,
  closeDate: string | null,
  nombreParticipante?: string | null
): Promise<SurveySession | null> {
  const session = createSession(closeDate);
  try {
    const { error } = await supabase.from("dulabs_survey_sessions").upsert(
      {
        phone_number_id: phoneNumberId,
        telefono_participante: telefonoParticipante,
        nombre_participante: nombreParticipante || null,
        ...sessionToRow(session),
      },
      { onConflict: "phone_number_id,telefono_participante" }
    );
    if (error) {
      logMissingOnce("createSessionRow", error);
      return null;
    }
    return session;
  } catch (err) {
    logMissingOnce("createSessionRow (throw)", err);
    return null;
  }
}

/** Persiste el estado resultante de un turno del motor. */
export async function saveSession(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoParticipante: string,
  session: SurveySession
): Promise<void> {
  try {
    const { error } = await supabase
      .from("dulabs_survey_sessions")
      .update(sessionToRow(session))
      .eq("phone_number_id", phoneNumberId)
      .eq("telefono_participante", telefonoParticipante);
    if (error) logMissingOnce("saveSession", error);
  } catch (err) {
    logMissingOnce("saveSession (throw)", err);
  }
}

/** Marca que se envió un recordatorio ahora mismo (para el espaciado del cron). */
export async function markReminderSent(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoParticipante: string,
  remindersSent: number
): Promise<void> {
  try {
    await supabase
      .from("dulabs_survey_sessions")
      .update({ reminders_sent: remindersSent, last_reminder_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("phone_number_id", phoneNumberId)
      .eq("telefono_participante", telefonoParticipante);
  } catch {
    /* best-effort; el estado principal ya se guardó en saveSession */
  }
}
