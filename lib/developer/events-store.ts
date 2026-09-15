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
  published_at: string | null;
  intentos_publicacion: number;
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

// DuLabs Developer V1 -- Fase 3 (autorizado, mecanismo de recuperación
// inbound, ver docs/DULABS_DEVELOPER_V1_PHASE_3_INFRASTRUCTURE_DESIGN.md
// sección A). Extiende dulabs_dev_events (Fase 2) en vez de crear una tabla
// paralela -- resuelve el patrón "DB commit -> Pub/Sub publish -> fallo".

/**
 * Marca un evento como publicado con éxito -- CAS real: solo aplica si
 * `published_at` seguía NULL (protege contra que el intento síncrono del
 * Gateway y una pasada posterior del barrido de recuperación se pisen
 * entre sí). Devuelve `false` si el evento ya estaba marcado (no es un
 * error, es la condición esperada de la carrera).
 */
export async function marcarEventoPublicado(supabase: SupabaseClient, params: { id: number }): Promise<{ marcado: boolean }> {
  const { data, error } = await supabase
    .from("dulabs_dev_events")
    .update({ published_at: new Date().toISOString() })
    .eq("id", params.id)
    .is("published_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`[developer/events-store] error marcando evento publicado: ${error.message}`);
  return { marcado: Boolean(data) };
}

/**
 * Incrementa `intentos_publicacion` de forma ATÓMICA -- un único UPDATE con
 * `intentos_publicacion = intentos_publicacion + 1` evaluado del lado de
 * Postgres, nunca un read -> incrementar en JS -> write (eso sí tendría una
 * ventana de carrera real entre dos ejecuciones concurrentes del barrido).
 * Devuelve el valor ya incrementado, leído del mismo UPDATE (RETURNING).
 */
export async function incrementarIntentoPublicacion(supabase: SupabaseClient, params: { id: number }): Promise<number> {
  const { data, error } = await supabase.rpc("dulabs_dev_events_incrementar_intento", { p_id: params.id });
  if (error) throw new Error(`[developer/events-store] error incrementando intento de publicación: ${error.message}`);
  return data as number;
}

/**
 * Eventos candidatos al barrido de recuperación: `published_at` NULL, con
 * más de `minutosAntiguedad` desde `created_at` (le da tiempo al intento
 * síncrono original antes de considerarlo atascado), y por debajo del tope
 * de intentos -- usa el índice parcial `dulabs_dev_events_pendiente_publicacion_idx`.
 */
export async function obtenerEventosPendientesDePublicar(
  supabase: SupabaseClient,
  params: { minutosAntiguedad: number; maximoIntentos: number; limite?: number }
): Promise<EventoFila[]> {
  const umbral = new Date(Date.now() - params.minutosAntiguedad * 60_000).toISOString();
  const { data, error } = await supabase
    .from("dulabs_dev_events")
    .select("*")
    .is("published_at", null)
    .lt("created_at", umbral)
    .lt("intentos_publicacion", params.maximoIntentos)
    .order("created_at", { ascending: true })
    .limit(params.limite ?? 200);
  if (error) throw new Error(`[developer/events-store] error obteniendo eventos pendientes de publicar: ${error.message}`);
  return (data ?? []) as EventoFila[];
}
