/**
 * RETENCIÓN de los datos del agente (Bloque 18): lo que ya no hace falta se borra.
 *
 *   dulabs_agente_trazas           90 días  (diagnóstico; dulabs_agente_trazas_purgar, mínimo 7)
 *   dulabs_agente_buzon            14 días  (dedupe de reintentos de Meta y ráfagas: minutos;
 *                                            guarda wa_id y, sin procesar, el texto del cliente)
 *   dulabs_agente_medios_enviados  90 días  (responder a una foto de hace más de 3 meses => el
 *                                            agente pregunta qué producto era, no adivina)
 *
 * No se tocan: pedidos, estado de la conversación (memoria del cliente), mensajes del Inbox.
 * Cada paso es independiente: una tabla ausente (sin migración) cuenta 0; un error se reporta
 * y no frena los demás. Lo ejecuta el cron /api/cron/agente-retencion (diario, CRON_SECRET).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const RETENCION_DIAS = { trazas: 90, buzon: 14, medios: 90 } as const;
const SIN_MIGRACION = new Set(["42P01", "PGRST205", "PGRST202", "42883"]);

export type ResultadoPaso = { borradas: number } | { error: string };
export interface ResultadoRetencion {
  trazas: ResultadoPaso;
  buzon: ResultadoPaso;
  medios: ResultadoPaso;
}

function paso(error: { code?: string; message?: string } | null, borradas: number | null): ResultadoPaso {
  if (!error) return { borradas: borradas ?? 0 };
  if (SIN_MIGRACION.has(error.code ?? "")) return { borradas: 0 };
  return { error: (error.code ?? "error").slice(0, 20) };
}

export async function purgarDatosAgente(supabase: SupabaseClient, ahora: number = Date.now()): Promise<ResultadoRetencion> {
  const antes = (dias: number) => new Date(ahora - dias * 86_400_000).toISOString();

  const trazas = await supabase.rpc("dulabs_agente_trazas_purgar", { p_dias: RETENCION_DIAS.trazas });
  // Procesados o no: pasado el plazo ninguno sirve (el texto ya está en dulabs_mensajes_log).
  const buzon = await supabase.from("dulabs_agente_buzon").delete({ count: "exact" }).lt("recibido_at", antes(RETENCION_DIAS.buzon));
  const medios = await supabase.from("dulabs_agente_medios_enviados").delete({ count: "exact" }).lt("created_at", antes(RETENCION_DIAS.medios));

  return {
    trazas: paso(trazas.error, typeof trazas.data === "number" ? trazas.data : Number(trazas.data ?? 0)),
    buzon: paso(buzon.error, buzon.count),
    medios: paso(medios.error, medios.count),
  };
}
