/**
 * Bloque 18 — cron DIARIO de retención de los datos del agente (ver lib/agente/retencion.ts).
 * Autorizado igual que los demás crons (QStash firmado o Bearer CRON_SECRET; sin secreto, nada pasa).
 */
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { purgarDatosAgente } from "@/lib/agente/retencion";

export const runtime = "nodejs";
export const maxDuration = 60;

async function manejar(request: NextRequest) {
  const cuerpo = await request.text();
  if (!(await solicitudAutorizadaCron(request, cuerpo))) return new Response("Unauthorized", { status: 401 });
  const resultado = await purgarDatosAgente(supabaseAdmin());
  const fallos = Object.values(resultado).filter((r) => "error" in r).length;
  if (fallos > 0) console.error("[cron/agente-retencion]", JSON.stringify(resultado));
  return Response.json(resultado, { status: fallos > 0 ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  return manejar(request);
}

export async function POST(request: NextRequest) {
  return manejar(request);
}
