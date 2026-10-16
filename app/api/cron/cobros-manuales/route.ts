/**
 * Cobros manuales (cron diario): el día de pago, si el cliente que paga fuera de Wompi no tiene el pago registrado, se le suspende el bot y se le manda la plantilla `pendiente_pago`
 * desde el número de Dulabs. La lógica vive en lib/cobros; esta ruta solo la autoriza y la dispara.
 *
 * COBROS_MANUALES_MODO=activo → actúa de verdad. Cualquier otro valor (o sin la variable) → SIMULACIÓN: responde qué haría y no escribe ni envía nada.
 * Autorizado como los demás crons (QStash firmado o CRON_SECRET). vercel.json lo corre a diario a las 14:00 UTC (9:00 a. m. en Colombia).
 */
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { avisarNuevoClienteDulabs } from "@/lib/onboarding-trigger";
import { depsCobrosDeProduccion, MigracionCobrosPendiente } from "@/lib/cobros/cobros-supabase";
import { modoCobros, procesarCobrosManuales } from "@/lib/cobros/procesar-cobros-manuales";

export const runtime = "nodejs";
export const maxDuration = 60;

async function manejar(request: NextRequest) {
  const cuerpo = await request.text();
  if (!(await solicitudAutorizadaCron(request, cuerpo))) return new Response("Unauthorized", { status: 401 });
  const modo = modoCobros(process.env.COBROS_MANUALES_MODO);
  try {
    const resultado = await procesarCobrosManuales(depsCobrosDeProduccion(supabaseAdmin()), { modo });
    return Response.json(resultado, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MigracionCobrosPendiente) {
      // No es un fallo del cron: simplemente todavía no se corrió la migración. Se responde 200 (no hay nada que reintentar) y, si ya está en modo activo, se le avisa al dueño.
      console.warn(`[cron/cobros-manuales] ${error.message}`);
      if (modo === "activo") await avisarNuevoClienteDulabs(`⚠️ Cobros manuales: ${error.message}. Hasta entonces no se suspende ni se avisa a nadie.`);
      return Response.json({ modo, estado: "migracion_pendiente" }, { headers: { "Cache-Control": "no-store" } });
    }
    console.error("[cron/cobros-manuales]", error instanceof Error ? error.message : "?");
    return Response.json({ error: "no_se_pudo_procesar" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return manejar(request);
}

export async function POST(request: NextRequest) {
  return manejar(request);
}
