/**
 * Bloque 19 — cron: vence los pedidos confirmados cuya reserva de stock pasó su plazo (72 h) y el
 * stock vuelve (todo en la BD: dulabs_catalogo_reservas_vencer). Bloque 23: también vence los
 * pedidos de conversación sin confirmar que llevan 72 h sin cambios (motor: expireAbandonedOrders).
 * Los pedidos en manos de una asesora (handoff) no vencen solos. Autorizado como los demás crons (QStash firmado o CRON_SECRET).
 * vercel.json lo corre a diario (el plan Hobby no permite más); con QStash puede ir cada hora, y
 * el panel de pedidos también vence al abrirse.
 */
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { createSupabaseOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { productionOrderEngine } from "@/lib/catalogo/pedidos/produccion";

export const runtime = "nodejs";
export const maxDuration = 60;

async function manejar(request: NextRequest) {
  const cuerpo = await request.text();
  if (!(await solicitudAutorizadaCron(request, cuerpo))) return new Response("Unauthorized", { status: 401 });
  try {
    const supabase = supabaseAdmin();
    const vencidos = await createSupabaseOrdersRepository(supabase).expireReservations(500);
    // Bloque 23: propuestas y borradores de conversación abandonados (72 h sin cambios) también vencen.
    const engine = productionOrderEngine(supabase);
    const abandonados = engine ? await engine.expireAbandonedOrders({ limit: 500 }) : 0;
    return Response.json({ vencidos, abandonados }, { headers: { "Cache-Control": "no-store" } });
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
