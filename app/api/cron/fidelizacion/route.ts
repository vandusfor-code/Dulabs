import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { listarTenantsConReglasActivas } from "@/lib/fidelizacion/reglas";
import { procesarFidelizacionDelTenant, type ResultadoProcesarFidelizacion } from "@/lib/fidelizacion/motor";
import { resumirResultados } from "@/lib/fidelizacion/resumen";

export const runtime = "nodejs";
export const maxDuration = 60;

// Fidelización (Fase 7, genérico, autorizado) — motor diario: recorre TODOS
// los tenants con al menos una regla activa y genera sus oportunidades de
// fidelización, aisladas por id_tenant. Mismo mecanismo de disparo/
// autenticación que el resto de crons (ver lib/cron-auth.ts).
//
// Esta fase NO envía WhatsApp -- ni siquiera en modo "real" (sin dryRun):
// el motor solo persiste oportunidades (estado "pendiente") para que el
// panel las muestre; entregarlas a un adaptador de mensajería es la Fase 9.
// Por seguridad, `?dryRun=true` (o body `{"dryRun":true}`) evita incluso esa
// persistencia -- por defecto SIN el parámetro el modo es dry-run.
//
// IMPORTANTE (Fase 7): esta ruta NO está registrada en vercel.json ni en
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
  const tenants = await listarTenantsConReglasActivas(supabase);

  const resultados: ResultadoProcesarFidelizacion[] = [];
  for (const idTenant of tenants) {
    resultados.push(await procesarFidelizacionDelTenant(supabase, { idTenant, dryRun }));
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
