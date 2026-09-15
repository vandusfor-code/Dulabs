import type { SupabaseClient } from "@supabase/supabase-js";

// DuLabs Developer V1 -- Fase 2 (autorizado, sección 13 del brief).
// Ledger técnico de consumo: reservar -> confirmar/liberar, SIEMPRE sobre
// la MISMA fila (UNIQUE(job_id), ver migración) -- nunca un INSERT nuevo
// por cada transición, eso es justo lo que produciría doble contabilización
// si dos procesos reservaran para el mismo job.
//
// Billing comercial completo (moneda, tasas, facturación) es de una fase
// posterior -- esto es solo la garantía técnica "un job, como mucho un
// cargo lógico, nunca más".

export type EstadoLedger = "reservado" | "confirmado" | "liberado";

export type LedgerFila = {
  id: number;
  workspace_id: string;
  job_id: string;
  estado: EstadoLedger;
  cantidad: number;
  created_at: string;
  updated_at: string;
};

export type ResultadoReserva = { reservado: true; fila: LedgerFila } | { reservado: false; motivo: "ya_reservado_o_procesado" };

/** Reserva consumo para un job -- INSERT único (UNIQUE(job_id) lo hace irrepetible a nivel de Postgres, no solo de "el código revisa antes"). */
export async function reservarUso(supabase: SupabaseClient, params: { workspaceId: string; jobId: string; cantidad?: number }): Promise<ResultadoReserva> {
  const { data, error } = await supabase
    .from("dulabs_dev_usage_ledger")
    .insert({ workspace_id: params.workspaceId, job_id: params.jobId, estado: "reservado", cantidad: params.cantidad ?? 1 })
    .select("*")
    .maybeSingle();

  if (!error && data) return { reservado: true, fila: data as LedgerFila };
  if (error && error.code === "23505") return { reservado: false, motivo: "ya_reservado_o_procesado" };
  throw new Error(`[developer/usage-ledger] error reservando uso: ${error?.message ?? "sin fila devuelta"}`);
}

/** Confirma una reserva existente como consumo real -- CAS: solo transiciona si sigue en 'reservado' (nunca confirma dos veces, nunca confirma algo que ya se liberó). */
export async function confirmarUso(supabase: SupabaseClient, params: { workspaceId: string; jobId: string }): Promise<{ confirmado: boolean }> {
  const { data, error } = await supabase
    .from("dulabs_dev_usage_ledger")
    .update({ estado: "confirmado", updated_at: new Date().toISOString() })
    .eq("workspace_id", params.workspaceId)
    .eq("job_id", params.jobId)
    .eq("estado", "reservado")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`[developer/usage-ledger] error confirmando uso: ${error.message}`);
  return { confirmado: Boolean(data) };
}

/** Libera una reserva (el job falló definitivamente, no debe cobrarse) -- mismo criterio de CAS que confirmarUso: solo desde 'reservado'. */
export async function liberarUso(supabase: SupabaseClient, params: { workspaceId: string; jobId: string }): Promise<{ liberado: boolean }> {
  const { data, error } = await supabase
    .from("dulabs_dev_usage_ledger")
    .update({ estado: "liberado", updated_at: new Date().toISOString() })
    .eq("workspace_id", params.workspaceId)
    .eq("job_id", params.jobId)
    .eq("estado", "reservado")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`[developer/usage-ledger] error liberando uso: ${error.message}`);
  return { liberado: Boolean(data) };
}

export async function obtenerLedgerDelJob(supabase: SupabaseClient, params: { workspaceId: string; jobId: string }): Promise<LedgerFila | null> {
  const { data, error } = await supabase.from("dulabs_dev_usage_ledger").select("*").eq("workspace_id", params.workspaceId).eq("job_id", params.jobId).maybeSingle();
  if (error) throw new Error(`[developer/usage-ledger] error obteniendo ledger: ${error.message}`);
  return (data as LedgerFila) ?? null;
}

export type ResumenUso = { reserved: number; confirmed: number; released: number };

/**
 * Fase 4 (autorizado, GET /api/v1/usage) -- lectura agregada sobre la
 * MISMA tabla que reservarUso/confirmarUso/liberarUso ya usan, activada en
 * el cierre de Fase 3. No es un sistema de billing nuevo: es un count por
 * estado, opcionalmente acotado por fecha. Sin dinero, sin plan, sin
 * límites -- eso queda fuera de alcance explícitamente.
 */
export async function obtenerResumenUsoDelWorkspace(supabase: SupabaseClient, params: { workspaceId: string; desde?: string; hasta?: string }): Promise<ResumenUso> {
  let query = supabase.from("dulabs_dev_usage_ledger").select("estado").eq("workspace_id", params.workspaceId);
  if (params.desde) query = query.gte("created_at", params.desde);
  if (params.hasta) query = query.lt("created_at", params.hasta);

  const { data, error } = await query;
  if (error) throw new Error(`[developer/usage-ledger] error obteniendo resumen de uso: ${error.message}`);

  const resumen: ResumenUso = { reserved: 0, confirmed: 0, released: 0 };
  for (const fila of data ?? []) {
    if (fila.estado === "reservado") resumen.reserved++;
    else if (fila.estado === "confirmado") resumen.confirmed++;
    else if (fila.estado === "liberado") resumen.released++;
  }
  return resumen;
}
