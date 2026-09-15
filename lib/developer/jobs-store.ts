import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { reclamarIdempotencia } from "@/lib/developer/idempotency";
import { transicionar, estadoInicial, type EventoJob, type EstadoCompletoJob } from "@/lib/developer/outbound-state-machine";

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
  created_at: string;
  updated_at: string;
};

/**
 * Reclama la idempotencia (Fase 1, sin modificar) Y crea la fila de job
 * persistente con el MISMO id -- la conexión entre ambas tablas que la
 * migración de Fase 2 documenta explícitamente que NO se hace vía foreign
 * key (para no romper el contrato ya probado de Fase 1), sino acá, en el
 * único punto de entrada real de un job nuevo.
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
  if (reclamo.resultado === "duplicado_identico") return { resultado: "duplicado_identico", jobId: reclamo.jobId };

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
  params: { workspaceId: string; jobId: string; leaseId: string; evento: EventoJob }
): Promise<ResultadoActualizacionJob> {
  const actual = await obtenerJobDelWorkspace(supabase, { workspaceId: params.workspaceId, jobId: params.jobId });
  if (!actual) return { aplicada: false, motivo: "sin_ownership", detalle: "job no encontrado en este workspace" };
  if (actual.lease_id !== params.leaseId) return { aplicada: false, motivo: "sin_ownership", detalle: "el lease no coincide con el dueño actual" };

  const estadoActual: EstadoCompletoJob = { status: actual.status, physicalOutcome: actual.physical_outcome, networkAttempts: actual.network_attempts };
  const transicion = transicionar(estadoActual, params.evento);
  if (!transicion.permitida) return { aplicada: false, motivo: "transicion_invalida", detalle: transicion.motivo };

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
      version_token: actual.version_token + 1,
      updated_at: new Date().toISOString(),
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

export { estadoInicial };
