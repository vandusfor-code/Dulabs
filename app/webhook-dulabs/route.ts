import { after } from "next/server";
import type { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin, type ClienteConfig } from "@/lib/supabase";

export const runtime = "nodejs";

const PAUSA_HUMANA_MS = 30 * 60 * 1000;
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v23.0";

type MetaMessage = {
  from: string;
  to?: string;
  id: string;
  type: string;
  text?: { body: string };
};

type MetaChangeValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  messages?: MetaMessage[];
  statuses?: unknown[];
  smb_message_echoes?: MetaMessage[];
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

  // Ecos de coexistencia: el dueño respondió desde el teclado de su celular.
  // (Los mensajes enviados por nuestra propia API llegan como "statuses",
  // nunca como ecos, así que esto solo detecta intervención humana real.)
  // La pausa es POR CHAT: necesitamos el número del cliente final ("to") al
  // que le respondió el dueño, no solo el hecho de que hubo un eco.
  const ecos = [
    ...(value.smb_message_echoes ?? []),
    ...(value.messages ?? []).filter((m) => soloDigitos(m.from) === displayPhone),
  ];

  for (const eco of ecos) {
    const telefonoCliente = soloDigitos(eco.to ?? "");
    if (telefonoCliente) {
      await activarPausaHumana(phoneNumberId, telefonoCliente);
    } else {
      console.warn("[webhook-dulabs] eco de coexistencia sin destinatario ('to'):", eco);
    }
  }
  if (ecos.length > 0) return;

  // Mensajes de clientes finales
  for (const mensaje of value.messages ?? []) {
    if (mensaje.type !== "text" || !mensaje.text?.body) continue; // esqueleto: solo texto
    await atenderMensaje(cliente, mensaje);
  }
}

async function activarPausaHumana(phoneNumberId: string, telefonoCliente: string) {
  const supabase = supabaseAdmin();
  const pausadoHasta = new Date(Date.now() + PAUSA_HUMANA_MS).toISOString();
  const { error } = await supabase.from("dulabs_pausas_chat").upsert(
    { phone_number_id: phoneNumberId, telefono_cliente: telefonoCliente, pausado_hasta: pausadoHasta },
    { onConflict: "phone_number_id,telefono_cliente" }
  );
  if (error) {
    console.error("[webhook-dulabs] error activando pausa:", error.message);
  } else {
    console.log(
      `[webhook-dulabs] pausa humana activada para ${phoneNumberId} <-> ${telefonoCliente} hasta ${pausadoHasta}`
    );
  }
}

async function atenderMensaje(cliente: ClienteConfig, mensaje: MetaMessage) {
  // Control de pausa por chat: si el humano intervino en ESTA conversación y
  // la ventana sigue vigente, la IA guarda silencio (filas vencidas se ignoran).
  const { data: pausa, error } = await supabaseAdmin()
    .from("dulabs_pausas_chat")
    .select("pausado_hasta")
    .eq("phone_number_id", cliente.phone_number_id)
    .eq("telefono_cliente", soloDigitos(mensaje.from))
    .maybeSingle();
  if (error) {
    console.error("[webhook-dulabs] error consultando pausa:", error.message);
  }
  if (pausa && new Date(pausa.pausado_hasta).getTime() > Date.now()) {
    console.log(
      `[webhook-dulabs] IA en silencio para "${cliente.nombre_negocio}" <-> ${mensaje.from} (pausa vigente)`
    );
    return;
  }

  const respuesta = await generarRespuestaIA(cliente, mensaje.text!.body);
  if (respuesta) {
    await enviarWhatsApp(cliente, mensaje.from, respuesta);
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
    cliente.prompt_sistema ??
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

async function enviarWhatsApp(cliente: ClienteConfig, para: string, texto: string) {
  // Cada tenant usa su propio token permanente (Embedded Signup); el token
  // global de plataforma queda como respaldo para números registrados a mano.
  const token = cliente.meta_permanent_token || process.env.META_ACCESS_TOKEN;
  if (!token) {
    console.error("[webhook-dulabs] sin token de Meta para", cliente.nombre_negocio);
    return;
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${cliente.phone_number_id}/messages`,
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
    return;
  }

  await incrementarUsoMensajes(cliente);
}

// --- Conteo de uso mensual (para el panel de plan/consumo) --------------------

async function incrementarUsoMensajes(cliente: ClienteConfig) {
  const mesHoy = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const nuevoUsados = cliente.mes_actual === mesHoy ? cliente.mensajes_usados_mes + 1 : 1;
  const { error } = await supabaseAdmin()
    .from("dulabs_clientes_config")
    .update({ mensajes_usados_mes: nuevoUsados, mes_actual: mesHoy })
    .eq("id", cliente.id);
  if (error) {
    console.error("[webhook-dulabs] error incrementando uso de mensajes:", error.message);
  }
}

function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}
