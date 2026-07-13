import { after } from "next/server";
import type { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin, type ClienteConfig } from "@/lib/supabase";

export const runtime = "nodejs";

const PAUSA_HUMANA_MS = 30 * 60 * 1000;
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v23.0";

type MetaMessage = {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
};

type MetaChangeValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  messages?: MetaMessage[];
  statuses?: unknown[];
  smb_message_echoes?: unknown[];
};

// --- Verificación inicial del webhook (Hub Challenge de Meta) ---------------

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const verifyToken = process.env.META_VERIFY_TOKEN;
  if (mode === "subscribe" && verifyToken && token === verifyToken) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// --- Recepción de eventos ----------------------------------------------------

export async function POST(request: NextRequest) {
  let payload: { entry?: { changes?: { field: string; value: MetaChangeValue }[] }[] };
  try {
    payload = await request.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Meta exige un 200 rápido; el trabajo pesado (IA + envío) corre en after().
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages" && change.field !== "smb_message_echoes") continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      after(async () => {
        try {
          await procesarCambio(phoneNumberId, value);
        } catch (err) {
          console.error("[webhook-dulabs] error procesando cambio:", err);
        }
      });
    }
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}

// --- Lógica multi-tenant + coexistencia --------------------------------------

async function procesarCambio(phoneNumberId: string, value: MetaChangeValue) {
  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .select("*")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();

  if (error) {
    console.error("[webhook-dulabs] error consultando cliente:", error.message);
    return;
  }
  const cliente = data as ClienteConfig | null;
  if (!cliente) {
    console.warn(`[webhook-dulabs] phone_number_id sin cliente: ${phoneNumberId}`);
    return;
  }

  const displayPhone = soloDigitos(value.metadata?.display_phone_number ?? "");

  // Eco de coexistencia: el dueño respondió desde el teclado de su celular.
  // (Los mensajes enviados por nuestra propia API llegan como "statuses",
  // nunca como ecos, así que esto solo detecta intervención humana real.)
  const hayEco =
    (value.smb_message_echoes?.length ?? 0) > 0 ||
    (value.messages ?? []).some((m) => soloDigitos(m.from) === displayPhone);

  if (hayEco) {
    await activarPausaHumana(cliente);
    return;
  }

  // Mensajes de clientes finales
  for (const mensaje of value.messages ?? []) {
    if (mensaje.type !== "text" || !mensaje.text?.body) continue; // esqueleto: solo texto
    await atenderMensaje(cliente, mensaje);
  }
}

async function activarPausaHumana(cliente: ClienteConfig) {
  const supabase = supabaseAdmin();
  const pausadoHasta = new Date(Date.now() + PAUSA_HUMANA_MS).toISOString();
  const { error } = await supabase
    .from("dulabs_clientes_config")
    .update({ estado_pausa: true, pausado_hasta: pausadoHasta })
    .eq("id", cliente.id);
  if (error) {
    console.error("[webhook-dulabs] error activando pausa:", error.message);
  } else {
    console.log(
      `[webhook-dulabs] pausa humana activada para "${cliente.nombre_negocio}" hasta ${pausadoHasta}`
    );
  }
}

async function atenderMensaje(cliente: ClienteConfig, mensaje: MetaMessage) {
  // Control de pausa: si el humano intervino y la ventana sigue vigente, silencio.
  if (cliente.estado_pausa && cliente.pausado_hasta) {
    if (new Date(cliente.pausado_hasta).getTime() > Date.now()) {
      console.log(
        `[webhook-dulabs] IA en silencio para "${cliente.nombre_negocio}" (pausa vigente)`
      );
      return;
    }
    // La ventana expiró: reactivar la IA.
    await supabaseAdmin()
      .from("dulabs_clientes_config")
      .update({ estado_pausa: false, pausado_hasta: null })
      .eq("id", cliente.id);
  }

  const respuesta = await generarRespuestaIA(cliente, mensaje.text!.body);
  if (respuesta) {
    await enviarWhatsApp(cliente.phone_number_id, mensaje.from, respuesta);
  }
}

// --- IA (Claude) --------------------------------------------------------------

async function generarRespuestaIA(
  cliente: ClienteConfig,
  textoUsuario: string
): Promise<string | null> {
  const apiKey = cliente.api_key_ia || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[webhook-dulabs] sin API key de IA configurada");
    return null;
  }

  const anthropic = new Anthropic({ apiKey });
  const system =
    cliente.prompt_ia ??
    `Eres el asistente de WhatsApp del negocio "${cliente.nombre_negocio}". Responde de forma breve, amable y útil.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: textoUsuario }],
    });

    const texto = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    return texto || null;
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.error("[webhook-dulabs] IA rate-limited");
    } else if (err instanceof Anthropic.APIError) {
      console.error(`[webhook-dulabs] error de IA ${err.status}:`, err.message);
    } else {
      console.error("[webhook-dulabs] error de IA:", err);
    }
    return null;
  }
}

// --- Envío por la API de WhatsApp de Meta --------------------------------------

async function enviarWhatsApp(phoneNumberId: string, para: string, texto: string) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    console.error("[webhook-dulabs] falta META_ACCESS_TOKEN");
    return;
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: para,
        type: "text",
        text: { body: texto },
      }),
    }
  );

  if (!res.ok) {
    console.error(
      `[webhook-dulabs] Meta respondió ${res.status}:`,
      await res.text()
    );
  }
}

function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}
