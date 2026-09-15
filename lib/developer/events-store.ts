import type { SupabaseClient } from "@supabase/supabase-js";

// DuLabs Developer V1 -- Fase 2 (autorizado, sección 14/19 del brief). Log
// append-only de eventos para poder reconstruir qué pasó con una
// operación. UNIQUE(event_id) (ver migración) es la deduplicación real
// contra la entrega at-least-once de Pub/Sub -- reintentar el registro del
// MISMO event_id nunca produce una segunda fila.

export type TipoEvento = "received" | "queued" | "sending" | "sent" | "failed";

export type EventoFila = {
  id: number;
  event_id: string;
  workspace_id: string;
  job_id: string | null;
  request_id: string | null;
  correlation_id: string | null;
  tipo: TipoEvento;
  created_at: string;
};

export type ResultadoRegistroEvento = { registrado: true; fila: EventoFila } | { registrado: false; motivo: "evento_duplicado" };

/**
 * Registra un evento de forma idempotente. Si `eventId` ya se vio antes
 * (Pub/Sub reentregó el mismo mensaje), NO inserta una segunda fila -- se
 * detecta por la violación de unicidad real de Postgres, no por un SELECT
 * previo (misma razón que en lib/developer/idempotency.ts: un SELECT-then-
 * INSERT tiene una ventana de carrera real).
 */
export async function registrarEvento(
  supabase: SupabaseClient,
  params: { eventId: string; workspaceId: string; tipo: TipoEvento; jobId?: string | null; requestId?: string | null; correlationId?: string | null }
): Promise<ResultadoRegistroEvento> {
  const { data, error } = await supabase
    .from("dulabs_dev_events")
    .insert({
      event_id: params.eventId,
      workspace_id: params.workspaceId,
      tipo: params.tipo,
      job_id: params.jobId ?? null,
      request_id: params.requestId ?? null,
      correlation_id: params.correlationId ?? null,
    })
    .select("*")
    .maybeSingle();

  if (!error && data) return { registrado: true, fila: data as EventoFila };
  if (error && error.code === "23505") return { registrado: false, motivo: "evento_duplicado" };
  throw new Error(`[developer/events-store] error registrando evento: ${error?.message ?? "sin fila devuelta"}`);
}

export async function obtenerEventosDelJob(supabase: SupabaseClient, params: { workspaceId: string; jobId: string }): Promise<EventoFila[]> {
  const { data, error } = await supabase
    .from("dulabs_dev_events")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("job_id", params.jobId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`[developer/events-store] error obteniendo eventos: ${error.message}`);
  return (data ?? []) as EventoFila[];
}
