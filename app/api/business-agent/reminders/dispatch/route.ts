/**
 * Business Agent 2.0 — FASE 8: despacho de recordatorios de cita (dulabs_ba_reminders).
 *
 * Autorizado como los demás crons (QStash firmado o `Authorization: Bearer $CRON_SECRET`). NO está registrado en
 * vercel.json: activarlo es una decisión operativa (requiere las migraciones 20261127000000 y 20261128000000 aplicadas;
 * sin la 28 el despacho falla ANTES de tomar recordatorios — nunca envía sin poder revalidarlos). Mientras no se
 * programe, los recordatorios quedan en 'scheduled' y NO se envían (el agente se lo dice al negocio en la matriz de
 * capacidades como integración "no verificada"). FASE 9: cada ejecución deja un latido (readiness en /health).
 */
import type { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import {
  createProductionReminderDispatchDeps,
  dispatchDueReminders,
  DISPATCH_DB_TIMEOUT_MS,
  fetchWithTimeout,
} from "@/lib/agent-compiler/runtime/production/reminder-dispatcher";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cliente de Postgres PROPIO del despachador: cada llamada con timeout (una consulta colgada nunca consume los 60 s de
// la función). No se toca el cliente compartido (lib/supabase).
let client: SupabaseClient | null = null;
function supabaseDespachador(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno");
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithTimeout(fetch, DISPATCH_DB_TIMEOUT_MS) },
    });
  }
  return client;
}

async function manejar(request: NextRequest) {
  const cuerpo = await request.text();
  if (!(await solicitudAutorizadaCron(request, cuerpo))) return new Response("Unauthorized", { status: 401 });
  try {
    const supabase = supabaseDespachador();
    const summary = await dispatchDueReminders(createProductionReminderDispatchDeps(supabase), { limit: 50 });
    // FASE 9 — mantenimiento del mismo job: ventanas de límites de uso ya vencidas (> 2 h). Best-effort.
    const pruned = await supabase.rpc("dulabs_ba_rate_counters_prune", { p_older_than_seconds: 7200 }).then(
      (r) => (r.error ? null : Number(r.data ?? 0)),
      () => null,
    );
    return Response.json({ ...summary, rateCountersPruned: pruned }, { headers: { "Cache-Control": "no-store" } });
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
