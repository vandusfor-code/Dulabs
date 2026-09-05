import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { listarTenantsConComunicacionesActivas } from "@/lib/comunicaciones/config";
import { procesarComunicacionesDelTenant, type ResultadoProcesarComunicaciones } from "@/lib/comunicaciones/motor";
import { resumirResultados } from "@/lib/comunicaciones/resumen";

export const runtime = "nodejs";
export const maxDuration = 60;

// Confirmaciones y recordatorios (Fase 8, genérico, autorizado) — motor
// diario: recorre TODOS los tenants con confirmación y/o recordatorio
// activo y procesa sus citas, aisladas por id_tenant. Mismo mecanismo de
// disparo/autenticación que el resto de crons (ver lib/cron-auth.ts).
//
// Esta fase NO envía WhatsApp bajo ninguna circunstancia -- no existe
// todavía ningún adaptador real (llega en la Fase 9); el motor siempre usa
// el simulador (ver lib/comunicaciones/adaptador.ts) incluso en modo "real"
// (dryRun=false), que solo persiste la comunicación como procesada sin
// entregarla a ningún proveedor. `?dryRun=true` (o body `{"dryRun":true}`)
// evita incluso esa persistencia -- por defecto SIN el parámetro el modo es
// dry-run.
//
// IMPORTANTE (Fase 8): esta ruta NO está registrada en vercel.json ni en
// ningún Schedule de QStash -- activar su disparo diario automático
// requiere autorización explícita todavía no dada.
async function manejar(request: NextRequest) {
  const cuerpo = await request.text();
  if (!(await solicitudAutorizadaCron(request, cuerpo))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let dryRun = request.nextUrl.searchParams.get("dryRun") !== "false";
  if (cuerpo) {
    try {
      const json = JSON.parse(cuerpo) as { dryRun?: boolean };
      if (typeof json.dryRun === "boolean") dryRun = json.dryRun;
    } catch {
      // Body no-JSON (ej. vacío o un ping de QStash) -- se ignora, queda el valor de la query string.
    }
  }

  const supabase = supabaseAdmin();
  const tenants = await listarTenantsConComunicacionesActivas(supabase);

  const resultados: ResultadoProcesarComunicaciones[] = [];
  for (const idTenant of tenants) {
    resultados.push(await procesarComunicacionesDelTenant(supabase, { idTenant, dryRun }));
  }

  const resumen = resumirResultados(resultados.flatMap((r) => r.procesados));
  return Response.json({ modo: dryRun ? "dry-run" : "real", tenants: resultados.length, resumen, resultados });
}

export async function GET(request: NextRequest) {
  return manejar(request);
}

export async function POST(request: NextRequest) {
  return manejar(request);
}
