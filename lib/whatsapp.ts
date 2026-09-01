import type { SupabaseClient } from "@supabase/supabase-js";

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;
const VENTANA_24H_MS = 24 * 60 * 60 * 1000;

type GraphError = { error?: { message?: string; code?: number } };

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
  });
  const json = (await res.json()) as { messages?: { id?: string }[] } & GraphError;
  if (!res.ok) {
    throw new Error(`Meta respondió ${res.status}: ${json.error?.message ?? "sin detalle"}`);
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
