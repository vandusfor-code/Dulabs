import type { SupabaseClient } from "@supabase/supabase-js";

// DuLabs Developer V1 -- Fase 2 (autorizado, sección 14/19 del brief). Log
// append-only de eventos para poder reconstruir qué pasó con una
// operación. UNIQUE(event_id) (ver migración) es la deduplicación real
// contra la entrega at-least-once de Pub/Sub -- reintentar el registro del
// MISMO event_id nunca produce una segunda fila.

// Fase 6 (D4) -- enum extendido ADITIVAMENTE con delivered/read.
export type TipoEvento = "received" | "queued" | "sending" | "sent" | "delivered" | "read" | "failed";

// Fase 6 (D2) -- estado de la entrega al webhook del Developer.
export type EstadoEntrega = "pendiente" | "entregando" | "entregado" | "fallido" | "dlq" | "sin_webhook";

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
  payload: Record<string, unknown> | null;
  procesado_en: string | null;
  // Fase 6 (D2) -- retry/DLQ de la entrega al webhook del Developer.
  entrega_estado: EstadoEntrega;
  entrega_intentos: number;
  entrega_next_attempt_at: string | null;
  entrega_ultimo_error: string | null;
};

// Fase 6 (D2) -- política de reintentos de entrega al Developer.
export const MAX_INTENTOS_ENTREGA = 5;
export const LEASE_ENTREGA_MS = 30_000;
/** Backoff exponencial acotado: 30s, 60s, 120s, 240s, tope 300s. */
export function backoffEntregaMs(intentosYaHechos: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, intentosYaHechos - 1), 300_000);
}

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
  params: {
    eventId: string;
    workspaceId: string;
    tipo: TipoEvento;
    jobId?: string | null;
    requestId?: string | null;
    correlationId?: string | null;
    payload?: Record<string, unknown> | null;
  }
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
      payload: params.payload ?? null,
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
export async function obtenerEventoPorId(supabase: SupabaseClient, params: { id: number }): Promise<EventoFila | null> {
  const { data, error } = await supabase.from("dulabs_dev_events").select("*").eq("id", params.id).maybeSingle();
  if (error) throw new Error(`[developer/events-store] error obteniendo evento por id: ${error.message}`);
  return (data as EventoFila) ?? null;
}

/**
 * Marca un evento como PROCESADO por el Worker inbound -- CAS real: solo
 * aplica si `procesado_en` seguía NULL. Es lo que hace que "recibir dos
 * veces el mismo evento" (redelivery de Pub/Sub, o del propio barrido de
 * recuperación) nunca produzca un segundo efecto secundario (ej. un
 * segundo reenvío al Developer Webhook) -- el Worker debe llamar a esto
 * ANTES de reenviar, y solo reenviar si `marcado` es true.
 */
export async function marcarEventoProcesado(supabase: SupabaseClient, params: { id: number }): Promise<{ marcado: boolean }> {
  const { data, error } = await supabase
    .from("dulabs_dev_events")
    .update({ procesado_en: new Date().toISOString() })
    .eq("id", params.id)
    .is("procesado_en", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`[developer/events-store] error marcando evento procesado: ${error.message}`);
  return { marcado: Boolean(data) };
}

// ============================================================
// Fase 6 (D2) -- entrega al webhook del Developer con retry/DLQ.
// ============================================================

/**
 * Reclama un evento para intentar su entrega -- CAS real: solo aplica si
 * `entrega_estado` es reintentable (pendiente/fallido, o un 'entregando'
 * vencido de un worker que murió) Y `entrega_next_attempt_at` ya venció (o
 * es null). Al reclamar fija next_attempt_at = ahora + LEASE, de modo que
 * un segundo worker concurrente NO pueda reclamar el mismo evento (su WHERE
 * de "next_attempt_at <= ahora" ya no matchea). Devuelve la fila reclamada
 * (con su entrega_intentos actual) o {reclamado:false}.
 */
export async function reclamarEntrega(supabase: SupabaseClient, params: { id: number }): Promise<{ reclamado: boolean; fila: EventoFila | null }> {
  const ahora = new Date();
  const leaseHasta = new Date(ahora.getTime() + LEASE_ENTREGA_MS).toISOString();
  const { data, error } = await supabase
    .from("dulabs_dev_events")
    .update({ entrega_estado: "entregando", entrega_next_attempt_at: leaseHasta })
    .eq("id", params.id)
    .in("entrega_estado", ["pendiente", "fallido", "entregando"])
    .or(`entrega_next_attempt_at.is.null,entrega_next_attempt_at.lte.${ahora.toISOString()}`)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`[developer/events-store] error reclamando entrega: ${error.message}`);
  return { reclamado: Boolean(data), fila: (data as EventoFila) ?? null };
}

/** Entrega exitosa -- estado terminal. Setea procesado_en (backcompat de observabilidad de Fase 3). */
export async function marcarEntregado(supabase: SupabaseClient, params: { id: number }): Promise<void> {
  const { error } = await supabase
    .from("dulabs_dev_events")
    .update({ entrega_estado: "entregado", entrega_next_attempt_at: null, entrega_ultimo_error: null, procesado_en: new Date().toISOString() })
    .eq("id", params.id);
  if (error) throw new Error(`[developer/events-store] error marcando entregado: ${error.message}`);
}

/** Fallo REINTENTABLE (5xx/timeout/red) -- programa el próximo intento con backoff, o pasa a DLQ si agotó los intentos. `motivoSanitizado` NUNCA debe traer secretos. */
export async function marcarEntregaReintentable(
  supabase: SupabaseClient,
  params: { id: number; intentosPrevios: number; motivoSanitizado: string }
): Promise<{ estado: "fallido" | "dlq" }> {
  const intentos = params.intentosPrevios + 1;
  if (intentos >= MAX_INTENTOS_ENTREGA) {
    await marcarEntregaDlq(supabase, { id: params.id, intentos, motivoSanitizado: `max_intentos:${params.motivoSanitizado}` });
    return { estado: "dlq" };
  }
  const next = new Date(Date.now() + backoffEntregaMs(intentos)).toISOString();
  const { error } = await supabase
    .from("dulabs_dev_events")
    .update({ entrega_estado: "fallido", entrega_intentos: intentos, entrega_next_attempt_at: next, entrega_ultimo_error: params.motivoSanitizado })
    .eq("id", params.id);
  if (error) throw new Error(`[developer/events-store] error marcando entrega reintentable: ${error.message}`);
  return { estado: "fallido" };
}

/** Fallo TERMINAL (4xx no reintentable, URL insegura, etc.) -- va directo a DLQ, nunca se reintenta. */
export async function marcarEntregaDlq(supabase: SupabaseClient, params: { id: number; intentos?: number; motivoSanitizado: string }): Promise<void> {
  const cambios: Record<string, unknown> = { entrega_estado: "dlq", entrega_next_attempt_at: null, entrega_ultimo_error: params.motivoSanitizado };
  if (typeof params.intentos === "number") cambios.entrega_intentos = params.intentos;
  const { error } = await supabase.from("dulabs_dev_events").update(cambios).eq("id", params.id);
  if (error) throw new Error(`[developer/events-store] error marcando entrega DLQ: ${error.message}`);
}

/** No hay webhook configurado (o está pausado) -- no es un fallo, no se reintenta. */
export async function marcarEntregaSinWebhook(supabase: SupabaseClient, params: { id: number }): Promise<void> {
  const { error } = await supabase
    .from("dulabs_dev_events")
    .update({ entrega_estado: "sin_webhook", entrega_next_attempt_at: null })
    .eq("id", params.id);
  if (error) throw new Error(`[developer/events-store] error marcando sin_webhook: ${error.message}`);
}

/**
 * Barrido de reintentos de entrega (dulabs-reconciliation, Fase 6 D2):
 * eventos reintentables cuyo next_attempt_at ya venció (o es null), por
 * debajo del tope de intentos. Incluye 'entregando' vencido (worker que
 * murió a mitad). Usa dulabs_dev_events_entrega_pendiente_idx.
 */
export async function obtenerEntregasListasParaReintento(supabase: SupabaseClient, params: { limite?: number } = {}): Promise<EventoFila[]> {
  const ahora = new Date().toISOString();
  const { data, error } = await supabase
    .from("dulabs_dev_events")
    .select("*")
    .in("entrega_estado", ["pendiente", "fallido", "entregando"])
    .lt("entrega_intentos", MAX_INTENTOS_ENTREGA)
    .or(`entrega_next_attempt_at.is.null,entrega_next_attempt_at.lte.${ahora}`)
    .order("created_at", { ascending: true })
    .limit(params.limite ?? 200);
  if (error) throw new Error(`[developer/events-store] error obteniendo entregas listas para reintento: ${error.message}`);
  return (data ?? []) as EventoFila[];
}

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
