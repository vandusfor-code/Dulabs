/**
 * Bloque 19 — cron: vence los pedidos confirmados cuya reserva de stock pasó su plazo (72 h) y el
 * stock vuelve (todo en la BD: dulabs_catalogo_reservas_vencer). Los pedidos en manos de una
 * asesora (handoff) no vencen solos. Autorizado como los demás crons (QStash firmado o CRON_SECRET).
 * vercel.json lo corre a diario (el plan Hobby no permite más); con QStash puede ir cada hora, y
 * el panel de pedidos también vence al abrirse.
 */
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { createSupabaseOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";

export const runtime = "nodejs";
export const maxDuration = 60;

async function manejar(request: NextRequest) {
  const cuerpo = await request.text();
  if (!(await solicitudAutorizadaCron(request, cuerpo))) return new Response("Unauthorized", { status: 401 });
  try {
    const vencidos = await createSupabaseOrdersRepository(supabaseAdmin()).expireReservations(500);
    return Response.json({ vencidos }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[cron/catalogo-reservas]", error instanceof Error ? error.message : "?");
    return Response.json({ error: "no_se_pudo_vencer" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return manejar(request);
}

export async function POST(request: NextRequest) {
  return manejar(request);
}
