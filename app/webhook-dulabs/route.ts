import { after } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin, type ClienteConfig } from "@/lib/supabase";
import { generarRespuestaIA } from "@/lib/ia";
import { verificarFirmaMeta, compararVerifyToken } from "@/lib/meta-firma";
import { enviarTexto } from "@/lib/whatsapp";
import { descifrarSecreto } from "@/lib/crypto";
import { getSurveyBot, getSession, saveSession } from "@/lib/survey-bot-store";
import { handleMessage } from "@/lib/survey-engine";

export const runtime = "nodejs";

const PAUSA_HUMANA_MS = 30 * 60 * 1000;

type MetaMessage = {
  from: string;
  to?: string;
  id: string;
  type: string;
  text?: { body: string };
  // Tap de un botón QUICK_REPLY de una plantilla (ver lib/meta-templates.ts):
  // Meta lo entrega como type "button", no "text".
  button?: { text?: string; payload?: string };
  context?: { id?: string };
};

type MetaStatus = {
  id: string;
  status: "sent" | "delivered" | "read" | "failed" | string;
  timestamp?: string;
  pricing?: { category?: string };
};

type MetaChangeValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
  smb_message_echoes?: MetaMessage[];
};

// --- Verificación inicial del webhook (Hub Challenge de Meta) ---------------

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && compararVerifyToken(token, process.env.META_VERIFY_TOKEN)) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// --- Recepción de eventos ----------------------------------------------------

export async function POST(request: NextRequest) {
  // La firma se calcula sobre los bytes EXACTOS del body: hay que leer el texto
  // crudo antes de parsear (re-serializar cambiaría el HMAC).
  const rawBody = await request.text();
  if (!verificarFirmaMeta(rawBody, request.headers.get("x-hub-signature-256"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: { entry?: { changes?: { field: string; value: MetaChangeValue }[] }[] };
  try {
    payload = JSON.parse(rawBody);
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
          console.error("[webhook-dulabs] error procesando cambio:", err instanceof Error ? err.message : err);
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
      await registrarMensaje(
        phoneNumberId,
        telefonoCliente,
        "saliente",
        eco.text?.body ?? `[mensaje ${eco.type}]`,
        "manual",
        eco.id
      );
    } else {
      console.warn(`[webhook-dulabs] eco de coexistencia sin destinatario ('to'): id=${eco.id} type=${eco.type}`);
    }
  }
  if (ecos.length > 0) return;

  // Estado de entrega/lectura de mensajes que enviamos (campañas e IA).
  for (const estado of value.statuses ?? []) {
    await actualizarEstadoEntrega(estado);
  }

  // Respuestas citadas (swipe-to-reply) a un mensaje de campaña específico.
  for (const mensaje of value.messages ?? []) {
    if (mensaje.context?.id) await marcarRespondido(mensaje.context.id);
  }

  // Mensajes de clientes finales
  for (const mensaje of value.messages ?? []) {
    // Tap de un botón QUICK_REPLY de plantilla: se procesa como si el
    // participante hubiera escrito el texto del botón (mismo motor de
    // encuestas/IA de abajo, sin lógica aparte para "type: button").
    // Un mensaje "type: button" SOLO puede contener el texto de un botón que
    // nosotros mismos definimos en una plantilla (nunca texto libre del
    // usuario), así que normalizar "Si"/"No"/"Acepto" aquí no tiene el riesgo
    // de ambigüedad que tendría interpretar esas mismas palabras si llegaran
    // como texto libre.
    if (mensaje.type === "button" && mensaje.button?.text) {
      mensaje.text = { body: normalizarTextoBoton(mensaje.button.text) };
    }
    if (mensaje.type !== "text" && mensaje.type !== "button") continue; // esqueleto: solo texto/botón
    if (!mensaje.text?.body) continue;
    await atenderMensaje(cliente, mensaje);
  }
}

const RANGO_ESTADO: Record<string, number> = { enviado: 0, entregado: 1, leido: 2, fallido: 3 };
const ESTADO_META_A_DB: Record<string, string> = {
  sent: "enviado",
  delivered: "entregado",
  read: "leido",
  failed: "fallido",
};

async function actualizarEstadoEntrega(estado: MetaStatus) {
  const nuevoEstado = ESTADO_META_A_DB[estado.status];
  if (!nuevoEstado) return;

  const supabase = supabaseAdmin();
  const { data: fila, error: errorLectura } = await supabase
    .from("dulabs_mensajes_log")
    .select("id, estado_entrega")
    .eq("wamid", estado.id)
    .maybeSingle();
  if (errorLectura) {
    console.error("[webhook-dulabs] error buscando mensaje por wamid:", errorLectura.message);
    return;
  }
  if (!fila) return; // mensaje no enviado por una campaña rastreada (o IA sin wamid guardado)

  if (nuevoEstado !== "fallido" && RANGO_ESTADO[nuevoEstado] <= RANGO_ESTADO[fila.estado_entrega]) {
    return; // no retroceder el estado si los eventos llegan desordenados
  }

  const marcaTiempo = estado.timestamp ? new Date(Number(estado.timestamp) * 1000).toISOString() : new Date().toISOString();
  const cambios: Record<string, string> = { estado_entrega: nuevoEstado };
  if (nuevoEstado === "entregado") cambios.entregado_at = marcaTiempo;
  if (nuevoEstado === "leido") cambios.leido_at = marcaTiempo;
  if (estado.pricing?.category) cambios.pricing_categoria = estado.pricing.category;

  const { error: errorUpdate } = await supabase.from("dulabs_mensajes_log").update(cambios).eq("id", fila.id);
  if (errorUpdate) {
    console.error("[webhook-dulabs] error actualizando estado de entrega:", errorUpdate.message);
  }
}

async function marcarRespondido(wamidCitado: string) {
  const { error } = await supabaseAdmin()
    .from("dulabs_mensajes_log")
    .update({ respondido: true })
    .eq("wamid", wamidCitado);
  if (error) {
    console.error("[webhook-dulabs] error marcando mensaje como respondido:", error.message);
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
    console.log(`[webhook-dulabs] pausa humana activada para ${phoneNumberId} hasta ${pausadoHasta}`);
  }
}

async function atenderMensaje(cliente: ClienteConfig, mensaje: MetaMessage) {
  await registrarMensaje(cliente.phone_number_id, soloDigitos(mensaje.from), "entrante", mensaje.text!.body, "entrante");

  // Bot de encuestas: SOLO toma el turno si este contacto ya tiene una sesión
  // de encuesta activa (fue invitado explícitamente vía /dashboard/surveys).
  // Cualquier otro mensaje sigue el flujo normal del asistente de IA de abajo.
  if (await atenderMensajeEncuesta(cliente, mensaje)) return;

  // Pausa manual de todo el número, activada desde Agentes de IA.
  if (cliente.ia_pausada) {
    console.log(`[webhook-dulabs] IA pausada manualmente para "${cliente.nombre_negocio}"`);
    return;
  }

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
    console.log(`[webhook-dulabs] IA en silencio para "${cliente.nombre_negocio}" (pausa vigente)`);
    return;
  }

  const respuesta = await generarRespuestaIA(cliente, mensaje.text!.body);
  if (respuesta) {
    await enviarWhatsApp(cliente, mensaje.from, respuesta);
  }
}

// --- Bot de encuestas (motor determinístico) -----------------------------------
//
// Devuelve true si el mensaje fue atendido por el motor de encuestas (y por lo
// tanto NO debe pasar al asistente de IA general). Devuelve false para dejar
// que el flujo normal continúe: mensajes de contactos sin una sesión de
// encuesta activa, o de participantes que ya la completaron/declinaron/venció.
async function atenderMensajeEncuesta(cliente: ClienteConfig, mensaje: MetaMessage): Promise<boolean> {
  const supabase = supabaseAdmin();
  const telefono = soloDigitos(mensaje.from);

  const bot = await getSurveyBot(supabase, cliente.phone_number_id);
  if (!bot) return false; // número sin bot de encuestas configurado/activo

  const session = await getSession(supabase, cliente.phone_number_id, telefono);
  if (!session) return false; // nunca fue invitado a la encuesta
  if (session.status === "completed" || session.status === "declined" || session.status === "expired") {
    return false; // encuesta ya cerrada para este participante: que hable con el asistente normal
  }

  const resultado = handleMessage(bot.config, bot.questions, session, mensaje.text!.body, new Date());
  await saveSession(supabase, cliente.phone_number_id, telefono, resultado.session);

  for (const texto of resultado.messages) {
    await enviarWhatsApp(cliente, mensaje.from, texto);
  }
  return true;
}

// --- Envío por la API de WhatsApp de Meta --------------------------------------

async function enviarWhatsApp(cliente: ClienteConfig, para: string, texto: string) {
  // Cada tenant usa su propio token permanente (Embedded Signup); el token
  // global de plataforma queda como respaldo para números registrados a mano.
  const token = cliente.meta_permanent_token ? descifrarSecreto(cliente.meta_permanent_token) : process.env.META_ACCESS_TOKEN;
  if (!token) {
    console.error("[webhook-dulabs] sin token de Meta para", cliente.nombre_negocio);
    return;
  }

  let wamid: string | null = null;
  try {
    ({ wamid } = await enviarTexto({ phoneNumberId: cliente.phone_number_id, token, para, texto }));
  } catch (err) {
    console.error("[webhook-dulabs] error enviando a Meta:", err);
    return;
  }

  await incrementarUsoMensajes(cliente);
  await registrarMensaje(cliente.phone_number_id, soloDigitos(para), "saliente", texto, "ia", wamid ?? undefined);
}

// --- Historial de mensajes (para la vista de actividad reciente) --------------

async function registrarMensaje(
  phoneNumberId: string,
  telefonoCliente: string,
  direccion: "entrante" | "saliente",
  contenido: string,
  origen: "entrante" | "ia" | "manual" | "campaña" | "agente",
  wamid?: string
) {
  const { error } = await supabaseAdmin().from("dulabs_mensajes_log").insert({
    phone_number_id: phoneNumberId,
    telefono_cliente: telefonoCliente,
    direccion,
    contenido,
    origen,
    wamid: wamid ?? null,
  });
  if (error) {
    console.error("[webhook-dulabs] error registrando mensaje en el historial:", error.message);
  }
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

// Textos de botón conocidos (nuestras 2 plantillas de encuestas) -> frase
// exacta que lib/survey-engine.ts reconoce. Como un mensaje "type: button"
// solo puede traer el texto de un botón que NOSOTROS pusimos en una
// plantilla, mapear palabras cortas como "si"/"no" aquí es seguro — no hay
// riesgo de confundirlo con texto libre real del usuario.
const BOTON_A_FRASE: Record<string, string> = {
  "acepto": "comenzar",
  "no acepto": "no deseo continuar",
  "si": "continuar",
  "sí": "continuar",
  "no": "no deseo continuar",
  "comenzar": "comenzar",
  "continuar": "continuar",
  "continuar encuesta": "continuar encuesta",
  "mas tarde": "más tarde",
  "más tarde": "más tarde",
  "no deseo continuar": "no deseo continuar",
};

function normalizarTextoBoton(texto: string): string {
  const clave = texto.toLowerCase().trim();
  return BOTON_A_FRASE[clave] ?? texto;
}
