import { Client } from "@upstash/qstash";
import type { ResultadoEnvioTemplate } from "@/lib/developer/dulabs-whatsapp";

// DuLabs Developer -- publicación INMEDIATA de jobs de WhatsApp transaccional
// en QStash (bienvenida y confirmación de pago). NO usa Vercel Cron ni ningún
// Schedule recurrente: publica el mensaje en el instante del evento y QStash se
// encarga de la entrega + reintentos contra el endpoint worker
// /api/developer/jobs/whatsapp (que verifica la firma de QStash).
//
// Este módulo es SOLO publisher (no importa la lógica de envío) para no crear
// dependencias circulares con los orquestadores que lo usan. Si QSTASH_TOKEN no
// está configurado, `encolar*` devuelve encolado:false y el llamador hace
// fallback inline -> nunca se pierde el mensaje ni se rompe el registro/webhook.

export type WhatsappJob =
  | { tipo: "bienvenida"; workspaceId: string; userId: string }
  | { tipo: "pago"; accountId: string; planCodigo: string; transactionId: string };

export function qstashDisponible(): boolean {
  return Boolean(process.env.QSTASH_TOKEN);
}

/** URL absoluta del worker (QStash necesita una URL pública). */
function urlWorker(): string {
  const base = process.env.QSTASH_TARGET_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.dulabs.co";
  return `${base.replace(/\/+$/, "")}/api/developer/jobs/whatsapp`;
}

/** Id de deduplicación estable por evento -- QStash descarta publicaciones repetidas con el mismo id. */
export function dedupIdDeJob(job: WhatsappJob): string {
  return job.tipo === "bienvenida" ? `wa-bienvenida-${job.workspaceId}` : `wa-pago-${job.transactionId}`;
}

/** Scope (workspace_id uuid) + clave de idempotencia del job para el candado del worker. */
export function scopeYclaveJob(job: WhatsappJob): { workspaceId: string; idempotencyKey: string } {
  return job.tipo === "bienvenida"
    ? { workspaceId: job.workspaceId, idempotencyKey: "wa-bienvenida" }
    : { workspaceId: job.accountId, idempotencyKey: `wa-pago-${job.transactionId}` };
}

// Motivos de fallo del sender que NO tiene sentido reintentar (no cambian con el retry).
export const MOTIVOS_PERMANENTES = new Set([
  "plantilla_no_aprobada",
  "variables_no_coinciden",
  "destino_invalido",
  "sin_credenciales",
  "plantilla_no_consultable",
  "sin_whatsapp",
  "cuenta_no_encontrada",
]);

/** error_envio con respuesta 4xx de Meta = permanente (input inválido); 5xx/desconocido (red/timeout) = transitorio -> reintentar. */
export function esFalloTransitorio(r: Extract<ResultadoEnvioTemplate, { enviado: false }>): boolean {
  if (r.motivo !== "error_envio") return !MOTIVOS_PERMANENTES.has(r.motivo);
  const m = /Meta respondió (\d{3})/.exec(r.detalle ?? "");
  if (!m) return true;
  return Number(m[1]) >= 500;
}

export type ResultadoEncolar = { encolado: true; messageId: string } | { encolado: false; motivo: string };

/**
 * Publica un job de WhatsApp en QStash para ejecución inmediata + reintentos.
 * Fire-and-forget desde el punto de vista del evento: no bloquea la respuesta
 * HTTP. Nunca lanza -- ante cualquier fallo devuelve encolado:false para que el
 * llamador haga fallback inline.
 */
export async function encolarWhatsappDeveloper(job: WhatsappJob): Promise<ResultadoEncolar> {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return { encolado: false, motivo: "sin_qstash_token" };
  try {
    const client = new Client({ token });
    const res = await client.publishJSON({
      url: urlWorker(),
      body: job,
      deduplicationId: dedupIdDeJob(job),
      retries: 3,
    });
    const messageId = (res as { messageId?: string }).messageId ?? "";
    return { encolado: true, messageId };
  } catch (err) {
    return { encolado: false, motivo: err instanceof Error ? err.message : String(err) };
  }
}
