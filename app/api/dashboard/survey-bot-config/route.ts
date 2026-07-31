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
    survey_name: "",
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
  survey_name?: string;
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

  // El frontend guarda reenviando el objeto completo que recibió del GET
  // (`{...remote, active}`), que trae de vuelta campos que NO son columnas
  // reales para escribir (el `existe` calculado) o que son de sistema (`id`
  // identity, `id_tenant`, `created_at` de la fila original). Whitelist
  // explícito en vez de un `...rest` a ciegas, para no reenviar nada de eso.
  const CAMPOS_PERMITIDOS = [
    "survey_name",
    "brand_name",
    "agent_name",
    "intro_template",
    "closing_template",
    "decline_template",
    "schedule_confirm_template",
    "milestone_half",
    "milestone_two_left",
    "milestone_last",
    "reminder_delay_hours",
    "reminder_max",
    "reminder_template",
    "allow_change_answers",
    "questions",
    "close_date",
    "invite_template_name",
    "reminder_template_name",
    "active",
  ] as const satisfies readonly (keyof Body)[];
  const cambios: Partial<Body> = {};
  for (const campo of CAMPOS_PERMITIDOS) {
    if (campo in body) cambios[campo] = body[campo] as never;
  }

  try {
    const { error } = await supabase.from("dulabs_survey_bot_config").upsert(
      {
        id_tenant: miembro.tenantId,
        phone_number_id,
        ...cambios,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number_id" }
    );
    // El error de Supabase (PostgrestError) es un objeto plano, no una
    // instancia de Error — se usa error.message directo en vez de lanzarlo y
    // recapturarlo (throw + `err instanceof Error` con un objeto plano cae a
    // String(err), que da "[object Object]" y esconde el mensaje real).
    if (error) {
      return Response.json({ error: `No se pudo guardar: ${error.message}` }, { status: 503 });
    }
    return Response.json({ success: true });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `No se pudo guardar: ${mensaje}` },
      { status: 503 }
    );
  }
}
