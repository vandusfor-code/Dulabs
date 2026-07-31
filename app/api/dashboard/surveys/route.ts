import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo } from "@/lib/team";
import {
  summaryFromConfig,
  kpisFromSessions,
  funnelFromSessions,
  performanceFromSessions,
  type SurveyConfigRow,
  type SurveySessionRow,
} from "@/lib/survey-stats";
import { analizarRespuestasTexto } from "@/lib/survey-insights";
import type { SurveyDashboard } from "@/lib/surveys";

export const runtime = "nodejs";
export const maxDuration = 30;

function tableroVacio(): SurveyDashboard {
  return {
    kpis: { sent: 0, started: 0, completed: 0, completionRate: 0, deltas: { sent: 0, started: 0, completed: 0, completionRate: 0 } },
    performance: [],
    funnel: [
      { key: "invited", value: 0, percentage: 0 },
      { key: "started", value: 0, percentage: 0 },
      { key: "q5", value: 0, percentage: 0 },
      { key: "q10", value: 0, percentage: 0 },
      { key: "completed", value: 0, percentage: 0 },
    ],
    surveys: [],
    insights: null,
  };
}

// Panel real de Encuestas: agrega dulabs_survey_bot_config +
// dulabs_survey_sessions del tenant (una "encuesta" en la UI = la encuesta
// activa de un número de WhatsApp, no un objeto libre — así es el modelo
// real del bot). Sin ninguna encuesta configurada, devuelve el tablero
// vacío real (no una maqueta).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!miembro) return Response.json({ error: "No perteneces a ningún equipo activo" }, { status: 403 });

  const { data: numeros } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, nombre_negocio, api_key_ia")
    .eq("id_tenant", miembro.tenantId);
  const phoneNumberIds = (numeros ?? []).map((n) => n.phone_number_id);
  if (phoneNumberIds.length === 0) return Response.json(tableroVacio());

  const { data: configs, error: configsError } = await supabase
    .from("dulabs_survey_bot_config")
    .select("*")
    .in("phone_number_id", phoneNumberIds);
  if (configsError) {
    // Degrada al tablero vacío si la tabla no existe todavía (mismo criterio
    // defensivo que lib/survey-bot-store.ts) en vez de romper el dashboard.
    return Response.json(tableroVacio());
  }
  const configsConEncuesta = (configs ?? []).filter((c) => Array.isArray(c.questions) && c.questions.length > 0);
  if (configsConEncuesta.length === 0) return Response.json(tableroVacio());

  const { data: sesionesRaw } = await supabase
    .from("dulabs_survey_sessions")
    .select("phone_number_id, telefono_participante, nombre_participante, status, answers, reminders_sent, last_interaction_at, created_at, updated_at")
    .in("phone_number_id", phoneNumberIds);
  const sesiones = (sesionesRaw ?? []) as SurveySessionRow[];

  const nombrePorNumero = new Map((numeros ?? []).map((n) => [n.phone_number_id, n.nombre_negocio]));
  const apiKeyPorNumero = new Map((numeros ?? []).map((n) => [n.phone_number_id, n.api_key_ia]));
  const sesionesPorNumero = new Map<string, SurveySessionRow[]>();
  for (const s of sesiones) {
    const arr = sesionesPorNumero.get(s.phone_number_id) ?? [];
    arr.push(s);
    sesionesPorNumero.set(s.phone_number_id, arr);
  }

  const configRows: SurveyConfigRow[] = configsConEncuesta.map((c) => ({
    phone_number_id: c.phone_number_id,
    nombre_negocio: nombrePorNumero.get(c.phone_number_id) ?? c.brand_name,
    survey_name: c.survey_name ?? "",
    brand_name: c.brand_name,
    questions: c.questions,
    close_date: c.close_date,
    active: c.active,
    updated_at: c.updated_at,
  }));

  const surveys = configRows.map((c) => summaryFromConfig(c, sesionesPorNumero.get(c.phone_number_id) ?? []));
  const todasLasSesiones = configRows.flatMap((c) => sesionesPorNumero.get(c.phone_number_id) ?? []);

  const respuestasTexto: string[] = [];
  for (const c of configRows) {
    const preguntasTexto = c.questions.filter((q) => q.type === "open_text").map((q) => q.id);
    if (preguntasTexto.length === 0) continue;
    for (const s of sesionesPorNumero.get(c.phone_number_id) ?? []) {
      for (const qid of preguntasTexto) {
        const r = s.answers[qid];
        if (typeof r === "string" && r.trim()) respuestasTexto.push(r.trim());
      }
    }
  }
  const apiKeyDelTenant = configRows.map((c) => apiKeyPorNumero.get(c.phone_number_id)).find((k) => k) ?? null;
  const insights = await analizarRespuestasTexto(respuestasTexto, apiKeyDelTenant ? apiKeyDelTenant : null);

  const dashboard: SurveyDashboard = {
    kpis: kpisFromSessions(todasLasSesiones),
    performance: performanceFromSessions(todasLasSesiones),
    funnel: funnelFromSessions(todasLasSesiones),
    surveys,
    insights,
  };
  return Response.json(dashboard);
}
