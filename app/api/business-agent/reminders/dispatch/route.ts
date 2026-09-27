/**
 * Business Agent 2.0 — FASE 8: despacho de recordatorios de cita (dulabs_ba_reminders).
 *
 * Autorizado como los demás crons (QStash firmado o `Authorization: Bearer $CRON_SECRET`). NO está registrado en
 * vercel.json: activarlo es una decisión operativa (requiere la migración 20261127000000 aplicada). Mientras no se
 * programe, los recordatorios quedan en 'scheduled' y NO se envían (el agente se lo dice al negocio en la matriz de
 * capacidades como integración "no verificada").
 */
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { createProductionReminderDispatchDeps, dispatchDueReminders } from "@/lib/agent-compiler/runtime/production/reminder-dispatcher";

export const runtime = "nodejs";
export const maxDuration = 60;

async function manejar(request: NextRequest) {
  const cuerpo = await request.text();
  if (!(await solicitudAutorizadaCron(request, cuerpo))) return new Response("Unauthorized", { status: 401 });
  try {
    const summary = await dispatchDueReminders(createProductionReminderDispatchDeps(supabaseAdmin()), { limit: 50 });
    return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[business-agent/reminders/dispatch]", error instanceof Error ? error.message.slice(0, 120) : "?");
    return Response.json({ error: "no_se_pudo_despachar" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return manejar(request);
}

export async function POST(request: NextRequest) {
  return manejar(request);
}
