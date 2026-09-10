import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { listarTenantsConCumpleanosActivo, obtenerConfigCumpleanos } from "@/lib/cumpleanos/config";
import { estaEnVentanaDeEnvio } from "@/lib/cumpleanos/fecha";
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
//
// Mejora Cumpleaños (autorizado) -- hora_envio REALMENTE usada: en modo
// real (dryRun=false) cada tenant solo se procesa cuando su hora local
// configurada (dulabs_cumpleanos_config.hora_envio, zona_horaria) ya llegó
// (±15 min, ver estaEnVentanaDeEnvio) -- así, el día que este cron SÍ quede
// programado con una cadencia periódica (ej. cada 15-30 min, igual que
// recordatorios), cada negocio recibe su envío una sola vez, a la hora que
// eligió, y nunca en cualquier pasada. En modo dry-run (el predeterminado)
// la ventana se ignora a propósito -- sirve para previsualizar "a quién le
// tocaría hoy" en cualquier momento, sin esperar la hora exacta, y nunca
// manda un WhatsApp real de todos modos.
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
  const ahora = new Date();

  const resultados: (ResultadoProcesarCumpleanos & { fueraDeHorario?: true })[] = [];
  for (const idTenant of tenants) {
    if (!dryRun) {
      const config = await obtenerConfigCumpleanos(supabase, idTenant);
      if (!estaEnVentanaDeEnvio(config.horaEnvio, config.zonaHoraria, ahora)) {
        resultados.push({ idTenant, candidatos: 0, procesados: [], fueraDeHorario: true });
        continue;
      }
    }
    const enviador = dryRun ? crearSimuladorLog(idTenant) : undefined;
    resultados.push(await procesarCumpleanosDelTenant(supabase, { idTenant, ahora, enviador }));
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
