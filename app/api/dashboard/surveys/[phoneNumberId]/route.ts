import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { detailFromConfig, questionsDataFromConfig, type SurveyConfigRow, type SurveySessionRow } from "@/lib/survey-stats";

export const runtime = "nodejs";

// Detalle real de la encuesta de un número: resumen, análisis por pregunta
// y lista de participantes — todo derivado de dulabs_survey_bot_config +
// dulabs_survey_sessions de ESE número (y del tenant dueño).
export async function GET(request: NextRequest, { params }: { params: Promise<{ phoneNumberId: string }> }) {
  const { phoneNumberId } = await params;

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!miembro) return Response.json({ error: "No perteneces a ningún equipo activo" }, { status: 403 });

  const { data: cliente } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, nombre_negocio")
    .eq("phone_number_id", phoneNumberId)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const { data: config, error: configError } = await supabase
    .from("dulabs_survey_bot_config")
    .select("*")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (configError || !config || !Array.isArray(config.questions) || config.questions.length === 0) {
    return Response.json({ error: "Este número todavía no tiene una encuesta configurada" }, { status: 404 });
  }

  const { data: sesionesRaw } = await supabase
    .from("dulabs_survey_sessions")
    .select("phone_number_id, telefono_participante, nombre_participante, status, answers, reminders_sent, last_interaction_at, created_at, updated_at")
    .eq("phone_number_id", phoneNumberId);
  const sesiones = (sesionesRaw ?? []) as SurveySessionRow[];

  const configRow: SurveyConfigRow = {
    phone_number_id: config.phone_number_id,
    nombre_negocio: cliente.nombre_negocio,
    survey_name: config.survey_name ?? "",
    brand_name: config.brand_name,
    questions: config.questions,
    close_date: config.close_date,
    active: config.active,
    updated_at: config.updated_at,
  };

  const totalPreguntas = configRow.questions.filter((q) => q.type !== "message").length;
  const participantes = sesiones
    .map((s) => ({
      telefono: s.telefono_participante,
      nombre: s.nombre_participante,
      estado: s.status,
      respondidas: Object.keys(s.answers).length,
      totalPreguntas,
      recordatoriosEnviados: s.reminders_sent,
      ultimaInteraccion: s.last_interaction_at,
    }))
    .sort((a, b) => (b.ultimaInteraccion ?? "").localeCompare(a.ultimaInteraccion ?? ""));

  return Response.json({
    detail: detailFromConfig(configRow, sesiones),
    questionsData: questionsDataFromConfig(configRow, sesiones),
    participantes,
  });
}

// Elimina POR COMPLETO la encuesta de un número: la configuración
// (dulabs_survey_bot_config) y el progreso de todos sus participantes
// (dulabs_survey_sessions) — no hay soft-delete ni papelera. No borra el
// número de WhatsApp en sí (dulabs_clientes_config), solo su encuesta.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ phoneNumberId: string }> }) {
  const { phoneNumberId } = await params;

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!requireRol(miembro, ["admin"])) {
    return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  }

  const { data: cliente } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id")
    .eq("phone_number_id", phoneNumberId)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const { error: sesionesError } = await supabase
    .from("dulabs_survey_sessions")
    .delete()
    .eq("phone_number_id", phoneNumberId);
  if (sesionesError) {
    return Response.json({ error: `No se pudo eliminar: ${sesionesError.message}` }, { status: 503 });
  }

  const { error: configError } = await supabase
    .from("dulabs_survey_bot_config")
    .delete()
    .eq("phone_number_id", phoneNumberId);
  if (configError) {
    return Response.json({ error: `No se pudo eliminar: ${configError.message}` }, { status: 503 });
  }

  return Response.json({ success: true });
}
