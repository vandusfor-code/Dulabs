import type { SupabaseClient } from "@supabase/supabase-js";
import { adquirirLease, liberarLease, aplicarEventoJob, obtenerJobDelWorkspace } from "@/lib/developer/jobs-store";
import { obtenerNumeroParaEnvioMeta } from "@/lib/developer/whatsapp-numbers-store";
import { confirmarUso, liberarUso } from "@/lib/developer/usage-ledger";
import { mapearPayloadAMeta, extraerWamid, type PayloadDeveloperV1 } from "@/lib/developer/meta-message-mapper";
import { clasificarErrorMeta } from "@/lib/developer/meta-error-classifier";

// DuLabs Developer V1 -- Fase 3 (autorizado, sección B/E del documento de
// infraestructura), extendido en Fase 5 (autorizado, decisiones D2-D5,
// D8). Handler del Worker outbound -- procesa UN mensaje push de
// dulabs-outbound. Reusa sin modificar: jobs-store.ts (lease/CAS,
// máquina de estados de Fase 1, extendida en Fase 5 sección D5),
// whatsapp-numbers-store.ts (descifrado del token de Meta vía KMS),
// usage-ledger.ts (Fase 2).
//
// Fase 5, decisión D8 -- el comentario original de esta sección decía que
// "el re-encolado real queda como un mecanismo pendiente de decisión
// explícita". Eso quedó RESUELTO en el cierre de Fase 3 (riesgo #2):
// dulabs-reconciliation, vía reintentarOutbound() (services/reconciliation/run.ts),
// republica jobs en retry_pending a dulabs-outbound cada 5 minutos
// (respetando next_attempt_at desde Fase 5, decisión D6). Este Worker
// SIGUE sin auto-publicarse a sí mismo -- esa responsabilidad es,
// correctamente, exclusiva de la reconciliación.

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

/** Valida en tiempo de ejecución que el payload guardado tiene el shape esperado -- defensivo: un payload corrupto nunca debe intentar mapearse a ciegas (lanzaría dentro de mapearPayloadAMeta). */
function parecePayloadValido(payload: unknown): payload is PayloadDeveloperV1 {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return typeof p.to === "string" && p.type === "text" && typeof (p.text as { body?: unknown })?.body === "string";
}

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

    // Corrección crítica de Fase 5 (autorizada) -- se resuelve el registro
    // REAL del número (phone_number_id + token cifrado) en una sola consulta
    // scoped por workspace. El phone_number_id es lo que Meta exige en la
    // URL (/{phone_number_id}/messages); el UUID interno
    // (iniciar.job.whatsapp_number_id) NUNCA debe usarse como path de Meta --
    // solo sirve para resolver este registro. Devuelve null si el número no
    // existe en el workspace o si aún no tiene token (número 'pendiente'):
    // en ambos casos el envío es estructuralmente imposible -> permanente.
    const numeroEnvio = await obtenerNumeroParaEnvioMeta(supabase, { workspaceId: mensaje.workspaceId, numeroId: iniciar.job.whatsapp_number_id });
    if (!numeroEnvio) {
      const resultado = await aplicarEventoJob(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId, evento: { tipo: "meta_rechazo", codigoError: "sin_token_meta", permanente: true } });
      // D3: sin token de Meta nunca puede funcionar reintentando -- es
      // estructuralmente permanente (permanente:true fuerza failed_by_meta
      // en la máquina de estados), así que esto siempre libera.
      if (resultado.aplicada && resultado.job.status === "failed_by_meta") await liberarUso(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId }).catch(() => {});
      await liberarLease(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId });
      return { httpStatus: 200, motivo: "sin_token_meta" };
    }

    // Fase 5 (D2) -- payload guardado (contrato público de Fase 4, sin
    // tocar) transformado al shape REAL que exige Meta justo acá, nunca
    // antes. Un payload corrupto (no debería ocurrir nunca dado que Fase 4
    // ya lo valida al crear el job, pero defensivo) se trata como
    // rechazo permanente -- reintentarlo nunca lo arreglaría.
    if (!parecePayloadValido(iniciar.job.payload)) {
      const resultado = await aplicarEventoJob(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId, evento: { tipo: "meta_rechazo", codigoError: "payload_almacenado_invalido", permanente: true } });
      if (resultado.aplicada && resultado.job.status === "failed_by_meta") await liberarUso(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId }).catch(() => {});
      await liberarLease(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId });
      return { httpStatus: 200, motivo: "payload_almacenado_invalido" };
    }
    const payloadMeta = mapearPayloadAMeta(iniciar.job.payload);

    let respuestaMeta: Response;
    try {
      // La URL usa EXCLUSIVAMENTE el phone_number_id real de Meta -- nunca el
      // UUID interno. El token viaja solo en el header Authorization, jamás se
      // loguea.
      respuestaMeta = await fetchFn(`${metaGraphApiBaseUrl}/${version}/${numeroEnvio.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${numeroEnvio.tokenMeta}`, "Content-Type": "application/json" },
        body: JSON.stringify(payloadMeta),
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
      // Fase 5 (D4) -- captura real del wamid. Si Meta responde 2xx pero
      // el cuerpo no trae un wamid con forma válida, NUNCA se inventa un
      // id ni se asume silenciosamente que todo salió perfecto -- se
      // persiste wamid=null (columna nullable, sin FK a nada, no requiere
      // nada más para ser un valor legítimo) y el motivo devuelto queda
      // distinguible para observabilidad real, pero el job SÍ se confirma
      // como enviado -- un 2xx real de Meta sigue siendo la misma certeza
      // total que ya era antes de Fase 5, esto no cambia esa regla.
      let cuerpoExito: unknown = null;
      try {
        cuerpoExito = await respuestaMeta.json();
      } catch {
        // Cuerpo no es JSON parseable -- tratado igual que "sin wamid válido" abajo.
      }
      const wamidResultado = extraerWamid(cuerpoExito);

      await aplicarEventoJob(supabase, {
        workspaceId: mensaje.workspaceId,
        jobId: mensaje.jobId,
        leaseId: lease.leaseId,
        evento: { tipo: "meta_confirmo_exito" },
        wamid: wamidResultado.valido ? wamidResultado.wamid : undefined,
      });
      await confirmarUso(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId }).catch(() => {});
      await liberarLease(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId });
      return {
        httpStatus: 200,
        motivo: wamidResultado.valido ? "meta_confirmo_exito" : `meta_confirmo_exito_sin_wamid:${wamidResultado.motivo}`,
      };
    }

    if (respuestaMeta.status >= 400 && respuestaMeta.status < 500) {
      // Fase 5 (D5) -- clasificación real del error de Meta por su propio
      // error.code (nunca solo por el status HTTP). "incertidumbre" se
      // trata EXACTAMENTE igual que un timeout de red -- Meta mismo está
      // señalando ambigüedad, nunca se asume "no enviado" en ese caso.
      let cuerpoError: unknown = null;
      try {
        cuerpoError = await respuestaMeta.json();
      } catch {
        // Sin cuerpo parseable -- clasificarErrorMeta ya maneja esto (cae en "retryable", mismo criterio que antes de Fase 5).
      }
      const clasificacion = clasificarErrorMeta(cuerpoError);

      if (clasificacion === "incertidumbre") {
        await aplicarEventoJob(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId, evento: { tipo: "incertidumbre_de_red" } });
        await liberarLease(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId });
        return { httpStatus: 200, motivo: `incertidumbre_por_error_meta_ambiguo:${respuestaMeta.status}` };
      }

      // Rechazo CIERTO de Meta -- el mensaje definitivamente no se envió,
      // es seguro decidir reintentar o no (a diferencia de la
      // incertidumbre). "permanente" (D5) fuerza failed_by_meta sin
      // importar los intentos restantes.
      const resultado = await aplicarEventoJob(supabase, {
        workspaceId: mensaje.workspaceId,
        jobId: mensaje.jobId,
        leaseId: lease.leaseId,
        evento: { tipo: "meta_rechazo", codigoError: String(respuestaMeta.status), permanente: clasificacion === "permanente" },
      });
      // Fase 5 (D3) -- CORRECCIÓN del bug real encontrado en el diseño:
      // liberarUso() SOLO si la transición resultante es REALMENTE
      // terminal (failed_by_meta). Si quedó en retry_pending, la reserva
      // se mantiene -- un reintento posterior todavía puede confirmar el
      // uso real. Antes de esta corrección, liberarUso() se llamaba
      // siempre, dejando el ledger en "liberado" para siempre aunque el
      // reintento después tuviera éxito.
      if (resultado.aplicada && resultado.job.status === "failed_by_meta") {
        await liberarUso(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId }).catch(() => {});
      }
      await liberarLease(supabase, { workspaceId: mensaje.workspaceId, jobId: mensaje.jobId, leaseId: lease.leaseId });
      return { httpStatus: 200, motivo: `meta_rechazo:${respuestaMeta.status}:${clasificacion}` };
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
