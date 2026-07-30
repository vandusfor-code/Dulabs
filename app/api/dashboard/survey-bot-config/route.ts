import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { DEFAULT_SURVEY_BOT_CONFIG } from "@/lib/survey-engine";
import { DEFAULT_SURVEY_QUESTIONS } from "@/lib/survey-bot-store";

export const runtime = "nodejs";

async function usuarioYMiembro(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  const miembro = await resolverMiembroEquipo(supabase, data.user.id);
  return miembro ? { supabase, miembro } : null;
}

// Config por defecto que ve el dashboard cuando el tenant todavía no ha
// guardado nada para este número (la tabla puede incluso no existir todavía
// si la migración no se ha corrido — en ese caso también devolvemos esto).
function respuestaPorDefecto(phoneNumberId: string, brandNameFallback: string) {
  return {
    phone_number_id: phoneNumberId,
    brand_name: DEFAULT_SURVEY_BOT_CONFIG.brandName === "nuestro servicio" ? brandNameFallback : DEFAULT_SURVEY_BOT_CONFIG.brandName,
    agent_name: DEFAULT_SURVEY_BOT_CONFIG.agentName,
    intro_template: DEFAULT_SURVEY_BOT_CONFIG.introTemplate,
    closing_template: DEFAULT_SURVEY_BOT_CONFIG.closingTemplate,
    decline_template: DEFAULT_SURVEY_BOT_CONFIG.declineTemplate,
    schedule_confirm_template: DEFAULT_SURVEY_BOT_CONFIG.scheduleConfirmTemplate,
    milestone_half: DEFAULT_SURVEY_BOT_CONFIG.milestones.half,
    milestone_two_left: DEFAULT_SURVEY_BOT_CONFIG.milestones.twoLeft,
    milestone_last: DEFAULT_SURVEY_BOT_CONFIG.milestones.last,
    reminder_delay_hours: DEFAULT_SURVEY_BOT_CONFIG.reminder.delayHours,
    reminder_max: DEFAULT_SURVEY_BOT_CONFIG.reminder.maxReminders,
    reminder_template: DEFAULT_SURVEY_BOT_CONFIG.reminder.template,
    allow_change_answers: DEFAULT_SURVEY_BOT_CONFIG.allowChangeAnswers,
    questions: DEFAULT_SURVEY_QUESTIONS,
    close_date: null as string | null,
    invite_template_name: "du_encuesta_invitacion",
    reminder_template_name: "du_encuesta_recordatorio",
    active: true,
    existe: false,
  };
}

export async function GET(request: NextRequest) {
  const ctx = await usuarioYMiembro(request);
  if (!ctx) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const { supabase, miembro } = ctx;

  const phoneNumberId = request.nextUrl.searchParams.get("phone_number_id");
  if (!phoneNumberId) return Response.json({ error: "Falta 'phone_number_id'" }, { status: 400 });

  const { data: cliente } = await supabase
    .from("dulabs_clientes_config")
    .select("nombre_negocio")
    .eq("phone_number_id", phoneNumberId)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  try {
    const { data, error } = await supabase
      .from("dulabs_survey_bot_config")
      .select("*")
      .eq("phone_number_id", phoneNumberId)
      .eq("id_tenant", miembro.tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json(respuestaPorDefecto(phoneNumberId, cliente.nombre_negocio));
    return Response.json({ ...data, existe: true });
  } catch {
    // Tabla todavía no existe (migración pendiente): degradar a defaults sin romper el dashboard.
    return Response.json(respuestaPorDefecto(phoneNumberId, cliente.nombre_negocio));
  }
}

type Body = {
  phone_number_id?: string;
  brand_name?: string;
  agent_name?: string;
  intro_template?: string;
  closing_template?: string;
  decline_template?: string;
  schedule_confirm_template?: string;
  milestone_half?: string;
  milestone_two_left?: string;
  milestone_last?: string;
  reminder_delay_hours?: number;
  reminder_max?: number;
  reminder_template?: string;
  allow_change_answers?: boolean;
  questions?: unknown;
  close_date?: string | null;
  invite_template_name?: string;
  reminder_template_name?: string;
  active?: boolean;
};

export async function PATCH(request: NextRequest) {
  const ctx = await usuarioYMiembro(request);
  if (!ctx) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const { supabase, miembro } = ctx;
  if (!requireRol(miembro, ["admin"])) {
    return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id } = body;
  if (!phone_number_id) return Response.json({ error: "Falta 'phone_number_id'" }, { status: 400 });

  const { data: cliente } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id")
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const { phone_number_id: _omit, ...rest } = body;
  void _omit;

  try {
    const { error } = await supabase.from("dulabs_survey_bot_config").upsert(
      {
        id_tenant: miembro.tenantId,
        phone_number_id,
        ...rest,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number_id" }
    );
    if (error) throw error;
    return Response.json({ success: true });
  } catch (err) {
    return Response.json(
      {
        error:
          "No se pudo guardar todavía: la tabla del bot de encuestas no existe en la base de datos. Corre la migración 20260730090000_survey_bot.sql y vuelve a intentar.",
        detalle: err instanceof Error ? err.message : String(err),
      },
      { status: 503 }
    );
  }
}
