import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { descifrarSecreto } from "@/lib/crypto";
import { enviarTexto, dentroVentana24h } from "@/lib/whatsapp";
import { enviarPlantilla, consultarEstadoPlantilla } from "@/lib/meta-templates";

const IDIOMA_PLANTILLA = "es_CO";
import { getSurveyBot, saveSession, markReminderSent, type StoredSurveyBot } from "@/lib/survey-bot-store";
import { buildReminder, resumeScheduled, shouldResumeScheduled, type SurveySession } from "@/lib/survey-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

type SessionRow = {
  telefono_participante: string;
  status: SurveySession["status"];
  current_index: number;
  answers: SurveySession["answers"];
  reminders_sent: number;
  milestones_sent: SurveySession["milestonesSent"];
  awaiting_schedule: boolean;
  resume_at: string | null;
  last_interaction_at: string | null;
  last_reminder_at: string | null;
  close_date: string | null;
};

function rowToSession(row: SessionRow): SurveySession {
  return {
    status: row.status,
    currentIndex: row.current_index,
    answers: row.answers ?? {},
    remindersSent: row.reminders_sent ?? 0,
    milestonesSent: row.milestones_sent ?? [],
    awaitingSchedule: Boolean(row.awaiting_schedule),
    resumeAt: row.resume_at,
    lastInteractionAt: row.last_interaction_at,
    closeDate: row.close_date,
  };
}

function isExpired(closeDate: string | null, now: Date): boolean {
  return Boolean(closeDate && new Date(closeDate).getTime() < now.getTime());
}

/** Candidatos a recordatorio: pausados/en progreso, sin compromiso pendiente, bajo el máximo, sin vencer. */
function needsReminder(row: SessionRow, bot: StoredSurveyBot, now: Date): boolean {
  if (row.status !== "paused" && row.status !== "in_progress") return false;
  if (row.awaiting_schedule || row.resume_at) return false;
  if (row.reminders_sent >= bot.config.reminder.maxReminders) return false;
  if (isExpired(row.close_date, now)) return false;
  const ancla = row.last_reminder_at ?? row.last_interaction_at;
  if (!ancla) return false;
  const horas = (now.getTime() - new Date(ancla).getTime()) / 3_600_000;
  return horas >= bot.config.reminder.delayHours;
}

async function enviarMensajes(params: {
  supabase: SupabaseClient;
  phoneNumberId: string;
  wabaId: string;
  numero: string;
  metaToken: string;
  mensajes: string[];
  dentroVentana: boolean;
  reminderTemplateName: string;
}) {
  const { supabase, phoneNumberId, wabaId, numero, metaToken, mensajes, dentroVentana, reminderTemplateName } = params;
  for (const texto of mensajes) {
    let wamid: string | null = null;
    if (dentroVentana) {
      ({ wamid } = await enviarTexto({ phoneNumberId, token: metaToken, para: numero, texto }));
    } else {
      // Verificación EN VIVO contra Meta — no depende de una fila local en
      // dulabs_plantillas (funciona igual si la plantilla se creó directo en
      // el Administrador de Meta).
      const estado = await consultarEstadoPlantilla({ wabaId, token: metaToken, nombre: reminderTemplateName });
      if (estado !== "APPROVED") {
        throw new Error(`Fuera de ventana de 24h y la plantilla "${reminderTemplateName}" no está aprobada (estado: ${estado ?? "no encontrada"}).`);
      }
      ({ wamid } = await enviarPlantilla({ phoneNumberId, token: metaToken, para: numero, nombrePlantilla: reminderTemplateName, idioma: IDIOMA_PLANTILLA }));
    }
    await supabase.from("dulabs_mensajes_log").insert({
      phone_number_id: phoneNumberId,
      telefono_cliente: numero,
      direccion: "saliente",
      contenido: texto,
      origen: "agente",
      wamid,
    });
  }
}

/**
 * Disparado periódicamente por Vercel Cron. Recorre los números con bot de
 * encuestas activo y, para cada participante pendiente:
 *  - si venció su compromiso de "más tarde", reanuda la conversación;
 *  - si lleva demasiado tiempo sin responder (y no ha agotado el máximo
 *    configurado de recordatorios), envía un recordatorio moderado.
 * Es un no-op seguro si la migración del bot de encuestas no se ha corrido
 * (las tablas simplemente no existen todavía).
 */
export async function GET(request: NextRequest) {
  const cuerpo = await request.text();
  if (!(await solicitudAutorizadaCron(request, cuerpo))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = supabaseAdmin();
  const now = new Date();
  let recordatorios = 0;
  let reanudaciones = 0;
  const errores: string[] = [];

  let configs: { phone_number_id: string; active: boolean }[] = [];
  try {
    const { data, error } = await supabase.from("dulabs_survey_bot_config").select("phone_number_id, active").eq("active", true);
    if (error) throw error;
    configs = data ?? [];
  } catch {
    // Migración todavía no aplicada: no-op silencioso, no rompe el cron.
    return Response.json({ recordatorios: 0, reanudaciones: 0, nota: "tablas del bot de encuestas no disponibles todavía" });
  }

  for (const { phone_number_id } of configs) {
    const bot = await getSurveyBot(supabase, phone_number_id);
    if (!bot) continue;

    const { data: cliente } = await supabase
      .from("dulabs_clientes_config")
      .select("meta_permanent_token, whatsapp_business_account_id")
      .eq("phone_number_id", phone_number_id)
      .maybeSingle();
    const metaToken = cliente?.meta_permanent_token ? descifrarSecreto(cliente.meta_permanent_token) : process.env.META_ACCESS_TOKEN;
    if (!metaToken || !cliente?.whatsapp_business_account_id) {
      errores.push(`${phone_number_id}: sin token o WABA de Meta`);
      continue;
    }
    const wabaId = cliente.whatsapp_business_account_id;

    const { data: sesiones, error: sesionesError } = await supabase
      .from("dulabs_survey_sessions")
      .select(
        "telefono_participante, status, current_index, answers, reminders_sent, milestones_sent, awaiting_schedule, resume_at, last_interaction_at, last_reminder_at, close_date"
      )
      .eq("phone_number_id", phone_number_id)
      .in("status", ["paused", "in_progress", "resume_scheduled"]);
    if (sesionesError || !sesiones) continue;

    for (const row of sesiones as SessionRow[]) {
      const numero = row.telefono_participante;
      const session = rowToSession(row);

      try {
        if (shouldResumeScheduled(session, now)) {
          const dentroVentana = await dentroVentana24h(supabase, phone_number_id, numero);
          const resultado = resumeScheduled(bot.config, bot.questions, session, now);
          await enviarMensajes({
            supabase,
            phoneNumberId: phone_number_id,
            wabaId,
            numero,
            metaToken,
            mensajes: resultado.messages,
            dentroVentana,
            reminderTemplateName: bot.reminderTemplateName,
          });
          await saveSession(supabase, phone_number_id, numero, resultado.session);
          reanudaciones++;
          continue;
        }

        if (needsReminder(row, bot, now)) {
          const dentroVentana = await dentroVentana24h(supabase, phone_number_id, numero);
          const resultado = buildReminder(bot.config, session);
          await enviarMensajes({
            supabase,
            phoneNumberId: phone_number_id,
            wabaId,
            numero,
            metaToken,
            mensajes: resultado.messages,
            dentroVentana,
            reminderTemplateName: bot.reminderTemplateName,
          });
          await saveSession(supabase, phone_number_id, numero, resultado.session);
          await markReminderSent(supabase, phone_number_id, numero, resultado.session.remindersSent);
          recordatorios++;
        }
      } catch (err) {
        errores.push(`${phone_number_id}/${numero}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return Response.json({ recordatorios, reanudaciones, errores });
}
