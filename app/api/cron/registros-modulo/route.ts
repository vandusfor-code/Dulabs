/**
 * Conciliación de `registrar_en_modulo` (genérico): reprocesa los registros de módulo que
 * quedaron "pendiente" (error transitorio o ambiguo en línea) con los datos de su ejecución
 * original, volviendo a pasar todas las barreras. Idempotente y seguro en paralelo.
 * Autorizado como los demás crons (QStash firmado o CRON_SECRET). vercel.json lo corre a diario
 * (el plan Hobby no permite más); con QStash puede ir cada pocos minutos, y el dashboard del
 * módulo también concilia al abrirse (solo su tenant).
 */
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { conciliarRegistrosDeModulo } from "@/lib/flow/registro-modulo-conciliacion";
import { conciliacionDeProduccion } from "@/lib/modulos/registros-flow";

export const runtime = "nodejs";
export const maxDuration = 60;

async function manejar(request: NextRequest) {
  const cuerpo = await request.text();
  if (!(await solicitudAutorizadaCron(request, cuerpo))) return new Response("Unauthorized", { status: 401 });
  try {
    const resultado = await conciliarRegistrosDeModulo(conciliacionDeProduccion(supabaseAdmin()), { limite: 100, presupuestoMs: 45_000 });
    return Response.json(resultado, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[cron/registros-modulo]", error instanceof Error ? error.message : "?");
    return Response.json({ error: "no_se_pudo_conciliar" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return manejar(request);
}

export async function POST(request: NextRequest) {
  return manejar(request);
}
