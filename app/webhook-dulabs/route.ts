import { after } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin, type ClienteConfig } from "@/lib/supabase";
import { generarRespuestaIA, construirSystemPrompt } from "@/lib/ia";
import { obtenerHistorialConversacion } from "@/lib/historial-conversacion";
import { generarRespuestaConEspecialistaIA } from "@/lib/especialista-solicitud-ia";
import { generarRespuestaConLeadIA } from "@/lib/lead-solicitud-ia";
import { generarRespuestaAdminEspecialistaIA } from "@/lib/especialista-admin-ia";
import { tieneEspecialistasActivas, especialistaPorNumero } from "@/lib/especialistas";
import { resolverConfigAgente, type ConfigAgenteEfectiva } from "@/lib/agentes";
import { planDelTenant } from "@/lib/plan-limits";
import { agentePorSlug, INSTRUCCION_ADMIN } from "@/lib/marketplace";
import { getActivacionPorId, normalizarTelefono, type ActivacionMarketplace } from "@/lib/marketplace-store";
import { generarRespuestaAgendaIA } from "@/lib/marketplace-agenda-ia";
import { verificarFirmaMeta, compararVerifyToken } from "@/lib/meta-firma";
import { marcarLeidoConTyping } from "@/lib/whatsapp";
import {
  resolverTokenMeta as libResolverTokenMeta,
  enviarWhatsApp as libEnviarWhatsApp,
  enviarWhatsAppPartes as libEnviarWhatsAppPartes,
  enviarBotonesWhatsApp,
  registrarMensaje as libRegistrarMensaje,
} from "@/lib/whatsapp-outbound";
import { descifrarSecreto } from "@/lib/crypto";
import { getSurveyBot, getSession, saveSession } from "@/lib/survey-bot-store";
import { handleMessage, questionPrompt } from "@/lib/survey-engine";
import { interpretarRespuestaEncuesta, redactarPreguntaCalida, fraseEmpatica, type Sentimiento } from "@/lib/survey-agent-ia";
import { procesarHistorialCoexistencia, type HistoryChangeValue } from "@/lib/coexistence-history";
import { getCampaignLead, getCampaignBotConfig, guardarCampaignLead, marcarDumoSyncStatus } from "@/lib/campaign-lead-store";
import { procesarMensajeCampaña, type CampaignLeadSession } from "@/lib/campaign-lead-engine";
import { adquirirCandadoChat, liberarCandadoChat } from "@/lib/chat-lock";
import { activarPausaChat } from "@/lib/pausas-chat";
import { obtenerOnboardingSesionActivaPorTelefono, guardarOnboardingSesion, marcarBienvenidaEnviada, filaASesion } from "@/lib/onboarding-store";
import { procesarMensajeOnboarding, textoBienvenida, BOTON_CONFIGURAR, BOTON_SOPORTE } from "@/lib/onboarding-engine";

export const runtime = "nodejs";
// El flujo de agenda con especialista puede necesitar varias idas y vueltas
// con la IA (buscar hueco libre, reintentar, etc.) -- 60s se quedaba corto
// y Vercel mataba la función a mitad de camino, dejando a la clienta sin
// respuesta y sin ningún error visible. campanas/enviar ya usa 300s en este
// mismo proyecto, así que el plan lo soporta.
export const maxDuration = 120;

const PAUSA_HUMANA_MS = 30 * 60 * 1000;
// Capa SECUNDARIA de protección tras terminar el onboarding (completado o
// soporte_solicitado) -- el gate principal es el `estado` de la sesión, que
// atenderMensajeOnboarding revisa primero y corta ahí mismo. Esta pausa es
// solo por si algo más en el sistema consulta dulabs_pausas_chat para ese
// chat; 5 años = efectivamente "hasta que un humano lo resuelva".
const PAUSA_ONBOARDING_MS = 5 * 365 * 24 * 60 * 60 * 1000;

type MetaMessage = {
  from: string;
  to?: string;
  id: string;
  type: string;
  text?: { body: string };
  // Tap de un botón QUICK_REPLY de una plantilla (ver lib/meta-templates.ts):
  // Meta lo entrega como type "button", no "text".
  button?: { text?: string; payload?: string };
  // Tap de un botón de un mensaje interactivo normal (no plantilla, ver
  // enviarBotonesWhatsApp en lib/whatsapp-outbound.ts) -- Meta lo entrega
  // como type "interactive" con interactive.button_reply, distinto del
  // "button" de arriba.
  interactive?: { type?: string; button_reply?: { id?: string; title?: string } };
  context?: { id?: string };
};

type MetaStatus = {
  id: string;
  status: "sent" | "delivered" | "read" | "failed" | string;
  timestamp?: string;
  pricing?: { category?: string };
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
};

type MetaChangeValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
  smb_message_echoes?: MetaMessage[];
};

// --- Reenvío a DuMo (CRM externo) --------------------------------------------
//
// dulabs y DuMo comparten la misma Meta App (un solo webhook suscrito en
// Meta), así que dulabs actúa de relay para el número de WhatsApp que usa
// DuMo: cualquier `change` de ESE número se reenvía tal cual, sin filtrar
// por campo (mensajes, estados de entrega, ecos — todo lo que le sirva a
// DuMo). Esto es ADEMÁS de, no en vez de, el procesamiento propio de
// dulabs de abajo — si ese phone_number_id nunca se agrega a
// dulabs_clientes_config, procesarCambio() ya lo ignora solo (no hay fila,
// solo un console.warn), así que no hay riesgo de que dulabs también le
// responda con su propia IA a los mensajes de DuMo.
//
// Nunca debe romper ni frenar el flujo propio de dulabs: corre dentro de
// after() (se ejecuta tras responder 200 a Meta, igual que el resto del
// trabajo pesado del webhook) y con su propio try/catch — un fallo acá
// jamás afecta el procesamiento normal.
const DUMO_URL = "https://du-mo.vercel.app/api/whatsapp/webhook";

async function reenviarADumo(change: { field: string; value: MetaChangeValue }) {
  const secret = process.env.DUMO_FORWARD_SECRET;
  if (!secret) {
    console.error("[webhook-dulabs] DUMO_FORWARD_SECRET no configurado, no se reenvía a DuMo");
    return false;
  }
  const phoneId = change.value?.metadata?.phone_number_id ?? "?";
  try {
    const res = await fetch(DUMO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DuMo-Forward-Secret": secret },
      body: JSON.stringify({ entry: [{ changes: [change] }] }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[webhook-dulabs] DuMo respondió ${res.status} al reenvío (phoneId=${phoneId})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
      return false;
    }
    console.log(
      `[webhook-dulabs] reenviado a DuMo phoneId=${phoneId} field=${change.field} messages=${change.value?.messages?.length ?? 0}`,
    );
    return true;
  } catch (err) {
    console.error(
      "[webhook-dulabs] error reenviando evento a DuMo:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

// --- Transferencia estructurada de leads capturados a DuMo ------------------
//
// Distinto de reenviarADumo (que reenvía CUALQUIER mensaje crudo de WhatsApp
// para el número relay): esto solo se dispara UNA vez, cuando el motor de
// captación de campañas llega a lead_captured, y manda el payload
// estructurado (RUT/teléfono/compañía ya validados) al endpoint dedicado de
// DuMo, no al webhook genérico de WhatsApp.
const DUMO_LEAD_INTAKE_URL = "https://du-mo.vercel.app/api/whatsapp/lead-intake";

async function sincronizarLeadConDuMo(params: {
  dulabsSessionId: string;
  tenantId: string;
  phoneNumberId: string;
  telefono: string;
  campanaId: number | null;
  campaignLabel: string;
  session: CampaignLeadSession;
}) {
  const supabase = supabaseAdmin();
  const secret = process.env.DULABS_LEAD_INTAKE_SECRET;
  if (!secret) {
    console.error("[webhook-dulabs] DULABS_LEAD_INTAKE_SECRET no configurado, no se transfiere el lead a DuMo");
    return;
  }

  await marcarDumoSyncStatus(supabase, params.dulabsSessionId, "pending");
  try {
    const res = await fetch(DUMO_LEAD_INTAKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dulabs-lead-secret": secret },
      body: JSON.stringify({
        dulabs_session_id: params.dulabsSessionId,
        dulabs_tenant_id: params.tenantId,
        phone_number_id: params.phoneNumberId,
        wa_id: params.telefono,
        // DuMo muestra el número como título del chat si customer_name viene
        // vacío -- si no tenemos un nombre real del cliente, mandamos una
        // etiqueta reconocible en vez de dejarlo en blanco.
        customer_name: params.session.customerName || "Masivos DuMo",
        rut: params.session.rut,
        phone_provided: params.session.phoneProvided,
        current_company_raw: params.session.currentCompanyRaw,
        current_operator: params.session.currentOperator,
        campaign_id: params.campanaId,
        campaign_name: params.campaignLabel,
        captured_at: params.session.capturedAt,
        status: "lead_captured",
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[webhook-dulabs] DuMo respondió ${res.status} al lead-intake (session=${params.dulabsSessionId})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
      await marcarDumoSyncStatus(supabase, params.dulabsSessionId, "error");
      return;
    }
    console.log(`[webhook-dulabs] lead transferido a DuMo (session=${params.dulabsSessionId})`);
    await marcarDumoSyncStatus(supabase, params.dulabsSessionId, "synced");
  } catch (err) {
    console.error(
      "[webhook-dulabs] error transfiriendo lead a DuMo:",
      err instanceof Error ? err.message : err,
    );
    await marcarDumoSyncStatus(supabase, params.dulabsSessionId, "error");
  }
}

/** Portate (+56) — siempre reenviar a DuMo aunque falle el flag en BD o el env legacy. */
const DUMO_RELAY_PHONE_IDS_HARDCODED = ["1058034444062074"];

/** IDs en DUMO_PHONE_NUMBER_ID (env, coma-separados) + IDs fijos de DuMo. */
function legacyDumoPhoneIds(): string[] {
  const fromEnv = (process.env.DUMO_PHONE_NUMBER_ID ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...fromEnv, ...DUMO_RELAY_PHONE_IDS_HARDCODED])];
}

/** true si este phone_number_id debe reenviarse a DuMo (flag por número o env legacy). */
async function debeReenviarADumo(phoneNumberId: string): Promise<boolean> {
  const legacyIds = legacyDumoPhoneIds();
  if (legacyIds.includes(phoneNumberId)) {
    console.log(`[webhook-dulabs] reenvío DuMo por DUMO_PHONE_NUMBER_ID legacy (${phoneNumberId})`);
    return true;
  }

  const { data, error } = await supabaseAdmin()
    .from("dulabs_clientes_config")
    .select("forward_to_dumo, nombre_negocio")
    .eq("phone_number_id", phoneNumberId)
    .eq("forward_to_dumo", true)
    .limit(1);
  if (error) {
    console.error("[webhook-dulabs] error consultando forward_to_dumo:", error.message);
    return false;
  }
  const row = data?.[0];
  if (row) {
    console.log(`[webhook-dulabs] reenvío DuMo activo para "${row.nombre_negocio}" (${phoneNumberId})`);
    return true;
  }

  console.log(`[webhook-dulabs] sin reenvío DuMo para phoneId=${phoneNumberId} (forward_to_dumo=false o sin fila)`);
  return false;
}

// DuMo rechaza explícitamente los mensajes type:"button" (los trata como no
// soportados y le inserta al cliente un "⚠️ DuMo no admite botones" en la
// conversación — verificado leyendo su código real). Un tap de botón de
// campaña (SÍ/NO) es contenido perfectamente válido, así que se reenvía
// como si fuera texto plano con el label del botón — nunca el evento crudo.
// Se opera sobre una COPIA: el `change` original (usado más abajo por
// procesarCambio/atenderMensajeCampaña) queda intacto.
function normalizarBotonesParaDumo(value: MetaChangeValue): MetaChangeValue {
  if (!value.messages?.some((m) => m.type === "button")) return value;
  return {
    ...value,
    messages: value.messages.map((m) =>
      m.type === "button" && m.button?.text ? { ...m, type: "text", text: { body: m.button.text } } : m,
    ),
  };
}

/** Reenvía mensajes entrantes a DuMo antes de responder 200 a Meta (evita perder el after()). */
async function reenviarMensajesADumoSiAplica(change: { field: string; value: MetaChangeValue }) {
  if (change.field !== "messages") return;
  if (!change.value?.messages?.length) return;

  const phoneId = change.value.metadata?.phone_number_id;
  if (!phoneId) return;

  try {
    if (await debeReenviarADumo(phoneId)) {
      await reenviarADumo({ field: change.field, value: normalizarBotonesParaDumo(change.value) });
    }
  } catch (err) {
    console.error(
      "[webhook-dulabs] error evaluando reenvío a DuMo:",
      err instanceof Error ? err.message : err,
    );
  }
}

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

  let payload: {
    entry?: { changes?: { field: string; value: MetaChangeValue | HistoryChangeValue }[] }[];
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const inboundPhoneId = change.value?.metadata?.phone_number_id;
      const inboundCount =
        change.field === "messages" && "messages" in (change.value ?? {})
          ? ((change.value as MetaChangeValue).messages?.length ?? 0)
          : 0;
      if (inboundPhoneId && inboundCount > 0) {
        console.log(
          `[webhook-dulabs] inbound messages=${inboundCount} phoneId=${inboundPhoneId} field=${change.field}`,
        );
      }

      // Mensajes entrantes: reenvío síncrono a DuMo (no depender de after() en serverless).
      await reenviarMensajesADumoSiAplica(change as { field: string; value: MetaChangeValue });

      const phoneId = change.value?.metadata?.phone_number_id;

      // Historial coexistencia: importar entrantes de hoy → dulabs + DuMo.
      if (change.field === "history" && phoneId) {
        after(async () => {
          try {
            if (await debeReenviarADumo(phoneId)) {
              await procesarHistorialCoexistencia({
                field: change.field,
                value: change.value as HistoryChangeValue,
              });
            }
          } catch (err) {
            console.error(
              "[webhook-dulabs] error procesando history coexistencia:",
              err instanceof Error ? err.message : err,
            );
          }
        });
      }

      if (phoneId && change.field !== "messages" && change.field !== "history") {
        after(async () => {
          try {
            if (await debeReenviarADumo(phoneId)) {
              await reenviarADumo(change);
            }
          } catch (err) {
            console.error("[webhook-dulabs] error evaluando reenvío a DuMo:", err instanceof Error ? err.message : err);
          }
        });
      }

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
      // registrarMensaje es el candado atómico (constraint único en wamid):
      // si Meta reentrega este eco, el INSERT choca y no se repite la pausa.
      const yaProcesado = await registrarMensaje(
        phoneNumberId,
        telefonoCliente,
        "saliente",
        eco.text?.body ?? `[mensaje ${eco.type}]`,
        "manual",
        eco.id
      );
      if (!yaProcesado) {
        await activarPausaHumana(phoneNumberId, telefonoCliente);
      }
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
    // Tap de un botón de un mensaje interactivo normal (ver
    // enviarBotonesWhatsApp) -- mismo criterio que arriba: el título del
    // botón lo definimos nosotros, así que se trata como el texto que
    // "escribió" la clienta.
    if (mensaje.type === "interactive" && mensaje.interactive?.type === "button_reply" && mensaje.interactive.button_reply?.title) {
      mensaje.text = { body: mensaje.interactive.button_reply.title };
    }
    if (mensaje.type !== "text" && mensaje.type !== "button" && mensaje.type !== "interactive") continue; // esqueleto: solo texto/botón
    if (!mensaje.text?.body) continue;
    const nombreContacto =
      (value.contacts ?? []).find((c) => soloDigitos(c.wa_id ?? "") === soloDigitos(mensaje.from))?.profile?.name ?? null;
    await atenderMensaje(cliente, mensaje, nombreContacto);
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
  const cambios: Record<string, string | number | null> = { estado_entrega: nuevoEstado };
  if (nuevoEstado === "entregado") cambios.entregado_at = marcaTiempo;
  if (nuevoEstado === "leido") cambios.leido_at = marcaTiempo;
  if (estado.pricing?.category) cambios.pricing_categoria = estado.pricing.category;
  if (nuevoEstado === "fallido" && estado.errors?.[0]) {
    cambios.error_codigo = estado.errors[0].code ?? null;
    cambios.error_detalle = estado.errors[0].error_data?.details ?? estado.errors[0].title ?? estado.errors[0].message ?? null;
  }

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
  await activarPausaChat(supabaseAdmin(), phoneNumberId, telefonoCliente, PAUSA_HUMANA_MS);
}

async function atenderMensaje(cliente: ClienteConfig, mensaje: MetaMessage, nombreContacto: string | null) {
  // Deduplicación real contra reintentos de Meta (reentrega el mismo webhook
  // si no respondemos 200 a tiempo): registrarMensaje es el candado atómico
  // vía el constraint único en wamid. Si este mensaje ya se procesó antes,
  // el INSERT choca (23505) y abortamos ANTES de cualquier efecto
  // secundario — nada de respuesta de IA, cita de agenda ni cupo consumido
  // se repite. No hay ventana de carrera: a diferencia de un SELECT previo,
  // el INSERT con constraint único es atómico incluso si dos reentregas de
  // Meta llegan genuinamente en paralelo.
  const yaProcesado = await registrarMensaje(
    cliente.phone_number_id,
    soloDigitos(mensaje.from),
    "entrante",
    mensaje.text!.body,
    "entrante",
    mensaje.id
  );
  if (yaProcesado) {
    console.log(`[webhook-dulabs] mensaje ${mensaje.id} ya fue procesado (reintento de Meta), ignorando`);
    return;
  }

  // Lista negra: estos números NUNCA reciben respuesta, sin importar nada
  // más -- se revisa antes que cualquier otro flujo (encuestas, campañas,
  // IA normal), a propósito. El mensaje queda igual registrado arriba.
  if (cliente.ia_numeros_bloqueados) {
    const bloqueados = cliente.ia_numeros_bloqueados.split(",").map((n) => n.trim()).filter(Boolean);
    if (bloqueados.includes(soloDigitos(mensaje.from))) {
      console.log(`[webhook-dulabs] número en lista negra para "${cliente.nombre_negocio}", ignorando`);
      return;
    }
  }

  // Bot de encuestas: SOLO toma el turno si este contacto ya tiene una sesión
  // de encuesta activa (fue invitado explícitamente vía /dashboard/surveys).
  // Cualquier otro mensaje sigue el flujo normal del asistente de IA de abajo.
  if (await atenderMensajeEncuesta(cliente, mensaje)) return;

  // Bot de captación de leads por campaña: mismo criterio — SOLO toma el
  // turno si este contacto ya tiene una fila en dulabs_campaign_leads
  // (fue impactado por una campaña con bot de captación configurado). Se
  // revisa ANTES de ia_pausada a propósito: debe funcionar incluso en
  // números conectados a DuMo (forward_to_dumo=true), donde la IA general
  // de dulabs ya está silenciada.
  if (await atenderMensajeCampaña(cliente, mensaje)) return;

  // Onboarding automático post-pago (ver lib/onboarding-trigger.ts, que
  // manda la bienvenida) -- SOLO toma el turno si este teléfono ya tiene una
  // fila en dulabs_onboarding_sesiones. El `estado` de esa fila es el gate
  // PRINCIPAL contra que la IA general responda después de terminar: si ya
  // es completado/soporte_solicitado, esta función devuelve true (mensaje
  // atendido, nada más que hacer) sin llamar a la IA -- independiente de la
  // pausa larga de abajo, que es solo una capa secundaria.
  if (await atenderMensajeOnboarding(cliente, mensaje)) return;

  // Pausa manual de todo el número, activada desde Agentes de IA.
  if (cliente.ia_pausada) {
    console.log(`[webhook-dulabs] IA pausada manualmente para "${cliente.nombre_negocio}"`);
    return;
  }

  // Restricción temporal a ciertos remitentes (ej. mientras se prueba algo
  // nuevo y no se quiere exponer clientes reales todavía). Distinta de
  // ia_pausada: esa apaga TODO, incluidas las pruebas propias; esta deja
  // pasar solo a los números autorizados y silencia al resto -- el mensaje
  // de cualquiera queda igual registrado arriba, solo no recibe respuesta.
  if (cliente.ia_restringida_a) {
    const autorizados = cliente.ia_restringida_a.split(",").map((n) => n.trim()).filter(Boolean);
    if (!autorizados.includes(soloDigitos(mensaje.from))) {
      console.log(`[webhook-dulabs] IA restringida para "${cliente.nombre_negocio}": remitente no autorizado`);
      return;
    }
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

  // Cupo mensual de mensajes de IA del plan (pool del tenant, sumado entre
  // todos sus números). Al agotarse, la IA guarda silencio hasta el próximo
  // mes o hasta que el tenant mejore su plan — el mensaje del cliente queda
  // registrado igual (arriba) para que un humano pueda responderlo a mano.
  if (!(await dentroDelCupoIA(cliente))) {
    console.log(`[webhook-dulabs] cupo mensual de mensajes IA agotado para tenant ${cliente.id_tenant}`);
    return;
  }

  // Si el cliente escribe varios mensajes seguidos muy rápido, Meta entrega
  // cada uno en un webhook aparte -- sin este freno, cada uno dispararía su
  // propia llamada a la IA en paralelo, y podrían llegar dos (o más)
  // respuestas sueltas que no se leyeron entre sí. Se espera un momento
  // corto y se revisa si mientras tanto llegó un mensaje MÁS NUEVO de este
  // mismo remitente: si lo hay, este mensaje se deja pasar en silencio --
  // el más nuevo, al procesarse, ya lo ve en el historial (obtenerHistorialConversacion)
  // y responde a la ráfaga completa de una sola vez.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const { data: masReciente } = await supabaseAdmin()
    .from("dulabs_mensajes_log")
    .select("wamid")
    .eq("phone_number_id", cliente.phone_number_id)
    .eq("telefono_cliente", soloDigitos(mensaje.from))
    .eq("direccion", "entrante")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (masReciente?.wamid && masReciente.wamid !== mensaje.id) {
    console.log(`[webhook-dulabs] mensaje ${mensaje.id} superado por uno más nuevo del mismo remitente, no respondo (evita duplicados)`);
    return;
  }

  // A partir de aquí ya es seguro que SÍ le vamos a responder a este
  // mensaje -- se marca leído y se activa "escribiendo..." para que la
  // clienta vea que ya la estamos atendiendo mientras la IA procesa
  // (puede tardar unos segundos, sobre todo si hay que consultar la
  // agenda). Nunca lanza, así que no puede frenar la respuesta real.
  const tokenMeta = resolverTokenMeta(cliente);
  if (tokenMeta) {
    await marcarLeidoConTyping({ phoneNumberId: cliente.phone_number_id, token: tokenMeta, messageId: mensaje.id });
  }

  // Candado real por conversación: aunque el freno de ráfaga de arriba ya
  // pasó, dos mensajes separados por MÁS de esos ~2.5s (ej. "Sí" y "gracias"
  // escritos con unos segundos de diferencia) pueden llegar cada uno como
  // "el más reciente" en su propio momento y disparar la IA dos veces en
  // PARALELO -- cada hilo revisando disponibilidad e intentando agendar por
  // su cuenta, sin saber del otro. Eso es lo que causaba que una clienta
  // recibiera "quedó agendada" seguido de "ya no hay espacio": el segundo
  // hilo chocaba contra un horario que el primero ya había resuelto.
  // Este candado serializa el tramo real de IA + agenda por chat -- si ya
  // hay otro mensaje de esta misma clienta procesándose, este espera turno
  // (nunca lo abandona) y cuando le toca, ya ve el resultado del anterior.
  const yaTengoCandado = await adquirirCandadoChat(cliente.phone_number_id, soloDigitos(mensaje.from), mensaje.id);
  try {
    const contexto = await resolverContextoMensaje(cliente, mensaje.from);

    if (contexto.modo === "agenda") {
      const resultado = await generarRespuestaAgendaIA({
        supabase: supabaseAdmin(),
        systemPrompt: contexto.systemPrompt,
        apiKeyCifrada: cliente.api_key_ia,
        textoUsuario: mensaje.text!.body,
        activacionId: contexto.activacion.id,
        phoneNumberId: cliente.phone_number_id,
        telefonoRemitente: normalizarTelefono(mensaje.from),
        nombreRemitente: nombreContacto,
        esAdmin: contexto.esAdmin,
        recursosDisponibles: contexto.activacion.recursos_disponibles,
        duracionEstandarMin: contexto.activacion.duracion_estandar_min,
      });
      if (resultado.texto) await enviarWhatsApp(cliente, mensaje.from, resultado.texto);
      return;
    }

    const historial = await obtenerHistorialConversacion(supabaseAdmin(), cliente.phone_number_id, soloDigitos(mensaje.from), {
      excluirWamid: mensaje.id,
    });

    // Solo entra aquí si el número tiene alguna especialista configurada (ver
    // lib/especialistas.ts) -- para el resto de la plataforma este chequeo es
    // un simple false y el comportamiento sigue exactamente igual que siempre.
    const conEspecialistas = await tieneEspecialistasActivas(supabaseAdmin(), cliente.phone_number_id);
    // Si quien escribe es una de las propias especialistas del negocio (por su
    // número de WhatsApp), se le atiende como administradora -- consulta la
    // agenda y agenda citas ya confirmadas para otras personas, no como una
    // clienta pidiendo un servicio para sí misma.
    const especialistaAdmin = conEspecialistas
      ? await especialistaPorNumero(supabaseAdmin(), cliente.phone_number_id, soloDigitos(mensaje.from))
      : null;

    const respuesta = especialistaAdmin
      ? await generarRespuestaAdminEspecialistaIA({
          supabase: supabaseAdmin(),
          cliente,
          especialista: especialistaAdmin,
          textoUsuario: mensaje.text!.body,
          historial,
        })
      : conEspecialistas
      ? await generarRespuestaConEspecialistaIA({
          supabase: supabaseAdmin(),
          cliente,
          systemPromptBase: construirSystemPrompt({ ...contexto.config, nombre_negocio: cliente.nombre_negocio }),
          textoUsuario: mensaje.text!.body,
          telefonoRemitente: soloDigitos(mensaje.from),
          nombrePerfilWhatsapp: nombreContacto,
          historial,
        })
      : cliente.captura_leads
      ? await generarRespuestaConLeadIA({
          supabase: supabaseAdmin(),
          cliente,
          textoUsuario: mensaje.text!.body,
          telefonoRemitente: soloDigitos(mensaje.from),
          historial,
        })
      : await generarRespuestaIA(
          { ...contexto.config, nombre_negocio: cliente.nombre_negocio },
          mensaje.text!.body,
          { idTenant: cliente.id_tenant, phoneNumberId: cliente.phone_number_id },
          historial
        );
    if (respuesta) {
      // Con especialistas activas se permite que la IA parta su respuesta en
      // dos mensajes (separados por línea en blanco) para sonar más humana --
      // el resto de la plataforma sigue mandando un solo mensaje por turno,
      // como siempre.
      if (conEspecialistas) {
        await enviarWhatsAppPartes(cliente, mensaje.from, respuesta);
      } else {
        await enviarWhatsApp(cliente, mensaje.from, respuesta);
      }
    }
  } finally {
    if (yaTengoCandado) {
      await liberarCandadoChat(cliente.phone_number_id, soloDigitos(mensaje.from), mensaje.id);
    }
  }
}

type ContextoMensaje =
  | { modo: "texto"; config: ConfigAgenteEfectiva }
  | { modo: "agenda"; systemPrompt: string; activacion: ActivacionMarketplace; esAdmin: boolean };

// Resuelve cómo responder este mensaje. Si el número tiene un agente del
// Marketplace activo CON agenda (ver lib/marketplace.ts `usaAgenda`), pasa a
// modo "agenda" (herramientas reales de citas, ver
// lib/marketplace-agenda-ia.ts). Si tiene un agente del marketplace SIN
// agenda, sigue en modo "texto" pero con el prompt del catálogo (sombreando
// la config propia, que queda intacta). Si el remitente es el número admin
// configurado, antepone la instrucción de trato administrativo. Sin agente
// del marketplace activo, cae a la resolución normal (agente propio/legado).
async function resolverContextoMensaje(cliente: ClienteConfig, remitente: string): Promise<ContextoMensaje> {
  const supabase = supabaseAdmin();
  if (cliente.marketplace_activacion_id) {
    const act = await getActivacionPorId(supabase, cliente.marketplace_activacion_id);
    if (act && act.estado === "activa") {
      const agente = agentePorSlug(act.agente_slug);
      if (agente) {
        const esAdmin = Boolean(act.numero_admin && normalizarTelefono(remitente) === act.numero_admin);
        const instruccionAdmin = esAdmin
          ? `${INSTRUCCION_ADMIN}${act.nombre_admin ? ` El administrador se llama ${act.nombre_admin}.` : ""}\n\n`
          : "";
        const prompt = `${instruccionAdmin}${agente.promptBase}`;
        if (agente.usaAgenda) {
          return { modo: "agenda", systemPrompt: prompt, activacion: act, esAdmin };
        }
        return {
          modo: "texto",
          config: { prompt_sistema: prompt, base_conocimiento: act.config_texto, api_key_ia: cliente.api_key_ia, nombre_agente: agente.nombre },
        };
      }
    }
  }
  return { modo: "texto", config: await resolverConfigAgente(supabase, cliente) };
}

// Suma el consumo de mensajes de IA del mes en curso entre TODOS los números
// del tenant y lo compara contra el tope de su plan (mensajesIAMes). null =
// ilimitado (Enterprise). El contador por número (mensajes_usados_mes) lo
// mantiene incrementarUsoMensajes en cada envío saliente.
async function dentroDelCupoIA(cliente: ClienteConfig): Promise<boolean> {
  const supabase = supabaseAdmin();
  const plan = await planDelTenant(supabase, cliente.id_tenant);
  if (plan.limites.mensajesIAMes === null) return true;
  const mesHoy = new Date().toISOString().slice(0, 7);
  const { data } = await supabase
    .from("dulabs_clientes_config")
    .select("mensajes_usados_mes, mes_actual")
    .eq("id_tenant", cliente.id_tenant);
  const usados = (data ?? [])
    .filter((r) => r.mes_actual === mesHoy)
    .reduce((suma, r) => suma + (r.mensajes_usados_mes ?? 0), 0);
  return usados < plan.limites.mensajesIAMes;
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

  const textoUsuario = mensaje.text!.body;
  const apiKey = cliente.api_key_ia ? descifrarSecreto(cliente.api_key_ia) : process.env.ANTHROPIC_API_KEY;

  // 1) Intento determinístico directo (rápido, sin costo): cubre respuestas
  // ya literales (números, Sí/No, taps de botón, "más tarde"/"detener"…).
  let resultado = handleMessage(bot.config, bot.questions, session, textoUsuario, new Date());
  let sentimiento: Sentimiento = null;

  // 2) Si el texto no validó contra la pregunta actual, la IA intenta
  // interpretar lenguaje natural (sección 17 del spec: "la IA interpreta,
  // el backend decide"). El texto normalizado que propone se vuelve a pasar
  // por el motor real — nunca se guarda nada directo desde la IA, así que un
  // valor mal propuesto simplemente vuelve a fallar la validación real.
  if (resultado.action === "clarify" && apiKey) {
    const preguntaActual = bot.questions[resultado.session.currentIndex];
    if (preguntaActual) {
      const interpretacion = await interpretarRespuestaEncuesta({ apiKey, pregunta: preguntaActual, textoUsuario });
      sentimiento = interpretacion.sentimiento;
      if (interpretacion.textoNormalizado) {
        const reintento = handleMessage(bot.config, bot.questions, session, interpretacion.textoNormalizado, new Date());
        if (reintento.action !== "clarify") resultado = reintento;
      }
    }
  }

  await saveSession(supabase, cliente.phone_number_id, telefono, resultado.session);

  // 3) Redacta con calidez la pregunta que se está presentando (siempre el
  // último mensaje en "ask"/"progress"/"clarify" — ver questionPrompt() en
  // lib/survey-engine.ts). Las instrucciones obligatorias de cómo responder
  // las sigue agregando el motor, nunca la IA.
  const mensajesFinales = [...resultado.messages];
  if ((resultado.action === "ask" || resultado.action === "progress" || resultado.action === "clarify") && apiKey) {
    const preguntaMostrada = bot.questions[resultado.session.currentIndex];
    if (preguntaMostrada) {
      const textoCalido = await redactarPreguntaCalida({ apiKey, pregunta: preguntaMostrada, brandName: bot.config.brandName });
      if (textoCalido) {
        mensajesFinales[mensajesFinales.length - 1] = questionPrompt(preguntaMostrada, textoCalido);
      }
    }
  }

  const empatia = fraseEmpatica(sentimiento);
  if (empatia) mensajesFinales.unshift(empatia);

  for (const texto of mensajesFinales) {
    await enviarWhatsApp(cliente, mensaje.from, texto);
  }
  return true;
}

// --- Bot de captación de leads por campaña (SÍ/NO -> RUT/teléfono/compañía) ---
//
// Devuelve true si el mensaje fue atendido por este flujo. Solo toma el
// turno si el contacto ya tiene una fila en dulabs_campaign_leads en un
// estado no terminal (fue impactado por una campaña con bot de captación
// configurado, ver POST /api/campanas/enviar) — mismo criterio que
// atenderMensajeEncuesta.
async function atenderMensajeCampaña(cliente: ClienteConfig, mensaje: MetaMessage): Promise<boolean> {
  const supabase = supabaseAdmin();
  const telefono = soloDigitos(mensaje.from);

  // getCampaignLead ya filtra por estado activo (waiting_response/
  // requesting_data) — nunca devuelve una fila terminal ni una sesión
  // histórica de una campaña vieja ya cerrada.
  const lead = await getCampaignLead(supabase, cliente.phone_number_id, telefono);
  if (!lead) return false; // sin sesión activa: nunca fue impactado por una campaña, o ya se resolvió
  if (!lead.plantillaId) return false;

  const config = await getCampaignBotConfig(supabase, cliente.phone_number_id, lead.plantillaId);
  if (!config) return false;

  // Texto CRUDO del botón (no el de normalizarTextoBoton, que tiene su
  // propio diccionario para el bot de encuestas y podría reescribir
  // "SÍ"/"NO" a otra cosa) — mensaje.button sigue disponible aunque
  // procesarCambio ya haya llenado mensaje.text aparte.
  const textoUsuario = mensaje.type === "button" && mensaje.button?.text ? mensaje.button.text : (mensaje.text?.body ?? "");

  const resultado = procesarMensajeCampaña(config, lead.session, textoUsuario);
  await guardarCampaignLead(supabase, lead.dulabsSessionId, resultado.session);

  if (resultado.action === "captured") {
    console.log(
      `[webhook-dulabs] lead capturado (campaña "${config.campaignLabel}") tenant=${config.tenantId} telefono=${telefono}`,
    );
    await sincronizarLeadConDuMo({
      dulabsSessionId: lead.dulabsSessionId,
      tenantId: config.tenantId,
      phoneNumberId: cliente.phone_number_id,
      telefono,
      campanaId: lead.campanaId,
      campaignLabel: config.campaignLabel,
      session: resultado.session,
    });
  }

  for (const texto of resultado.messages) {
    await enviarWhatsApp(cliente, mensaje.from, texto);
  }
  return true;
}

async function atenderMensajeOnboarding(cliente: ClienteConfig, mensaje: MetaMessage): Promise<boolean> {
  const supabase = supabaseAdmin();
  const telefono = soloDigitos(mensaje.from);

  const fila = await obtenerOnboardingSesionActivaPorTelefono(supabase, cliente.phone_number_id, telefono);
  if (!fila) return false; // este teléfono nunca recibió un onboarding -- sigue el flujo normal

  // Gate principal: sesión ya terminal -> no se procesa nada más, ni
  // siquiera se llega a mirar la pausa larga (ver comentario en el
  // dispatch de arriba).
  if (fila.estado === "completado" || fila.estado === "soporte_solicitado") {
    return true;
  }

  // Primer mensaje real del cliente (el del link wa.me del checkout, ver
  // lib/onboarding-trigger.ts) -- todavía no se le ha mandado nada. En vez
  // de tratar ese mensaje como respuesta del flujo (es solo el aviso de
  // "ya pagué", no una decisión), se manda AQUÍ la bienvenida real con
  // botones interactivos -- ya dentro de la ventana de 24h que el cliente
  // acaba de abrir, sin necesitar ninguna plantilla aprobada por Meta.
  if (fila.estado === "menu_enviado" && !fila.bienvenida_enviada_at) {
    await marcarBienvenidaEnviada(supabase, fila.id);
    const { data: authUser } = await supabase.auth.admin.getUserById(fila.id_tenant);
    const nombre = (authUser?.user?.user_metadata?.nombre as string | undefined) ?? null;
    await enviarBotonesWhatsApp(supabase, cliente, mensaje.from, textoBienvenida(nombre, fila.plan), [
      { id: "onboarding_configurar", titulo: BOTON_CONFIGURAR },
      { id: "onboarding_soporte", titulo: BOTON_SOPORTE },
    ]);
    return true;
  }

  const textoUsuario = mensaje.text?.body ?? "";
  if (!textoUsuario) return true; // mensaje sin texto (imagen, audio...) dentro del onboarding: se ignora, no se pierde el progreso

  const resultado = procesarMensajeOnboarding(filaASesion(fila), textoUsuario);
  await guardarOnboardingSesion(supabase, fila.id, resultado.session);

  for (const texto of resultado.messages) {
    await enviarWhatsApp(cliente, mensaje.from, texto);
  }

  if (resultado.session.estado === "completado" || resultado.session.estado === "soporte_solicitado") {
    console.log(
      `[webhook-dulabs] onboarding terminado (${resultado.session.estado}) tenant=${fila.id_tenant} telefono=${telefono}`
    );
    await activarPausaChat(supabase, cliente.phone_number_id, telefono, PAUSA_ONBOARDING_MS);
  }

  return true;
}

// --- Envío por la API de WhatsApp de Meta --------------------------------------

// Cada tenant usa su propio token permanente (Embedded Signup); el token
// global de plataforma queda como respaldo para números registrados a mano.
// (Movido a lib/whatsapp-outbound.ts -- estos son wrappers delgados que
// fijan supabaseAdmin() para no tener que tocar cada llamado existente.)
function resolverTokenMeta(cliente: ClienteConfig): string | null {
  return libResolverTokenMeta(cliente);
}

async function enviarWhatsApp(cliente: ClienteConfig, para: string, texto: string) {
  await libEnviarWhatsApp(supabaseAdmin(), cliente, para, texto);
}

// Si la IA separó su respuesta en párrafos con línea en blanco, se envían
// como mensajes de WhatsApp aparte (como escribiría una persona real) en
// vez de un solo bloque de texto largo. Máximo dos: la primera idea sola, el
// resto junto -- así no se convierte en una ráfaga de mensajes.
async function enviarWhatsAppPartes(cliente: ClienteConfig, para: string, texto: string) {
  await libEnviarWhatsAppPartes(supabaseAdmin(), cliente, para, texto);
}

// --- Historial de mensajes (para la vista de actividad reciente) --------------

// Registra un mensaje en el historial. Devuelve true si este wamid ya
// estaba registrado (constraint único dulabs_mensajes_log_wamid_unico) —
// esa colisión ES la deduplicación real: el llamador debe abortar sin
// repetir ningún efecto secundario. Devuelve false tanto si el mensaje es
// nuevo (se registró bien) como si el insert falló por un motivo distinto a
// duplicado (no bloqueamos el procesamiento por un fallo de logging, mismo
// criterio que ya usaba esta función).
async function registrarMensaje(
  phoneNumberId: string,
  telefonoCliente: string,
  direccion: "entrante" | "saliente",
  contenido: string,
  origen: "entrante" | "ia" | "manual" | "campaña" | "agente",
  wamid?: string
): Promise<boolean> {
  return libRegistrarMensaje(supabaseAdmin(), phoneNumberId, telefonoCliente, direccion, contenido, origen, wamid);
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
