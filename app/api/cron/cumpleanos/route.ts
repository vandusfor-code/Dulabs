import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { listarTenantsConCumpleanosActivo } from "@/lib/cumpleanos/config";
import { procesarCumpleanosDelTenant, type ResultadoProcesarCumpleanos } from "@/lib/cumpleanos/motor";
import { resumirResultados } from "@/lib/cumpleanos/resumen";
import { crearSimuladorLog } from "@/lib/cumpleanos/simulador";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cumpleaños automáticos (Fase 6B, genérico, autorizado) — motor diario:
// recorre TODOS los tenants con el módulo activo en dulabs_cumpleanos_config
// (hoy solo AMORE) y procesa los cumpleaños de cada uno, aislado por
// id_tenant. Mismo mecanismo de disparo/autenticación que el resto de crons
// (ver lib/cron-auth.ts) -- acepta tanto QStash como
// `Authorization: Bearer $CRON_SECRET` para pruebas manuales con curl.
//
// Modo dry-run vs. real (Fase 6B): reutiliza el MISMO motor de Fase 6A sin
// duplicar nada -- el punto de inyección ya existente (`enviador`) es lo
// único que cambia. `?dryRun=true` (o body `{"dryRun":true}` para QStash) usa
// crearSimuladorLog, que nunca llama a enviarWhatsApp/Meta; sin ese flag, el
// motor usa la infraestructura real de envío. Por seguridad, SIN el
// parámetro el modo por defecto es dry-run -- un curl manual sin pensarlo
// nunca dispara un envío real.
//
// IMPORTANTE (Fase 6B): esta ruta sigue sin estar registrada en vercel.json
// ni en ningún Schedule de QStash -- activar su disparo diario automático
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
  const tenants = await listarTenantsConCumpleanosActivo(supabase);

  const resultados: ResultadoProcesarCumpleanos[] = [];
  for (const idTenant of tenants) {
    const enviador = dryRun ? crearSimuladorLog(idTenant) : undefined;
    resultados.push(await procesarCumpleanosDelTenant(supabase, { idTenant, enviador }));
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
