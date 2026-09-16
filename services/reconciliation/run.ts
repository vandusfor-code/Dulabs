import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerJobsPendientesDeReconciliacion, obtenerJobsListosParaReintento } from "@/lib/developer/jobs-store";
import { obtenerEventosPendientesDePublicar, marcarEventoPublicado, incrementarIntentoPublicacion, obtenerEntregasListasParaReintento } from "@/lib/developer/events-store";
import { publicarMensaje } from "../shared/pubsub";

// DuLabs Developer V1 -- Fase 3 (autorizado), actualizado en Fase 6
// (autorizado, decisión I). El Job de reconciliación tiene ahora TRES
// barridos, ninguno hace un POST físico a Meta:
//
// 1. recuperarInbound: republica a dulabs-inbound los eventos persistidos
//    cuyo publish a Pub/Sub quedó pendiente (patrón "DB commit -> publish
//    falló", Fase 3).
// 2. reintentarOutbound: republica a dulabs-outbound los jobs en
//    retry_pending listos (Fase 3 cierre + Fase 5 D6 backoff).
// 3. reintentarEntregasInbound (Fase 6, D2): republica a dulabs-inbound los
//    eventos cuya entrega al webhook del Developer falló y está lista para
//    reintentar (retry acotado + DLQ).
//
// DEUDA DE FASE 5 RESUELTA (decisión I): el antiguo consultarEstadoEnMeta
// (endpoint ficticio /message_status + UUID interno) SE ELIMINÓ. La
// resolución de reconciliation_pending ya NO se hace por polling activo:
// llega de forma PASIVA por los status webhooks reales de Meta
// (services/worker-inbound/handler.ts correlaciona por wamid y dispara
// `reconciliacion_confirmo_enviado`). Este barrido solo REPORTA los jobs en
// reconciliation_pending para observabilidad -- nunca los muta ni contacta
// a Meta, y nunca hace blind resend.

export type DependenciasReconciliation = {
  supabase: SupabaseClient;
  topicInbound: string;
  topicOutbound: string;
  publicar?: typeof publicarMensaje;
  minutosAntiguedadRecovery?: number;
  maximoIntentosRecovery?: number;
  // Presentes por compatibilidad con el bootstrap (index.ts); ya NO se usan
  // -- reconciliation no contacta a Meta en Fase 6.
  metaGraphApiBaseUrl?: string;
  fetchImpl?: typeof fetch;
};

export type ResultadoReconciliacionOutbound = { jobId: string; resultado: "esperando_status_webhook" };
export type ResultadoRecoveryInbound = { eventoId: number; resultado: "republicado" | "tope_de_intentos_alcanzado" | "error"; detalle?: string };
export type ResultadoReintentoOutbound = { jobId: string; resultado: "republicado" | "error"; detalle?: string };
export type ResultadoReintentoEntrega = { eventoId: number; resultado: "republicado" | "error"; detalle?: string };

export type ResumenEjecucion = {
  reconciliacionOutbound: ResultadoReconciliacionOutbound[];
  recoveryInbound: ResultadoRecoveryInbound[];
  reintentoOutbound: ResultadoReintentoOutbound[];
  reintentoEntrega: ResultadoReintentoEntrega[];
};

/**
 * Fase 6 (I) -- SIN polling a Meta. Solo lista los jobs en
 * reconciliation_pending para observabilidad; su resolución llega de forma
 * pasiva por los status webhooks reales (worker-inbound). Nunca muta el job
 * ni contacta a Meta.
 */
async function reportarReconciliationPendiente(deps: DependenciasReconciliation): Promise<ResultadoReconciliacionOutbound[]> {
  const jobs = await obtenerJobsPendientesDeReconciliacion(deps.supabase);
  return jobs.map((job) => ({ jobId: job.id, resultado: "esperando_status_webhook" as const }));
}

async function recuperarInbound(deps: DependenciasReconciliation): Promise<ResultadoRecoveryInbound[]> {
  const publicar = deps.publicar ?? publicarMensaje;
  const minutos = deps.minutosAntiguedadRecovery ?? 2;
  const maximo = deps.maximoIntentosRecovery ?? 5;

  const eventos = await obtenerEventosPendientesDePublicar(deps.supabase, { minutosAntiguedad: minutos, maximoIntentos: maximo });
  const resultados: ResultadoRecoveryInbound[] = [];

  for (const evento of eventos) {
    try {
      await incrementarIntentoPublicacion(deps.supabase, { id: evento.id });
      await publicar(deps.topicInbound, { eventoId: evento.id });
      await marcarEventoPublicado(deps.supabase, { id: evento.id });
      resultados.push({ eventoId: evento.id, resultado: "republicado" });
    } catch (err) {
      resultados.push({ eventoId: evento.id, resultado: "error", detalle: err instanceof Error ? err.message : String(err) });
    }
  }

  return resultados;
}

/**
 * Fase 3 cierre (riesgo #3). Barrido de jobs en retry_pending -- republica
 * {workspaceId, jobId} a dulabs-outbound (mismo mensaje que publica el
 * Gateway). El lease/CAS del Worker outbound protege contra un segundo POST
 * físico si dos republicaciones se solapan.
 */
async function reintentarOutbound(deps: DependenciasReconciliation): Promise<ResultadoReintentoOutbound[]> {
  const publicar = deps.publicar ?? publicarMensaje;
  const jobs = await obtenerJobsListosParaReintento(deps.supabase);
  const resultados: ResultadoReintentoOutbound[] = [];

  for (const job of jobs) {
    try {
      await publicar(deps.topicOutbound, { workspaceId: job.workspace_id, jobId: job.id });
      resultados.push({ jobId: job.id, resultado: "republicado" });
    } catch (err) {
      resultados.push({ jobId: job.id, resultado: "error", detalle: err instanceof Error ? err.message : String(err) });
    }
  }

  return resultados;
}

/**
 * Fase 6 (D2). Barrido de reintentos de ENTREGA al webhook del Developer:
 * republica a dulabs-inbound los eventos cuya entrega falló y ya venció su
 * backoff. El claim CAS del Worker inbound (reclamarEntrega) protege contra
 * dos reintentos concurrentes; un evento en DLQ nunca se selecciona.
 */
async function reintentarEntregasInbound(deps: DependenciasReconciliation): Promise<ResultadoReintentoEntrega[]> {
  const publicar = deps.publicar ?? publicarMensaje;
  const eventos = await obtenerEntregasListasParaReintento(deps.supabase);
  const resultados: ResultadoReintentoEntrega[] = [];

  for (const evento of eventos) {
    try {
      await publicar(deps.topicInbound, { eventoId: evento.id });
      resultados.push({ eventoId: evento.id, resultado: "republicado" });
    } catch (err) {
      resultados.push({ eventoId: evento.id, resultado: "error", detalle: err instanceof Error ? err.message : String(err) });
    }
  }

  return resultados;
}

export async function ejecutarReconciliacion(deps: DependenciasReconciliation): Promise<ResumenEjecucion> {
  const [reconciliacionOutbound, recoveryInbound, reintentoOutbound, reintentoEntrega] = await Promise.all([
    reportarReconciliationPendiente(deps),
    recuperarInbound(deps),
    reintentarOutbound(deps),
    reintentarEntregasInbound(deps),
  ]);
  return { reconciliacionOutbound, recoveryInbound, reintentoOutbound, reintentoEntrega };
}
