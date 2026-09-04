import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { enviarWhatsApp } from "@/lib/whatsapp-outbound";
import { saveExecutionState } from "@/lib/flow/flow-store";
import { executionRowToEngineState, type FlowExecutionRow } from "@/lib/flow/flow-store-types";
import { DURACION_SEGUIMIENTO_MS } from "@/lib/asistente-daniela-ia";
import type { ClienteConfig } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

// Exclusivo de SOLOTALENTO SAS -- identidad fija, nunca parametrizada desde
// afuera de este archivo. NUNCA se usa lib/asistente-daniela-ia.ts para el
// texto (solo se reutiliza el umbral de tiempo ya establecido en ese
// archivo, DURACION_SEGUIMIENTO_MS -- "el tiempo de inactividad que
// corresponde al comportamiento actual del sistema", pedido explícito).
const SOLOTALENTO_TENANT_ID = "11ccf0a3-726b-4d4b-9f7d-2deb8441d6a9";
const SOLOTALENTO_PHONE_NUMBER_ID = "1321997104321708";

export const MENSAJE_PAUSA_SOLOTALENTO =
  "Hola!👋 Dejaré tu solicitud en pausa por el momento. *Cuando quieras retomarla, con gusto te ayudamos a continuar.";

// Se reutiliza dulabs_flow_executions.metadata (jsonb ya existente en cada
// ejecución) para recordar "ya se envió el aviso de pausa" -- ninguna
// columna ni tabla nueva. Deliberadamente NO se usa dulabs_pausas_chat/
// activarPausaChat acá: esa función SILENCIA a la IA para ese chat durante
// horas, y el propio mensaje pedido invita a "retomar cuando quieras" -- si
// el cliente responde 2 minutos después, el bot debe seguir respondiendo
// normal, no quedarse callado.
const METADATA_FLAG_ENVIADO = "pausaInactividadEnviada";

/**
 * Detección de inactividad de SOLOTALENTO (autorizado, NUEVO -- Fase de
 * cierre de cambios solicitados por la cliente).
 *
 * Reutiliza la MISMA memoria de conversación que ya mantiene el Flow Engine
 * en cada turno (dulabs_flow_executions.status/last_activity_at, actualizado
 * por saveExecutionState en CADA respuesta real -- ver
 * engineStateToExecutionUpdate, lib/flow/flow-store-types.ts) en vez de
 * construir un mecanismo de timestamps paralelo: `status='waiting_input'`
 * YA significa "el bot está esperando una respuesta de este cliente", y
 * `last_activity_at` YA es "cuándo fue el último turno real" (se refresca
 * en cada mensaje del cliente que el motor procesa).
 *
 * `tenantId`/`phoneNumberId`/`mensaje`/`duracionMs` se reciben como
 * parámetros explícitos (nunca hardcoded adentro de esta función) para que
 * las pruebas puedan usar un tenant descartable real, sin tocar jamás datos
 * de SOLOTALENTO -- el wrapper HTTP de abajo es quien fija los valores
 * reales de producción.
 */
export async function ejecutarSeguimientoInactividadSolotalento(
  supabase: SupabaseClient,
  opts: { tenantId: string; phoneNumberId: string; mensaje: string; duracionMs: number },
): Promise<{ enviados: number; errores: string[] }> {
  const limite = new Date(Date.now() - opts.duracionMs).toISOString();

  const { data: ejecuciones, error } = await supabase
    .from("dulabs_flow_executions")
    .select("*")
    .eq("tenant_id", opts.tenantId)
    .eq("phone_number_id", opts.phoneNumberId)
    .eq("status", "waiting_input")
    .lte("last_activity_at", limite);

  if (error) {
    return { enviados: 0, errores: [`consulta dulabs_flow_executions: ${error.message}`] };
  }

  const pendientes = ((ejecuciones ?? []) as FlowExecutionRow[]).filter(
    (e) => e.metadata?.[METADATA_FLAG_ENVIADO] !== true,
  );
  if (pendientes.length === 0) return { enviados: 0, errores: [] };

  const { data: cliente, error: clienteErr } = await supabase
    .from("dulabs_clientes_config")
    .select("*")
    .eq("phone_number_id", opts.phoneNumberId)
    .maybeSingle();
  if (clienteErr || !cliente) {
    return {
      enviados: 0,
      errores: [`sin configuración de cliente para phone_number_id=${opts.phoneNumberId}: ${clienteErr?.message ?? "no encontrado"}`],
    };
  }

  let enviados = 0;
  const errores: string[] = [];

  for (const ejecucion of pendientes) {
    try {
      await enviarWhatsApp(supabase, cliente as ClienteConfig, ejecucion.telefono_cliente, opts.mensaje);

      const state = executionRowToEngineState(ejecucion);
      await saveExecutionState(
        supabase,
        opts.tenantId,
        ejecucion.id,
        { ...state, metadata: { ...state.metadata, [METADATA_FLAG_ENVIADO]: true } },
        ejecucion.state_version,
      ).catch(() => {
        // Best-effort -- mismo criterio que marcarEjecucionRotaComoFallida
        // (lib/flow-runtime-bridge.ts): un conflicto de concurrencia acá no
        // debe tumbar el resto del barrido. En el peor caso, el próximo
        // barrido reintenta marcar (self-heal), nunca queda enganchado.
      });
      enviados++;
    } catch (err) {
      errores.push(`${ejecucion.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { enviados, errores };
}

async function manejar(request: NextRequest) {
  const cuerpo = await request.text();
  if (!(await solicitudAutorizadaCron(request, cuerpo))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const resultado = await ejecutarSeguimientoInactividadSolotalento(supabaseAdmin(), {
    tenantId: SOLOTALENTO_TENANT_ID,
    phoneNumberId: SOLOTALENTO_PHONE_NUMBER_ID,
    mensaje: MENSAJE_PAUSA_SOLOTALENTO,
    duracionMs: DURACION_SEGUIMIENTO_MS,
  });
  return Response.json(resultado);
}

export async function GET(request: NextRequest) {
  return manejar(request);
}

export async function POST(request: NextRequest) {
  return manejar(request);
}
