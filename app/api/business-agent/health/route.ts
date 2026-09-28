/**
 * Business Agent 2.0 — FASE 9: salud del servicio.
 *
 *   GET /api/business-agent/health              LIVENESS: el proceso responde. Público, sin dependencias ni datos.
 *   GET /api/business-agent/health?check=ready  READINESS: base, migraciones, IA y su circuito, circuitos por dependencia,
 *                                               latido del despacho de recordatorios y palancas operativas. Requiere la
 *                                               misma autorización que los crons (QStash firmado o Bearer CRON_SECRET).
 *                                               200 = ready/degraded · 503 = not_ready. Nunca secretos ni datos de clientes.
 */
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { createSupabaseReadinessDeps, evaluateReadiness, liveness } from "@/lib/agent-compiler/runtime/production/health";
import { sharedCircuits } from "@/lib/agent-compiler/runtime/production/circuits";
import { understandingProviderConfigured } from "@/lib/agent-compiler/understanding/provider";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (new URL(request.url).searchParams.get("check") !== "ready") return Response.json(liveness(), { headers: NO_STORE });
  if (!(await solicitudAutorizadaCron(request, ""))) return new Response("Unauthorized", { status: 401 });
  try {
    const report = await evaluateReadiness(createSupabaseReadinessDeps(supabaseAdmin(), sharedCircuits, () => understandingProviderConfigured()));
    return Response.json(report, { status: report.status === "not_ready" ? 503 : 200, headers: NO_STORE });
  } catch {
    return Response.json({ status: "not_ready", checks: [{ id: "readiness", status: "down", detail: "EVALUATION_FAILED" }], at: new Date().toISOString() }, { status: 503, headers: NO_STORE });
  }
}
