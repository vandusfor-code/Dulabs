import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { reclamarCicloParaReintento } from "@/lib/dunning/dunning-domain";
import { procesarReintentoCobro } from "@/lib/dunning/procesar-reintento";
import { enviarNotificacionDunning } from "@/lib/dunning/notificaciones";
import { fechaRecordatorio } from "@/lib/dunning/politica";

export const runtime = "nodejs";
export const maxDuration = 60;

// FASE F16.1 (Commercial Scale — Dunning, autorizado) — cron DEDICADO de
// reintentos de cobro para tenants en dunning, separado a propósito de
// app/api/wompi/cobro-mensual/route.ts (ese cron ahora se salta cualquier
// tenant con un ciclo de dunning activo -- ver el guard que agrega ahí esta
// misma fase). El cobro real (crearTransaccion/insertarPagoConPlan/
// resolverEstadoPago) vive en lib/dunning/procesar-reintento.ts, compartido
// con el reintento manual del cliente y del admin -- ninguna segunda
// lógica de cobro acá.
//
// Concurrencia: dulabs_dunning_reclamar_reintento (RPC atómica,
// UPDATE...WHERE...RETURNING) es la única fuente de verdad de "a quién le
// toca reintentar ahora" -- si dos invocaciones de este cron corrieran a la
// vez, la segunda simplemente no reclama nada para ese tenant.
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = supabaseAdmin();
  const ahora = new Date();

  const { data: ciclosActivos, error } = await supabase
    .from("dulabs_dunning_ciclos")
    .select("id, id_tenant, intentos, primer_fallo_at, proximo_intento_at")
    .eq("estado", "activo");
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const resultadosReintentos: { id_tenant: string; ok: boolean; detalle: string }[] = [];
  const resultadosRecordatorios: { id_tenant: string; ok: boolean; detalle: string }[] = [];

  for (const ciclo of ciclosActivos ?? []) {
    // --- Recordatorio (día intermedio, independiente de si hoy toca reintentar) ---
    try {
      if (fechaRecordatorio(new Date(ciclo.primer_fallo_at)) <= ahora) {
        const { data: authUser } = await supabase.auth.admin.getUserById(ciclo.id_tenant);
        const { data: sub } = await supabase.from("dulabs_suscripciones").select("fecha_proximo_cobro").eq("id_tenant", ciclo.id_tenant).maybeSingle();
        const resultado = await enviarNotificacionDunning(supabase, {
          idTenant: ciclo.id_tenant,
          cicloId: ciclo.id,
          tipo: "reminder",
          destinatario: authUser?.user?.email ?? null,
          nombreNegocio: (authUser?.user?.user_metadata?.nombre as string | undefined) ?? null,
          fechaLimite: sub?.fecha_proximo_cobro ?? undefined,
        });
        resultadosRecordatorios.push({ id_tenant: ciclo.id_tenant, ok: true, detalle: resultado.yaEnviada ? "ya se había enviado" : resultado.enviada ? "enviado" : "sin enviar (ver motivo)" });
      }
    } catch (err) {
      console.error(`[dunning-reintentos] error enviando recordatorio a ${ciclo.id_tenant}:`, err instanceof Error ? err.message : String(err));
    }

    // --- Reintento de cobro (solo si ya toca según proximo_intento_at) ---
    if (!ciclo.proximo_intento_at || new Date(ciclo.proximo_intento_at) > ahora) continue;

    try {
      const reclamo = await reclamarCicloParaReintento(supabase, ciclo.id_tenant);
      if (!reclamo) {
        resultadosReintentos.push({ id_tenant: ciclo.id_tenant, ok: true, detalle: "omitido: ya reclamado por otra ejecución o no le toca todavía" });
        continue;
      }

      const resultado = await procesarReintentoCobro(supabase, {
        idTenant: ciclo.id_tenant,
        cicloId: reclamo.id,
        intentosActuales: reclamo.intentos,
        primerFalloAt: ciclo.primer_fallo_at,
      });
      resultadosReintentos.push({ id_tenant: ciclo.id_tenant, ok: resultado.resultado !== "rechazado_final", detalle: resultado.resultado });
    } catch (err) {
      const detalle = err instanceof Error ? err.message : String(err);
      console.error(`[dunning-reintentos] error procesando ciclo de ${ciclo.id_tenant}:`, detalle);
      resultadosReintentos.push({ id_tenant: ciclo.id_tenant, ok: false, detalle });
    }
  }

  return Response.json({ procesados: resultadosReintentos.length, resultadosReintentos, recordatorios: resultadosRecordatorios });
}
