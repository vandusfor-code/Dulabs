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
