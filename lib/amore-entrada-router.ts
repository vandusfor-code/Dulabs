/**
 * AMORE (autorizado, Fase 9) — puente conversacional: bienvenida (menú 1/2)
 * -> Gemini (clasifica CONSULTA/TRIGGER_AGENDA) -> Agenda V2. ÚNICO punto
 * de entrada para este puente; se llama desde app/api/whatsapp-qr-bot/route.ts
 * DESPUÉS de procesarMensajeConAgendaV2 (que sigue teniendo prioridad
 * absoluta mientras haya una sesión Agenda V2 activa) y ANTES de
 * ejecutarBotWhatsAppQR (Flow Engine) -- EXCLUSIVO de AMORE: cualquier otro
 * tenant devuelve manejado:false de inmediato, sin tocar nada, y sigue el
 * comportamiento normal de siempre.
 *
 * Reutiliza EXACTAMENTE (nunca duplica):
 * - adquirirCandadoChat/liberarCandadoChat (lib/chat-lock.ts) -- MISMO
 *   candado real y MISMA convención de phone_number_id sintético que ya usa
 *   Agenda V2 (lib/agenda-v2/router.ts).
 * - iniciarNuevaSesionAgendaV2 (lib/agenda-v2/router.ts) -- entrega el
 *   control a Agenda V2 sin duplicar su lógica de creación de sesión.
 * - enviarMensajeWhatsApp (lib/whatsapp-worker-client.ts).
 * - clasificarMensajeConGemini/detectarTriggerAgendaDeterminista
 *   (lib/amore-entrada-gemini.ts) -- Gemini ÚNICAMENTE clasifica, nunca crea
 *   ni modifica citas, nunca llama a Nylas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { adquirirCandadoChat, liberarCandadoChat } from "@/lib/chat-lock";
import { enviarMensajeWhatsApp } from "@/lib/whatsapp-worker-client";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import { iniciarNuevaSesionAgendaV2 } from "@/lib/agenda-v2/router";
import {
  buscarEntradaAmore,
  crearEntradaAmore,
  actualizarEntradaAmore,
  type EntradaAmore,
} from "@/lib/amore-entrada-sesiones";
import {
  MENSAJE_BIENVENIDA_1,
  MENSAJE_BIENVENIDA_2,
  MENSAJE_MENU_INICIO_INVALIDO,
  MENSAJE_GEMINI_BIENVENIDA,
  MENSAJE_TRANSICION_AGENDA,
  detectarTriggerAgendaDeterminista,
  clasificarMensajeConGemini,
  type IntentGemini,
} from "@/lib/amore-entrada-gemini";

/** Mismo prefijo sintético EXACTO que ya usa lib/agenda-v2/router.ts (nunca un phone_number_id real de Meta). */
function phoneNumberIdSintetico(tenantId: string): string {
  return `whatsapp-qr:${tenantId}`;
}

export interface AmoreEntradaDeps {
  adquirirCandadoChat?: typeof adquirirCandadoChat;
  liberarCandadoChat?: typeof liberarCandadoChat;
  buscarEntrada?: typeof buscarEntradaAmore;
  crearEntrada?: typeof crearEntradaAmore;
  actualizarEntrada?: typeof actualizarEntradaAmore;
  enviarMensajeWhatsApp?: typeof enviarMensajeWhatsApp;
  clasificarConGemini?: typeof clasificarMensajeConGemini;
  /** Inyectable para tests -- default real: iniciarNuevaSesionAgendaV2 (lib/agenda-v2/router.ts), sin deps custom. */
  iniciarAgendaV2?: (params: { supabase: SupabaseClient; idTenant: string; telefono: string; wamid: string }) => Promise<void>;
}

export type ResultadoEntradaAmore = { manejado: boolean };

/**
 * Único punto de entrada del puente. Devuelve `manejado:false` de inmediato
 * para cualquier tenant que no sea AMORE (sección MULTI-TENANT del pedido)
 * -- ningún otro tenant ve ningún cambio de comportamiento.
 */
export async function procesarEntradaAmore(
  params: { supabase: SupabaseClient; idTenant: string; telefono: string; texto: string; wamid: string },
  deps: AmoreEntradaDeps = {},
): Promise<ResultadoEntradaAmore> {
  if (params.idTenant !== AMORE_TENANT_ID) {
    return { manejado: false };
  }

  const adquirir = deps.adquirirCandadoChat ?? adquirirCandadoChat;
  const liberar = deps.liberarCandadoChat ?? liberarCandadoChat;
  const buscarEntrada = deps.buscarEntrada ?? buscarEntradaAmore;
  const crearEntrada = deps.crearEntrada ?? crearEntradaAmore;
  const actualizarEntrada = deps.actualizarEntrada ?? actualizarEntradaAmore;
  const enviarMensaje = deps.enviarMensajeWhatsApp ?? enviarMensajeWhatsApp;
  const clasificar = deps.clasificarConGemini ?? clasificarMensajeConGemini;
  const iniciarAgendaV2 = deps.iniciarAgendaV2 ?? ((p) => iniciarNuevaSesionAgendaV2(p));

  const phoneNumberId = phoneNumberIdSintetico(params.idTenant);

  await adquirir(phoneNumberId, params.telefono, params.wamid);
  try {
    let fila: EntradaAmore | null;
    try {
      fila = await buscarEntrada(params.supabase, params.idTenant, params.telefono);
    } catch (err) {
      // Defensivo (mismo criterio EXACTO que lib/agenda-v2/router.ts) -- si
      // la migración de dulabs_amore_entrada todavía no se aplicó en
      // producción, nunca debe romper el canal: se deja pasar al
      // comportamiento normal (Flow Engine + Gemini de siempre).
      console.error("[amore-entrada] error buscando estado -- se deja pasar al comportamiento normal", err);
      return { manejado: false };
    }

    // Mismo wamid ya procesado -- nunca se reenvía nada ni se reprocesa
    // (sección IDEMPOTENCIA del pedido).
    if (fila && fila.ultimoWamidProcesado === params.wamid) {
      return { manejado: true };
    }

    if (!fila) {
      // PRIMER CONTACTO real -- dos mensajes SEPARADOS (sección del pedido).
      await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_BIENVENIDA_1, origen: "automatico" });
      await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_BIENVENIDA_2, origen: "automatico" });
      await crearEntrada(params.supabase, { tenantId: params.idTenant, telefonoCliente: params.telefono, wamid: params.wamid, modo: "inicio" });
      return { manejado: true };
    }

    if (fila.modo === "inicio") {
      const texto = params.texto.trim();

      if (texto === "1") {
        // OPCIÓN 1 -- entrega inmediata a Agenda V2. NUNCA pasa por Gemini,
        // NUNCA hace clasificación de intención, NUNCA conversación
        // intermedia (sección OPCIÓN 1 del pedido).
        await actualizarEntrada(params.supabase, fila.id, { modo: "gemini", ultimoWamidProcesado: params.wamid });
        await iniciarAgendaV2({ supabase: params.supabase, idTenant: params.idTenant, telefono: params.telefono, wamid: params.wamid });
        return { manejado: true };
      }

      if (texto === "2") {
        // OPCIÓN 2 -- entra al modo conversacional con Gemini.
        await actualizarEntrada(params.supabase, fila.id, { modo: "gemini", ultimoWamidProcesado: params.wamid });
        await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_GEMINI_BIENVENIDA, origen: "automatico" });
        return { manejado: true };
      }

      // Mismo criterio EXACTO que el resto de Agenda V2: solo número exacto
      // (1-2), nunca fuzzy -- se reenvía el mismo menú, sin avanzar.
      await actualizarEntrada(params.supabase, fila.id, { ultimoWamidProcesado: params.wamid });
      await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_MENU_INICIO_INVALIDO, origen: "automatico" });
      return { manejado: true };
    }

    // fila.modo === "gemini" -- FAST TRACK DETERMINISTA primero (evita
    // latencia y evita que un mensaje obvio quede atrapado en Gemini).
    let intent: IntentGemini;
    let replyText = "";
    if (detectarTriggerAgendaDeterminista(params.texto)) {
      intent = "TRIGGER_AGENDA";
    } else {
      const resultado = await clasificar({ mensaje: params.texto });
      intent = resultado.intent;
      replyText = resultado.replyText;
      // detectedServiceMention se recibe pero deliberadamente NO se usa
      // todavía (sección CONTEXTO DEL SERVICIO del pedido: "si integrar el
      // servicio directamente complica la arquitectura actual, NO hacerlo
      // todavía" -- Agenda V2 siempre arranca desde su flujo normal, nunca
      // con una selección de servicio asumida silenciosamente).
    }

    if (intent === "TRIGGER_AGENDA") {
      // PROBLEMA CRÍTICO resuelto -- Gemini deja de conversar de inmediato,
      // "reply_text" se IGNORA (sección STRUCTURED OUTPUT del pedido), y el
      // backend entrega el control a Agenda V2 usando el mecanismo existente.
      await actualizarEntrada(params.supabase, fila.id, { ultimoWamidProcesado: params.wamid });
      await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_TRANSICION_AGENDA, origen: "automatico" });
      await iniciarAgendaV2({ supabase: params.supabase, idTenant: params.idTenant, telefono: params.telefono, wamid: params.wamid });
      return { manejado: true };
    }

    // CONSULTA -- Gemini sigue conversando normalmente.
    await actualizarEntrada(params.supabase, fila.id, { ultimoWamidProcesado: params.wamid });
    await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: replyText, origen: "automatico" });
    return { manejado: true };
  } finally {
    await liberar(phoneNumberId, params.telefono, params.wamid);
  }
}
