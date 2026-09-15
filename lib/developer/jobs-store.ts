import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { reclamarIdempotencia } from "@/lib/developer/idempotency";
import { transicionar, estadoInicial, type EventoJob, type EstadoCompletoJob } from "@/lib/developer/outbound-state-machine";
import { reservarUso } from "@/lib/developer/usage-ledger";

// DuLabs Developer V1 -- Fase 2 (autorizado, secciones 9/10/11 del brief).
// Persistencia real del job saliente + ownership/lease con CAS real
// (`rowCount === 1` después del UPDATE, nunca "el Worker asume que es
// dueño"). Reusa lib/developer/outbound-state-machine.ts (Fase 1, sin
// tocar) como ÚNICA fuente de verdad de qué transiciones son válidas --
// este módulo nunca decide un `status` nuevo por su cuenta, siempre se lo
// pide a transicionar().

export type JobFila = {
  id: string;
  workspace_id: string;
  whatsapp_number_id: string;
  status: EstadoCompletoJob["status"];
  physical_outcome: EstadoCompletoJob["physicalOutcome"];
  network_attempts: number;
  next_attempt_at: string | null;
  lease_id: string | null;
  locked_at: string | null;
  version_token: number;
  payload: Record<string, unknown>;
  wamid: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Reclama la idempotencia (Fase 1, sin modificar) Y crea la fila de job
 * persistente con el MISMO id -- la conexión entre ambas tablas que la
 * migración de Fase 2 documenta explícitamente que NO se hace vía foreign
 * key (para no romper el contrato ya probado de Fase 1), sino acá, en el
 * único punto de entrada real de un job nuevo.
 *
 * Fase 3, cierre (hallazgo del usage_ledger) -- este es también el ÚNICO
 * punto real donde se llama a reservarUso() (Fase 2, lib/developer/usage-ledger.ts,
 * ya existía pero nunca se invocaba desde código de producción). Se
 * reserva acá, no en el Gateway ni en el Worker, porque:
 *   - es el único lugar donde el job_id ya está atómicamente decidido
 *     (viene del propio reclamo de idempotencia, UNIQUE(workspace_id,
 *     idempotency_key) real de Postgres) ANTES de reservar -- nunca se
 *     reserva "adivinando" un id que después podría no persistir;
 *   - una solicitud rechazada ANTES de llegar acá (auth inválida, falta
 *     Idempotency-Key, payload inválido, o un conflicto de idempotencia
 *     con payload distinto -- sección "conflicto_payload_distinto" arriba)
 *     nunca ejecuta esta función, así que nunca reserva;
 *   - "duplicado_identico" (réplica exacta de un request ya procesado)
 *     NUNCA crea una fila de job nueva ni debe crear una reserva nueva --
 *     reservarUso() ya es idempotente por su propio UNIQUE(job_id), así
 *     que reintentarla acá es un no-op seguro, y sirve como auto-sanación
 *     real ante el único caso borde posible: una ejecución anterior creó
 *     la fila de job pero se cayó (crash/timeout) antes de reservar -- un
 *     reintento real del desarrollador con la MISMA Idempotency-Key (el
 *     comportamiento esperado tras un error) completa la reserva que
 *     había quedado pendiente, sin inventar ninguna transacción nueva.
 */
export async function crearJobConIdempotencia(
  supabase: SupabaseClient,
  params: { workspaceId: string; whatsappNumberId: string; idempotencyKey: string; payload: Record<string, unknown> }
): Promise<{ resultado: "nuevo" | "duplicado_identico"; jobId: string } | { resultado: "conflicto_payload_distinto" }> {
  const reclamo = await reclamarIdempotencia(supabase, {
    workspaceId: params.workspaceId,
    idempotencyKey: params.idempotencyKey,
    payload: params.payload,
  });
  if (reclamo.resultado === "conflicto_payload_distinto") return reclamo;
  if (reclamo.resultado === "duplicado_identico") {
    // Auto-sanación idempotente -- ver comentario de la función. Nunca debe
    // romper una réplica que de otro modo sería exitosa: si esto falla de
    // nuevo (ej. Postgres momentáneamente inalcanzable), se ignora y el
    // caller igual recibe su "duplicado_identico" normal.
    await reservarUso(supabase, { workspaceId: params.workspaceId, jobId: reclamo.jobId }).catch(() => {});
    return { resultado: "duplicado_identico", jobId: reclamo.jobId };
  }

  // "nuevo": inserta la fila de job real con ESE mismo id. onConflict
  // do-nothing por si dos requests concurrentes llegaran a pasar el
  // reclamo de idempotencia (no debería, es atómico) y competir acá --
  // nunca produce dos filas de job para el mismo id.
  const { error } = await supabase
    .from("dulabs_dev_jobs")
    .insert({
      id: reclamo.jobId,
      workspace_id: params.workspaceId,
      whatsapp_number_id: params.whatsappNumberId,
      status: "created",
      physical_outcome: "pre_send",
      payload: params.payload,
    });
  if (error && error.code !== "23505") {
    throw new Error(`[developer/jobs-store] error creando fila de job: ${error.message}`);
  }

  // Reserva real de uso -- job_id ya atómicamente decidido arriba. Se deja
  // propagar un error real (nunca se traga silenciosamente): si falla acá,
  // el caller (Gateway) responde error real, y el reintento del
  // desarrollador con la MISMA Idempotency-Key cae en la rama
  // "duplicado_identico" de arriba, que reintenta la reserva.
  await reservarUso(supabase, { workspaceId: params.workspaceId, jobId: reclamo.jobId });
  return { resultado: "nuevo", jobId: reclamo.jobId };
}

export async function obtenerJobDelWorkspace(supabase: SupabaseClient, params: { workspaceId: string; jobId: string }): Promise<JobFila | null> {
  const { data, error } = await supabase.from("dulabs_dev_jobs").select("*").eq("id", params.jobId).eq("workspace_id", params.workspaceId).maybeSingle();
  if (error) throw new Error(`[developer/jobs-store] error obteniendo job: ${error.message}`);
  return (data as JobFila) ?? null;
}

export type ResultadoLease = { adquirido: true; leaseId: string; job: JobFila } | { adquirido: false; motivo: "ya_tomado" | "job_no_encontrado" };

// Un lease se considera vencido después de este tiempo sin refrescar --
// permite que OTRO Worker haga takeover de un job cuyo dueño murió sin
// liberar explícitamente (sección 14 del brief: "si un Worker muere...
// otro Worker puede recuperar el ownership").
export const LEASE_DURACION_MS = 60_000;

// Fase 5 (autorizado, decisión D6) -- backoff real antes de que
// reintentarOutbound() (services/reconciliation/run.ts) vuelva a
// republicar un job en retry_pending. Con MAX_INTENTOS_FISICOS=2 (Fase 1,
// sin tocar) nunca hay más de UN reintento posible en toda la vida de un
// job, así que un backoff exponencial no aporta nada real -- un valor
// fijo, corto respecto al ciclo de 5 minutos de Cloud Scheduler, alcanza
// el objetivo real (evitar que una ráfaga de reconciliación redispare el
// mismo job de inmediato) sin inventar un sistema paralelo.
export const BACKOFF_REINTENTO_MS = 30_000;

/**
 * CAS real de adquisición de lease (sección 10/13 del brief): el UPDATE
 * solo aplica si el job está SIN lease, o su lease ya venció -- Postgres
 * decide atómicamente, nunca "leer y luego decidir en JS". Se comprueba
 * `data` (la fila RETURNING) en vez de una lectura previa -- si el UPDATE
 * no afectó ninguna fila, `data` es null y NINGÚN otro código debe asumir
 * ownership.
 */
export async function adquirirLease(supabase: SupabaseClient, params: { workspaceId: string; jobId: string }): Promise<ResultadoLease> {
  const nuevoLeaseId = randomUUID();
  const ahora = new Date();
  const umbralVencimiento = new Date(ahora.getTime() - LEASE_DURACION_MS).toISOString();

  const { data, error } = await supabase
    .from("dulabs_dev_jobs")
    .update({ lease_id: nuevoLeaseId, locked_at: ahora.toISOString() })
    .eq("id", params.jobId)
    .eq("workspace_id", params.workspaceId)
    .or(`lease_id.is.null,locked_at.lt.${umbralVencimiento}`)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`[developer/jobs-store] error adquiriendo lease: ${error.message}`);

  if (!data) {
    const { data: existe } = await supabase.from("dulabs_dev_jobs").select("id").eq("id", params.jobId).eq("workspace_id", params.workspaceId).maybeSingle();
    return { adquirido: false, motivo: existe ? "ya_tomado" : "job_no_encontrado" };
  }
  return { adquirido: true, leaseId: nuevoLeaseId, job: data as JobFila };
}

/** Libera un lease -- SOLO si el caller es de verdad el dueño actual (leaseId debe matchear). Un Worker que perdió su lease (vencido y tomado por otro) NO puede liberarlo -- liberaría el lease de OTRO Worker. */
export async function liberarLease(supabase: SupabaseClient, params: { workspaceId: string; jobId: string; leaseId: string }): Promise<{ liberado: boolean }> {
  const { data, error } = await supabase
    .from("dulabs_dev_jobs")
    .update({ lease_id: null, locked_at: null })
    .eq("id", params.jobId)
    .eq("workspace_id", params.workspaceId)
    .eq("lease_id", params.leaseId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`[developer/jobs-store] error liberando lease: ${error.message}`);
  return { liberado: Boolean(data) };
}

export type ResultadoActualizacionJob = { aplicada: true; job: JobFila } | { aplicada: false; motivo: "sin_ownership" | "transicion_invalida"; detalle?: string };

/**
 * ÚNICO punto real de mutación del estado de un job. Dos capas de
 * protección, ambas obligatorias:
 *   1. Ownership: el UPDATE exige lease_id = el que trae el caller -- un
 *      Worker sin el lease actual (o que ya lo perdió por vencimiento y
 *      takeover de otro) no puede mutar, sin excepción (sección 10: "no es
 *      aceptable" mutar sin verificar rowCount === 1 de un CAS real).
 *   2. Validez de la transición: se le pregunta a transicionar()
 *      (lib/developer/outbound-state-machine.ts, Fase 1) si el evento es
 *      válido ANTES de tocar la base de datos -- nunca se persiste un
 *      estado que la máquina de estados no autorizó.
 */
export async function aplicarEventoJob(
  supabase: SupabaseClient,
  // Fase 5 (autorizado, decisión D4) -- `wamid` es opcional y se persiste
  // en la MISMA mutación protegida por CAS cuando el caller lo trae (solo
  // el Worker, solo en meta_confirmo_exito con un wamid real capturado) --
  // nunca se agrega un segundo punto de escritura desprotegido para esto.
  params: { workspaceId: string; jobId: string; leaseId: string; evento: EventoJob; wamid?: string }
): Promise<ResultadoActualizacionJob> {
  const actual = await obtenerJobDelWorkspace(supabase, { workspaceId: params.workspaceId, jobId: params.jobId });
  if (!actual) return { aplicada: false, motivo: "sin_ownership", detalle: "job no encontrado en este workspace" };
  if (actual.lease_id !== params.leaseId) return { aplicada: false, motivo: "sin_ownership", detalle: "el lease no coincide con el dueño actual" };

  const estadoActual: EstadoCompletoJob = { status: actual.status, physicalOutcome: actual.physical_outcome, networkAttempts: actual.network_attempts };
  const transicion = transicionar(estadoActual, params.evento);
  if (!transicion.permitida) return { aplicada: false, motivo: "transicion_invalida", detalle: transicion.motivo };

  // Fase 5 (autorizado, decisión D6) -- next_attempt_at se fija SOLO al
  // aterrizar en retry_pending (backoff real antes de que reconciliation
  // vuelva a republicarlo); en cualquier otro estado se limpia -- nunca
  // debe quedar un valor viejo confundiendo una consulta futura si el job
  // vuelve a pasar por retry_pending más adelante.
  const proximoIntentoEn = transicion.siguiente.status === "retry_pending" ? new Date(Date.now() + BACKOFF_REINTENTO_MS).toISOString() : null;

  // CAS real sobre version_token, ADEMÁS del chequeo de lease de arriba --
  // cubre la carrera entre "leí el job" y "hago el UPDATE" (otro proceso
  // pudo mutarlo en el medio, aunque sea el mismo dueño de lease en teoría
  // esto no debería pasar salvo un bug, pero el constraint no depende de
  // que ese bug nunca exista).
  const { data, error } = await supabase
    .from("dulabs_dev_jobs")
    .update({
      status: transicion.siguiente.status,
      physical_outcome: transicion.siguiente.physicalOutcome,
      network_attempts: transicion.siguiente.networkAttempts,
      next_attempt_at: proximoIntentoEn,
      version_token: actual.version_token + 1,
      updated_at: new Date().toISOString(),
      ...(params.wamid ? { wamid: params.wamid } : {}),
    })
    .eq("id", params.jobId)
    .eq("workspace_id", params.workspaceId)
    .eq("lease_id", params.leaseId)
    .eq("version_token", actual.version_token)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`[developer/jobs-store] error aplicando evento: ${error.message}`);
  if (!data) return { aplicada: false, motivo: "sin_ownership", detalle: "el job cambió entre la lectura y el UPDATE (CAS de version_token falló)" };

  return { aplicada: true, job: data as JobFila };
}

/**
 * Jobs en reconciliation_pending, a través de TODOS los workspaces -- usa
 * el índice parcial dulabs_dev_jobs_reconciliation_idx (Fase 2). Solo lo
 * llama dulabs-reconciliation (Fase 3): es la única identidad con motivo
 * legítimo para barrer jobs de más de un workspace a la vez.
 */
export async function obtenerJobsPendientesDeReconciliacion(supabase: SupabaseClient, params: { limite?: number } = {}): Promise<JobFila[]> {
  const { data, error } = await supabase
    .from("dulabs_dev_jobs")
    .select("*")
    .eq("status", "reconciliation_pending")
    .order("updated_at", { ascending: true })
    .limit(params.limite ?? 200);
  if (error) throw new Error(`[developer/jobs-store] error obteniendo jobs pendientes de reconciliación: ${error.message}`);
  return (data ?? []) as JobFila[];
}

/**
 * Fase 3, cierre (riesgo #3 del reporte de Fase 3), extendido en Fase 5
 * (decisión D6, backoff real). Jobs en retry_pending Y con
 * next_attempt_at ya alcanzado (o nunca fijado -- filas legacy de antes
 * de D6, tratadas como listas de inmediato para no dejarlas atascadas),
 * a través de TODOS los workspaces -- usa el índice parcial
 * dulabs_dev_jobs_retry_pending_idx. Solo lo llama dulabs-reconciliation,
 * mismo criterio que obtenerJobsPendientesDeReconciliacion: es la única
 * identidad con motivo legítimo para barrer jobs de más de un workspace.
 * Republicar es seguro de repetir -- el propio lease/CAS del Worker
 * outbound (ver services/worker-outbound/handler.ts) protege contra un
 * segundo POST físico si dos republicaciones del mismo job se solapan,
 * incluso si dos ejecuciones concurrentes de reconciliation seleccionan
 * el mismo job.
 */
export async function obtenerJobsListosParaReintento(supabase: SupabaseClient, params: { limite?: number } = {}): Promise<JobFila[]> {
  const ahora = new Date().toISOString();
  const { data, error } = await supabase
    .from("dulabs_dev_jobs")
    .select("*")
    .eq("status", "retry_pending")
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${ahora}`)
    .order("updated_at", { ascending: true })
    .limit(params.limite ?? 200);
  if (error) throw new Error(`[developer/jobs-store] error obteniendo jobs listos para reintento: ${error.message}`);
  return (data ?? []) as JobFila[];
}

export { estadoInicial };
