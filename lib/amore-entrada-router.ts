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
import { nombreConocido, recordarNombreCliente, clienteConocidoCompleto } from "@/lib/clientes-conocidos";
import { parseDiaCumpleanos, parseMesCumpleanos, parseCumpleanosNatural } from "@/lib/cumpleanos/parse-cumpleanos-natural";
import { obtenerHistorialRecienteChat } from "@/lib/chats/historial-reciente";
import { normalizeText } from "@/lib/flow-triggers/normalize-text";
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
  MENSAJE_ATENCION_HUMANA_CLIENTE,
  NUMERO_JESSICA,
  MENSAJE_REGISTRO_NOMBRE,
  MENSAJE_REGISTRO_DIA,
  MENSAJE_REGISTRO_MES,
  MENSAJE_DIA_INVALIDO,
  MENSAJE_MES_INVALIDO,
  MENSAJE_REGISTRO_CANCELADO,
  MENSAJE_COMPRA_MENU,
  MENSAJE_COMPRA_OPCION_INVALIDA,
  MENSAJE_COMPRA_ASESOR_CLIENTE,
  MENSAJE_COMPRA_PAGO_REGISTRADO_CLIENTE,
  MENSAJE_COMPRA_RECORDATORIO_PAGO,
  MENSAJE_COMPRA_METODOS_PAGO_PENDIENTE,
  construirMensajeCompraSaludo,
  construirMensajeJessicaCompraAsesor,
  construirMensajeJessicaPagoReportado,
  extraerProductoDeLinkTienda,
  detectarIntencionCompraLibre,
  detectarConfirmacionPago,
  detectarTriggerAgendaDeterminista,
  detectarSolicitudAtencionHumana,
  construirMensajeNotificacionJessica,
  clasificarMensajeConGemini,
  type IntentGemini,
} from "@/lib/amore-entrada-gemini";
import { listarProductosActivos } from "@/lib/amore-inventario";

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
  /** Fase 1 (atención humana, autorizado) -- historial real reciente para dar contexto a Gemini. */
  obtenerHistorial?: typeof obtenerHistorialRecienteChat;
  /** Fase 1 (atención humana, autorizado) -- nombre real ya conocido de la clienta, para la notificación a Jessica. */
  buscarNombreConocido?: typeof nombreConocido;
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

      if (texto === "3") {
        // OPCIÓN 3 (Fase 1, autorizado) -- derivación humana directa desde el
        // menú inicial. Nunca puede haber una sesión Agenda V2 activa en este
        // punto (procesarMensajeConAgendaV2 ya se evaluó antes y devolvió
        // manejado:false, o este mensaje jamás habría llegado hasta acá) --
        // por eso este branch no necesita "pausar" nada, solo activar el modo.
        return await activarAtencionHumana(params, {
          fila,
          enviarMensaje,
          crearEntrada,
          actualizarEntrada,
          buscarNombreConocidoDep: deps.buscarNombreConocido ?? nombreConocido,
        });
      }

      // Mismo criterio EXACTO que el resto de Agenda V2: solo número exacto
      // (1-3), nunca fuzzy -- se reenvía el mismo menú, sin avanzar.
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
      // Fase 1 (atención humana, autorizado) -- historial REAL reciente
      // (dulabs_chat_mensajes, ver lib/chats/historial-reciente.ts) para que
      // Gemini pueda distinguir un afirmativo corto ("Sí porfa") que
      // responde a una pregunta informativa de uno que responde a "¿quieres
      // que te ayude a reservar?" -- nunca se inventa ni se duplica un
      // historial paralelo, se lee tal cual lo que el worker ya persistió.
      const obtenerHistorial = deps.obtenerHistorial ?? obtenerHistorialRecienteChat;
      const historial = await obtenerHistorial(params.supabase, { idTenant: params.idTenant, telefono: params.telefono, wamidActual: params.wamid });
      const resultado = await clasificar({ mensaje: params.texto, historial });
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

/**
 * Fase 1 (atención humana, autorizado) — único punto real que activa el
 * modo 'atencion_humana' y notifica a Jessica, compartido por la opción "3"
 * del menú inicial y por interceptarAtencionHumanaAmore (lenguaje natural,
 * cualquier momento de la conversación) -- sección 11 del pedido: "no
 * agregues lógica duplicada en múltiples capas".
 *
 * Idempotencia real: la notificación a Jessica SOLO se envía si
 * `fila.notificadoAJessica` todavía no es true (o si `fila` no existe
 * todavía, primer contacto). Como toda esta función corre dentro del MISMO
 * candado (whatsapp-qr:<tenantId>, telefono) que ya serializa cualquier
 * mensaje de esta conversación, no hay ventana de carrera real entre leer
 * el flag y escribirlo.
 *
 * Fase 3 (compra de producto, autorizado) -- se EXPORTA y admite
 * `mensajeJessica`/`mensajeCliente` opcionales para que
 * interceptarCompraProductoAmore reutilice tal cual toda la lógica real
 * (transición de modo, notificación idempotente a Jessica, candado) sin
 * duplicarla, cambiando únicamente el texto de los dos mensajes cuando el
 * motivo no es la solicitud genérica de "hablar con Jessica" (ej. "está
 * interesada en un producto" / "reporta pago de producto"). Sin overrides,
 * el comportamiento es IDÉNTICO al de siempre (opción "3" del menú inicial e
 * interceptarAtencionHumanaAmore).
 */
export async function activarAtencionHumana(
  params: { supabase: SupabaseClient; idTenant: string; telefono: string; wamid: string },
  ctx: {
    fila: EntradaAmore | null;
    enviarMensaje: typeof enviarMensajeWhatsApp;
    crearEntrada: typeof crearEntradaAmore;
    actualizarEntrada: typeof actualizarEntradaAmore;
    buscarNombreConocidoDep: typeof nombreConocido;
    mensajeJessica?: string;
    mensajeCliente?: string;
  },
): Promise<{ manejado: true }> {
  const yaNotificado = ctx.fila?.notificadoAJessica ?? false;
  if (!yaNotificado) {
    // nombreConocido se identifica por (phone_number_id, telefono_cliente) --
    // mismo phone_number_id sintético que ya usa Agenda V2/el resto de este
    // puente, nunca uno nuevo (lib/clientes-conocidos.ts).
    const nombre = await ctx.buscarNombreConocidoDep(params.supabase, phoneNumberIdSintetico(params.idTenant), params.telefono);
    // Fase 1 -- deliberadamente NO se llama a Gemini para resumir un motivo
    // (sección "priorizamos confiabilidad" del pedido); usa el único motivo
    // real disponible (construirMensajeNotificacionJessica ya cae a
    // MOTIVO_ATENCION_HUMANA_DEFECTO cuando no se pasa `motivo`).
    await ctx.enviarMensaje({
      tenantId: params.idTenant,
      telefono: NUMERO_JESSICA,
      mensaje: ctx.mensajeJessica ?? construirMensajeNotificacionJessica({ nombre, telefono: params.telefono }),
      origen: "automatico",
    });
  }

  if (ctx.fila) {
    await ctx.actualizarEntrada(params.supabase, ctx.fila.id, { modo: "atencion_humana", notificadoAJessica: true, ultimoWamidProcesado: params.wamid });
  } else {
    // Caso límite real (sección 1 del pedido): primer contacto CON AMORE y el
    // primerísimo mensaje ya es "quiero hablar con Jessica" -- nunca se
    // fuerza el menú de bienvenida antes de atender lo que se pidió
    // explícitamente. Se crea la fila directamente en atencion_humana.
    await ctx.crearEntrada(params.supabase, {
      tenantId: params.idTenant,
      telefonoCliente: params.telefono,
      wamid: params.wamid,
      modo: "atencion_humana",
      notificadoAJessica: true,
    });
  }

  await ctx.enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: ctx.mensajeCliente ?? MENSAJE_ATENCION_HUMANA_CLIENTE, origen: "automatico" });
  return { manejado: true };
}

export interface InterceptarAtencionHumanaDeps {
  adquirirCandadoChat?: typeof adquirirCandadoChat;
  liberarCandadoChat?: typeof liberarCandadoChat;
  buscarEntrada?: typeof buscarEntradaAmore;
  crearEntrada?: typeof crearEntradaAmore;
  actualizarEntrada?: typeof actualizarEntradaAmore;
  enviarMensajeWhatsApp?: typeof enviarMensajeWhatsApp;
  buscarNombreConocido?: typeof nombreConocido;
}

/**
 * Fase 1 (atención humana, autorizado) — GATE GLOBAL, exclusivo de AMORE,
 * que debe llamarse ANTES de procesarMensajeConAgendaV2 (ver
 * app/api/whatsapp-qr-bot/route.ts) -- es la ÚNICA forma real de que:
 *
 * (a) una conversación YA en atencion_humana quede en silencio TOTAL
 *     (ni Gemini, ni Agenda V2, ni Flow Engine reciben el mensaje), y
 * (b) una solicitud EXPLÍCITA de hablar con una persona ("quiero hablar con
 *     Jessica") le gane a una sesión Agenda V2 YA activa, sin tener que
 *     reordenar ni modificar lib/agenda-v2/router.ts en absoluto.
 *
 * Deliberadamente NO reconoce "3" como trigger acá (sección PRIORIDAD DE
 * DETECCIÓN del pedido) -- "3" solo tiene sentido dentro del menú de
 * bienvenida (fila.modo==='inicio', manejado en procesarEntradaAmore); acá
 * sería ambiguo con una selección numérica real de Agenda V2 ("3. Depilación").
 *
 * Devuelve manejado:false SIN escribir nada (ni siquiera ultimo_wamid_procesado)
 * en cualquier otro caso -- así procesarMensajeConAgendaV2/procesarEntradaAmore
 * pueden seguir usando esa misma columna para su propia idempotencia sin
 * ninguna colisión.
 */
export async function interceptarAtencionHumanaAmore(
  params: { supabase: SupabaseClient; idTenant: string; telefono: string; texto: string; wamid: string },
  deps: InterceptarAtencionHumanaDeps = {},
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
  const buscarNombreConocidoDep = deps.buscarNombreConocido ?? nombreConocido;

  const phoneNumberId = phoneNumberIdSintetico(params.idTenant);

  await adquirir(phoneNumberId, params.telefono, params.wamid);
  try {
    let fila: EntradaAmore | null;
    try {
      fila = await buscarEntrada(params.supabase, params.idTenant, params.telefono);
    } catch (err) {
      // Defensivo (mismo criterio EXACTO que el resto del puente) -- si la
      // migración todavía no se aplicó en producción, nunca debe romper el
      // canal: se deja pasar al comportamiento normal.
      console.error("[amore-entrada] error buscando estado (gate atención humana) -- se deja pasar al comportamiento normal", err);
      return { manejado: false };
    }

    // Mismo wamid ya procesado por ESTE gate o por cualquier otro paso del
    // puente -- nunca se reenvía ni se reprocesa (mismo criterio de siempre).
    if (fila && fila.ultimoWamidProcesado === params.wamid) {
      return { manejado: true };
    }

    if (fila?.modo === "atencion_humana") {
      // Corte absoluto -- ni Gemini, ni Agenda V2, ni Flow Engine. El mensaje
      // real ya queda registrado por el worker en dulabs_chat_mensajes (Chats
      // AMORE); acá solo se avanza ultimo_wamid_procesado para no reprocesar
      // este mismo wamid si Baileys lo reintenta.
      await actualizarEntrada(params.supabase, fila.id, { ultimoWamidProcesado: params.wamid });
      return { manejado: true };
    }

    if (detectarSolicitudAtencionHumana(params.texto)) {
      return await activarAtencionHumana(params, { fila, enviarMensaje, crearEntrada, actualizarEntrada, buscarNombreConocidoDep });
    }

    return { manejado: false };
  } finally {
    await liberar(phoneNumberId, params.telefono, params.wamid);
  }
}

const MODOS_REGISTRO = new Set<string>(["registro_nombre", "registro_dia", "registro_mes"]);

export interface InterceptarRegistroClienteDeps {
  adquirirCandadoChat?: typeof adquirirCandadoChat;
  liberarCandadoChat?: typeof liberarCandadoChat;
  buscarEntrada?: typeof buscarEntradaAmore;
  actualizarEntrada?: typeof actualizarEntradaAmore;
  enviarMensajeWhatsApp?: typeof enviarMensajeWhatsApp;
  recordarNombreCliente?: typeof recordarNombreCliente;
  buscarClienteConocido?: typeof clienteConocidoCompleto;
  /** Inyectable para tests -- default real: iniciarNuevaSesionAgendaV2 (lib/agenda-v2/router.ts), sin deps custom. */
  iniciarAgendaV2?: (params: { supabase: SupabaseClient; idTenant: string; telefono: string; wamid: string }) => Promise<void>;
}

/**
 * FASE 2 (autorizado, registro de clientes nuevos) — GATE GLOBAL, exclusivo
 * de AMORE, que debe llamarse DESPUÉS de interceptarAtencionHumanaAmore
 * (esa conserva prioridad absoluta -- "Hablar con Jessica" en cualquier paso
 * del registro sigue funcionando exactamente igual, sin ningún código
 * adicional acá) y ANTES de procesarMensajeConAgendaV2 -- es la ÚNICA forma
 * real de que el registro no pueda saltarse por ninguna de las 3 vías de
 * inicio de Agenda V2: mientras `dulabs_amore_entrada.modo` esté en
 * registro_nombre/dia/mes, este gate se queda con el mensaje ANTES de que
 * esInicioDeAgendaV2 (trigger directo) o la clasificación de Gemini
 * (TRIGGER_AGENDA) puedan verlo.
 *
 * Determinístico de punta a punta -- NUNCA llama a Gemini. Guarda de forma
 * progresiva sobre dulabs_clientes_conocidos (recordarNombreCliente, mismo
 * mecanismo aditivo ya existente) -- nunca una tabla ni un estado paralelo.
 *
 * Devuelve manejado:false SIN escribir nada cuando no hay ningún registro en
 * curso -- así procesarMensajeConAgendaV2/procesarEntradaAmore siguen
 * exactamente igual que hoy para cualquier conversación que no esté
 * registrándose.
 */
export async function interceptarRegistroClienteAmore(
  params: { supabase: SupabaseClient; idTenant: string; telefono: string; texto: string; wamid: string },
  deps: InterceptarRegistroClienteDeps = {},
): Promise<ResultadoEntradaAmore> {
  if (params.idTenant !== AMORE_TENANT_ID) {
    return { manejado: false };
  }

  const adquirir = deps.adquirirCandadoChat ?? adquirirCandadoChat;
  const liberar = deps.liberarCandadoChat ?? liberarCandadoChat;
  const buscarEntrada = deps.buscarEntrada ?? buscarEntradaAmore;
  const actualizarEntrada = deps.actualizarEntrada ?? actualizarEntradaAmore;
  const enviarMensaje = deps.enviarMensajeWhatsApp ?? enviarMensajeWhatsApp;
  const recordarNombre = deps.recordarNombreCliente ?? recordarNombreCliente;
  const buscarCliente = deps.buscarClienteConocido ?? clienteConocidoCompleto;
  const iniciarAgendaV2 = deps.iniciarAgendaV2 ?? ((p) => iniciarNuevaSesionAgendaV2(p));

  const phoneNumberId = phoneNumberIdSintetico(params.idTenant);

  await adquirir(phoneNumberId, params.telefono, params.wamid);
  try {
    let fila: EntradaAmore | null;
    try {
      fila = await buscarEntrada(params.supabase, params.idTenant, params.telefono);
    } catch (err) {
      // Defensivo (mismo criterio EXACTO que el resto del puente) -- si la
      // migración todavía no se aplicó en producción, nunca debe romper el
      // canal: se deja pasar al comportamiento normal.
      console.error("[amore-entrada] error buscando estado (gate registro cliente) -- se deja pasar al comportamiento normal", err);
      return { manejado: false };
    }

    if (!fila || !MODOS_REGISTRO.has(fila.modo)) {
      // Sin registro en curso -- deja pasar SIN escribir nada, para no
      // interferir con la idempotencia de wamid de los pasos siguientes.
      return { manejado: false };
    }

    // Mismo wamid ya procesado -- nunca se reenvía nada ni se reprocesa.
    if (fila.ultimoWamidProcesado === params.wamid) {
      return { manejado: true };
    }

    const texto = params.texto.trim();

    if (normalizeText(texto) === "cancelar") {
      // Mismo comando global EXACTO ya usado por Agenda V2 (COMANDO_CANCELAR,
      // lib/agenda-v2/controlador.ts): coincidencia EXACTA tras normalizar,
      // nunca "contains", nunca "cancelar cita"/"no quiero" (esas frases no
      // están cubiertas por el mecanismo real que se está reutilizando).
      // Nunca crea una sesión de Agenda V2 -- solo vuelve al estado de
      // conversación normal.
      await actualizarEntrada(params.supabase, fila.id, { modo: "gemini", ultimoWamidProcesado: params.wamid });
      await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_REGISTRO_CANCELADO, origen: "automatico" });
      return { manejado: true };
    }

    if (fila.modo === "registro_nombre") {
      // Sección NOMBRE del pedido -- sin validación rígida, se acepta el
      // texto tal cual (mismo criterio que recordarNombreCliente, que ya
      // recorta espacios y descarta solo una cadena vacía).
      await recordarNombre(params.supabase, { idTenant: params.idTenant, phoneNumberId, telefonoCliente: params.telefono, nombre: texto });
      await actualizarEntrada(params.supabase, fila.id, { modo: "registro_dia", ultimoWamidProcesado: params.wamid });
      await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_REGISTRO_DIA, origen: "automatico" });
      return { manejado: true };
    }

    if (fila.modo === "registro_dia") {
      // Corrección post-deploy (auditoría real, autorizado) -- un mensaje
      // real puede traer día Y mes juntos ("3 de enero"), en vez de solo el
      // día que este paso espera; parseDiaCumpleanos (solo dígitos puros,
      // ver lib/cumpleanos/parse-cumpleanos-natural.ts) rechazaba eso por
      // completo, dejando a la clienta atascada pidiendo un "día válido" a
      // pesar de haber respondido correctamente. Se intenta PRIMERO el
      // parser combinado ya existente (parseCumpleanosNatural, sin ningún
      // cambio) -- si reconoce una fecha real, completa el registro de una
      // sola vez (nunca pide el mes de nuevo). Si no reconoce nada
      // combinado, cae EXACTAMENTE al comportamiento anterior (solo día).
      const fechaNatural = parseCumpleanosNatural(texto);
      if (fechaNatural.ok) {
        const clienteConDiaYMes = await buscarCliente(params.supabase, phoneNumberId, params.telefono);
        if (!clienteConDiaYMes) {
          // Mismo defensivo EXACTO que el resto de este flujo -- nunca
          // inventa un nombre si por algún error real no quedó persistido.
          await actualizarEntrada(params.supabase, fila.id, { modo: "registro_nombre", ultimoWamidProcesado: params.wamid });
          await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_REGISTRO_NOMBRE, origen: "automatico" });
          return { manejado: true };
        }
        await recordarNombre(params.supabase, {
          idTenant: params.idTenant,
          phoneNumberId,
          telefonoCliente: params.telefono,
          nombre: clienteConDiaYMes.nombre,
          cumpleDia: fechaNatural.dia,
          cumpleMes: fechaNatural.mes,
        });
        // Registro completo -- MISMO camino exacto que el cierre normal de
        // registro_mes (vuelve a modo "gemini" y entrega el control a
        // Agenda V2 vía iniciarNuevaSesionAgendaV2), solo que sin haber
        // pasado por el paso intermedio de pedir el mes.
        await actualizarEntrada(params.supabase, fila.id, { modo: "gemini", ultimoWamidProcesado: params.wamid });
        await iniciarAgendaV2({ supabase: params.supabase, idTenant: params.idTenant, telefono: params.telefono, wamid: params.wamid });
        return { manejado: true };
      }

      const dia = parseDiaCumpleanos(texto);
      if (dia === null) {
        await actualizarEntrada(params.supabase, fila.id, { ultimoWamidProcesado: params.wamid });
        await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_DIA_INVALIDO, origen: "automatico" });
        return { manejado: true };
      }
      const clienteActual = await buscarCliente(params.supabase, phoneNumberId, params.telefono);
      if (!clienteActual) {
        // Defensivo -- el nombre debió guardarse en el paso anterior; si por
        // algún error real no quedó persistido, nunca se inventa un nombre:
        // se reinicia el registro desde el principio.
        await actualizarEntrada(params.supabase, fila.id, { modo: "registro_nombre", ultimoWamidProcesado: params.wamid });
        await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_REGISTRO_NOMBRE, origen: "automatico" });
        return { manejado: true };
      }
      await recordarNombre(params.supabase, { idTenant: params.idTenant, phoneNumberId, telefonoCliente: params.telefono, nombre: clienteActual.nombre, cumpleDia: dia });
      await actualizarEntrada(params.supabase, fila.id, { modo: "registro_mes", ultimoWamidProcesado: params.wamid });
      await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_REGISTRO_MES, origen: "automatico" });
      return { manejado: true };
    }

    // fila.modo === "registro_mes"
    const mes = parseMesCumpleanos(texto);
    if (mes === null) {
      await actualizarEntrada(params.supabase, fila.id, { ultimoWamidProcesado: params.wamid });
      await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_MES_INVALIDO, origen: "automatico" });
      return { manejado: true };
    }
    const clienteActual = await buscarCliente(params.supabase, phoneNumberId, params.telefono);
    if (!clienteActual) {
      // Mismo defensivo de arriba -- nunca inventa datos faltantes.
      await actualizarEntrada(params.supabase, fila.id, { modo: "registro_nombre", ultimoWamidProcesado: params.wamid });
      await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_REGISTRO_NOMBRE, origen: "automatico" });
      return { manejado: true };
    }
    await recordarNombre(params.supabase, { idTenant: params.idTenant, phoneNumberId, telefonoCliente: params.telefono, nombre: clienteActual.nombre, cumpleMes: mes });
    // Registro completo -- vuelve al estado de conversación normal y entrega
    // el control a Agenda V2 vía el MISMO mecanismo existente
    // (iniciarNuevaSesionAgendaV2): la clienta ya existe en
    // dulabs_clientes_conocidos, así que esta vez sigue directo a categorías
    // reales, nunca una segunda lógica de creación de sesión.
    await actualizarEntrada(params.supabase, fila.id, { modo: "gemini", ultimoWamidProcesado: params.wamid });
    await iniciarAgendaV2({ supabase: params.supabase, idTenant: params.idTenant, telefono: params.telefono, wamid: params.wamid });
    return { manejado: true };
  } finally {
    await liberar(phoneNumberId, params.telefono, params.wamid);
  }
}

const MODOS_COMPRA = new Set<string>(["compra_producto_opcion", "compra_esperando_pago"]);

export interface InterceptarCompraProductoDeps {
  adquirirCandadoChat?: typeof adquirirCandadoChat;
  liberarCandadoChat?: typeof liberarCandadoChat;
  buscarEntrada?: typeof buscarEntradaAmore;
  crearEntrada?: typeof crearEntradaAmore;
  actualizarEntrada?: typeof actualizarEntradaAmore;
  enviarMensajeWhatsApp?: typeof enviarMensajeWhatsApp;
  buscarNombreConocido?: typeof nombreConocido;
  /** Inyectable para tests -- default real: listarProductosActivos (lib/amore-inventario.ts). Solo se consulta cuando el mensaje NO viene del link de la tienda (ver extraerProductoDeLinkTienda), para el reconocimiento de texto libre. */
  listarProductosActivos?: typeof listarProductosActivos;
}

/**
 * FASE 3 (autorizado, compra de producto) — GATE GLOBAL, exclusivo de AMORE,
 * que debe llamarse DESPUÉS de interceptarRegistroClienteAmore y ANTES de
 * procesarMensajeConAgendaV2 (ver app/api/whatsapp-qr-bot/route.ts) --
 * decisión aprobada explícitamente: una intención INEQUÍVOCA de compra debe
 * poder interrumpir una sesión de Agenda V2 ya activa (mismo precedente que
 * "hablar con Jessica" en interceptarAtencionHumanaAmore), pero SOLO cuando
 * la intención es realmente clara -- nunca por palabras sueltas como
 * "producto"/"comprar"/"pago" (ver detectarIntencionCompraLibre y
 * extraerProductoDeLinkTienda en lib/amore-entrada-gemini.ts).
 *
 * Dos responsabilidades, igual que interceptarAtencionHumanaAmore:
 * (a) CONTINUAR un flujo de compra ya en curso (fila.modo en
 *     compra_producto_opcion/compra_esperando_pago) -- mientras dure, este
 *     gate se queda con TODOS los mensajes (nunca deja pasar al Flow
 *     Engine/Gemini con un modo que no sabrían interpretar).
 * (b) DETECTAR una intención nueva cuando no hay flujo en curso -- por el
 *     link de la tienda (prioridad absoluta, aprobado) o por texto libre
 *     explícito que además mencione un producto activo real.
 *
 * "Ya pagué" se reconoce ÚNICAMENTE dentro de compra_esperando_pago -- nunca
 * como trigger global (aprobado explícitamente).
 *
 * Devuelve manejado:false SIN escribir nada cuando no hay flujo en curso ni
 * intención detectada -- así procesarMensajeConAgendaV2/procesarEntradaAmore
 * siguen exactamente igual que hoy para cualquier conversación ajena a este
 * flujo.
 */
export async function interceptarCompraProductoAmore(
  params: { supabase: SupabaseClient; idTenant: string; telefono: string; texto: string; wamid: string },
  deps: InterceptarCompraProductoDeps = {},
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
  const buscarNombreConocidoDep = deps.buscarNombreConocido ?? nombreConocido;
  const obtenerProductosActivos = deps.listarProductosActivos ?? listarProductosActivos;

  const phoneNumberId = phoneNumberIdSintetico(params.idTenant);

  await adquirir(phoneNumberId, params.telefono, params.wamid);
  try {
    let fila: EntradaAmore | null;
    try {
      fila = await buscarEntrada(params.supabase, params.idTenant, params.telefono);
    } catch (err) {
      // Defensivo (mismo criterio EXACTO que el resto del puente) -- si la
      // migración todavía no se aplicó en producción, nunca debe romper el
      // canal: se deja pasar al comportamiento normal.
      console.error("[amore-entrada] error buscando estado (gate compra producto) -- se deja pasar al comportamiento normal", err);
      return { manejado: false };
    }

    // Mismo wamid ya procesado por ESTE gate o por cualquier otro paso del
    // puente -- nunca se reenvía ni se reprocesa.
    if (fila && fila.ultimoWamidProcesado === params.wamid) {
      return { manejado: true };
    }

    const texto = params.texto.trim();

    if (fila && MODOS_COMPRA.has(fila.modo)) {
      // (a) Continuación de un flujo de compra ya en curso.
      if (fila.modo === "compra_producto_opcion") {
        if (texto === "1") {
          await actualizarEntrada(params.supabase, fila.id, { modo: "compra_esperando_pago", ultimoWamidProcesado: params.wamid });
          await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_COMPRA_METODOS_PAGO_PENDIENTE, origen: "automatico" });
          return { manejado: true };
        }
        if (texto === "2") {
          const producto = fila.productoInteresNombre ?? "un producto";
          return await activarAtencionHumana(params, {
            fila,
            enviarMensaje,
            crearEntrada,
            actualizarEntrada,
            buscarNombreConocidoDep,
            mensajeJessica: construirMensajeJessicaCompraAsesor(producto),
            mensajeCliente: MENSAJE_COMPRA_ASESOR_CLIENTE,
          });
        }
        // Mismo criterio EXACTO que el resto del puente: solo número exacto
        // (1-2), nunca fuzzy -- se reenvía el mismo menú, sin avanzar.
        await actualizarEntrada(params.supabase, fila.id, { ultimoWamidProcesado: params.wamid });
        await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_COMPRA_OPCION_INVALIDA, origen: "automatico" });
        return { manejado: true };
      }

      // fila.modo === "compra_esperando_pago"
      if (detectarConfirmacionPago(texto)) {
        const producto = fila.productoInteresNombre ?? "un producto";
        await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_COMPRA_PAGO_REGISTRADO_CLIENTE, origen: "automatico" });
        // Reutiliza tal cual activarAtencionHumana -- pero el mensaje al
        // cliente YA se envió arriba con el texto exacto pedido para "Ya
        // pagué" (distinto del de "hablar con un asesor"), así que acá se
        // pasa un mensajeCliente vacío-no-aplica: en vez de reenviar un
        // segundo mensaje, se reutiliza únicamente la parte de
        // notificación/transición de modo pasando el mismo texto ya
        // enviado (idempotente si algún día se reintenta).
        return await activarAtencionHumana(params, {
          fila,
          enviarMensaje,
          crearEntrada,
          actualizarEntrada,
          buscarNombreConocidoDep,
          mensajeJessica: construirMensajeJessicaPagoReportado(producto),
          mensajeCliente: MENSAJE_COMPRA_PAGO_REGISTRADO_CLIENTE,
        });
      }
      // No es "Ya pagué" -- nunca se deja pasar a Gemini/Agenda V2 mientras
      // se espera el pago (el gate de atención humana, evaluado ANTES que
      // este, ya intercepta "hablar con Jessica" en cualquier momento).
      await actualizarEntrada(params.supabase, fila.id, { ultimoWamidProcesado: params.wamid });
      await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_COMPRA_RECORDATORIO_PAGO, origen: "automatico" });
      return { manejado: true };
    }

    // (b) Sin flujo de compra en curso -- ¿es una intención NUEVA?
    // 1) Link de la tienda: prioridad absoluta, aprobado -- ni siquiera
    //    necesita consultar el catálogo real (el nombre viene del propio
    //    mensaje, generado por nuestra propia tienda).
    let productoDetectado = extraerProductoDeLinkTienda(params.texto);
    if (!productoDetectado) {
      // 2) Texto libre -- exige verbo de compra explícito Y que mencione un
      //    producto activo real (nunca "producto"/"comprar" sueltos).
      const productos = await obtenerProductosActivos(params.supabase, params.idTenant);
      productoDetectado = detectarIntencionCompraLibre(params.texto, productos.map((p) => p.nombre));
    }
    if (!productoDetectado) {
      return { manejado: false };
    }

    const saludo = construirMensajeCompraSaludo(productoDetectado);
    if (fila) {
      await actualizarEntrada(params.supabase, fila.id, {
        modo: "compra_producto_opcion",
        ultimoWamidProcesado: params.wamid,
        productoInteresNombre: productoDetectado,
      });
    } else {
      // Primer contacto real y el primerísimo mensaje ya es un "Comprar" de
      // la tienda -- mismo criterio EXACTO que activarAtencionHumana: nunca
      // se fuerza el menú de bienvenida antes de atender lo que se pidió.
      await crearEntrada(params.supabase, {
        tenantId: params.idTenant,
        telefonoCliente: params.telefono,
        wamid: params.wamid,
        modo: "compra_producto_opcion",
        productoInteresNombre: productoDetectado,
      });
    }
    await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: saludo, origen: "automatico" });
    await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_COMPRA_MENU, origen: "automatico" });
    return { manejado: true };
  } finally {
    await liberar(phoneNumberId, params.telefono, params.wamid);
  }
}
