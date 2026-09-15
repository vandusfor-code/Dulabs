import type { SupabaseClient } from "@supabase/supabase-js";
import { adquirirLease, liberarLease, aplicarEventoJob, obtenerJobDelWorkspace } from "@/lib/developer/jobs-store";
import { obtenerTokenMetaDelNumero } from "@/lib/developer/whatsapp-numbers-store";
import { confirmarUso, liberarUso } from "@/lib/developer/usage-ledger";

// DuLabs Developer V1 -- Fase 3 (autorizado, sección B/E del documento de
// infraestructura). Handler del Worker outbound -- procesa UN mensaje push
// de dulabs-outbound. Reusa sin modificar: jobs-store.ts (lease/CAS,
// máquina de estados de Fase 1), whatsapp-numbers-store.ts (descifrado del
// token de Meta vía KMS), usage-ledger.ts (Fase 2).
//
// GAP DE DISEÑO ENCONTRADO Y NO RESUELTO ACÁ (reportado, no improvisado):
// la sección E del documento dice que retry_pending puede re-encolarse
// "desde el propio Worker o desde el Job de reconciliación", pero la
// sección I de IAM nunca le da a dulabs-worker-outbound@ el rol
// pubsub.publisher, y la sección G no especifica qué proceso concreto
// vigila jobs en retry_pending para republicarlos. Este handler
// DELIBERADAMENTE no publica a Pub/Sub bajo ninguna circunstancia --
// transiciona el estado correctamente (incluida la transición automática a
// retry_pending que ya hace la máquina de estados de Fase 1) pero deja el
// re-encolado real como un mecanismo pendiente de decisión explícita.

export type DependenciasWorkerOutbound = {
  supabase: SupabaseClient;
  metaGraphApiBaseUrl: string;
  fetchImpl?: typeof fetch;
  metaApiVersion?: string;
};

export type MensajePubSubOutbound = {
  workspaceId: string;
  jobId: string;
};

export type ResultadoProcesamientoOutbound = { httpStatus: 200 | 500; motivo: string };

const ESTADOS_TERMINALES_O_EN_RECONCILIACION = new Set(["success_confirmed", "failed_by_meta", "reconciliation_pending"]);

/**
 * Procesa un mensaje de dulabs-outbound. SIEMPRE devuelve httpStatus:200
 * salvo un error transitorio de infraestructura ANTES de tocar Meta (ahí sí
 * es seguro que Pub/Sub reintente, sección E punto 4). Nunca hace un
 * segundo POST físico si el lease ya está tomado (punto 1) ni deja que una
 * incertidumbre de red produzca un código que provoque redelivery (punto 3
 * -- regla crítica de "no blind resend").
 */
export async function procesarMensajeOutbound(deps: DependenciasWorkerOutbound, mensaje: MensajePubSubOutbound): Promise<ResultadoProcesamientoOutbound> {
  const { supabase, metaGraphApiBaseUrl } = deps;
  const fetchFn = deps.fetchImpl ?? fetch;
  const version = deps.metaApiVersion ?? "v21.0";

  const lease = await adquirirLease(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId });
  if (!lease.adquirido) {
    // "ya_tomado": otra entrega concurrente del mismo mensaje ya lo tiene.
    // "job_no_encontrado": nada que procesar. En ambos casos, ACK -- nunca
    // un segundo intento físico, nunca provocar redelivery.
    return { httpStatus: 200, motivo: `lease_no_adquirido:${lease.motivo}` };
  }

  try {
    const actualInicial = await obtenerJobDelWorkspace(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId });
    if (!actualInicial) {
      await liberarLease(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId });
      return { httpStatus: 200, motivo: "job_no_encontrado_tras_lease" };
    }

    // Si el job ya está resuelto (otra entrega lo terminó mientras
    // esperaba el lease, o quedó en reconciliation_pending), no hay nada
    // más que hacer -- ACK, sin tocar Meta de nuevo.
    if (ESTADOS_TERMINALES_O_EN_RECONCILIACION.has(actualInicial.status)) {
      await liberarLease(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId });
      return { httpStatus: 200, motivo: `job_ya_resuelto:${actualInicial.status}` };
    }

    if (actualInicial.status === "created") {
      const encolar = await aplicarEventoJob(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId, evento: { tipo: "encolar" } });
      if (!encolar.aplicada) {
        await liberarLease(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId });
        return { httpStatus: 200, motivo: `no_se_pudo_encolar:${encolar.motivo}` };
      }
    }

    const iniciar = await aplicarEventoJob(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId, evento: { tipo: "iniciar_envio" } });
    if (!iniciar.aplicada) {
      // Ej. ya se agotaron los intentos físicos permitidos, o el job no
      // estaba en queued/retry_pending -- no es seguro ni necesario
      // reintentar automáticamente.
      await liberarLease(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId });
      return { httpStatus: 200, motivo: `no_se_pudo_iniciar_envio:${iniciar.motivo}` };
    }

    const tokenMeta = await obtenerTokenMetaDelNumero(supabase, { workspaceId: mensaje.workspaceId, numeroId: iniciar.job.whatsapp_number_id });
    if (!tokenMeta) {
      await aplicarEventoJob(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId, evento: { tipo: "meta_rechazo", codigoError: "sin_token_meta" } });
      await liberarUso(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId }).catch(() => {});
      await liberarLease(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId });
      return { httpStatus: 200, motivo: "sin_token_meta" };
    }

    let respuestaMeta: Response;
    try {
      respuestaMeta = await fetchFn(`${metaGraphApiBaseUrl}/${version}/${iniciar.job.whatsapp_number_id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenMeta}`, "Content-Type": "application/json" },
        body: JSON.stringify(iniciar.job.payload),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // Timeout / conexión cortada -- REGLA CRÍTICA (sección 11, Fase 1):
      // incertidumbre de red, NUNCA se trata como "no enviado". Transición
      // a reconciliation_pending, ACK -- nunca un código que provoque
      // redelivery (eso causaría exactamente el blind resend prohibido).
      await aplicarEventoJob(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId, evento: { tipo: "incertidumbre_de_red" } });
      await liberarLease(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId });
      return { httpStatus: 200, motivo: "incertidumbre_de_red" };
    }

    if (respuestaMeta.ok) {
      await aplicarEventoJob(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId, evento: { tipo: "meta_confirmo_exito" } });
      await confirmarUso(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId }).catch(() => {});
      await liberarLease(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId });
      return { httpStatus: 200, motivo: "meta_confirmo_exito" };
    }

    if (respuestaMeta.status >= 400 && respuestaMeta.status < 500) {
      // Rechazo CIERTO de Meta -- el mensaje definitivamente no se envió,
      // es seguro decidir reintentar o no (a diferencia de la
      // incertidumbre de red).
      await aplicarEventoJob(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId, evento: { tipo: "meta_rechazo", codigoError: String(respuestaMeta.status) } });
      await liberarUso(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId }).catch(() => {});
      await liberarLease(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId });
      return { httpStatus: 200, motivo: `meta_rechazo:${respuestaMeta.status}` };
    }

    // 5xx de Meta -- no hay certeza de si Meta alcanzó a procesar el
    // mensaje antes de fallar del lado suyo. Mismo criterio conservador
    // que un timeout de red: incertidumbre, nunca "no enviado".
    await aplicarEventoJob(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId, evento: { tipo: "incertidumbre_de_red" } });
    await liberarLease(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId });
    return { httpStatus: 200, motivo: `incertidumbre_por_5xx_meta:${respuestaMeta.status}` };
  } catch (err) {
    // Error inesperado ANTES de haber intentado el POST físico a Meta (ej.
    // Postgres momentáneamente inalcanzable) -- todavía es seguro
    // reintentar, así que se deja que Pub/Sub reintente (sección E punto 4).
    await liberarLease(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId }).catch(() => {});
    return { httpStatus: 500, motivo: `error_transitorio:${err instanceof Error ? err.message : String(err)}` };
  }
}
