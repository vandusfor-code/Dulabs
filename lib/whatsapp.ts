import type { SupabaseClient } from "@supabase/supabase-js";

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;
const VENTANA_24H_MS = 24 * 60 * 60 * 1000;

type GraphError = { error?: { message?: string; code?: number } };

// FASE F8.3 (Meta Send Reliability, autorizado) -- error estructurado de un
// fallo de la Graph API, para que quien lo captura (SendMessageExecutor)
// pueda clasificarlo (retryable/permanente/auth) sin tener que parsear un
// string. Mantiene `.message` con el mismo texto que antes (compatibilidad:
// todo caller existente que solo hacía `err.message`/`console.error(err)`
// seguirá viendo exactamente lo mismo).
export class MetaGraphApiError extends Error {
  readonly httpStatus: number;
  readonly metaErrorCode?: number;
  readonly metaErrorMessage?: string;
  /** Del header Retry-After de Meta (429), en ms -- undefined si Meta no lo envió. */
  readonly retryAfterMs?: number;

  constructor(params: { httpStatus: number; metaErrorCode?: number; metaErrorMessage?: string; retryAfterMs?: number }) {
    super(`Meta respondió ${params.httpStatus}: ${params.metaErrorMessage ?? "sin detalle"}`);
    this.name = "MetaGraphApiError";
    this.httpStatus = params.httpStatus;
    this.metaErrorCode = params.metaErrorCode;
    this.metaErrorMessage = params.metaErrorMessage;
    this.retryAfterMs = params.retryAfterMs;
  }
}

function parseRetryAfterMs(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const segundos = Number(header);
  if (!Number.isFinite(segundos) || segundos < 0) return undefined;
  return segundos * 1000;
}

// Envío de texto libre (free-form) por la API de WhatsApp de Meta. Solo
// funciona dentro de la ventana de servicio al cliente de 24h — fuera de
// ella Meta responde con error y hay que usar una plantilla aprobada.
// Compartida entre el webhook (respuestas de IA) y el Inbox web (respuestas
// manuales de un agente).
export async function enviarTexto(params: {
  phoneNumberId: string;
  token: string;
  para: string;
  texto: string;
  /**
   * FASE F8.3 (autorizado) -- permite al caller (SendMessageExecutor)
   * cancelar el fetch cuando el EffectExecutorFramework ya decidió abortar
   * por timeout (ver executor-framework.ts), en vez de dejar la conexión
   * HTTP colgada en segundo plano. Opcional, sin default: ningún caller
   * existente (LEGACY, campañas) pasa esto hoy, así que su comportamiento
   * queda IDÉNTICO -- fetch() con signal:undefined nunca aborta.
   */
  signal?: AbortSignal;
}): Promise<{ wamid: string | null }> {
  const res = await fetch(`${GRAPH}/${params.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: params.para,
      type: "text",
      text: { body: params.texto },
    }),
    signal: params.signal,
  });
  const json = (await res.json()) as { messages?: { id?: string }[] } & GraphError;
  if (!res.ok) {
    throw new MetaGraphApiError({
      httpStatus: res.status,
      metaErrorCode: json.error?.code,
      metaErrorMessage: json.error?.message,
      retryAfterMs: parseRetryAfterMs(res),
    });
  }
  return { wamid: json.messages?.[0]?.id ?? null };
}

// Sube un archivo multimedia al servidor de Meta y devuelve su media id --
// paso previo obligatorio antes de poder enviarlo en un mensaje (Meta no
// acepta binarios inline en /messages, solo un id ya subido o una URL
// pública). Se sube fresco cada vez que se envía, no se reutiliza.
export async function subirMedia(params: {
  phoneNumberId: string;
  token: string;
  archivo: Buffer;
  tipoMime: string;
}): Promise<{ mediaId: string }> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([new Uint8Array(params.archivo)], { type: params.tipoMime }));
  const res = await fetch(`${GRAPH}/${params.phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.token}` },
    body: form,
  });
  const json = (await res.json()) as { id?: string } & GraphError;
  if (!res.ok || !json.id) {
    throw new Error(`Meta respondió ${res.status} subiendo media: ${json.error?.message ?? "sin detalle"}`);
  }
  return { mediaId: json.id };
}

// Envía una imagen ya subida (ver subirMedia) con caption opcional. Mismo
// criterio de ventana de 24h que enviarTexto -- solo funciona con el
// cliente dentro de las últimas 24h, o con una plantilla aprobada fuera de
// ella (no cubierto por esta función).
export async function enviarImagen(params: {
  phoneNumberId: string;
  token: string;
  para: string;
  mediaId: string;
  caption?: string;
}): Promise<{ wamid: string | null }> {
  const res = await fetch(`${GRAPH}/${params.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: params.para,
      type: "image",
      image: { id: params.mediaId, caption: params.caption },
    }),
  });
  const json = (await res.json()) as { messages?: { id?: string }[] } & GraphError;
  if (!res.ok) {
    throw new Error(`Meta respondió ${res.status}: ${json.error?.message ?? "sin detalle"}`);
  }
  return { wamid: json.messages?.[0]?.id ?? null };
}

// FASE F8.4 (WhatsApp Media, autorizado) -- envío genérico de los 5 tipos de
// media reales de Meta Cloud API (image/video/audio/document/sticker),
// generalizando enviarImagen de arriba (que queda intacta, sin caller nuevo,
// por compatibilidad -- LEGACY es el único que la usa hoy vía
// enviarImagenWhatsApp). Acepta `link` (URL pública -- la descarga Meta por
// su cuenta, este servidor NUNCA la toca, cero superficie de SSRF acá) O
// `mediaId` (ya subido, ver subirMedia) -- exactamente uno de los dos,
// exigido por FlowMediaRef/flowMediaRefSchema antes de llegar acá. Reglas
// reales de Meta respetadas explícitamente (no inventadas): caption solo en
// image/video/document, filename solo en document, audio/sticker sin
// caption ni filename.
export type WhatsAppMediaType = "image" | "video" | "audio" | "document" | "sticker";

export async function enviarMedia(params: {
  phoneNumberId: string;
  token: string;
  para: string;
  tipo: WhatsAppMediaType;
  link?: string;
  mediaId?: string;
  caption?: string;
  filename?: string;
  signal?: AbortSignal;
}): Promise<{ wamid: string | null }> {
  const referencia: Record<string, string> = params.mediaId ? { id: params.mediaId } : { link: params.link ?? "" };
  // Meta rechaza el campo si no aplica al tipo -- nunca se envían de más.
  if (params.caption && (params.tipo === "image" || params.tipo === "video" || params.tipo === "document")) {
    referencia.caption = params.caption;
  }
  if (params.filename && params.tipo === "document") {
    referencia.filename = params.filename;
  }

  const res = await fetch(`${GRAPH}/${params.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: params.para,
      type: params.tipo,
      [params.tipo]: referencia,
    }),
    signal: params.signal,
  });
  const json = (await res.json()) as { messages?: { id?: string }[] } & GraphError;
  if (!res.ok) {
    throw new MetaGraphApiError({
      httpStatus: res.status,
      metaErrorCode: json.error?.code,
      metaErrorMessage: json.error?.message,
      retryAfterMs: parseRetryAfterMs(res),
    });
  }
  return { wamid: json.messages?.[0]?.id ?? null };
}

// Marca el mensaje entrante como leído (doble check azul) y activa el
// indicador "escribiendo..." de WhatsApp -- Meta lo apaga solo a los ~25s o
// en cuanto le llega el siguiente mensaje real, lo que pase primero. Se
// llama apenas se decide que SÍ se le va a responder a este mensaje, para
// que la clienta vea que el negocio ya está en eso mientras la IA procesa.
// Nunca lanza: un fallo acá (token vencido, mensaje ya viejo, etc.) no
// puede tumbar el resto del flujo de respuesta.
export async function marcarLeidoConTyping(params: {
  phoneNumberId: string;
  token: string;
  messageId: string;
}): Promise<void> {
  try {
    const res = await fetch(`${GRAPH}/${params.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: params.messageId,
        typing_indicator: { type: "text" },
      }),
    });
    if (!res.ok) {
      const detalle = await res.text().catch(() => "");
      console.error(`[whatsapp] no se pudo marcar leído/typing (${res.status}): ${detalle.slice(0, 200)}`);
    }
  } catch (err) {
    console.error("[whatsapp] error marcando leído/typing:", err instanceof Error ? err.message : err);
  }
}

// True si el cliente final escribió en las últimas 24h. Fuera de esta
// ventana, WhatsApp solo permite plantillas aprobadas (no aplica al envío de
// campañas, que ya usa plantillas exclusivamente vía lib/meta-templates.ts).
export async function dentroVentana24h(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string
): Promise<boolean> {
  const { data } = await supabase
    .from("dulabs_mensajes_log")
    .select("created_at")
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente)
    .eq("direccion", "entrante")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  return Date.now() - new Date(data.created_at).getTime() < VENTANA_24H_MS;
}
