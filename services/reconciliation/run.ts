import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerJobsPendientesDeReconciliacion, obtenerJobsListosParaReintento, adquirirLease, liberarLease, aplicarEventoJob } from "@/lib/developer/jobs-store";
import { obtenerEventosPendientesDePublicar, marcarEventoPublicado, incrementarIntentoPublicacion } from "@/lib/developer/events-store";
import { confirmarUso } from "@/lib/developer/usage-ledger";
import { publicarMensaje } from "../shared/pubsub";

// DuLabs Developer V1 -- Fase 3 (autorizado, sección G del documento de
// infraestructura). Dos responsabilidades en una sola ejecución -- ver
// justificación de por qué se combinan (no crear un recurso GCP nuevo
// evitable) en la sección G/A del documento.
//
// REGLA CRÍTICA que este archivo respeta sin excepción: NUNCA hace un POST
// físico a Meta por su cuenta. Su único rol de reconciliación outbound es
// preguntar a Meta y, si confirma "nunca llegó", pasar el job a
// retry_pending -- el reenvío físico real lo hace después el Worker
// outbound, no este Job.

export type DependenciasReconciliation = {
  supabase: SupabaseClient;
  metaGraphApiBaseUrl: string;
  topicInbound: string;
  topicOutbound: string;
  fetchImpl?: typeof fetch;
  publicar?: typeof publicarMensaje;
  minutosAntiguedadRecovery?: number;
  maximoIntentosRecovery?: number;
};

export type ResultadoReconciliacionOutbound = {
  jobId: string;
  resultado: "confirmado_no_enviado" | "confirmado_enviado" | "sin_certeza_todavia" | "lease_no_disponible" | "error";
  detalle?: string;
};

export type ResultadoRecoveryInbound = { eventoId: number; resultado: "republicado" | "tope_de_intentos_alcanzado" | "error"; detalle?: string };

// Fase 3, cierre (riesgo #3 del reporte de Fase 3).
export type ResultadoReintentoOutbound = { jobId: string; resultado: "republicado" | "error"; detalle?: string };

export type ResumenEjecucion = {
  reconciliacionOutbound: ResultadoReconciliacionOutbound[];
  recoveryInbound: ResultadoRecoveryInbound[];
  reintentoOutbound: ResultadoReintentoOutbound[];
};

/**
 * Consulta a Meta si un envío incierto llegó o no. NOTA HONESTA: la API
 * Graph de Meta no ofrece un endpoint universal simple de "¿este POST
 * anterior se procesó?" -- el status real de un mensaje llega
 * normalmente vía webhooks, no vía consulta activa. Esta función asume un
 * endpoint de verificación configurable (mismo criterio que
 * META_GRAPH_API_BASE_URL: real en producción, un fixture HTTP real en
 * tests -- nunca simulado en memoria). Documentado como punto abierto en
 * el reporte de Fase 3 -- requiere que el negocio confirme el mecanismo
 * real contra la API de Meta antes de confiar en esto en producción.
 */
async function consultarEstadoEnMeta(fetchFn: typeof fetch, baseUrl: string, whatsappNumberId: string, jobId: string): Promise<"enviado" | "no_enviado" | "sin_certeza"> {
  try {
    const respuesta = await fetchFn(`${baseUrl}/v21.0/${whatsappNumberId}/message_status?job_id=${encodeURIComponent(jobId)}`, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
    if (!respuesta.ok) return "sin_certeza";
    const cuerpo = (await respuesta.json()) as { enviado?: boolean };
    if (cuerpo.enviado === true) return "enviado";
    if (cuerpo.enviado === false) return "no_enviado";
    return "sin_certeza";
  } catch {
    return "sin_certeza";
  }
}

async function reconciliarOutbound(deps: DependenciasReconciliation): Promise<ResultadoReconciliacionOutbound[]> {
  const fetchFn = deps.fetchImpl ?? fetch;
  const jobs = await obtenerJobsPendientesDeReconciliacion(deps.supabase);
  const resultados: ResultadoReconciliacionOutbound[] = [];

  for (const job of jobs) {
    const lease = await adquirirLease(deps.supabase, { workspaceId: job.workspace_id, jobId: job.id });
    if (!lease.adquirido) {
      resultados.push({ jobId: job.id, resultado: "lease_no_disponible", detalle: lease.motivo });
      continue;
    }

    try {
      const estado = await consultarEstadoEnMeta(fetchFn, deps.metaGraphApiBaseUrl, job.whatsapp_number_id, job.id);

      if (estado === "no_enviado") {
        // ÚNICA transición permitida acá: reconciliation_pending ->
        // retry_pending (o failed_by_meta si ya no quedan intentos) -- la
        // decide la máquina de estados de Fase 1, nunca este archivo.
        await aplicarEventoJob(deps.supabase, { workspaceId: job.workspace_id, jobId: job.id, leaseId: lease.leaseId, evento: { tipo: "reconciliacion_confirmo_no_enviado" } });
        resultados.push({ jobId: job.id, resultado: "confirmado_no_enviado" });
      } else if (estado === "enviado") {
        // Fase 3, cierre (riesgo #4) -- Meta confirma que sí llegó pese a
        // la incertidumbre original. Certeza total tardía, mismo destino
        // final que una confirmación síncrona del Worker
        // (meta_confirmo_exito): success_confirmed. No se hace NINGÚN
        // POST físico nuevo -- solo se confirma el que ya se había hecho.
        await aplicarEventoJob(deps.supabase, { workspaceId: job.workspace_id, jobId: job.id, leaseId: lease.leaseId, evento: { tipo: "reconciliacion_confirmo_enviado" } });
        await confirmarUso(deps.supabase, { workspaceId: job.workspace_id, jobId: job.id }).catch(() => {});
        resultados.push({ jobId: job.id, resultado: "confirmado_enviado" });
      } else {
        resultados.push({ jobId: job.id, resultado: "sin_certeza_todavia" });
      }
    } catch (err) {
      resultados.push({ jobId: job.id, resultado: "error", detalle: err instanceof Error ? err.message : String(err) });
    } finally {
      await liberarLease(deps.supabase, { workspaceId: job.workspace_id, jobId: job.id, leaseId: lease.leaseId }).catch(() => {});
    }
  }

  return resultados;
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
 * Fase 3, cierre (riesgo #3 del reporte de Fase 3). Barrido de jobs en
 * retry_pending -- sin esto, un job que un rechazo cierto de Meta (con
 * intentos disponibles) o una reconciliación con "no enviado" dejó en
 * retry_pending quedaba atascado para siempre, porque el Worker outbound
 * deliberadamente nunca se auto-publica (ver GAP documentado en
 * services/worker-outbound/handler.ts, ahora resuelto acá). Republicar
 * {workspaceId, jobId} es EXACTAMENTE el mismo mensaje que publica el
 * Gateway al crear un job -- el Worker outbound reusa su lógica real sin
 * cambios (lease/CAS ya protege contra una republicación duplicada
 * mientras la anterior sigue en curso).
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

export async function ejecutarReconciliacion(deps: DependenciasReconciliation): Promise<ResumenEjecucion> {
  const [reconciliacionOutbound, recoveryInbound, reintentoOutbound] = await Promise.all([reconciliarOutbound(deps), recuperarInbound(deps), reintentarOutbound(deps)]);
  return { reconciliacionOutbound, recoveryInbound, reintentoOutbound };
}
