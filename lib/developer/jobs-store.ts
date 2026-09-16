import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { hashPayload } from "@/lib/developer/idempotency";
import { transicionar, estadoInicial, type EventoJob, type EstadoCompletoJob } from "@/lib/developer/outbound-state-machine";
import { reclamarYReservarMensaje } from "@/lib/developer/usage-ledger";
import { resolverLimitesDelWorkspace } from "@/lib/developer/plans";

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
  // Fase 6 (autorizado) -- dimensión ORTOGONAL al Job lifecycle congelado.
  // No participa de la máquina de estados (status/physical_outcome).
  delivery_status: "sent" | "delivered" | "read" | "failed" | null;
  delivery_status_at: string | null;
  delivery_status_rank: number;
  created_at: string;
  updated_at: string;
};

/**
 * Reclama idempotencia + aplica la cuota mensual del plan + crea la fila de
 * job + reserva el uso -- TODO en una sola transacción atómica de Postgres
 * (función dulabs_dev_reclamar_reservar_mensaje, migración 20261013000000).
 *
 * Fase 7 (autorizado) -- prioridad máxima: reserva atómica y CERO
 * idempotency-key/job huérfano cuando se excede la cuota. Antes (Fase 3/4)
 * el reclamo de idempotencia, la inserción del job y reservarUso() eran
 * tres pasos separados desde este módulo; agregar el límite mensual ahí
 * habría dejado una ventana en la que un reclamo de idempotencia persiste
 * pero la reserva se rechaza por cuota -> un idempotency-key apuntando a un
 * job que nunca existió. Fusionar los tres pasos dentro de la función de
 * Postgres elimina esa ventana por completo: si la cuota se excede, la
 * función hace ROLLBACK de todo (incluido el reclamo de idempotencia).
 *
 * Semántica preservada EXACTA respecto a Fase 3/4:
 *   - conflicto_payload_distinto -> nunca crea job ni reserva.
 *   - duplicado_identico (réplica exacta) -> devuelve el MISMO job, NUNCA
 *     una segunda reserva, NUNCA vuelve a chequear cuota (la reserva
 *     original ya cuenta).
 *   - nuevo -> job creado + reserva 'reservado' con el mismo job_id.
 * Y una salida NUEVA de Fase 7:
 *   - limite_excedido -> nada creado, nada reservado, nada publicado (el
 *     Gateway lo traduce a 429 monthly_message_limit_exceeded).
 *
 * El límite mensual se resuelve desde el plan del workspace (DEVELOPER por
 * defecto; null = plan sin límite -> no se aplica cuota). Ver lib/developer/plans.ts.
 */
export async function crearJobConIdempotencia(
  supabase: SupabaseClient,
  params: { workspaceId: string; whatsappNumberId: string; idempotencyKey: string; payload: Record<string, unknown> }
): Promise<{ resultado: "nuevo" | "duplicado_identico"; jobId: string } | { resultado: "conflicto_payload_distinto" } | { resultado: "limite_excedido" }> {
  const limites = await resolverLimitesDelWorkspace(supabase, params.workspaceId);

  const reserva = await reclamarYReservarMensaje(supabase, {
    workspaceId: params.workspaceId,
    idempotencyKey: params.idempotencyKey,
    payloadHash: hashPayload(params.payload),
    payload: params.payload,
    whatsappNumberId: params.whatsappNumberId,
    limiteMensual: limites.mensajesMensualesIncluidos,
  });

  switch (reserva.resultado) {
    case "nuevo":
      return { resultado: "nuevo", jobId: reserva.jobId };
    case "duplicado_identico":
      return { resultado: "duplicado_identico", jobId: reserva.jobId };
    case "conflicto_payload_distinto":
      return { resultado: "conflicto_payload_distinto" };
    case "limite_excedido":
      return { resultado: "limite_excedido" };
  }
}

export async function obtenerJobDelWorkspace(supabase: SupabaseClient, params: { workspaceId: string; jobId: string }): Promise<JobFila | null> {
  const { data, error } = await supabase.from("dulabs_dev_jobs").select("*").eq("id", params.jobId).eq("workspace_id", params.workspaceId).maybeSingle();
  if (error) throw new Error(`[developer/jobs-store] error obteniendo job: ${error.message}`);
  return (data as JobFila) ?? null;
}

/**
 * Fase 9 (autorizado, D2) -- lista paginada de jobs de UN workspace para el
 * Dashboard (Jobs/Logs). Estrictamente scoped por workspace_id (nunca cruza
 * tenant) y proyección SEGURA: solo columnas de estado/trazabilidad, NUNCA
 * el payload (puede traer datos del mensaje) ni nada sensible. Paginación
 * keyset por created_at desc (estable ante inserciones nuevas, sin offset).
 * No toca la máquina de estados.
 */
export type JobResumen = {
  id: string;
  status: EstadoCompletoJob["status"];
  physical_outcome: EstadoCompletoJob["physicalOutcome"];
  network_attempts: number;
  delivery_status: "sent" | "delivered" | "read" | "failed" | null;
  wamid: string | null;
  whatsapp_number_id: string;
  created_at: string;
  updated_at: string;
};

const COLUMNAS_JOB_RESUMEN = "id, status, physical_outcome, network_attempts, delivery_status, wamid, whatsapp_number_id, created_at, updated_at";

export async function listarJobsDelWorkspace(
  supabase: SupabaseClient,
  params: { workspaceId: string; limit?: number; cursor?: string }
): Promise<{ jobs: JobResumen[]; nextCursor: string | null }> {
  const limite = Math.min(Math.max(params.limit ?? 20, 1), 100);
  let consulta = supabase
    .from("dulabs_dev_jobs")
    .select(COLUMNAS_JOB_RESUMEN)
    .eq("workspace_id", params.workspaceId)
    .order("created_at", { ascending: false })
    .limit(limite + 1);
  if (params.cursor) consulta = consulta.lt("created_at", params.cursor);

  const { data, error } = await consulta;
  if (error) throw new Error(`[developer/jobs-store] error listando jobs del workspace: ${error.message}`);

  const filas = (data ?? []) as JobResumen[];
  const hayMas = filas.length > limite;
  const jobs = hayMas ? filas.slice(0, limite) : filas;
  const nextCursor = hayMas ? jobs[jobs.length - 1].created_at : null;
  return { jobs, nextCursor };
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

// ============================================================
// Fase 6 (autorizado) -- correlación de status webhooks por wamid.
// ============================================================

const RANK_STATUS: Record<"sent" | "delivered" | "read" | "failed", number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

/** Busca el Job de un wamid DENTRO de un workspace -- nunca resuelve un wamid sin el workspace_id como parte del filtro (usa dulabs_dev_jobs_wamid_idx). */
export async function obtenerJobPorWamid(supabase: SupabaseClient, params: { workspaceId: string; wamid: string }): Promise<JobFila | null> {
  const { data, error } = await supabase
    .from("dulabs_dev_jobs")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("wamid", params.wamid)
    .maybeSingle();
  if (error) throw new Error(`[developer/jobs-store] error obteniendo job por wamid: ${error.message}`);
  return (data as JobFila) ?? null;
}

export type ResultadoDeliveryStatus =
  | { aplicado: true; job: JobFila; retrocedido: false }
  | { aplicado: false; motivo: "job_no_encontrado_por_wamid" | "numero_no_coincide" | "status_no_avanza"; job: JobFila | null };

/**
 * Fase 6 -- aplica un status de Meta (sent/delivered/read/failed) al Job
 * correlacionado por wamid, de forma MONOTÓNICA y con guarda multi-tenant.
 *
 * Correlación protegida por (workspace_id + wamid + whatsapp_number_id):
 * nunca solo por wamid. Si el Job del wamid pertenece a otro número del que
 * Meta reporta, se rechaza (defensa contra cross-tenant/number contamination).
 *
 * Monotonicidad (decisión H): sent<delivered<read nunca retroceden -- se
 * aplica solo si el nuevo rank es MAYOR al actual. `failed` es terminal
 * pero NO pisa un delivered/read ya alcanzado (un mensaje ya entregado/leído
 * no puede "fallar" tardíamente): solo aplica desde sin-status o 'sent'. El
 * guard va en el WHERE del UPDATE -> atómico frente a status concurrentes.
 * NO toca status/physical_outcome (la máquina de estados congelada).
 */
export async function aplicarDeliveryStatus(
  supabase: SupabaseClient,
  params: { workspaceId: string; whatsappNumberId: string; wamid: string; status: "sent" | "delivered" | "read" | "failed"; statusAt?: string }
): Promise<ResultadoDeliveryStatus> {
  const job = await obtenerJobPorWamid(supabase, { workspaceId: params.workspaceId, wamid: params.wamid });
  if (!job) return { aplicado: false, motivo: "job_no_encontrado_por_wamid", job: null };
  if (job.whatsapp_number_id !== params.whatsappNumberId) {
    // El wamid resolvió un job del workspace correcto pero de OTRO número --
    // nunca se acepta (defensa en profundidad contra contaminación cruzada).
    return { aplicado: false, motivo: "numero_no_coincide", job };
  }

  const nuevoRank = RANK_STATUS[params.status];
  const cuando = params.statusAt ?? new Date().toISOString();

  let consulta = supabase
    .from("dulabs_dev_jobs")
    .update({ delivery_status: params.status, delivery_status_rank: nuevoRank, delivery_status_at: cuando, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("workspace_id", params.workspaceId)
    .eq("whatsapp_number_id", params.whatsappNumberId);

  if (params.status === "failed") {
    // failed solo desde sin-status o 'sent' (rank <= 1) -- nunca pisa delivered/read.
    consulta = consulta.lte("delivery_status_rank", 1);
  } else {
    // sent/delivered/read: monotónico estricto.
    consulta = consulta.lt("delivery_status_rank", nuevoRank);
  }

  const { data, error } = await consulta.select("*").maybeSingle();
  if (error) throw new Error(`[developer/jobs-store] error aplicando delivery_status: ${error.message}`);
  if (!data) return { aplicado: false, motivo: "status_no_avanza", job };
  return { aplicado: true, job: data as JobFila, retrocedido: false };
}

export { estadoInicial };
