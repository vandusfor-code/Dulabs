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

// Fase 7 (autorizado) -- período mensual determinista en hora de Colombia
// (America/Bogota, UTC-5, sin DST), MISMA zona que usa la columna `period`
// de dulabs_dev_usage_ledger y las funciones atómicas de la migración
// 20261013000000. Nunca depende de la zona del servidor (Cloud Run corre en
// UTC) -- se calcula explícitamente en Bogotá para que coincida con lo que
// la DB almacena.
export function periodoActual(fecha: Date = new Date()): string {
  // en-CA da formato YYYY-MM-DD; nos quedamos con YYYY-MM.
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(fecha);
  return ymd.slice(0, 7);
}

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

// ============================================================
// Fase 7 (autorizado) -- reserva mensual ATÓMICA (idempotencia + cuota +
// job + ledger en una sola transacción) vía la función de Postgres
// dulabs_dev_reclamar_reservar_mensaje (migración 20261013000000). Es el
// ÚNICO camino de reserva que aplica el límite mensual del plan y garantiza
// que un exceso de cuota NO deje idempotency-key/job/ledger huérfanos (la
// función hace rollback total). reservarUso() de arriba sigue existiendo
// como primitivo de bajo nivel (sin límite) para tests y usos internos.
// ============================================================

export type ResultadoReservaMensual =
  | { resultado: "nuevo"; jobId: string; periodo: string }
  | { resultado: "duplicado_identico"; jobId: string }
  | { resultado: "conflicto_payload_distinto" }
  | { resultado: "limite_excedido" };

/** Token único con el que la función de Postgres marca "cuota mensual excedida" en el mensaje de la excepción (ver migración 20261013000000). */
const SENTINEL_LIMITE_MENSUAL = "DULABS_LIMITE_MENSUAL_EXCEDIDO";

/**
 * Llama a la función atómica. `limiteMensual` null = plan sin límite
 * mensual (AGENCY/ENTERPRISE) -> no se aplica cuota. El límite lo resuelve
 * el caller desde el plan (lib/developer/plans.ts) y lo pasa acá; esta
 * función es un wrapper delgado sobre el primitivo genérico de Postgres, lo
 * que además permite a los tests ejercer límites pequeños de forma directa.
 */
export async function reclamarYReservarMensaje(
  supabase: SupabaseClient,
  params: {
    workspaceId: string;
    idempotencyKey: string;
    payloadHash: string;
    payload: Record<string, unknown>;
    whatsappNumberId: string;
    limiteMensual: number | null;
    cantidad?: number;
  }
): Promise<ResultadoReservaMensual> {
  const { data, error } = await supabase.rpc("dulabs_dev_reclamar_reservar_mensaje", {
    p_workspace_id: params.workspaceId,
    p_idempotency_key: params.idempotencyKey,
    p_payload_hash: params.payloadHash,
    p_payload: params.payload,
    p_whatsapp_number_id: params.whatsappNumberId,
    p_limite_mensual: params.limiteMensual,
    p_cantidad: params.cantidad ?? 1,
  });

  if (error) {
    // La cuota excedida es un resultado ESPERADO (no un fallo real): la
    // función hace RAISE con un token único para poder revertir el reclamo
    // de idempotencia de forma atómica. Cualquier otro error sí es real.
    if (error.message?.includes(SENTINEL_LIMITE_MENSUAL)) return { resultado: "limite_excedido" };
    throw new Error(`[developer/usage-ledger] error en reserva mensual atómica: ${error.message}`);
  }

  const fila = Array.isArray(data) ? data[0] : data;
  if (!fila) throw new Error("[developer/usage-ledger] la reserva mensual atómica no devolvió ninguna fila");

  switch (fila.resultado) {
    case "nuevo":
      return { resultado: "nuevo", jobId: fila.job_id as string, periodo: fila.periodo as string };
    case "duplicado_identico":
      return { resultado: "duplicado_identico", jobId: fila.job_id as string };
    case "conflicto_payload_distinto":
      return { resultado: "conflicto_payload_distinto" };
    default:
      throw new Error(`[developer/usage-ledger] resultado inesperado de la reserva mensual: ${String(fila.resultado)}`);
  }
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

/**
 * Fase 7 (autorizado) -- resumen mensual real por período (YYYY-MM). Suma
 * `cantidad` (no cuenta filas) para ser correcto si algún día un job vale
 * más de 1 mensaje; hoy 1 job = 1 mensaje = cantidad 1, así que coincide.
 * `reservado + confirmado` es el consumo que cuenta contra la cuota (mismo
 * criterio EXACTO que la función atómica de reserva); `liberado` no cuenta.
 */
export async function obtenerResumenMensualDelWorkspace(supabase: SupabaseClient, params: { workspaceId: string; period: string }): Promise<ResumenUso> {
  const { data, error } = await supabase
    .from("dulabs_dev_usage_ledger")
    .select("estado, cantidad")
    .eq("workspace_id", params.workspaceId)
    .eq("period", params.period);
  if (error) throw new Error(`[developer/usage-ledger] error obteniendo resumen mensual: ${error.message}`);

  const resumen: ResumenUso = { reserved: 0, confirmed: 0, released: 0 };
  for (const fila of data ?? []) {
    const cantidad = (fila.cantidad as number) ?? 0;
    if (fila.estado === "reservado") resumen.reserved += cantidad;
    else if (fila.estado === "confirmado") resumen.confirmed += cantidad;
    else if (fila.estado === "liberado") resumen.released += cantidad;
  }
  return resumen;
}

/** Fase 7 (autorizado) -- cantidad de números registrados en el workspace (cualquier estado). Es lo que cuenta contra `numeros_incluidos` del plan (mismo criterio que la función atómica de registro). */
export async function contarNumerosDelWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<number> {
  const { count, error } = await supabase.from("dulabs_dev_whatsapp_numbers").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  if (error) throw new Error(`[developer/usage-ledger] error contando números del workspace: ${error.message}`);
  return count ?? 0;
}
